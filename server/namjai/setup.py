import argparse
import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///" + (Path(__file__).resolve().parents[1] / "namjai-local.db").as_posix())

from sqlalchemy import select  # noqa: E402

from . import db as D  # noqa: E402
from .community import hash_pin  # noqa: E402
from .models import Meter, Person, Village, Zone  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Create a real (not simulated) village for a field test.")
    ap.add_argument("--village", required=True, help='e.g. "Home test" or the village name')
    ap.add_argument("--name", required=True, help="caretaker's name (the person who will log in)")
    ap.add_argument("--phone", required=True, help="caretaker's phone number, used to log in")
    ap.add_argument("--pin", required=True, help="4 to 8 digit PIN")
    ap.add_argument("--zones", default="", help='comma-separated sois or rooms, e.g. "Soi 1,Soi 2" or "Kitchen,Bathroom,Garden"')
    ap.add_argument("--houses", type=int, default=0, help="number of house meters to create (0 for a home test)")
    ap.add_argument("--max-flow", type=float, default=3.125, help="largest believable flow of the main meter, m3/h")
    ap.add_argument("--tz", default="Asia/Bangkok")
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lon", type=float)
    a = ap.parse_args()
    phone = "".join(ch for ch in a.phone if ch.isdigit())
    if not (4 <= len(a.pin) <= 8 and a.pin.isdigit()):
        raise SystemExit("PIN must be 4 to 8 digits")
    D.init()
    with D.Session() as db:
        if db.scalars(select(Person).where(Person.phone == phone)).first():
            raise SystemExit(f"phone {phone} is already registered")
        v = Village(name=a.village, tz=a.tz, lat=a.lat, lon=a.lon, simulated=False, settings={})
        db.add(v)
        db.flush()
        zones = [Zone(village_id=v.id, name=z.strip()) for z in a.zones.split(",") if z.strip()]
        db.add_all(zones)
        db.flush()
        main = Meter(village_id=v.id, kind="main", label="Main meter", n_digits=5, scale=1.0, max_flow=a.max_flow, lat=a.lat, lon=a.lon)
        db.add(main)
        for i in range(a.houses):
            db.add(Meter(village_id=v.id, kind="house", label=f"House {i + 1}", zone_id=zones[i % len(zones)].id if zones else None))
        db.add(Person(village_id=v.id, name=a.name, phone=phone, pin_hash=hash_pin(a.pin), role="caretaker"))
        db.commit()
        print(f"""
  Created village "{v.name}" (id {v.id}) with a main meter{f", {a.houses} house meters" if a.houses else ""}{f" and zones: {', '.join(z.name for z in zones)}" if zones else ""}.
  Log in with phone {phone} and your PIN.
  Next: Caretaker tools -> Connect a Clip, then paste the webhook URI and API key into the Clip's settings.
""")


if __name__ == "__main__":
    main()
