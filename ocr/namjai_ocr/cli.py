import argparse
import json

import cv2

from .reader import read_counter, read_dial


def main():
    ap = argparse.ArgumentParser(prog="namjai-ocr")
    ap.add_argument("image")
    ap.add_argument("--digits", type=int, default=5)
    ap.add_argument("--roi", help="x0,y0,x1,y1")
    ap.add_argument("--exact", action="store_true")
    ap.add_argument("--prev", type=int)
    ap.add_argument("--hours", type=float)
    ap.add_argument("--max-flow", type=float)
    ap.add_argument("--dial", action="store_true")
    ap.add_argument("--ccw", action="store_true")
    a = ap.parse_args()
    img = cv2.imread(a.image)
    if img is None:
        raise SystemExit(f"cannot read {a.image}")
    if a.dial:
        out = read_dial(img, a.ccw)
    else:
        roi = [float(v) for v in a.roi.split(",")] if a.roi else None
        out = read_counter(img, a.digits, roi, a.exact, a.prev, a.hours, a.max_flow).to_dict()
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
