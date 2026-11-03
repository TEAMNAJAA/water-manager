import cv2
import numpy as np

CELL = (24, 40)
BIN, PX = 9, 4


def hog(img):
    g = img.astype(np.float32)
    gx, gy = np.zeros_like(g), np.zeros_like(g)
    gx[:, 1:-1] = g[:, 2:] - g[:, :-2]
    gy[1:-1] = g[2:] - g[:-2]
    mag = np.hypot(gx, gy)
    b = (np.degrees(np.arctan2(gy, gx)) % 180) / (180 / BIN)
    b0 = np.floor(b).astype(int) % BIN
    w1 = b - np.floor(b)
    H, W = g.shape
    cy, cx = H // PX, W // PX
    cell = (np.arange(H)[:, None] // PX) * cx + np.arange(W)[None, :] // PX
    n = cy * cx * BIN
    hist = (np.bincount((cell * BIN + b0).ravel(), (mag * (1 - w1)).ravel(), n)
            + np.bincount((cell * BIN + (b0 + 1) % BIN).ravel(), (mag * w1).ravel(), n)).reshape(cy, cx, BIN)
    blk = np.concatenate([hist[:-1, :-1], hist[:-1, 1:], hist[1:, :-1], hist[1:, 1:]], axis=2)
    blk = blk / np.sqrt((blk ** 2).sum(2, keepdims=True) + 1e-6)
    blk = np.minimum(blk, 0.2)
    blk = blk / np.sqrt((blk ** 2).sum(2, keepdims=True) + 1e-6)
    return blk.ravel()


def ink(img):
    return img.min(axis=2) if img.ndim == 3 else img


def normalize(cell):
    c = cv2.resize(cell, CELL, interpolation=cv2.INTER_AREA).astype(np.float32)
    lo, hi = np.percentile(c, (2, 98))
    c = np.clip((c - lo) / max(hi - lo, 1) * 255, 0, 255).astype(np.uint8)
    t, _ = cv2.threshold(c, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return 255 - c if np.median(c) < t else c


def features(cells):
    out = []
    for c in cells:
        n = normalize(c)
        small = cv2.resize(n, (8, 12), interpolation=cv2.INTER_AREA).ravel() / 255.0
        out.append(np.concatenate([hog(n), small]))
    return np.asarray(out, np.float32)


def split(window, n):
    g = ink(window)
    xs = np.linspace(0, g.shape[1], n + 1).round().astype(int)
    return [g[:, xs[i]:max(xs[i + 1], xs[i] + 1)] for i in range(n)]


def crop(img, box):
    h, w = img.shape[:2]
    x0, y0, x1, y1 = np.round(box).astype(int)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    return img[y0:y1, x0:x1] if x1 - x0 > 4 and y1 - y0 > 4 else img


def _binary(g):
    block = max(11, int(g.shape[0] * 0.35)) | 1
    return [cv2.adaptiveThreshold(src, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, block, 10) for src in (g, 255 - g)]


def _blobs(bins):
    H, W = bins[0].shape
    boxes = []
    for b in bins:
        _, _, st, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
        for x, y, w, h, a in st[1:]:
            if 0.1 * H < h < 0.75 * H and 1.05 < h / w < 7 and 0.12 < a / (w * h) < 0.95 and x > 0 and x + w < W:
                boxes.append((x, y, w, h))
    return boxes


def _group(boxes):
    best = []
    for _, by, _, bh in boxes:
        cy = by + bh / 2
        grp = sorted((b for b in boxes if abs(b[3] - bh) < 0.3 * bh and abs(b[1] + b[3] / 2 - cy) < 0.35 * bh), key=lambda b: b[0] + b[2] / 2)
        keep = []
        for b in grp:
            if keep and abs((b[0] + b[2] / 2) - (keep[-1][0] + keep[-1][2] / 2)) < 0.4 * bh:
                if b[2] * b[3] > keep[-1][2] * keep[-1][3]:
                    keep[-1] = b
            else:
                keep.append(b)
        if len(keep) > len(best):
            best = keep
    return best


def _ink(bins, x, p, y0, y1):
    x0, x1 = int(x - 0.35 * p), int(x + 0.35 * p)
    if x0 < 0 or x1 > bins[0].shape[1]:
        return -1.0
    return max(float(b[y0:y1, x0:x1].mean()) for b in bins)


def locate(img, n):
    g = ink(img)
    s = 200 / g.shape[0]
    g = cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    bins = _binary(g)
    grp = _group(_blobs(bins))
    if len(grp) < 2:
        return None
    cx = np.array([x + w / 2 for x, _, w, _ in grp])
    hm = float(np.median([h for *_, h in grp]))
    cy = float(np.median([y + h / 2 for _, y, _, h in grp]))
    d = np.diff(cx)
    p0 = float(np.median(d))
    if p0 < 0.35 * hm:
        return None
    p = float(np.mean(d / np.maximum(1, np.round(d / p0))))
    slots = np.round((cx - cx[0]) / p).astype(int)
    lo, hi = 0, int(slots[-1])
    if hi + 1 > n:
        counts = [((slots >= k) & (slots < k + n)).sum() for k in range(hi - n + 2)]
        lo = int(np.argmax(counts))
        hi = lo + n - 1
    y0, y1 = int(cy - hm / 2), int(cy + hm / 2)
    while hi - lo + 1 < n:
        left, right = _ink(bins, cx[0] + (lo - 1) * p, p, y0, y1), _ink(bins, cx[0] + (hi + 1) * p, p, y0, y1)
        if right >= left:
            hi += 1
        else:
            lo -= 1
    x0 = cx[0] + lo * p - p / 2
    ch = hm / 0.6
    return np.array([x0, cy - ch / 2, x0 + n * p, cy + ch / 2]) / s
