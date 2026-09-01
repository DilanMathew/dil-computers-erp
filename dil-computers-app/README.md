# DIL Computers App

React (Vite) frontend + Node/Express backend. Currently ships a single login
screen with a hardcoded account:

- Username: `admin`
- Password: `admin123`

(Override via the `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars without
touching code.)

## Local development

```bash
npm install

# Terminal 1 — backend on :5000
npm run dev:server

# Terminal 2 — frontend on :5173 (proxies /api to :5000)
npm run dev:client
```

Visit http://localhost:5173.

## Production build

```bash
npm install
npm run build   # builds client/dist
npm run start   # serves client/dist + the API on $PORT (default 5000)
```

## Deploying to Railway

This repo is set up for Railway's Nixpacks builder out of the box
(`railway.json` at the root sets the build/start commands: `npm install &&
npm run build` then `npm run start`).

1. Push this repo to GitHub.
2. In Railway, on your project, choose **Deploy from GitHub repo** and pick
   this repo.
3. Railway will detect Node, run the build, and start the server. No extra
   environment variables are required for the login to work (it falls back
   to `admin` / `admin123`), but you can set `ADMIN_USERNAME` /
   `ADMIN_PASSWORD` in the service's Variables tab to change them.
4. Railway assigns `PORT` automatically — the server already reads
   `process.env.PORT`, so no changes needed there.
