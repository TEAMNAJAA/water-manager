from dataclasses import asdict, dataclass, field
from functools import lru_cache

import numpy as np

from . import digits as D
from .dial import read_dial
from .model import DEFAULT, MLP
from .quality import assess
from .validate import check

AUTO_ACCEPT = 0.95


@lru_cache
def model(path=str(DEFAULT)):
    return MLP.load(path)


@dataclass
class Reading:
    value: int | None
    digits: str
    confidence: float
    auto_ok: bool
    box: list | None
    cells: list = field(default_factory=list)
    alternative: int | None = None
    quality: dict = field(default_factory=dict)
    issues: list = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


def read_window(window, n, mlp=None):
    p = (mlp or model()).proba(D.features(D.split(window, n)))
    top = p.argmax(1)
    conf = p.max(1)
    second = np.argsort(p, 1)[:, -2]
    weak = int(conf.argmin())
    alt = top.copy()
    alt[weak] = second[weak]
    cells = [{"digit": int(t), "p": round(float(c), 3), "alt": int(s)} for t, c, s in zip(top, conf, second)]
    return "".join(map(str, top)), float(conf.min()), int("".join(map(str, alt))), cells


def read_counter(img, n, roi=None, exact=False, prev=None, hours=None, max_flow=None, mlp=None):
    q = assess(img)
    window_img = D.crop(img, roi) if roi is not None else img
    box = None if exact or roi is not None else D.locate(img, n)
    if box is not None:
        window_img = D.crop(img, box)
    text, conf, alt, cells = read_window(window_img, n, mlp)
    value = int(text)
    issues = q["issues"] + check(value, prev, hours, max_flow, n)
    return Reading(value, text, round(conf, 3), prev is not None and conf >= AUTO_ACCEPT and not issues,
                   None if box is None else [round(float(v), 1) for v in box], cells, alt, q, issues)


__all__ = ["Reading", "read_counter", "read_window", "read_dial", "model"]
