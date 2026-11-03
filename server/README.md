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

Defaults to SQLite (`namjai.db`). Set `DATABASE_URL` for Postgres (Neon), `ADMIN_TOKEN` for admin routes.

## Leak logic

**Night flow** – main-meter flow averaged over 01:00–05:00 local time, when almost nobody uses water.

**Baseline** – median night flow of the last 14 normal nights (needs 5 nights to start; until then the village is "learning").

**High night** – night flow > 1.5 × baseline **and** at least 0.2 m³/h above it (raised automatically for coarse meters
so meter resolution alone can never trigger it).

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
| `/api/login`, `/api/me`, bills, funds, repairs, points, Namjai (`namjai/community.py`) | community features |
| `POST /api/sms/inbound` | SMS gateway webhook: `READ`, `REPORT`, `STATUS`, `BILL` (English or Thai) |
| `POST /api/demo/login`, `/api/demo/ocr`, `/api/demo/phones` | judges' demo |
| `POST /api/admin/...` | villages, zones, meters, devices (returns the Clip token) |

## Deploy (free tier)

1. Create a Postgres database on Neon and copy its connection string.
2. Create a Hugging Face Space with the **Docker** SDK and push this repo to it (the Space builds `server/Dockerfile`
   from the repo root – copy it to `Dockerfile` at the root of the Space).
3. In the Space settings add secrets `DATABASE_URL`, `ADMIN_TOKEN` and `SECRET_KEY` (login tokens); add `SEED_DEMO=1`
   for the judges' demo Space. Optional `SMS_SECRET` protects the SMS webhook.

Check the current free-tier limits of both services before relying on them.
