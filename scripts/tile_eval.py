"""
Vacant — tiled (SAHI-style) accuracy harness.

Same scoring as pklot_eval.py, but runs YOLO on an overlapping GRID of crops so
tiny/far cars become big enough to detect. For OCCUPANCY we only need to know if
each space is covered by SOME car box, so we just POOL all tile detections and
reuse the overlap metric — no cross-tile NMS needed (duplicate boxes are harmless,
each space takes its best-overlapping box).

  python tile_eval.py --data <dir> --device mps --grid 3
"""
import argparse
import glob
import json
import os

import cv2
import numpy as np
from ultralytics import YOLO

from pklot_eval import parse_spaces, VEHICLE


def tile_boxes(model, frame, grid, ov, conf, imgsz, device):
    H, W = frame.shape[:2]
    tw, th = W / grid, H / grid
    px, py = tw * ov, th * ov
    boxes = []
    for r in range(grid):
        for c in range(grid):
            x0, y0 = max(0, int(c * tw - px)), max(0, int(r * th - py))
            x1, y1 = min(W, int((c + 1) * tw + px)), min(H, int((r + 1) * th + py))
            crop = frame[y0:y1, x0:x1]
            res = model.predict(crop, classes=VEHICLE, conf=conf, imgsz=imgsz, verbose=False, device=device)[0]
            if res.boxes is None or not len(res.boxes):
                continue
            for bx in res.boxes.xyxy.cpu().numpy():
                boxes.append([bx[0] + x0, bx[1] + y0, bx[2] + x0, bx[3] + y0])
    return boxes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--model', default='models/yolo11x.pt')
    ap.add_argument('--device', default=None)
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--imgsz', type=int, default=1280)
    ap.add_argument('--overlap', type=float, default=0.30)
    ap.add_argument('--grid', type=int, default=3, help='NxN tile grid (3 = 9 tiles)')
    ap.add_argument('--tile-ov', type=float, default=0.2, help='fractional tile overlap so cars on seams survive')
    ap.add_argument('--limit', type=int, default=20)
    ap.add_argument('--sample-out', default='work/tile_sample.jpg')
    args = ap.parse_args()

    imgs = sorted(glob.glob(os.path.join(args.data, '*.jpg')))[:args.limit]
    assert imgs, f'no .jpg in {args.data}'
    model = YOLO(args.model)

    TP = TN = FP_open = FP_occ = 0
    n_img = 0
    sample_done = False
    for ip in imgs:
        xp = os.path.splitext(ip)[0] + '.xml'
        if not os.path.exists(xp):
            continue
        spaces = parse_spaces(xp)
        if not spaces:
            continue
        frame = cv2.imread(ip)
        if frame is None:
            continue
        n_img += 1
        xy = tile_boxes(model, frame, args.grid, args.tile_ov, args.conf, args.imgsz, args.device)
        quads = [np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], np.float32) for x1, y1, x2, y2 in xy]
        viz = frame.copy() if not sample_done else None
        for occ_true, poly in spaces:
            pf = poly.astype(np.float32)
            area = max(cv2.contourArea(pf), 1.0)
            best = 0.0
            for cq in quads:
                a, _ = cv2.intersectConvexConvex(pf, cq)
                if a > best:
                    best = a
            pred = 1 if best / area >= args.overlap else 0
            if pred == occ_true:
                TP += occ_true == 1
                TN += occ_true == 0
            elif occ_true == 1:
                FP_open += 1
            else:
                FP_occ += 1
            if viz is not None:
                col = {(1, 1): (0, 200, 0), (0, 0): (255, 150, 0), (0, 1): (0, 0, 255), (1, 0): (0, 140, 255)}[(pred, occ_true)]
                cv2.polylines(viz, [poly], True, col, 3)
        if viz is not None:
            cv2.imwrite(args.sample_out, viz)
            sample_done = True

    total = TP + TN + FP_open + FP_occ
    occ_total, emp_total = TP + FP_open, TN + FP_occ
    print(json.dumps({
        'mode': f'tiled {args.grid}x{args.grid}', 'images': n_img, 'spaces_scored': total,
        'accuracy_pct': round(100 * (TP + TN) / total, 2) if total else 0,
        'false_open': FP_open, 'false_occupied': FP_occ,
        'occupied_recall_pct': round(100 * TP / occ_total, 2) if occ_total else None,
        'empty_recall_pct': round(100 * TN / emp_total, 2) if emp_total else None,
        'sample': args.sample_out,
    }, indent=2))


if __name__ == '__main__':
    main()
