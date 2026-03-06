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
   - `FORMSPREE_ENDPOINT` (optional)
   - `NAVER_CLIENT_ID` (optional)
   - `NAVER_CLIENT_SECRET` (optional)

## Cloudflare Pages

Cloudflare Pages is static hosting, so `server.js` is not executed.
This repository uses `config.js` for client-side runtime settings.

1. Connect this GitHub repository to a Pages project.
2. Build command: none, Output directory: `/` (root).
3. Edit `config.js` before deploy:
   - `formspreeEndpoint` (optional, e.g. `https://formspree.io/f/xxxxxxxx`)
   - `adsenseClient` (optional, e.g. `ca-pub-1234...`)
   - `adsenseSlot` (optional, e.g. `1234567890`)
4. Deploy and verify:
   - 문의 폼 submit action is your Formspree endpoint
   - 광고 슬롯이 정상 렌더링됨

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
