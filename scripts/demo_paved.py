"""
Vacant — paved per-stall PROOF + clean aerial (PKLot painted-stall lot).

Proves the EXACT per-stall path end-to-end on a lot that genuinely has marked
stalls, and builds the CLEAN bird's-eye layout the right way:

  - OCCUPANCY (live CV): box-overlap per real image-space stall (spatial.stall_states),
    scored against PKLot human ground truth — the "exact" claim is measured.
  - LAYOUT (calibration, DECOUPLED): aerial.clean_stalls projects the stalls through
    a PROPER homography and regularizes them into clean, even, non-overlapping rows.
    Live CV only flips taken/open per stall id; it never moves a stall.

Writes calib/<id>.json carrying BOTH the image stalls (for occupancy) and the clean
top-down layout (for display) so the app + worker render the non-warped map.

  .venv/bin/python scripts/demo_paved.py --frame work/ufpr04_demo.jpg --xml <matching.xml>
  .venv/bin/python scripts/demo_paved.py --frame ... --xml ... --api http://localhost:3000
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, os.path.dirname(__file__))
import aerial
import spatial
from pklot_eval import parse_spaces
from push import annotate_stalls, to_data_uri, post

VEHICLE = [2, 3, 5, 7]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frame', required=True)
    ap.add_argument('--xml', help='PKLot annotation (defaults to <frame>.xml)')
    ap.add_argument('--id', default='paved-demo')
    ap.add_argument('--name', default='Paved Lot (demo · PKLot)')
    ap.add_argument('--quad', help='8 ints TL,TR,BR,BL homography corners (else auto fit_quad)')
    ap.add_argument('--api', help='POST a paved-lot payload to the running app')
    ap.add_argument('--save-calib', action='store_true', help='write calib/<id>.json')
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
    n = len(sp)

    # image-space stalls = the occupancy contract (where a car overlaps a stall)
    image_stalls = [{'id': i, 'poly': p.tolist()} for i, p in enumerate(polys)]

    # CLEAN LAYOUT (decoupled, calibration-time): proper homography + regularize
    quad = None
    if args.quad:
        nums = [int(v) for v in args.quad.split(',')]
        quad = aerial.order_quad(np.array([[nums[i], nums[i + 1]] for i in range(0, 8, 2)], np.float32))
    layout_polys, map_size, meta = aerial.clean_stalls(
        [{'poly': p.astype(np.float32), 'occ': bool(gt[i])} for i, p in enumerate(polys)], quad)

    # OCCUPANCY (live CV) — SAME box-overlap metric as the worker
    model = YOLO('models/yolo11x.pt')
    r = model.predict(frame, classes=VEHICLE, conf=args.conf, imgsz=args.imgsz, verbose=False, device=args.device)[0]
    xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
    states = spatial.stall_states(image_stalls, xy, args.overlap)
    taken = sum(states)

    # measured accuracy vs PKLot ground truth (occupancy only; layout is decoupled)
    correct = sum(int(p) == g for p, g in zip(states, gt))
    false_open = sum(1 for p, g in zip(states, gt) if not p and g == 1)   # taken called empty (dangerous)
    false_occ = sum(1 for p, g in zip(states, gt) if p and g == 0)        # empty called taken
    print(f'stalls {n} | GT taken {sum(gt)} open {n - sum(gt)} | PRED taken {taken} open {n - taken}')
    print(f'occupancy accuracy {100 * correct / n:.1f}%  (false_open {false_open}, false_occ {false_occ})')
    print(f'capacity={n} (EXACT)  open_now={n - taken}  |  layout rows={meta["n_rows"]} map={map_size}')

    # renders: image-space occupancy (proof) + clean aerial (YOLO occ) + clean aerial (GT, to compare)
    cv2.imwrite('work/paved_demo_annot.jpg', annotate_stalls(frame, {'stalls': image_stalls}, xy, states))
    aerial.render_polys(layout_polys, states, map_size, 'work/paved_demo_aerial.jpg')
    aerial.render_polys(layout_polys, gt, map_size, 'work/paved_demo_aerial_gt.jpg')
    print('rendered work/paved_demo_annot.jpg + _aerial.jpg (YOLO) + _aerial_gt.jpg (truth)')

    stalls_out = [{'poly': layout_polys[i], 'taken': bool(states[i])} for i in range(n)]

    if args.save_calib:
        os.makedirs('calib', exist_ok=True)
        rec = {
            'id': args.id, 'name': args.name, 'type': 'lot', 'surface': 'paved',
            'frame': [w, h], 'refresh_sec': 30,
            'lot_quad': meta['quad'], 'map_size': list(map_size),
            'stalls': image_stalls,                                   # occupancy (image space)
            'layout': [{'id': i, 'poly': layout_polys[i]} for i in range(n)],  # display (clean top-down)
            'capacity': n,
        }
        json.dump(rec, open(f'calib/{args.id}.json', 'w'), indent=2)
        print(f'saved calib/{args.id}.json (image stalls + clean layout, decoupled)')

    if args.api:
        post(args.api, {
            'id': args.id, 'name': args.name, 'type': 'lot', 'surface': 'paved',
            'map': list(map_size), 'stalls': stalls_out, 'inside': taken, 'count': int(len(xy)),
            'capacity': n, 'open': n - taken, 'refresh_sec': 30,
            'image': to_data_uri(annotate_stalls(frame, {'stalls': image_stalls}, xy, states)),
        })
        print(f'POSTed paved-demo to {args.api}')


if __name__ == '__main__':
    main()
