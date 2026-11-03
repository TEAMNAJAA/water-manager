import cv2
import numpy as np

LIMITS = {"sharpness": 120.0, "bright": 70.0, "contrast": 45.0, "glare": 0.05}


def assess(img, limits=LIMITS):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    g = cv2.resize(g, (320, max(8, int(320 * g.shape[0] / g.shape[1]))), interpolation=cv2.INTER_AREA)
    lo, hi = np.percentile(g, (2, 98))
    stretched = np.clip((g - lo) / max(hi - lo, 1) * 255, 0, 255).astype(np.uint8)
    m = {
        "sharpness": float(cv2.Laplacian(stretched, cv2.CV_64F).var()),
        "bright": float(hi),
        "contrast": float(hi - lo),
        "glare": float((g >= 250).mean()),
    }
    issues = []
    if m["bright"] < limits["bright"]:
        issues.append("too_dark")
    elif m["contrast"] < limits["contrast"]:
        issues.append("low_contrast")
    if m["sharpness"] < limits["sharpness"]:
        issues.append("blurry")
    if m["glare"] > limits["glare"]:
        issues.append("glare")
    return {**{k: round(v, 3) for k, v in m.items()}, "issues": issues, "ok": not issues}
