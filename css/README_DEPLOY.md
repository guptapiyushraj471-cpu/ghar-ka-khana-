# Deploying "Ghar ka Khana" (Free Hosting)

## Option A — Render (1-click, recommended)
1. Push this project to a new GitHub repo.
2. On **Render.com** → **New** → **Web Service** → **Build from GitHub**.
3. Settings:
   - **Build Command:** `npm ci || npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
   - (Render sets `PORT` automatically; no need to add it)
4. **Environment Variables:**
   - `ADMIN_KEY = your-secure-admin-key`
5. (Optional) Set **Health Check Path:** `/api/health`
6. Deploy. Your site will be live at `https://<your-app>.onrender.com`.

> Alternatively, use the provided **`render.yaml`**: Render → **Blueprints** → point to this repo for 1-click deploy (includes a persistent disk for `/data`).

---

## Option B — Railway (free tier)
1. Create an account at **railway.app**.
2. **New Project** → **Deploy from GitHub** → select your repo.
3. Add variables:
   - `ADMIN_KEY = your-secure-admin-key`
   - (Railway sets `PORT` automatically; no need to add it)
4. Railway (Nixpacks) will detect Node and run `node server.js`.
5. You’ll get a URL like `https://<app>.up.railway.app`.

---

## Option C — Vercel (frontend + API proxy)
> Best for **static frontend**. For reliability, host the **backend** on Render/Railway and the **frontend** on Vercel.

### Split deployment (recommended)
- **Backend:** Deploy this repo to Render/Railway (as above).
- **Frontend:** Create a new repo with only `/public` contents (ensure `index.html` at root).
- In the frontend repo’s `vercel.json`, forward API calls to your backend:
  ```json
  {
    "rewrites": [
      { "source": "/api/(.*)", "destination": "https://<your-backend-host>/api/$1" }
    ]
  }
