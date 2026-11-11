FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 app && mkdir /data && chown app /data
WORKDIR /app
COPY ocr /app/ocr
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir /app/ocr -r /app/server/requirements.txt
COPY server /app/server
COPY --from=web /web/dist /app/web/dist
USER app
WORKDIR /app/server
ENV PORT=7860 DATABASE_URL=sqlite:////data/namjai.db
EXPOSE 7860
CMD ["sh", "-c", "uvicorn namjai.app:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
