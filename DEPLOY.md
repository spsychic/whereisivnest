# Deployment Guide

This project must run as a Node server (`server.js`).  
Do not deploy as static-only hosting, or APIs (`/api/*`) will fail.

## Local Verify

```bash
npm start
```

Check:

- `/health`
- `/api/portfolio`
- `/api/prices`
- `/api/news`

## Render (Recommended)

1. Push this project to a Git repo.
2. In Render, create a new **Web Service** from the repo.
3. Use `render.yaml` or set manually:
   - Start command: `node server.js`
   - Health check path: `/health`
4. Set environment variables in Render dashboard:
   - `NODE_ENV=production`
   - `ADSENSE_CLIENT` (optional)
   - `ADSENSE_SLOT` (optional)
   - `NAVER_CLIENT_ID` (optional)
   - `NAVER_CLIENT_SECRET` (optional)

## Docker

Build:

```bash
docker build -t whereisinvest .
```

Run:

```bash
docker run --rm -p 8080:8080 --env PORT=8080 whereisinvest
```

## Notes

- Fallback mock data is enabled only on `localhost` / `127.0.0.1`.
- In real deployment, API failures are shown as connection failure status (not 3-item mock list).
