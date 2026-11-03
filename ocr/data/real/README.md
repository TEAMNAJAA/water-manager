# Real meter photos

Put photos in `images/` (git-ignored by default, because photos can show house numbers or faces)
and describe each one in `labels.csv`:

```csv
file,kind,meter,condition,n_digits,reading,roi,ccw
house01_day.jpg,counter,asahi,clear,5,01234,,
house01_night.jpg,counter,asahi,night,5,01236,412 300 980 420,
main_dust.jpg,counter,main,dust,6,123456,,
house01_dial1.jpg,dial,asahi,clear,,7.4,500 600 640 740,
```

| column | meaning |
|---|---|
| `kind` | `counter` (rolling digits) or `dial` (red needle) |
| `meter` | brand or `main` for the village main meter |
| `condition` | `clear`, `dust`, `fog`, `night` |
| `n_digits` | number of rolling wheels to read (counter only) |
| `reading` | the true value read by a person; for a wheel between two numbers write the lower one |
| `roi` | optional `x0 y0 x1 y1` box around the digit window or the dial; empty = auto-locate |
| `ccw` | `1` if the dial counts counter-clockwise |

Then run `python evaluate.py`. Real results appear first in `reports/accuracy.md`, split by meter and condition.
