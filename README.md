# Vacant — live parking-lot occupancy from public cameras

Vacant detects cars in real public camera feeds and shows, live, **where every car
actually is** in a lot — not a guess. Parking lots get a top-down map (cars placed
by a one-time per-camera calibration); busy streets get a live vehicle counter.

> Thesis: we *measure* cars from pixels. GPS-panel products (Placer.ai) only *estimate*.

## Architecture (two parts)

```
 public cams ──► [ CV worker  scripts/push.py ]  ──POST──►  [ Next.js app  vacant-app/ ]  ──►  browser
 (Boulder lots,    YOLO11x + homography projection            /api/occupancy store              live map
  NYC streets)     runs on a Mac/box with a GPU               (Vercel + KV in prod)
```

- **`vacant-app/`** — the dashboard (Next.js 16 / React 19). Deploys to Vercel. Holds
  no CV; it just stores what the worker POSTs and renders it.
- **`scripts/`** — the CV worker and tools. **Cannot run on Vercel** (needs PyTorch +
  a GPU). Runs on a Mac (Apple MPS) or any box, polls cameras, POSTs results to the app.
- **`calib/`** — one JSON per camera: the 4-point ground homography + capacity. Made
  once with `scripts/calibrate.py`.

## Run it locally

**1. Dashboard**
```bash
cd vacant-app
npm install
npm run dev            # http://localhost:3000
```

**2. CV worker** (separate terminal, from the repo root)
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# detector weights (~110MB), not in git:
mkdir -p models && curl -L -o models/yolo11x.pt \
  https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11x.pt
python scripts/push.py            # polls cams -> POSTs to the app
```

Open `http://localhost:3000`. Lots show a calibrated top-down map; streets show a counter.

## Calibrate a new lot (one-time)

```bash
# grab a frame, then pick the 4 ground corners (TL,TR,BR,BL) and verify:
python scripts/calibrate.py --id mylot --src work/frame.jpg \
  --quad x1,y1,x2,y2,x3,y3,x4,y4 --map 600x380 --cap 20 --save
```
Add the camera's URL/metadata to `scripts/push.py`, then re-run the worker.

## Key scripts
- `scripts/push.py` — multi-camera worker (calib-driven lots + labeled streets)
- `scripts/calibrate.py` — per-camera homography calibration
- `scripts/spatial.py` — homography + projection helpers
- `scripts/curate.py` — sweep candidate cams, build a labeled contact sheet

## Deploy (shareable)
Frontend → Vercel; swap the in-memory store in `vacant-app/app/api/occupancy/route.ts`
for **Vercel KV** (serverless instances don't share memory). Keep the worker running on
a Mac/box pointing `--api` at the deployed URL.

Cameras used are all public: Boulder County trailhead lots + NYC DOT traffic cams.
Detector is YOLO11x (AGPL — needs an Ultralytics commercial license or a permissive
swap like RF-DETR/YOLOX before any commercial use).
