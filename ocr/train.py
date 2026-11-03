import argparse
import time
from multiprocessing import Pool

import numpy as np

from namjai_ocr import digits as D
from namjai_ocr import synth as S
from namjai_ocr.model import DEFAULT, MLP


def hiou(a, b):
    return max(0, min(a[2], b[2]) - max(a[0], b[0])) / (max(a[2], b[2]) - min(a[0], b[0]))


def jitter(box, rng):
    w, h = box[2] - box[0], box[3] - box[1]
    d = rng.uniform([-0.03, -0.1, -0.03, -0.1], [0.03, 0.1, 0.03, 0.1]) * [w, h, w, h]
    return box + d


def chunk(seed, count=400):
    rng = np.random.default_rng(seed)
    fonts = S.fonts(S.TRAIN_FONTS)
    X, y = [], []
    for i in range(count):
        cond = S.CONDITIONS[i % len(S.CONDITIONS)]
        loose = rng.random() < 0.5
        img, box, value, n = S.sample_counter(rng, fonts, cond, loose)
        if loose:
            found = D.locate(img, n)
            box = found if found is not None and hiou(found, box) > 0.85 else jitter(box, rng)
        else:
            box = jitter(box, rng)
        X.append(D.features(D.split(D.crop(img, box), n)))
        y.extend(int(c) for c in f"{value:0{n}d}")
    return np.vstack(X), np.array(y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunks", type=int, default=40)
    ap.add_argument("--hidden", type=int, default=128)
    a = ap.parse_args()
    t = time.time()
    with Pool() as p:
        parts = p.map(chunk, range(1000, 1000 + a.chunks))
    X = np.vstack([x for x, _ in parts])
    y = np.concatenate([y for _, y in parts])
    print(f"{len(y)} cells in {time.time() - t:.0f}s")
    m = MLP.fit(X, y, (a.hidden,), fonts=list(S.TRAIN_FONTS), cells=len(y), data="synthetic")
    m.save(DEFAULT)
    print(f"val_acc={m.meta['val_acc']:.4f} saved {DEFAULT} in {time.time() - t:.0f}s")


if __name__ == "__main__":
    main()
