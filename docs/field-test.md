# Field test on a laptop

For the NamJai Playbook tests: the Clip sends readings to a laptop on the same Wi-Fi.

## 1. Install (once)

- Python 3.12 from python.org (tick "Add python.exe to PATH" on Windows) and Node.js LTS from nodejs.org.
- In a terminal, in the `water-manager` folder:

```bash
python -m pip install -e ocr -r server/requirements.txt
cd web && npm ci && npm run build && cd ..
```

## 2. Create your test village (once)

```bash
cd server
python -m namjai.setup --village "Home test" --name "Your name" --phone 0812345678 --pin 2468 --zones "Kitchen,Bathroom,Garden"
```

## 3. Start NamJai (each time)

```bash
python run_local.py
```

It prints an address like `http://192.168.1.23:8000`. Open it on the laptop or any phone on the same Wi-Fi and log in
with the phone number and PIN. Keep the window open during the whole test, and stop the laptop from sleeping.

## 4. Connect the Clip (AI-on-the-edge-device)

In the app: **Caretaker tools → Connect a Clip → Create a Clip key**. Copy the two values into the Clip's web page,
Settings → Configuration → Webhook:

| Clip setting | Value |
|---|---|
| Uri | the Webhook Uri shown in the app (must start with the laptop's Wi-Fi address, not localhost) |
| ApiKey | the key shown in the app (shown once) |
| UploadImg | 2 (only images of failed reads) |

Also set `AutoTimer Interval` 5 min, `PreValueUse` true, `AllowNegativeRates` false, `DataLogActive` true.
The Clip's status in the app turns online after its first round.

If Wi-Fi cannot reach the meter, the Clip keeps logging to its SD card: copy `/log/data/*.csv` and add them in
**Caretaker tools → Add data from the Clip's SD card**.

## 5. Before the Clip arrives

Read the meter at bedtime and on waking: **Read my meter → Type the number instead**, type every digit (red ones too)
and add a photo. NamJai uses the pair as a coarse night reading.

## What the system does during the leak test

| Nights | You do | NamJai shows |
|---|---|---|
| 1–4 | normal use | learning, then green |
| 5–7 | tap open about 1 L/min, 23:00–05:00 | yellow after night 6, red and a repair job after night 7, with litres/day and people |
| 8–9 | tap closed, press **Mark repaired** on the job | "meter checking", then "confirmed by the meter" with litres stopped |

Write down the bucket measurement; compare it with the litres per day NamJai estimates. Only real measurements go in the slides.

## Licence of AI-on-the-edge-device

Checked on 11 Nov 2026 in the project's `Licence.md` ("Dual Use License", version 1.0, 5 Jan 2025):

- Free to use, modify and share for **private, non-commercial** purposes. A student pilot fits this.
- **Commercial use** (selling, renting, providing as a service, building into a product) needs a separate licence from the author.
- Credit the project and its source (https://github.com/jomjol/AI-on-the-edge-device) and keep its licence unchanged.
- The authors say it must not be used for safety-relevant systems or systems with high reliability requirements.
  NamJai only gives advice: people confirm readings and repairs.

So NamJai credits AI-on-the-edge-device for the pilot. For scaling, NamJai has its own MIT-licensed Clip firmware
(`firmware/`), or a commercial licence can be requested.
