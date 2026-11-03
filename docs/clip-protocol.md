# NamJai Clip ↔ server protocol

All requests are `POST` over HTTPS and carry:

| header | value |
|---|---|
| `Authorization` | `Bearer <device token>` |
| `X-Device` | `clip-xxxxxx` (from the chip MAC) |

## `POST /api/clip/photo`

Body: one JPEG (`image/jpeg`). Each capture sends two photos, one per LED, so the server can keep the better one.

| header | meaning |
|---|---|
| `X-Seq` | capture number, increases by 1 per capture and survives reboots |
| `X-Light` | `a` or `b` – which LED was on |
| `X-Captured-At` | Unix time; `0` if the clock was never set since boot |
| `X-Boot`, `X-Ms` | boot counter and milliseconds since boot at capture, to rebuild the time later |

Reply `2xx` = stored, `409` = already have it (the Clip deletes its copy in both cases). Anything else = keep and retry next hour.
The server must treat `(device, seq, light)` as unique.

## `POST /api/clip/heartbeat`

Sent after every capture. Body (JSON):

```json
{"fw":"0.1.0","boot":12,"seq":3456,"uptime":3605,"reset":"power_on","rssi":-67,"heap":151000,
 "psram":3900000,"queue":0,"queue_bytes":0,"fs_free":2400000,"camera":true,"time":1793143426,
 "interval":3600,"led":180,"error":""}
```

Optional reply fields the Clip obeys:

| field | effect |
|---|---|
| `interval` | seconds between captures, minimum 300 (e.g. 900 during a night leak test) |
| `led` | LED brightness 0–255 |
| `capture_now` | `true` = take a photo right away |

The server marks a Clip **silent** if no heartbeat arrives for 2 hours and asks the caretaker to photograph the main meter by phone instead.
