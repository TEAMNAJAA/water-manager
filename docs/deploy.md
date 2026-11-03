# Deploy

## Server → Hugging Face Space (free, Docker)

1. Create a Space: SDK **Docker**, template **Blank**, e.g. `your-name/namjai`.
2. Create a Hugging Face access token with **write** permission.
3. In this GitHub repo: Settings → Secrets and variables → Actions
   - Secret `HF_TOKEN` = the token
   - Variable `HF_SPACE` = `your-name/namjai`
4. In the Space: Settings → Variables and secrets
   - Variable `SEED_DEMO` = `1` (judges' demo with simulated villages)
   - Secrets `ADMIN_TOKEN` and `SECRET_KEY` = long random strings
   - Secret `DATABASE_URL` = Neon connection string (only needed to keep real pilot data; without it the demo uses SQLite and reseeds after a restart)
5. Actions → **deploy-space** → Run workflow (it also runs on every push to `main`).
6. Check `https://your-name-namjai.hf.space/health`.

## Web app → Cloudflare Pages (free)

Connect the GitHub repo, then: production branch `main`, root directory `web`, build command `npm run build`,
output directory `dist`, environment variable `VITE_API_URL` = `https://your-name-namjai.hf.space`.

The judges' page is `https://<your-pages-domain>/demo`.

Check the current free-tier limits of each service before relying on them.
