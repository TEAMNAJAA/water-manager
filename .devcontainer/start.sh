cd "$(dirname "$0")/.."
mkdir -p .run
(cd server && SEED_DEMO=1 DATABASE_URL=sqlite:///../.run/demo.db setsid nohup python -m uvicorn namjai.app:app --host 0.0.0.0 --port 8000 > ../.run/api.log 2>&1 &)
(cd web && setsid nohup npm run dev -- --host 0.0.0.0 --port 5173 > ../.run/web.log 2>&1 &)
echo "NamJai: app on port 5173 (open /demo), API on port 8000. Logs in .run/"
