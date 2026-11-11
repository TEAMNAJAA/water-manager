import argparse
import os
import socket
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
DEFAULT_DB = HERE / "namjai-local.db"


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser(description="Run NamJai on this computer for a field test.")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--db", default=str(DEFAULT_DB), help="database file (default: server/namjai-local.db)")
    ap.add_argument("--demo", action="store_true", help="fill an empty database with the simulated demo villages")
    a = ap.parse_args()
    os.environ.setdefault("DATABASE_URL", "sqlite:///" + Path(a.db).resolve().as_posix())
    if a.demo:
        os.environ["SEED_DEMO"] = "1"
    base = f"http://{lan_ip()}:{a.port}"
    web = (HERE.parent / "web" / "dist").is_dir()
    print(f"""
  NamJai is starting.

  Open on any phone or computer on this Wi-Fi:  {base}
  Clip (AI-on-the-edge) webhook URI:            {base}/api/hook/aiedge/<Clip id>
     -> get the Clip id and API key in the app: Caretaker tools -> Connect a Clip
  Database: {os.environ["DATABASE_URL"]}
  {"" if web else "Web app not built yet: only the API runs. Build it once with:  cd web && npm ci && npm run build"}
  Keep this window open. Stop with Ctrl+C.
""")
    import uvicorn
    uvicorn.run("namjai.app:app", host="0.0.0.0", port=a.port)


if __name__ == "__main__":
    main()
