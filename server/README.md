# NamJai server

FastAPI + SQLAlchemy. Receives NamJai Clip photos, reads them with `namjai-ocr`, stores readings and runs the leak logic.

## Run locally

```bash
cd server
pip install -r requirements-dev.txt
python -m namjai.sim seed          # optional: 4 simulated villages
uvicorn namjai.app:app --reload    # http://localhost:8000/docs
pytest -q tests
```

### On a laptop for a field test

```bash
python -m namjai.setup --village "Home test" --name "Your name" --phone 0812345678 --pin 2468 --zones "Kitchen,Bathroom,Garden"
python run_local.py                 # prints the Wi-Fi address and the Clip webhook URI
```

The server serves the web app too when `web/dist` exists (`cd web && npm ci && npm run build`).
Data goes to `server/namjai-local.db`. Step-by-step: [docs/field-test.md](../docs/field-test.md).

Defaults to SQLite (`namjai.db`). Set `DATABASE_URL` for Postgres (Neon), `ADMIN_TOKEN` for admin routes.

## Leak logic

**Night flow** – main-meter flow averaged over 01:00–05:00 local time, when almost nobody uses water. With only bedtime
and wake-up readings (by hand), the flow between those two readings is used instead and marked coarse.

**Baseline** – median night flow of the last 14 normal nights (needs 3 nights to start; until then the village is "learning").

**High night** – night flow > 1.5 × baseline **and** at least 20 L/h above it (raised automatically to twice the meter's
resolution, so rounding alone can never trigger it). A Clip connected through AI-on-the-edge reads to 1 L.

| high nights in a row | level |
|---|---|
| 1 | nothing (a late toilet flush or water filter) |
| 2 | 🟡 watch |
| 3+ | 🔴 send a technician |

Two normal nights clear it. The alert carries the start night, the excess flow and an estimated litres/day
(excess × 24 h – an estimate, because pressure and leak flow change during the day).

**Water balance** (IWA-style, monthly) – supplied = main meter, billed = sum of house meters pro-rated to the period,
loss = supplied − billed. Houses with less than half the period covered are listed as missing, not guessed.

**House check** – a house whose daily use is > 1.5 × its own usual (median of past periods) and 0.1 m³/day higher gets a
"check for leaks inside" alert.

**Night test** (find the soi) – houses in a suspect soi photograph their meter at bedtime and on waking.
A meter that moved ≥ 20 L → leak inside that house. Main-meter volume above the baseline that the houses do not explain
→ pipe leak likely (in this soi or elsewhere – the test can only clear the houses it covered).

**Burst (same day)** – the last 2 hours, in four 30-minute parts, all run at least 2 × the usual flow for those hours
(median of the same hours on previous days) and 0.5 m³/h above it → 🔴 and a repair job right away.

**No water** – during the day, the main meter has not moved for 2 hours while it usually flows at those hours → 🟡.

**Proof-of-Repair** – marking a leak job repaired puts it in *meter checking*. After 2 normal nights the job closes as
*confirmed by the meter* with the litres per day it stopped; 2 high nights reopen it. Litres are also shown as people
(÷ 50 L/person/day, WHO intermediate access).

**Step test** – the caretaker closes one valve at a time for about 15 minutes; the valve whose closing makes the flow
drop most (at least 25 % of the flow) points to the soi with the leak. Needs readings every few minutes.

**Clip silent** – no heartbeat for 2 h → alert and ask the caretaker to photograph the main meter.

All thresholds are per-village settings (`analytics.DEFAULTS`). They are starting values, to be tuned with pilot data.

## Readings

| source | becomes trusted when |
|---|---|
| Clip | OCR confidence ≥ 0.95, clean photo, agrees with the previous trusted reading; otherwise waits for a person |
| phone photo | always confirmed by a person (OCR only suggests) |
| manual / SMS | entered value passes the history check (or `force`) |

The very first Clip reading of a meter must be confirmed by a person – it anchors the history check.

## Simulator

`namjai/sim.py` models a village (household use with a daily pattern, background loss, leaks that start on a given night)
and either writes readings straight to the database (`seed_village`, `seed_demo`) or acts as a **Clip**
(`ClipSim`): it renders meter photos for the true meter value, sends them through the real Clip API with heartbeats,
and can go offline and send its backlog later. Tests in `tests/test_api.py` run a Clip end to end this way.

Simulated villages are flagged `simulated: true` in the API and must be labelled as simulated in the demo.

**Live demo mode** – set `SEED_DEMO=1`. On first start the server seeds the four demo villages (with people, bills,
funds, repairs and rendered Clip photos), adds an hourly main-meter reading from the same village model, and reseeds once a
day, so a judge opening the demo weeks later still sees Village B 🔴 (4 nights), C 🟡 (2 nights), D (Clip silent) and A 🟢.
Auto-reseed only runs when every village in the database is simulated.

## API

Interactive docs at `/docs`. Main routes:

| route | |
|---|---|
| `POST /api/clip/photo`, `POST /api/clip/heartbeat` | Clip protocol ([docs/clip-protocol.md](../docs/clip-protocol.md)) |
| `GET /api/villages`, `/api/villages/{id}/status` | 🟢🟡🔴 level, alerts, leak state, devices |
| `GET /api/villages/{id}/hourly`, `/nights`, `/balance?month=YYYY-MM` | dashboard data |
| `POST /api/villages/{id}/night-tests`, `GET /api/night-tests/{id}` | soi night test |
| `POST /api/meters/{id}/photo`, `POST /api/meters/{id}/readings`, `POST /api/readings/{id}/confirm` | phone, manual readings |
| `GET /api/meters/{id}/latest-photo`, `PUT /api/meters/{id}/roi` | set the Clip's digit box once after install |
| `POST /api/meters/{id}/clips` | create a Clip key: webhook URI path + API key |
| `POST`/`PUT /api/hook/aiedge/{clip}` | AI-on-the-edge-device webhook (`APIKEY` header): readings and images |
| `POST /api/meters/{id}/import` | AI-on-the-edge SD-card data log (`/log/data/*.csv`) |
| `POST /api/meters/{id}/typed` | typed reading with a photo |
| `/api/villages/{id}/step-tests`, `/api/step-tests/{id}/close` · `/open` · `/finish` | valve-by-valve step test |
| `GET`/`PUT /api/villages/{id}/settings` | currency, tariff, agencies, sois |
| `GET /api/repairs/{id}/report` | one-page evidence report data (`/report/{id}` in the app) |
| `GET /api/technician/jobs` | jobs in every village of the technician's network |
| `/api/login`, `/api/me`, bills, funds, repairs, points, Namjai (`namjai/community.py`) | community features |
| `POST /api/sms/inbound` | SMS gateway webhook: `READ`, `REPORT`, `STATUS`, `BILL` (English or Thai) |
| `POST /api/demo/login`, `/api/demo/ocr`, `/api/demo/phones` | judges' demo |
| `POST /api/admin/...` | villages, zones, meters, devices (returns the Clip token) |

## Deploy (free tier)

The Docker image builds the web app too, so one Space serves the app and the API. See [docs/deploy.md](../docs/deploy.md).

1. Create a Postgres database on Neon and copy its connection string (only needed to keep real data).
2. Create a Hugging Face Space with the **Docker** SDK; the `deploy-space` workflow pushes this repo to it.
3. In the Space settings add secrets `DATABASE_URL`, `ADMIN_TOKEN` and `SECRET_KEY` (login tokens); add `SEED_DEMO=1`
   for the judges' demo Space. Optional `SMS_SECRET` protects the SMS webhook.

Check the current free-tier limits of both services before relying on them.
