"""
Vacant — paved per-stall PROOF (uses a real painted-stall lot: PKLot UFPR04).

None of our 6 live Boulder County lots are paved — they're all gravel (no painted
stalls), so they correctly stay on the honest estimate+peak model. This script
proves the EXACT per-stall path on a lot that genuinely has marked stalls, using
the SAME shared logic the live worker uses (spatial.stall_states / project_stalls),
and scores it against PKLot's human ground truth so the "exact" claim is measured,
not asserted.

  # score + render only:
  .venv/bin/python scripts/demo_paved.py --frame work/ufpr04_demo.jpg --xml <matching.xml>
  # also push to the running app so the dashboard shows the paved lot:
  .venv/bin/python scripts/demo_paved.py --frame ... --xml ... --api http://localhost:3000
"""
import argparse
import glob
import os
import sys

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, os.path.dirname(__file__))
import spatial
from pklot_eval import parse_spaces
from push import annotate_stalls, to_data_uri, post

VEHICLE = [2, 3, 5, 7]


def order_quad(pts):
    """4 oriented-box corners -> [TL, TR, BR, BL] by image position."""
    pts = np.array(pts, np.float32)
    pts = pts[np.argsort(pts[:, 1])]            # by y
    top = pts[:2][np.argsort(pts[:2, 0])]       # TL, TR
    bot = pts[2:][np.argsort(pts[2:, 0])]       # BL, BR
    return [top[0].tolist(), top[1].tolist(), bot[1].tolist(), bot[0].tolist()]


def topdown_preview(calib, stalls_out, path):
    """Sanity render of the projected stalls (confirms the homography is clean)."""
    mw, mh = calib['map_size']
    sc = 640 / mw
    W, Hh = int(mw * sc), int(mh * sc)
    img = np.full((Hh, W, 3), 52, np.uint8)
    for st in stalls_out:
        poly = (np.array(st['poly'], np.float32) * sc).astype(np.int32)
        cv2.fillPoly(img, [poly], (40, 40, 170) if st['taken'] else (90, 170, 60))
        cv2.polylines(img, [poly], True, (240, 244, 248), 2)
    cv2.imwrite(path, img)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frame', required=True)
    ap.add_argument('--xml', help='PKLot annotation (defaults to <frame>.xml)')
    ap.add_argument('--api', help='POST a paved-lot payload to the running app')
    ap.add_argument('--device', default='mps')
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--imgsz', type=int, default=1280)
    ap.add_argument('--overlap', type=float, default=0.30)
    args = ap.parse_args()

    frame = cv2.imread(args.frame)
    assert frame is not None, f'could not read {args.frame}'
    xml = args.xml or (os.path.splitext(args.frame)[0] + '.xml')
    sp = parse_spaces(xml)
    assert sp, f'no stalls parsed from {xml}'
    gt = [o for o, _ in sp]
    polys = [p for _, p in sp]
    h, w = frame.shape[:2]

    # one-time homography quad = oriented bounding box of the painted-stall cloud
    quad = order_quad(cv2.boxPoints(cv2.minAreaRect(np.vstack(polys))))
    rect_w, rect_h = cv2.minAreaRect(np.vstack(polys))[1]
    longest = max(rect_w, rect_h)
    mw, mh = (700, round(700 * rect_h / rect_w)) if rect_w >= rect_h else (round(700 * rect_w / rect_h), 700)

    calib = {
        'id': 'paved-demo', 'name': 'Paved Lot (demo · PKLot UFPR04)', 'type': 'lot', 'surface': 'paved',
        'frame': [w, h], 'refresh_sec': 30, 'lot_quad': quad, 'map_size': [mw, mh],
        'stalls': [{'id': i, 'poly': p.tolist()} for i, p in enumerate(polys)],
    }

    model = YOLO('models/yolo11x.pt')
    r = model.predict(frame, classes=VEHICLE, conf=args.conf, imgsz=args.imgsz, verbose=False, device=args.device)[0]
    xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))

    states = spatial.stall_states(calib['stalls'], xy, args.overlap)   # SAME logic as the live worker
    stalls_out = spatial.project_stalls(calib, states)
    taken = sum(states)

    # measured accuracy vs PKLot ground truth
    correct = sum(int(p) == g for p, g in zip(states, gt))
    false_open = sum(1 for p, g in zip(states, gt) if not p and g == 1)   # taken called empty (dangerous)
    false_occ = sum(1 for p, g in zip(states, gt) if p and g == 0)        # empty called taken
    n = len(sp)
    print(f'stalls {n} | GT taken {sum(gt)} open {n - sum(gt)} | PRED taken {taken} open {n - taken}')
    print(f'accuracy {100 * correct / n:.1f}%  (false_open {false_open}, false_occ {false_occ})')
    print(f'capacity={n} (EXACT)  open_now={n - taken}')

    cv2.imwrite('work/paved_demo_annot.jpg', annotate_stalls(frame, calib, xy, states))
    topdown_preview(calib, stalls_out, 'work/paved_demo_topdown.jpg')
    print('rendered work/paved_demo_annot.jpg + work/paved_demo_topdown.jpg')

    if args.api:
        post(args.api, {
            'id': calib['id'], 'name': calib['name'], 'type': 'lot', 'surface': 'paved',
            'map': calib['map_size'], 'stalls': stalls_out, 'inside': taken, 'count': int(len(xy)),
            'capacity': n, 'open': n - taken, 'refresh_sec': calib['refresh_sec'],
            'image': to_data_uri(annotate_stalls(frame, calib, xy, states)),
        })
        print(f'POSTed paved-demo to {args.api}')


if __name__ == '__main__':
    main()
