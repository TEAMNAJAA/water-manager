import os
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

CONDITIONS = ("clear", "dust", "fog", "night")
SPOILS = ("blur", "dark", "glare")
TRAIN_FONTS = (
    "DejaVuSans-Bold", "LiberationSans-Bold", "FreeSansBold", "Inter-Bold",
    "JetBrainsMono-Bold", "LiberationMono-Bold", "DejaVuSansMono-Bold", "Loma-Bold",
)
HOLDOUT_FONTS = ("Carlito-Bold", "FreeMonoBold")
FONT_DIRS = ("/usr/share/fonts", "/usr/local/share/fonts", "~/.fonts", "/Library/Fonts", "/System/Library/Fonts", "C:/Windows/Fonts")


@lru_cache
def fonts(names):
    found = {}
    for d in FONT_DIRS:
        root = Path(os.path.expanduser(d))
        if root.exists():
            for p in root.rglob("*"):
                if p.suffix.lower() in (".ttf", ".otf") and p.stem in names:
                    found.setdefault(p.stem, str(p))
    return tuple(found[n] for n in names if n in found)


@lru_cache(maxsize=512)
def _font(path, size):
    return ImageFont.truetype(path, size) if path else ImageFont.load_default(size)


def positions(value, n, frac):
    pos, carry = [], frac
    for i in range(n):
        d = value // 10 ** i % 10
        pos.append(d + carry)
        carry = carry if d == 9 else 0.0
    return pos[::-1]


def style(rng, font_paths):
    dark = rng.random() < 0.7
    ink = tuple(int(v) for v in rng.integers(15, 55, 3)) if dark else tuple(int(v) for v in rng.integers(215, 250, 3))
    paper = tuple(int(v) for v in rng.integers(210, 248, 3)) if dark else tuple(int(v) for v in rng.integers(15, 50, 3))
    return {
        "font": font_paths[rng.integers(len(font_paths))] if font_paths else None,
        "ink": ink,
        "paper": paper,
        "red": int(rng.choice([0, 0, 1, 2, 3])),
        "red_inverse": bool(rng.random() < 0.5),
        "cw": int(rng.integers(26, 46)),
        "ratio": float(rng.uniform(1.3, 1.75)),
        "gap": float(rng.uniform(0.06, 0.2)),
        "shade": float(rng.uniform(0.1, 0.45)),
        "scale": float(rng.uniform(0.55, 0.75)),
        "frame": tuple(int(v) for v in rng.integers(25, 70, 3)),
    }


def wheel(pos, font, w, h, ink, paper, scale, shade):
    base = int(np.floor(pos))
    frac = pos - base
    f = _font(font, max(8, int(h * scale)))
    strip = Image.new("RGB", (w, 3 * h), paper)
    draw = ImageDraw.Draw(strip)
    _, t, _, b = draw.textbbox((0, 0), "0", font=f)
    for j in range(3):
        s = str((base + j - 1) % 10)
        l, _, r, _ = draw.textbbox((0, 0), s, font=f)
        draw.text(((w - (r - l)) / 2 - l, j * h + (h - (b - t)) / 2 - t), s, font=f, fill=ink)
    y0 = int(round(h + frac * h))
    cell = np.asarray(strip, np.float32)[y0:y0 + h]
    y = np.linspace(-1, 1, h)[:, None, None]
    return cell * (1 - shade * y ** 2)


def counter(value, n, frac, st):
    w, h = st["cw"], int(st["cw"] * st["ratio"])
    g = max(2, int(w * st["gap"]))
    red_ink, red_paper = ((245, 245, 240), (185, 25, 30)) if st["red_inverse"] else ((200, 25, 30), (240, 238, 232))
    cells = []
    for i, p in enumerate(positions(value, n, frac)):
        is_red = i >= n - st["red"]
        ink, paper = (red_ink, red_paper) if is_red else (st["ink"], st["paper"])
        cells.append(wheel(p, st["font"], w, h, ink, paper, st["scale"], st["shade"]))
    frame = np.array(st["frame"], np.float32)
    H, W = h + 2 * g, n * w + (n + 1) * g
    out = np.empty((H, W, 3), np.float32)
    out[:] = frame
    for i, c in enumerate(cells):
        x = g + i * (w + g)
        out[g:g + h, x:x + w] = c
    return np.clip(out, 0, 255).astype(np.uint8)[:, :, ::-1].copy()


def scene(win, rng, loose):
    h, w = win.shape[:2]
    if loose:
        mx, my = rng.uniform(0.08, 0.35) * w, rng.uniform(0.35, 1.2) * h
    else:
        mx, my = rng.uniform(0, 0.04) * w, rng.uniform(0, 0.06) * h
    mx, my = int(mx), int(my)
    face = np.array(rng.integers(170, 240, 3), np.uint8)
    img = np.empty((h + 2 * my, w + 2 * mx, 3), np.uint8)
    img[:] = face
    img[my:my + h, mx:mx + w] = win
    if loose:
        ink = tuple(int(v) for v in rng.integers(20, 80, 3))
        fs = max(0.3, h / 80)
        cv2.putText(img, "m3", (mx + w + 4, my + int(h * 0.7)), cv2.FONT_HERSHEY_SIMPLEX, fs * 0.8, ink, 1, cv2.LINE_AA)
        if my > 20:
            cv2.putText(img, "NAMJAI  R160  Qn1.5", (mx, max(12, my - 6)), cv2.FONT_HERSHEY_SIMPLEX, fs * 0.5, ink, 1, cv2.LINE_AA)
    box = np.array([mx, my, mx + w, my + h], np.float32)
    H, W = img.shape[:2]
    a = rng.uniform(-3, 3) if loose else rng.uniform(-1, 1)
    M = cv2.getRotationMatrix2D((W / 2, H / 2), a, 1.0)
    jitter = rng.uniform(-0.02, 0.02, (4, 2)) * [W, H] if loose else np.zeros((4, 2))
    src = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    P = cv2.getPerspectiveTransform(src, np.float32(src + jitter))
    T = P @ np.vstack([M, [0, 0, 1]])
    img = cv2.warpPerspective(img, T, (W, H), borderMode=cv2.BORDER_REPLICATE)
    corners = cv2.perspectiveTransform(np.float32([[[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]]), T)[0]
    return img, np.r_[corners.min(0), corners.max(0)]


def _spots(x, rng, count, rmin, rmax, color, alpha):
    h, w = x.shape[:2]
    layer = x.copy()
    for _ in range(count):
        c = (int(rng.integers(w)), int(rng.integers(h)))
        cv2.circle(layer, c, int(rng.integers(rmin, rmax + 1)), color, -1, cv2.LINE_AA)
    return x * (1 - alpha) + layer * alpha


def degrade(img, cond, rng):
    x = img.astype(np.float32)
    h, w = x.shape[:2]
    s = max(1, min(h, w) // 60)
    if cond == "dust":
        x = x * rng.uniform(0.75, 0.95) + rng.uniform(5, 25)
        brown = tuple(float(v) for v in rng.uniform([40, 70, 90], [90, 120, 150]))
        x = _spots(x, rng, int(rng.integers(60, 300)), s, 2 * s, brown, rng.uniform(0.4, 0.8))
        x = _spots(x, rng, int(rng.integers(2, 6)), 6 * s, 18 * s, brown, rng.uniform(0.12, 0.3))
    elif cond == "fog":
        grad = np.linspace(rng.uniform(0.2, 0.5), rng.uniform(0.3, 0.6), w)[None, :, None]
        x = x * (1 - grad) + 235 * grad
        x = cv2.GaussianBlur(x, (0, 0), rng.uniform(0.8, 2.0))
        x = _spots(x, rng, int(rng.integers(15, 60)), s, 4 * s, (245, 245, 245), rng.uniform(0.2, 0.45))
    elif cond == "night":
        x = x * rng.uniform(0.25, 0.5) * rng.uniform([0.8, 0.9, 1.0], [0.95, 1.0, 1.15])
        x += rng.normal(0, rng.uniform(5, 11), x.shape)
        if rng.random() < 0.6:
            yy, xx = np.mgrid[:h, :w]
            cx, cy, r = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(0.25, 0.6) * w
            x += rng.uniform(40, 110) * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r))[..., None]
    x += rng.normal(0, rng.uniform(1.5, 4), x.shape)
    if rng.random() < 0.3:
        x = cv2.GaussianBlur(x, (0, 0), rng.uniform(0.4, 0.9))
    return jpeg(np.clip(x, 0, 255).astype(np.uint8), int(rng.integers(55, 92)))


def spoil(img, kind, rng):
    x = img.astype(np.float32)
    h, w = x.shape[:2]
    if kind == "blur":
        if rng.random() < 0.5:
            x = cv2.GaussianBlur(x, (0, 0), rng.uniform(3, 6) * w / 300)
        else:
            k = max(9, int(rng.uniform(0.06, 0.12) * w)) | 1
            kern = np.zeros((k, k), np.float32)
            kern[k // 2] = 1 / k
            M = cv2.getRotationMatrix2D((k / 2, k / 2), rng.uniform(0, 180), 1)
            kern = cv2.warpAffine(kern, M, (k, k))
            x = cv2.filter2D(x, -1, kern / kern.sum())
    elif kind == "dark":
        x = x * rng.uniform(0.03, 0.09) + rng.normal(0, 3, x.shape)
    elif kind == "glare":
        layer = np.zeros_like(x)
        axes = (int(w * rng.uniform(0.25, 0.4)), int(h * rng.uniform(0.3, 0.5)))
        cv2.ellipse(layer, (int(w * rng.uniform(0.3, 0.7)), int(h * rng.uniform(0.3, 0.7))), axes, rng.uniform(0, 180), 0, 360, (255, 255, 255), -1)
        layer = cv2.GaussianBlur(layer, (0, 0), max(2, w / 60))
        x = np.maximum(x, layer * 1.3)
    return jpeg(np.clip(x, 0, 255).astype(np.uint8), 85)


def jpeg(img, q):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def sample_counter(rng, font_paths, cond, loose, n=None):
    n = n or int(rng.integers(4, 9))
    value = int(rng.integers(0, 10 ** n))
    frac = float(rng.random())
    st = style(rng, font_paths)
    img, box = scene(counter(value, n, frac, st), rng, loose)
    return degrade(img, cond, rng), box, value, n


def dial(value, rng, size=None, ccw=False):
    size = size or int(rng.integers(90, 180))
    m = int(size * rng.uniform(0.08, 0.2))
    S = size + 2 * m
    img = np.empty((S, S, 3), np.uint8)
    img[:] = rng.integers(150, 230, 3).astype(np.uint8)
    c, R = (S // 2, S // 2), size // 2
    cv2.circle(img, c, R, tuple(int(v) for v in rng.integers(225, 252, 3)), -1, cv2.LINE_AA)
    cv2.circle(img, c, R, (40, 40, 40), max(1, size // 60), cv2.LINE_AA)
    for k in range(10):
        t = np.deg2rad((-k if ccw else k) * 36)
        p1 = (int(c[0] + 0.86 * R * np.sin(t)), int(c[1] - 0.86 * R * np.cos(t)))
        p2 = (int(c[0] + 0.97 * R * np.sin(t)), int(c[1] - 0.97 * R * np.cos(t)))
        cv2.line(img, p1, p2, (30, 30, 30), max(1, size // 70), cv2.LINE_AA)
        q = (int(c[0] + 0.7 * R * np.sin(t) - size * 0.03), int(c[1] - 0.7 * R * np.cos(t) + size * 0.03))
        cv2.putText(img, str(k), q, cv2.FONT_HERSHEY_SIMPLEX, size / 380, (30, 30, 30), 1, cv2.LINE_AA)
    t = np.deg2rad((-value if ccw else value) * 36)
    u, v = np.array([np.sin(t), -np.cos(t)]), np.array([np.cos(t), np.sin(t)])
    cc = np.array(c, np.float32)
    L, b, tail = R * rng.uniform(0.72, 0.85), R * rng.uniform(0.07, 0.11), R * rng.uniform(0.12, 0.25)
    poly = np.int32([cc + u * L, cc + v * b, cc - u * tail, cc - v * b])
    red = (int(rng.integers(20, 60)), int(rng.integers(20, 50)), int(rng.integers(180, 235)))
    cv2.fillPoly(img, [poly], red, cv2.LINE_AA)
    cv2.circle(img, c, max(2, int(R * 0.1)), (35, 35, 35), -1, cv2.LINE_AA)
    return img
