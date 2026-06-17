"""
Vacant — lot REGION QC + refinement ("look at and refine the orange boxes").

Shows EXACTLY how a lot's region decides what belongs to it, so the quad + its
parameters can be refined instead of guessed:
  - the orange lot quad (how we define the lot),
  - every detection colored by membership status from spatial.classify_cars using
    the explicit knobs INSIDE_OVERLAP / EDGE_MARGIN_PX:
        green=in   cyan=boundary (straddles edge, still counted)
        orange=partial (cut off by frame, may be out of view)   grey=out (dropped),
  - a VEGETATION overlay: green-tinted pixels INSIDE the quad that are not parking
    (a tree/bush the quad wrongly covers), plus the % of the quad that is vegetation.

Preview a tighter quad before committing it via calibrate.py --save:
  .venv/bin/python scripts/region_qc.py --id pella3
  .venv/bin/python scripts/region_qc.py --id pella3 --quad 40,300,900,250,1180,560,60,600
  .venv/bin/python scripts/region_qc.py --all
"""
import argparse
import glob
import json
import os
import sys
import urllib.request

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, os.path.dirname(__file__))
import spatial

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
STATUS_COL = {'in': (0, 210, 0), 'boundary': (0, 210, 210), 'partial': (0, 140, 255), 'out': (120, 120, 120)}


def fetch(url):
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12).read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def vegetation_mask(frame):
    """green, saturated, not-too-dark pixels = foliage (a bush/tree, NOT parking)."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, (32, 50, 40), (90, 255, 255))


def quad_mask(shape, quad):
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [np.array(quad, np.int32)], 255)
    return m


def veg_fraction(frame, quad):
    qm = quad_mask(frame.shape, quad)
    veg = cv2.bitwise_and(vegetation_mask(frame), qm)
    area = max(int((qm > 0).sum()), 1)
    return float((veg > 0).sum()) / area, veg, qm


def annotate(frame, calib, quad, model, conf, imgsz, device):
    calib = dict(calib, lot_quad=[list(map(float, p)) for p in quad])
    r = model.predict(frame, classes=spatial.VEHICLE, conf=conf, imgsz=imgsz, verbose=False, device=device)[0]
    xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
    info = spatial.classify_cars(calib, xy, frame.shape)
    vfrac, veg, _ = veg_fraction(frame, quad)

    viz = frame.copy()
    viz[veg > 0] = (0.45 * viz[veg > 0] + 0.55 * np.array([60, 220, 60])).astype(np.uint8)  # green tint over foliage
    cv2.polylines(viz, [np.array(quad, np.int32)], True, (0, 200, 255), 3)
    lw = max(2, frame.shape[1] // 600)
    for c in info:
        x1, y1, x2, y2 = [int(v) for v in c['box']]
        cv2.rectangle(viz, (x1, y1), (x2, y2), STATUS_COL[c['status']], lw)
        cv2.circle(viz, (int(c['contact'][0]), int(c['contact'][1])), 4, (0, 0, 255), -1)

    counts = {k: sum(1 for c in info if c['status'] == k) for k in STATUS_COL}
    counted = counts['in'] + counts['boundary'] + counts['partial']
    return viz, info, counts, counted, vfrac


def banner(viz, calib, counts, counted, vfrac):
    lines = [
        f"{calib['id']}  params: INSIDE_OVERLAP={spatial.INSIDE_OVERLAP} EDGE_MARGIN={spatial.EDGE_MARGIN_PX}px",
        f"counted {counted}  (in {counts['in']}  boundary {counts['boundary']}  partial {counts['partial']})  dropped/out {counts['out']}",
        f"quad vegetation: {100 * vfrac:.0f}%  {'<-- quad covers a tree/bush; tighten it' if vfrac > 0.12 else 'ok'}",
    ]
    pad = np.full((86, viz.shape[1], 3), 22, np.uint8)
    for i, t in enumerate(lines):
        cv2.putText(pad, t, (10, 24 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (230, 235, 240), 1, cv2.LINE_AA)
    return np.vstack([pad, viz])


def run_one(calib, model, args, quad_override=None):
    frame = cv2.imread(args.src) if args.src else fetch(calib['url'])
    assert frame is not None, f"no frame for {calib['id']}"
    quad = quad_override or calib['lot_quad']
    viz, info, counts, counted, vfrac = annotate(frame, calib, quad, model, args.conf, args.imgsz, args.device)
    out = f"work/region_{calib['id']}.jpg"
    cv2.imwrite(out, banner(viz, calib, counts, counted, vfrac))
    print(f"[{calib['id']}] counted {counted} (in {counts['in']} boundary {counts['boundary']} "
          f"partial {counts['partial']}) out {counts['out']} | quad veg {100 * vfrac:.0f}% -> {out}", flush=True)
    return viz, counts, vfrac


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', help='lot id (calib/<id>.json)')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--quad', help='preview a tighter quad: 8 ints TL,TR,BR,BL')
    ap.add_argument('--src', help='use a local frame instead of fetching')
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--imgsz', type=int, default=1920)
    ap.add_argument('--device', default='mps')
    ap.add_argument('--model', default='models/yolo11x.pt')
    args = ap.parse_args()

    calibs = spatial.load_calibs('calib')
    model = YOLO(args.model)

    if args.all:
        thumbs = []
        for cid, c in calibs.items():
            if not c.get('url'):
                continue
            try:
                viz, counts, vfrac = run_one(c, model, args)
                thumbs.append(cv2.resize(viz, (440, int(viz.shape[0] * 440 / viz.shape[1]))))
            except Exception as e:
                print(f"  skip {cid}: {type(e).__name__} {e}", flush=True)
        if thumbs:
            hh = max(t.shape[0] for t in thumbs)
            thumbs = [cv2.copyMakeBorder(t, 0, hh - t.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(20, 20, 20)) for t in thumbs]
            rows = [np.hstack(thumbs[i:i + 3]) for i in range(0, len(thumbs), 3)]
            w = max(r.shape[1] for r in rows)
            rows = [cv2.copyMakeBorder(r, 0, 0, 0, w - r.shape[1], cv2.BORDER_CONSTANT, value=(20, 20, 20)) for r in rows]
            cv2.imwrite('work/region_all.jpg', np.vstack(rows))
            print('-> work/region_all.jpg')
        return

    assert args.id in calibs, f'unknown lot {args.id}; have {list(calibs)}'
    quad = None
    if args.quad:
        n = [int(v) for v in args.quad.split(',')]
        quad = [[n[i], n[i + 1]] for i in range(0, 8, 2)]
    run_one(calibs[args.id], model, args, quad)


if __name__ == '__main__':
    main()
