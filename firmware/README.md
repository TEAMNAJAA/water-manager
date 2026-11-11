# NamJai Clip firmware

Two ways to run a Clip:

- **AI-on-the-edge-device** (used in the field test): open firmware that reads the meter on the ESP32-CAM itself and
  sends each value to NamJai's webhook. Set-up in [docs/field-test.md](../docs/field-test.md).
- **NamJai firmware** (this folder): sends photos and lets the NamJai server read them. Described below.

ESP32-CAM (AI-Thinker) clipped onto the village main water meter. Every hour it:

1. takes **two photos**, one with LED A and one with LED B (45° side lights, so one of them avoids glare),
2. saves both to internal flash first (survives power cuts and Wi-Fi outages),
3. sends a heartbeat and uploads every saved photo, oldest first, deleting each one only after the server confirms.

Captures line up with the clock (on the hour) once the time is synced. The server can change the interval, LED brightness
or ask for a photo now through the heartbeat reply – see [`docs/clip-protocol.md`](../docs/clip-protocol.md).

## Keeps working when things fail

| failure | what the Clip does |
|---|---|
| Wi-Fi or internet down | keeps capturing into flash; when flash is full the oldest photos are dropped first |
| power cut | runs on the 18650 backup; photos already in flash are not lost |
| firmware hangs | 120 s watchdog reboots it |
| camera error | re-initialises; reboots after 3 failed captures in a row |
| Clip dead or silent | server notices no heartbeat for 2 h and asks the caretaker to use a phone |

Offline capacity ≈ 2.4 MB ÷ (2 × photo size). At SVGA and JPEG quality 12 a photo is expected to be tens of kB,
so roughly a day or more of hourly captures – **measure real photo sizes on the device before quoting a number.**

## Wiring

| ESP32-CAM pin | to |
|---|---|
| GPIO 13 | LED A driver (logic-level N-MOSFET or NPN, gate/base resistor) |
| GPIO 12 | LED B driver – **must have a 10 kΩ pull-down**; GPIO 12 high at boot stops the ESP32 from starting |
| 5V / GND | 5 V from the pump-house supply through an 18650 UPS module |
| GPIO 4 | on-board flash LED, kept off by the firmware (it points straight at the meter glass and causes glare) |

The SD card slot is not used, so GPIO 12/13 are free.

## Build and flash

```bash
cd firmware
pio run -t upload
pio device monitor
```

CI builds the firmware on every push (`.github/workflows/ci.yml`) and attaches `firmware.bin`.

Root certificates for HTTPS are in `src/certs.h`; regenerate with `python tools/make_certs.py` if the server's CA changes.

## First setup

1. Power the Clip. With no server set it opens a Wi-Fi hotspot **`NamJai-clip-xxxxxx`**.
2. Join it with a phone, pick the pump-house Wi-Fi, enter the **server URL** and **device token**, save.
3. To reopen the setup page later, power-cycle the Clip **3 times within 10 seconds**.

## Test without the real server

```bash
python tools/mock_server.py 8080
```

Enter `http://<your-computer-ip>:8080` as the server URL. Photos land in `clip_inbox/<device>/`.
