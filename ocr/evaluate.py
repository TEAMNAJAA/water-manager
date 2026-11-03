import argparse
import csv
import json
from datetime import date
from pathlib import Path

import cv2
import numpy as np

from namjai_ocr import synth as S
from namjai_ocr.quality import assess
from namjai_ocr.reader import read_counter, read_dial

ROOT = Path(__file__).parent
REAL = ROOT / "data" / "real"


def pct(x):
    return f"{100 * np.mean(x):.1f}%" if len(x) else "-"


def counter_stats(rows):
    rows = [r for r in rows]
    auto = [r for r in rows if r["auto"]]
    return {
        "n": len(rows),
        "digit": pct([r["digit"] for r in rows]),
        "exact": pct([r["exact"] for r in rows]),
        "pm1": pct([r["pm1"] for r in rows]),
        "auto": pct([r["auto"] for r in rows]),
        "auto_wrong": pct([not r["exact"] for r in auto]),
        "auto_off>1": pct([not r["pm1"] for r in auto]),
        "flagged": pct([r["flagged"] for r in rows]),
    }


def score(reading, value, n):
    t = f"{value:0{n}d}"
    return {
        "digit": np.mean([a == b for a, b in zip(reading.digits, t)]),
        "exact": reading.value == value,
        "pm1": abs(reading.value - value) <= 1,
        "auto": reading.auto_ok,
        "flagged": not reading.quality["ok"],
    }


def synthetic(per):
    rng = np.random.default_rng(2026)
    sets = {"train fonts": S.fonts(S.TRAIN_FONTS), "unseen fonts": S.fonts(S.HOLDOUT_FONTS)}
    table = []
    for mode in ("exact ROI", "auto-locate"):
        for fs, fonts in sets.items():
            for cond in S.CONDITIONS:
                rows = []
                for _ in range(per):
                    img, box, value, n = S.sample_counter(rng, fonts, cond, mode == "auto-locate")
                    prev = max(0, value - int(rng.integers(0, 4)))
                    r = read_counter(img, n, roi=box if mode == "exact ROI" else None, prev=prev, hours=1, max_flow=5)
                    rows.append(score(r, value, n))
                table.append({"mode": mode, "fonts": fs, "condition": cond, **counter_stats(rows)})
    dials = []
    for cond in S.CONDITIONS:
        err = []
        for _ in range(per):
            v = float(rng.uniform(0, 10))
            out = read_dial(S.degrade(S.dial(v, rng), cond, rng))
            err.append(10.0 if out is None else abs((out["value"] - v + 5) % 10 - 5))
        err = np.array(err)
        dials.append({"condition": cond, "n": per, "mae": f"{err.mean():.2f}", "within_0.5": pct(err <= 0.5), "within_0.2": pct(err <= 0.2)})
    fonts = S.fonts(S.TRAIN_FONTS)
    gate = []
    for kind in ("good",) + S.SPOILS:
        flags = []
        for i in range(per):
            img, *_ = S.sample_counter(rng, fonts, S.CONDITIONS[i % 4], True)
            if kind != "good":
                img = S.spoil(img, kind, rng)
            flags.append(not assess(img)["ok"])
        gate.append({"input": kind, "n": per, "rejected": pct(flags)})
    return table, dials, gate


def real():
    path = REAL / "labels.csv"
    if not path.exists():
        return None
    rows = {}
    for rec in csv.DictReader(path.open(encoding="utf-8")):
        img = cv2.imread(str(REAL / "images" / rec["file"]))
        if img is None:
            continue
        roi = [float(v) for v in rec["roi"].split()] if rec.get("roi") else None
        key = (rec["kind"], rec.get("meter", ""), rec["condition"])
        if rec["kind"] == "dial":
            out = read_dial(img if roi is None else img[int(roi[1]):int(roi[3]), int(roi[0]):int(roi[2])], rec.get("ccw") == "1")
            v = float(rec["reading"])
            err = 10.0 if out is None else abs((out["value"] - v + 5) % 10 - 5)
            rows.setdefault(key, []).append({"err": err})
        else:
            n = int(rec["n_digits"])
            rows.setdefault(key, []).append(score(read_counter(img, n, roi=roi), int(rec["reading"]), n))
    out = []
    for (kind, meter, cond), rs in sorted(rows.items()):
        if kind == "dial":
            e = np.array([r["err"] for r in rs])
            out.append({"kind": kind, "meter": meter, "condition": cond, "n": len(rs), "mae": f"{e.mean():.2f}", "within_0.5": pct(e <= 0.5)})
        else:
            out.append({"kind": kind, "meter": meter, "condition": cond, **counter_stats(rs)})
    return out


def md(rows):
    if not rows:
        return "_none_\n"
    keys = list(rows[0])
    lines = ["| " + " | ".join(keys) + " |", "|" + "---|" * len(keys)]
    lines += ["| " + " | ".join(str(r.get(k, "")) for k in keys) + " |" for r in rows]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=150)
    a = ap.parse_args()
    table, dials, gate = synthetic(a.per)
    real_rows = real()
    report = f"""# NamJai OCR accuracy report

Generated {date.today()} by `python evaluate.py --per {a.per}`.

## Real photos
{md(real_rows) if real_rows else "_No labelled real photos yet. Add them to `data/real/` (see `data/real/README.md`). Until then there is **no real-world accuracy number**._"}

## Synthetic benchmark

> **SYNTHETIC ONLY.** Rendered meters, not photos. These numbers show the pipeline works end to end and where it is weak.
> They are **not** real-world accuracy and must not be quoted as such.

Columns: `digit` = digits correct, `exact` = whole reading correct, `pm1` = within ±1 of the last digit,
`auto` = share the system would accept without asking a human (needs confidence ≥ 0.95, a clean photo and a previous reading it agrees with;
here the previous reading is 0–3 units lower and the flow limit is 5 units/hour), `auto_wrong` = wrong readings among those auto-accepted,
`auto_off>1` = auto-accepted readings off by more than one unit of the last digit,
`flagged` = good photos the quality gate wrongly rejected.

### Counter (odometer) digits
{md(table)}
### Needle dials
`mae` in dial units (one unit = one number on the dial).

{md(dials)}
### Photo quality gate
`good` = normal photos (should be low), others = spoiled photos (should be high).

{md(gate)}"""
    out = ROOT / "reports" / "accuracy.md"
    out.write_text(report)
    (ROOT / "reports" / "accuracy.json").write_text(json.dumps({"synthetic": {"counter": table, "dial": dials, "gate": gate}, "real": real_rows}, indent=1))
    print(report)


if __name__ == "__main__":
    main()
