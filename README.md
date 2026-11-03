# NamJai

Turns the old main water meter of a village into the brain of its community water system:
read the meter automatically, catch leaks early, organise repairs and keep the repair fund transparent.

Built for the Xylem Global Student Innovation Challenge 2026 (Water Access).

| Part | Folder | Status |
|---|---|---|
| Meter reading from photos | [`ocr/`](ocr) | v0.1 – synthetic benchmark, waiting for real photos |
| NamJai Clip firmware (ESP32-CAM) | [`firmware/`](firmware) | v0.1 – builds in CI, not yet tested on hardware |
| Server, database, leak detection, simulator | [`server/`](server) | v0.1 – tested on simulated villages |
| Web app (PWA), dashboards, judges' demo, SMS simulator | [`web/`](web) | v0.1 – tested in Chromium on simulated villages |
| Hardware: parts list, wiring, 3D-printed hood, test plan | [`hardware/`](hardware) | v0.1 – hood rendered, not yet printed or tested |

## Try it locally

```bash
python -m venv .venv && . .venv/bin/activate
cd server && pip install -r requirements-dev.txt
SEED_DEMO=1 uvicorn namjai.app:app --port 8000 &                # API + simulated villages
cd ../web && npm ci && npm run dev                              # http://localhost:5173/demo
```

## How it fits together

```
NamJai Clip (ESP32-CAM) ──HTTPS──▶ server (FastAPI) ◀──── web app (PWA, offline queue)
  hourly photos, heartbeat          OCR, readings, leak logic      residents, caretaker, committee,
                                    bills, funds, repairs, points   technicians, dashboards, demo
SMS gateway (keypad phones) ──────▶ /api/sms/inbound
```

The core (server) is separate from the channels, so the web app, SMS, LINE or WhatsApp can be swapped per country.

Before quoting any number, see [`docs/claims-checklist.md`](docs/claims-checklist.md).

Open source under the MIT License.
