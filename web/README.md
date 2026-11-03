# NamJai web app (PWA)

React + Vite + TypeScript. Installable from the browser (no app store), works offline, English with a Thai switch.

| Screen | Who |
|---|---|
| Home – 🟢🟡🔴 village status, big **Report a problem** button | everyone |
| Read a meter – live camera with a guide box, OCR suggestion, ✅ confirm or ✏️ fix | resident (own meter, main meter), caretaker |
| My bills, anonymous thank-you for Namjai support | resident |
| Report a problem – type, photo, GPS, note | everyone |
| Repairs – sorted by water lost, status for every house, self-repair guides, technician actions, parts from the depot | everyone / technician |
| Village funds – four wallets, rules, approvals (2 people) | everyone sees, staff record |
| Points – Water Guardian board, rewards (never water access) | everyone |
| Namjai – gifts, households helped (count only), thank-you wall, committee proposals | everyone / committee |
| Caretaker tools – readings to check, billing round, unpaid bills, night test, Clip status | caretaker, committee |
| Dashboard – hourly flow, night flow vs usual, water balance, village map | everyone |
| District network – villages, technicians, parts store on a map | everyone |
| `/demo` – judges' page with QR code, sample meters to read, demo logins | anyone |
| `/sms` – simulated keypad phone talking to the SMS endpoint | anyone |

## Offline

The app shell and the last API answers are cached by the service worker. Meter photos, problem reports and
thank-you notes made offline wait in IndexedDB and are sent, oldest first, when the phone is back online.

## Run

```bash
npm ci
npm run dev        # http://localhost:5173, proxies /api to http://localhost:8000
npm run build      # dist/
```

Start the server first (`server/README.md`); `python -m namjai.sim seed` gives demo villages.

## Deploy (Cloudflare Pages)

Build command `npm run build`, output folder `dist`, root `web/`. Set `VITE_API_URL` to the server URL
(e.g. the Hugging Face Space). `public/_redirects` sends every path to the app.
