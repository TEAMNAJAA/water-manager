# NamJai OCR accuracy report

Generated 2026-11-03 by `python evaluate.py --per 150`.

## Real photos
_No labelled real photos yet. Add them to `data/real/` (see `data/real/README.md`). Until then there is **no real-world accuracy number**._

## Synthetic benchmark

> **SYNTHETIC ONLY.** Rendered meters, not photos. These numbers show the pipeline works end to end and where it is weak.
> They are **not** real-world accuracy and must not be quoted as such.

Columns: `digit` = digits correct, `exact` = whole reading correct, `pm1` = within ±1 of the last digit,
`auto` = share the system would accept without asking a human (needs confidence ≥ 0.95, a clean photo and a previous reading it agrees with;
here the previous reading is 0–3 units lower and the flow limit is 5 units/hour), `auto_wrong` = wrong readings among those auto-accepted,
`auto_off>1` = auto-accepted readings off by more than one unit of the last digit,
`flagged` = good photos the quality gate wrongly rejected.

### Counter (odometer) digits
| mode | fonts | condition | n | digit | exact | pm1 | auto | auto_wrong | auto_off>1 | flagged |
|---|---|---|---|---|---|---|---|---|---|---|
| exact ROI | train fonts | clear | 150 | 98.3% | 90.0% | 97.3% | 81.3% | 5.7% | 0.0% | 0.0% |
| exact ROI | train fonts | dust | 150 | 94.9% | 75.3% | 84.7% | 59.3% | 7.9% | 0.0% | 0.0% |
| exact ROI | train fonts | fog | 150 | 94.5% | 78.0% | 84.0% | 50.7% | 3.9% | 0.0% | 2.7% |
| exact ROI | train fonts | night | 150 | 98.0% | 90.0% | 94.7% | 70.7% | 2.8% | 0.0% | 8.7% |
| exact ROI | unseen fonts | clear | 150 | 98.1% | 88.7% | 96.0% | 70.7% | 5.7% | 0.0% | 0.0% |
| exact ROI | unseen fonts | dust | 150 | 94.2% | 74.0% | 78.0% | 44.7% | 0.0% | 0.0% | 0.0% |
| exact ROI | unseen fonts | fog | 150 | 91.9% | 71.3% | 76.7% | 39.3% | 5.1% | 0.0% | 4.0% |
| exact ROI | unseen fonts | night | 150 | 97.2% | 84.7% | 90.7% | 52.0% | 1.3% | 0.0% | 7.3% |
| auto-locate | train fonts | clear | 150 | 92.0% | 76.7% | 84.7% | 55.3% | 9.6% | 0.0% | 0.7% |
| auto-locate | train fonts | dust | 150 | 81.9% | 53.3% | 63.3% | 30.0% | 4.4% | 0.0% | 0.0% |
| auto-locate | train fonts | fog | 150 | 70.9% | 45.3% | 51.3% | 17.3% | 3.8% | 0.0% | 18.0% |
| auto-locate | train fonts | night | 150 | 73.1% | 51.3% | 60.0% | 20.0% | 13.3% | 0.0% | 10.7% |
| auto-locate | unseen fonts | clear | 150 | 88.7% | 62.7% | 74.7% | 42.7% | 9.4% | 0.0% | 0.0% |
| auto-locate | unseen fonts | dust | 150 | 73.4% | 40.7% | 50.7% | 17.3% | 11.5% | 3.8% | 0.0% |
| auto-locate | unseen fonts | fog | 150 | 68.8% | 37.3% | 46.7% | 16.7% | 12.0% | 0.0% | 25.3% |
| auto-locate | unseen fonts | night | 150 | 66.9% | 37.3% | 49.3% | 15.3% | 17.4% | 4.3% | 13.3% |

### Needle dials
`mae` in dial units (one unit = one number on the dial).

| condition | n | mae | within_0.5 | within_0.2 |
|---|---|---|---|---|
| clear | 150 | 0.07 | 98.7% | 97.3% |
| dust | 150 | 0.30 | 90.0% | 83.3% |
| fog | 150 | 0.44 | 96.0% | 96.0% |
| night | 150 | 0.55 | 72.0% | 62.0% |

### Photo quality gate
`good` = normal photos (should be low), others = spoiled photos (should be high).

| input | n | rejected |
|---|---|---|
| good | 150 | 11.3% |
| blur | 150 | 89.3% |
| dark | 150 | 100.0% |
| glare | 150 | 100.0% |
