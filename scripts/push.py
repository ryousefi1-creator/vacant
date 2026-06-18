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
PEAKS_FILE = 'work/peaks.json'  # most cars ever counted per lot — grounds capacity in real data


def load_peaks():
    try:
        return json.load(open(PEAKS_FILE))
    except Exception:
        return {}


def save_peaks(p):
    try:
        json.dump(p, open(PEAKS_FILE, 'w'))
    except Exception:
        pass

# kept streets: clearly labeled live vehicle counters (no parking). 2 is enough
# for "always moving" without burying the lots.
STREETS = [
    {'id': 'fdr122', 'name': 'FDR Dr @ 122 St', 'url': NYC.format('ec1e7b42-18de-4475-8c89-9e80f21e5b6c'), 'refresh_sec': 3},
    {'id': '2ave58', 'name': '2 Ave @ 58 St',   'url': NYC.format('5b44d19e-de48-4941-b071-d2a4c08bd230'), 'refresh_sec': 3},
]


def fetch(url):
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12).read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def detect_lot(model, frame, calib, conf, lot_imgsz, tile_imgsz, tile_grid, device):
    """Detect vehicles for a LOT. Tiling is opt-in per calib ("tile": true) to recover
    small/far cars on wide gravel lots; close lots stay single-pass (tiling splits big
    foreground cars). Per-calib "imgsz"/"tile_imgsz"/"tile_grid" override the CLI defaults."""
    if calib.get('tile'):
        return spatial.detect_tiled(model, frame, conf, int(calib.get('tile_imgsz', tile_imgsz)),
                                    device, grid=int(calib.get('tile_grid', tile_grid)))
    return spatial.detect(model, frame, conf, int(calib.get('imgsz', lot_imgsz)), device)


def to_data_uri(viz, width=800):
    h, w = viz.shape[:2]
    small = cv2.resize(viz, (width, int(h * width / w))) if w > width else viz
    ok, buf = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return 'data:image/jpeg;base64,' + base64.b64encode(buf).decode()


def annotate_lot(frame, calib, info):
    """Live-detection view: the orange lot region + each detection colored by its lot
    membership (green=in, cyan=boundary/straddling but counted, orange=cut off by the
    frame edge, grey=off-lot/dropped). Makes the refined region logic visible."""
    viz = frame.copy()
    q = np.array(calib['lot_quad'], np.int32)
    cv2.polylines(viz, [q], True, (0, 200, 255), 3)
    lw = max(2, frame.shape[1] // 600)
    col = {'in': (0, 210, 0), 'boundary': (0, 210, 210), 'partial': (0, 140, 255), 'out': (120, 120, 120)}
    for c in info:
        x1, y1, x2, y2 = [int(v) for v in c['box']]
        cv2.rectangle(viz, (x1, y1), (x2, y2), col[c['status']], lw)
        cv2.circle(viz, (int(c['contact'][0]), int(c['contact'][1])), 5, (0, 0, 255), -1)
    return viz


def annotate_stalls(frame, calib, xy, states):
    """PAVED lots: draw each real stall polygon red=taken / green=open, with faint
    car boxes for context (image space)."""
    viz = frame.copy()
    lw = max(2, frame.shape[1] // 600)
    for x1, y1, x2, y2 in xy:
        cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), (150, 150, 150), 1)
    for s, taken in zip(calib['stalls'], states):
        poly = np.array(s['poly'], np.int32)
        cv2.polylines(viz, [poly], True, (0, 0, 255) if taken else (0, 200, 0), lw)
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


def do_lot(model, calib, api, conf, imgsz, device, peaks, overlap=0.30, tile_imgsz=1280, tile_grid=3):
    frame = fetch(calib['url'])
    if frame is None:
        raise RuntimeError('no frame')
    xy = detect_lot(model, frame, calib, conf, imgsz, tile_imgsz, tile_grid, device)

    # PAVED lots with real marked stalls -> EXACT per-stall occupancy (capacity is
    # the marked-stall count, open = # empty). The estimate/peak path below is only
    # for free-form gravel lots that have no countable spaces.
    if calib.get('stalls'):
        states = spatial.stall_states(calib['stalls'], xy, overlap)
        stalls_out = spatial.display_stalls(calib, states)   # CLEAN calibrated layout + live occupancy
        taken = sum(states)
        open_n = len(states) - taken
        viz = annotate_stalls(frame, calib, xy, states)
        post(api, {
            'id': calib['id'], 'name': calib['name'], 'type': 'lot', 'surface': calib['surface'],
            'map': calib['map_size'], 'stalls': stalls_out, 'inside': taken, 'count': int(len(xy)),
            'capacity': len(states), 'open': open_n, 'refresh_sec': calib['refresh_sec'],
            'image': to_data_uri(viz),
        })
        return taken, int(len(xy))

    # overlap-robust lot membership: boundary (straddling) cars ARE counted, frame-edge
    # cars are flagged 'partial' (may be out of view) — classify once, reuse for the
    # count + the annotated panel.
    info = spatial.classify_cars(calib, xy, frame.shape)
    counted = [c for c in info if c['status'] != 'out']
    cars = [{'x': c['map'][0], 'y': c['map'][1], 'partial': c['partial']} for c in counted]
    inside = len(cars)
    partial_n = sum(1 for c in counted if c['partial'])
    # capacity = careful per-lot floor, corrected UP by the most cars we've ever
    # counted there (real data, not a guess; self-improves as the lot fills).
    peak = max(int(peaks.get(calib['id'], 0)), inside)
    peaks[calib['id']] = peak
    capacity = max(calib['capacity'], peak)
    viz = annotate_lot(frame, calib, info)
    post(api, {
        'id': calib['id'], 'name': calib['name'], 'type': 'lot', 'surface': calib['surface'],
        'map': calib['map_size'], 'cars': cars, 'inside': inside, 'count': int(len(xy)),
        'partial': partial_n, 'capacity': capacity, 'peak': peak, 'refresh_sec': calib['refresh_sec'],
        'image': to_data_uri(viz),
    })
    return inside, int(len(xy))


def do_street(model, st, api, conf, imgsz, device):
    frame = fetch(st['url'])
    if frame is None:
        raise RuntimeError('no frame')
    xy = spatial.detect(model, frame, conf, imgsz, device)
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
    ap.add_argument('--imgsz', type=int, default=1280, help='street detection size')
    ap.add_argument('--lot-imgsz', type=int, default=1920, help='lot detection size (higher = catches more far cars)')
    ap.add_argument('--overlap', type=float, default=0.30, help='paved-stall occupancy threshold (box covers >= this frac of a stall)')
    ap.add_argument('--tile-imgsz', type=int, default=1280, help='per-tile detection size for lots with "tile": true')
    ap.add_argument('--tile-grid', type=int, default=3, help='NxN tile grid for tiled lots (3 = 9 tiles, the validated sweet spot)')
    ap.add_argument('--lot-interval', type=float, default=30, help='seconds between lot re-fetches (snapshots refresh slowly)')
    ap.add_argument('--street-interval', type=float, default=5, help='seconds between street re-fetches')
    ap.add_argument('--model', default='models/yolo11x.pt')
    args = ap.parse_args()

    calibs = spatial.load_calibs('calib')
    peaks = load_peaks()
    model = YOLO(args.model)
    print(f'worker up: {len(calibs)} calibrated lots + {len(STREETS)} streets -> {args.api}', flush=True)
    if not calibs:
        print('  (no calib/*.json yet — run scripts/calibrate.py)', flush=True)

    # schedule: each source has its own next-due time so lots poll slowly, streets fast
    due = {}
    for cid, c in calibs.items():
        if c.get('url'):                       # skip demo/offline calibs (e.g. paved-demo) — no live cam to poll
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
                    inside, total = do_lot(model, c, args.api, args.conf, args.lot_imgsz, args.device, peaks,
                                           args.overlap, args.tile_imgsz, args.tile_grid)
                    save_peaks(peaks)
                    g = c.get('tile_grid', args.tile_grid)
                    tag = f" [tiled {g}x{g}]" if c.get('tile') else ''
                    print(f"  [lot] {c['name']}:{tag} {inside} in-lot ({total} detected, peak {peaks.get(cid)})", flush=True)
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
