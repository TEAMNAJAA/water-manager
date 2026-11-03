import base64
import json
from pathlib import Path

import numpy as np

DEFAULT = Path(__file__).parent / "models" / "digits.json"


def _enc(a, dtype="<f2"):
    return {"shape": list(a.shape), "dtype": dtype, "data": base64.b64encode(np.asarray(a, dtype).tobytes()).decode()}


def _dec(o):
    return np.frombuffer(base64.b64decode(o["data"]), o["dtype"]).astype(np.float32).reshape(o["shape"])


class MLP:
    def __init__(self, mean, scale, layers, meta=None):
        self.mean, self.scale, self.layers, self.meta = mean, scale, layers, meta or {}

    @classmethod
    def fit(cls, X, y, hidden=(96,), seed=0, **meta):
        from sklearn.neural_network import MLPClassifier
        mean, scale = X.mean(0), X.std(0) + 1e-6
        clf = MLPClassifier(hidden, alpha=1e-4, batch_size=256, max_iter=60, early_stopping=True,
                            n_iter_no_change=6, random_state=seed)
        clf.fit((X - mean) / scale, y)
        return cls(mean, scale, list(zip(clf.coefs_, clf.intercepts_)), {**meta, "val_acc": float(clf.best_validation_score_)})

    def proba(self, X):
        z = (np.asarray(X, np.float32) - self.mean) / self.scale
        for i, (W, b) in enumerate(self.layers):
            z = z @ W + b
            if i < len(self.layers) - 1:
                z = np.maximum(z, 0)
        z = np.exp(z - z.max(1, keepdims=True))
        return z / z.sum(1, keepdims=True)

    def save(self, path=DEFAULT):
        doc = {"meta": self.meta, "mean": _enc(self.mean, "<f4"), "scale": _enc(self.scale, "<f4"),
               "layers": [{"W": _enc(W), "b": _enc(b)} for W, b in self.layers]}
        Path(path).write_text(json.dumps(doc))

    @classmethod
    def load(cls, path=DEFAULT):
        doc = json.loads(Path(path).read_text())
        return cls(_dec(doc["mean"]), _dec(doc["scale"]), [(_dec(l["W"]), _dec(l["b"])) for l in doc["layers"]], doc["meta"])
