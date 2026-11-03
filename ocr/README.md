# namjai-ocr

Reads water meters from photos: rolling-digit counters and red-needle dials.
Runs on the server for NamJai Clip photos and the model is small enough (~1.2 MB) to run in the web app offline.

## Pipeline

1. **Quality gate** – sharpness, darkness, contrast and glare. A bad photo asks for a retake or a Clip lens clean.
2. **Find the digit window** – fixed box for the Clip (set once at install), on-screen guide box for phones, or auto-locate.
3. **Read each wheel** – HOG features + a small neural net. A wheel between two numbers reads as the lower one.
4. **Check against history** – a reading must not go down (except roll-over) or rise faster than the meter's max flow.
5. **Accept or ask** – auto-accept only when every wheel is ≥ 95 % confident, the photo is clean and the history check passes.
   Everything else goes to a person to confirm. House meters are always confirmed by a person.

## Use

```bash
pip install -r requirements.txt
python -m namjai_ocr photo.jpg --digits 5 --prev 1230 --hours 1 --max-flow 3.125
python -m namjai_ocr dial.jpg --dial
```

```python
from namjai_ocr import read_counter
r = read_counter(img, n=5, roi=(x0, y0, x1, y1), prev=1230, hours=1, max_flow=3.125)
r.value, r.confidence, r.auto_ok, r.issues
```

`max_flow` is in units of the last digit per hour. 3.125 m³/h is Q4 for a common DN15 house meter (Q3 = 2.5) – check the meter's own label.

## Train and measure

```bash
python train.py --chunks 100 --hidden 256
python evaluate.py --per 150
pytest -q tests
```

The model is trained only on rendered meters (`namjai_ocr/synth.py`) in four conditions: clear, dust, fog, night.
`reports/accuracy.md` keeps synthetic and real results apart. **Only the real-photo table is real-world accuracy.**

## Known limits

- Synthetic training data; real photos are needed to measure and improve.
- Auto-locate is the weakest step; the guide box / fixed Clip box works much better.
- A wheel that has almost finished rolling can read one higher in the last digit.
- Needle reading assumes the box is centred on the dial.
