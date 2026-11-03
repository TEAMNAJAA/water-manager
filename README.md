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

Open source under the MIT License.
