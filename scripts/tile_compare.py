"""
Vacant — single-pass vs SAHI-tiled detection comparison (per live lot).

Decides whether a lot should get "tile": true in its calib. For each calibrated
gravel lot (or a local --src frame) it fetches the camera, runs BOTH the single-pass
and the tiled detector through the SAME worker membership logic
(spatial.classify_cars), reports in-lot counts + delta, and saves a side-by-side
annotated image so you can SEE which real cars tiling recovers (and whether it adds
false boxes inside the orange lot region).

Rule of thumb (validated on PKLot): tiling helps FAR/wide/small-car lots, hurts close
lots (splits big foreground cars). Flip "tile": true only where the delta is real cars.

  .venv/bin/python scripts/tile_compare.py                 # all live gravel lots
  .venv/bin/python scripts/tile_compare.py --id lagerman2
  .venv/bin/python scripts/tile_compare.py --src work/frame.jpg --id coalton1 --grid 4
"""
import argparse
import os

import cv2
import numpy as np
from ultralytics import YOLO

import spatial
from push import fetch, annotate_lot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', help='single calib id (default: all live gravel lots)')
    ap.add_argument('--src', help='use a local frame path instead of fetching the camera')
    ap.add_argument('--device', default='mps')
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--lot-imgsz', type=int, default=1920)
    ap.add_argument('--tile-imgsz', type=int, default=1280)
    ap.add_argument('--grid', type=int, default=3)
    ap.add_argument('--model', default='models/yolo11x.pt')
    ap.add_argument('--out-dir', default='work/tile_compare')
    args = ap.parse_args()

    calibs = spatial.load_calibs('calib')
    if args.id:
        calibs = {args.id: calibs[args.id]}
    os.makedirs(args.out_dir, exist_ok=True)
    model = YOLO(args.model)

    print(f"\n{'lot':24}{'single':>8}{'tiled':>8}{'delta':>7}   total-det (single->tiled)")
    print('-' * 72)
    for cid, c in calibs.items():
        if c.get('stalls') is not None or not c.get('url'):
            continue  # paved-stall lots use a different occupancy path; skip url-less demos
        try:
            frame = cv2.imread(args.src) if args.src else fetch(c['url'])
        except Exception as e:
            print(f"  {cid}: fetch failed ({type(e).__name__})")
            continue
        if frame is None:
            print(f"  {cid}: no frame")
            continue

        single = spatial.detect(model, frame, args.conf, int(c.get('imgsz', args.lot_imgsz)), args.device)
        tiled = spatial.detect_tiled(model, frame, args.conf, args.tile_imgsz, args.device, grid=args.grid)
        si = spatial.classify_cars(c, single, frame.shape)
        ti = spatial.classify_cars(c, tiled, frame.shape)
        sin = sum(1 for d in si if d['status'] != 'out')
        tin = sum(1 for d in ti if d['status'] != 'out')

        left, right = annotate_lot(frame, c, si), annotate_lot(frame, c, ti)
        cv2.putText(left, f'single  {sin} in-lot / {len(single)} det', (14, 44),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
        cv2.putText(right, f'tiled {args.grid}x{args.grid}  {tin} in-lot / {len(tiled)} det', (14, 44),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
        outp = os.path.join(args.out_dir, f'{cid}.jpg')
        cv2.imwrite(outp, np.hstack([left, right]))
        print(f"  {c['name']:22}{sin:>8}{tin:>8}{tin - sin:>+7}   {len(single)}->{len(tiled)}   {outp}")
    print()


if __name__ == '__main__':
    main()
