import cv2
import numpy as np


def read_dial(img, ccw=False, center=None):
    h, w = img.shape[:2]
    cx, cy = center or (w / 2, h / 2)
    R = min(w, h) / 2
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.float32)
    v = (v - v.min()) / max(float(np.percentile(v, 99) - v.min()), 1)
    red = ((hsv[..., 0] < 10) | (hsv[..., 0] > 165)) & (hsv[..., 1] > 70) & (v > 0.2)
    ys, xs = np.nonzero(red)
    dx, dy = xs - cx, cy - ys
    r = np.hypot(dx, dy)
    keep = (r > 0.3 * R) & (r < 0.95 * R)
    if keep.sum() < 12:
        return None
    ux, uy = (dx[keep] / r[keep]), (dy[keep] / r[keep])
    mx, my = ux.mean(), uy.mean()
    value = (np.degrees(np.arctan2(mx, my)) % 360) / 36
    return {"value": float((10 - value) % 10 if ccw else value), "confidence": float(np.hypot(mx, my))}
