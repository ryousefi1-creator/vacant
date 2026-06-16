"""
Vacant — per-camera spatial calibration.

ONE-TIME per camera. You give the 4 ground corners of the lot's parking surface
in the image (TL,TR,BR,BL). We build a homography image->top-down so that a car's
ground-contact point (bottom-center of its box) maps to its TRUE position on a
clean top-down map: a car on the right of the lot shows on the right of the map.
No painted stalls required — works on gravel lots (project real car positions).

Writes calib/<id>.json (the runtime contract the worker reads). Renders a
verification image (frame w/ quad + car contacts | top-down map w/ cars) so you
can confirm the quad sits on the lot before saving.

  # preview a quad (no save):
  .venv/bin/python scripts/calibrate.py --id coalton1 --src work/coalton_fresh1.jpg \
      --quad 60,485,780,450,1150,700,240,1010 --map 600x400

  # save it into calib/coalton1.json (merges name/url/etc):
  .venv/bin/python scripts/calibrate.py --id coalton1 ... --save
"""
import argparse
import json
import os

import cv2
import numpy as np
from ultralytics import YOLO

VEHICLE = [2, 3, 5, 7]
CALIB_DIR = 'calib'

# metadata per known camera id (name/url/cadence) merged into the saved calib
META = {
    'coalton1': dict(name='Coalton Trailhead', url='https://bouldercountyopenspace.org/photos/coalton/live1.jpg', refresh_sec=900),
    'chp':      dict(name='Carolyn Holmberg Lot', url='https://bouldercountyopenspace.org/photos/chp/parkinglot.jpg', refresh_sec=900),
    'pella3':   dict(name='Pella Crossing Lot', url='https://bouldercountyopenspace.org/photos/pella/live3.jpg', refresh_sec=900),
    'walker3':  dict(name='Walker Ranch Lot', url='https://bouldercountyopenspace.org/photos/walker/live3.jpg', refresh_sec=900),
    'lagerman2':dict(name='Lagerman Reservoir Lot', url='https://bouldercountyopenspace.org/photos/lagerman/live2.jpg', refresh_sec=900),
}


def homography(quad, mw, mh):
    src = np.array(quad, np.float32)
    dst = np.array([[0, 0], [mw, 0], [mw, mh], [0, mh]], np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def project(H, pts):
    if len(pts) == 0:
        return np.empty((0, 2))
    a = np.array(pts, np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(a, H).reshape(-1, 2)


def detect_contacts(model, frame, conf, imgsz, device):
    """Return (boxes xyxy, ground-contact points = bottom-center of each box)."""
    r = model.predict(frame, classes=VEHICLE, conf=conf, imgsz=imgsz, verbose=False, device=device)[0]
    xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
    contacts = [((x1 + x2) / 2, y2) for x1, y1, x2, y2 in xy]
    return xy, contacts


def render(frame, quad, H, mw, mh, xy, contacts):
    """Side-by-side: annotated frame | top-down map with cars at real positions."""
    viz = frame.copy()
    q = np.array(quad, np.int32)
    cv2.polylines(viz, [q], True, (0, 200, 255), 3)
    proj = project(H, contacts)
    inside = []
    for (x1, y1, x2, y2), (px, py), (mx, my) in zip(xy, contacts, proj):
        on = 0 <= mx <= mw and 0 <= my <= mh
        inside.append(on)
        c = (0, 200, 0) if on else (120, 120, 120)
        cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), c, 2)
        cv2.circle(viz, (int(px), int(py)), 6, (0, 0, 255), -1)  # ground-contact dot

    # top-down map
    scale = 700 / mw
    MW, MH = int(mw * scale), int(mh * scale)
    top = np.full((MH, MW, 3), 60, np.uint8)
    cv2.rectangle(top, (0, 0), (MW - 1, MH - 1), (90, 110, 130), 2)
    for c in range(1, 6):  # faint reference grid
        cv2.line(top, (int(MW * c / 6), 0), (int(MW * c / 6), MH), (75, 80, 88), 1)
        cv2.line(top, (0, int(MH * c / 6)), (MW, int(MH * c / 6)), (75, 80, 88), 1)
    n_in = 0
    for (mx, my), on in zip(proj, inside):
        if not on:
            continue
        n_in += 1
        cx, cy = int(mx * scale), int(my * scale)
        cv2.rectangle(top, (cx - 16, cy - 26), (cx + 16, cy + 26), (60, 70, 200), -1)
        cv2.rectangle(top, (cx - 16, cy - 26), (cx + 16, cy + 26), (200, 220, 255), 2)
    cv2.putText(top, f'{n_in} cars (top-down)', (8, MH - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 230, 240), 1)

    # stack to same height
    h = max(viz.shape[0], top.shape[0])
    vv = cv2.copyMakeBorder(viz, 0, h - viz.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(30, 30, 30))
    tt = cv2.copyMakeBorder(top, 0, h - top.shape[0], 20, 20, cv2.BORDER_CONSTANT, value=(30, 30, 30))
    vv = cv2.resize(vv, (int(vv.shape[1] * h / vv.shape[0]), h))
    return np.hstack([vv, tt]), n_in


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', required=True)
    ap.add_argument('--src', required=True, help='local frame path (snapshot to calibrate on)')
    ap.add_argument('--quad', required=True, help='x1,y1,x2,y2,x3,y3,x4,y4  (TL,TR,BR,BL ground corners)')
    ap.add_argument('--map', default='600x400', help='top-down map size WxH (aspect ~ lot)')
    ap.add_argument('--cap', type=int, default=0, help='honest capacity (marked spaces / est. max)')
    ap.add_argument('--surface', default='gravel', choices=['gravel', 'paved'])
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--imgsz', type=int, default=1280)
    ap.add_argument('--device', default='mps')
    ap.add_argument('--save', action='store_true')
    args = ap.parse_args()

    frame = cv2.imread(args.src)
    if frame is None:
        raise SystemExit(f'could not read {args.src}')
    h, w = frame.shape[:2]
    nums = [int(v) for v in args.quad.split(',')]
    quad = [[nums[i], nums[i + 1]] for i in range(0, 8, 2)]
    mw, mh = (int(v) for v in args.map.split('x'))
    H = homography(quad, mw, mh)

    model = YOLO('models/yolo11x.pt')
    xy, contacts = detect_contacts(model, frame, args.conf, args.imgsz, args.device)
    out, n_in = render(frame, quad, H, mw, mh, xy, contacts)
    cv2.imwrite(f'work/calib_{args.id}.jpg', out)
    print(f'detected {len(xy)} cars, {n_in} inside lot quad -> work/calib_{args.id}.jpg', flush=True)

    if args.save:
        os.makedirs(CALIB_DIR, exist_ok=True)
        meta = META.get(args.id, {})
        rec = {
            'id': args.id,
            'name': meta.get('name', args.id),
            'type': 'lot',
            'surface': args.surface,
            'url': meta.get('url', ''),
            'frame': [w, h],
            'refresh_sec': meta.get('refresh_sec', 900),
            'lot_quad': quad,
            'map_size': [mw, mh],
            'capacity': args.cap or len(xy),
            'stalls': None,
        }
        json.dump(rec, open(f'{CALIB_DIR}/{args.id}.json', 'w'), indent=2)
        print(f'saved {CALIB_DIR}/{args.id}.json', flush=True)


if __name__ == '__main__':
    main()
