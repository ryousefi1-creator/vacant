"""
Vacant — multi-location CV worker (spatial).

LOTS are driven by calib/*.json: fetch the camera, detect vehicles, project each
car's ground-contact point through the lot homography to TOP-DOWN map coords
(a car on the right shows on the right), keep only cars INSIDE the lot quad
(this also drops off-lot false positives), and POST real positions + real
capacity + honest refresh cadence to the Next.js app.

STREETS (NYC DOT) are kept only as clearly-labeled live VEHICLE COUNTERS — no
parking spaces. They give the dashboard constant near-real-time movement.

Poll cadence is per source: streets change every few seconds, Boulder lot
snapshots refresh ~every 15 min, so we poll lots far less often.

  cd ~/"HW Forge/Image Recognition"
  .venv/bin/python scripts/push.py
  .venv/bin/python scripts/push.py --api http://localhost:3000
"""
import argparse
import base64
import json
import os
import time
import urllib.request

import cv2
import numpy as np
from ultralytics import YOLO

import spatial

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
NYC = 'https://webcams.nyctmc.org/api/cameras/{}/image'

# kept streets: clearly labeled live vehicle counters (no parking). 2 is enough
# for "always moving" without burying the lots.
STREETS = [
    {'id': 'fdr122', 'name': 'FDR Dr @ 122 St', 'url': NYC.format('ec1e7b42-18de-4475-8c89-9e80f21e5b6c'), 'refresh_sec': 3},
    {'id': '2ave58', 'name': '2 Ave @ 58 St',   'url': NYC.format('5b44d19e-de48-4941-b071-d2a4c08bd230'), 'refresh_sec': 3},
]


def fetch(url):
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12).read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def detect(model, frame, conf, imgsz, device):
    r = model.predict(frame, classes=spatial.VEHICLE, conf=conf, imgsz=imgsz, verbose=False, device=device)[0]
    return r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))


def to_data_uri(viz, width=800):
    h, w = viz.shape[:2]
    small = cv2.resize(viz, (width, int(h * width / w))) if w > width else viz
    ok, buf = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return 'data:image/jpeg;base64,' + base64.b64encode(buf).decode()


def annotate_lot(frame, calib, xy, mask):
    viz = frame.copy()
    q = np.array(calib['lot_quad'], np.int32)
    cv2.polylines(viz, [q], True, (0, 200, 255), 3)
    lw = max(2, frame.shape[1] // 600)
    for (x1, y1, x2, y2), on in zip(xy, mask):
        c = (0, 210, 0) if on else (120, 120, 120)
        cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), c, lw)
        cv2.circle(viz, (int((x1 + x2) / 2), int(y2)), 5, (0, 0, 255), -1)
    return viz


def annotate_street(frame, xy):
    viz = frame.copy()
    lw = max(2, frame.shape[1] // 480)
    for x1, y1, x2, y2 in xy:
        cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), (0, 200, 0), lw)
    return viz


def post(api, payload):
    body = json.dumps(payload).encode()
    headers = {'Content-Type': 'application/json'}
    token = os.environ.get('VACANT_TOKEN')  # must match the app's VACANT_TOKEN in prod
    if token:
        headers['x-vacant-token'] = token
    req = urllib.request.Request(api + '/api/occupancy', data=body, headers=headers, method='POST')
    urllib.request.urlopen(req, timeout=10).read()


def do_lot(model, calib, api, conf, imgsz, device):
    frame = fetch(calib['url'])
    if frame is None:
        raise RuntimeError('no frame')
    xy = detect(model, frame, conf, imgsz, device)
    cars, mask = spatial.map_cars(calib, xy)
    viz = annotate_lot(frame, calib, xy, mask)
    post(api, {
        'id': calib['id'], 'name': calib['name'], 'type': 'lot', 'surface': calib['surface'],
        'map': calib['map_size'], 'cars': cars, 'inside': len(cars), 'count': int(len(xy)),
        'capacity': calib['capacity'], 'refresh_sec': calib['refresh_sec'],
        'image': to_data_uri(viz),
    })
    return len(cars), int(len(xy))


def do_street(model, st, api, conf, imgsz, device):
    frame = fetch(st['url'])
    if frame is None:
        raise RuntimeError('no frame')
    xy = detect(model, frame, conf, imgsz, device)
    viz = annotate_street(frame, xy)
    post(api, {
        'id': st['id'], 'name': st['name'], 'type': 'street',
        'count': int(len(xy)), 'capacity': None, 'refresh_sec': st['refresh_sec'],
        'image': to_data_uri(viz),
    })
    return int(len(xy))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', default='http://localhost:3000')
    ap.add_argument('--device', default='mps')
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--imgsz', type=int, default=1280)
    ap.add_argument('--lot-interval', type=float, default=30, help='seconds between lot re-fetches (snapshots refresh slowly)')
    ap.add_argument('--street-interval', type=float, default=5, help='seconds between street re-fetches')
    ap.add_argument('--model', default='models/yolo11x.pt')
    args = ap.parse_args()

    calibs = spatial.load_calibs('calib')
    model = YOLO(args.model)
    print(f'worker up: {len(calibs)} calibrated lots + {len(STREETS)} streets -> {args.api}', flush=True)
    if not calibs:
        print('  (no calib/*.json yet — run scripts/calibrate.py)', flush=True)

    # schedule: each source has its own next-due time so lots poll slowly, streets fast
    due = {}
    for cid in calibs:
        due[('lot', cid)] = 0.0
    for st in STREETS:
        due[('street', st['id'])] = 0.0

    while True:
        now = time.time()
        for (kind, cid), t in list(due.items()):
            if now < t:
                continue
            try:
                if kind == 'lot':
                    c = calibs[cid]
                    inside, total = do_lot(model, c, args.api, args.conf, args.imgsz, args.device)
                    print(f"  [lot] {c['name']}: {inside} in-lot ({total} detected)", flush=True)
                    due[(kind, cid)] = time.time() + args.lot_interval
                else:
                    st = next(s for s in STREETS if s['id'] == cid)
                    n = do_street(model, st, args.api, args.conf, args.imgsz, args.device)
                    print(f"  [street] {st['name']}: {n} vehicles", flush=True)
                    due[(kind, cid)] = time.time() + args.street_interval
            except Exception as e:
                print(f"  skip {kind}:{cid}: {type(e).__name__} {e}", flush=True)
                due[(kind, cid)] = time.time() + 15
        time.sleep(1)


if __name__ == '__main__':
    main()
