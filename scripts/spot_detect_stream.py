"""
Vacant — automatic stall detection from a live RTMP/RTSP stream.

Samples frames from the stream, runs YOLO on each, accumulates car-position
heatmaps, clusters into stable per-car positions, then FILLS GAPS and
extrapolates row ends so EMPTY stalls are inferred from the lot geometry —
not just the parked cars.

Best results: run while a few cars are parked (not all, not none). More
frames = more reliable gap detection.

  .venv/bin/python scripts/spot_detect_stream.py --id mylot
  .venv/bin/python scripts/spot_detect_stream.py --id mylot --capacity 6 --frames 30
  .venv/bin/python scripts/spot_detect_stream.py --id mylot --capacity 6 --iou-thr 0.15
"""
import argparse
import json
import os
import sys
import time

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, os.path.dirname(__file__))
import spatial

VEHICLE = [2, 3, 5, 7]
CALIB_DIR = 'calib'


# ─── frame sampling ───────────────────────────────────────────────────────────

def grab_frames(url, n, interval, model, conf, imgsz, device):
    cap = cv2.VideoCapture(url)
    if not cap.isOpened():
        raise RuntimeError(f'Cannot open stream: {url}')

    all_boxes = []
    last_frame = None
    print(f'Sampling {n} frames (~{n * interval:.0f}s)…', flush=True)
    for i in range(n):
        for _ in range(8):
            cap.grab()
        ok, frame = cap.read()
        if not ok or frame is None:
            print(f'  frame {i+1}: read failed', flush=True)
            continue
        last_frame = frame
        r = model.predict(frame, classes=VEHICLE, conf=conf, imgsz=imgsz, verbose=False, device=device)[0]
        if r.boxes is not None and len(r.boxes):
            boxes = r.boxes.xyxy.cpu().numpy()
            all_boxes.extend(boxes.tolist())
            print(f'  frame {i+1}/{n}: {len(boxes)} vehicle(s)', flush=True)
        else:
            print(f'  frame {i+1}/{n}: none', flush=True)
        if i < n - 1:
            time.sleep(interval)

    cap.release()
    return (np.array(all_boxes, np.float32) if all_boxes else np.empty((0, 4), np.float32)), last_frame


# ─── clustering ───────────────────────────────────────────────────────────────

def iou(a, b):
    xi1, yi1 = max(a[0], b[0]), max(a[1], b[1])
    xi2, yi2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def cluster_boxes(boxes, iou_thr=0.20, min_votes=1):
    """Greedy IoU cluster → average box per cluster seen >= min_votes times."""
    if len(boxes) == 0:
        return []
    clusters: list[list] = []
    for box in boxes:
        merged = False
        for cl in clusters:
            rep = np.mean(cl, axis=0)
            if iou(box, rep) >= iou_thr:
                cl.append(box.tolist())
                merged = True
                break
        if not merged:
            clusters.append([box.tolist()])
    return [np.mean(cl, axis=0) for cl in clusters if len(cl) >= min_votes]


# ─── row / gap analysis ───────────────────────────────────────────────────────

def detect_rows(avg_boxes, row_y_tol_frac=0.55):
    """Group averaged car boxes into rows by similar Y-centroid.
    row_y_tol_frac: fraction of median box height to use as row-merge tolerance."""
    if not avg_boxes:
        return []
    heights = np.array([b[3] - b[1] for b in avg_boxes])
    med_h = float(np.median(heights))
    tol = med_h * row_y_tol_frac

    # sort by y-center
    sorted_b = sorted(avg_boxes, key=lambda b: (b[1] + b[3]) / 2)
    rows: list[list] = []
    for box in sorted_b:
        cy = (box[1] + box[3]) / 2
        placed = False
        for row in rows:
            row_cy = np.mean([(b[1] + b[3]) / 2 for b in row])
            if abs(cy - row_cy) <= tol:
                row.append(box)
                placed = True
                break
        if not placed:
            rows.append([box])
    # sort each row left to right
    return [sorted(r, key=lambda b: b[0]) for r in rows]


def fill_row(row_boxes, target_n=None, extend_ends=1):
    """Given a left-to-right sorted row of car boxes:
    1. Fill any large gaps (likely empty stalls) between detected cars.
    2. Extend the row by `extend_ends` stalls at each end (for edge empty spots).
    3. If target_n given, add/remove from the ends to hit that count.

    Returns list of (box, is_detected) pairs — undetected = inferred empty stall.
    """
    if len(row_boxes) == 0:
        return []

    # median box dimensions for this row
    widths  = np.array([b[2] - b[0] for b in row_boxes])
    heights = np.array([b[3] - b[1] for b in row_boxes])
    med_w = float(np.median(widths))
    med_h = float(np.median(heights))
    med_cy = float(np.median([(b[1] + b[3]) / 2 for b in row_boxes]))

    def make_box(cx, w=None, h=None):
        w = w or med_w
        h = h or med_h
        return [cx - w/2, med_cy - h/2, cx + w/2, med_cy + h/2]

    result = [(b, True) for b in row_boxes]  # (box, detected)

    # fill gaps between consecutive detected boxes
    filled: list[tuple] = []
    for i, (box, det) in enumerate(result):
        filled.append((box, det))
        if i < len(result) - 1:
            next_box, _ = result[i + 1]
            gap = next_box[0] - box[2]
            if gap > med_w * 0.8:  # there's at least one missing stall
                n_missing = max(1, round(gap / med_w) - 1)
                step = (next_box[0] - box[2]) / (n_missing + 1)
                for k in range(1, n_missing + 1):
                    cx = box[2] + step * k
                    filled.append((make_box(cx), False))

    result = sorted(filled, key=lambda t: t[0][0])

    # extend ends (one stall at each edge that was likely just empty)
    for _ in range(extend_ends):
        if result:
            leftmost = result[0][0]
            cx = leftmost[0] - med_w * 0.5
            if cx > 0:
                result.insert(0, (make_box(cx), False))
        if result:
            rightmost = result[-1][0]
            cx = rightmost[2] + med_w * 0.5
            result.append((make_box(cx), False))

    # trim / pad to target_n if given
    if target_n is not None and target_n > 0:
        while len(result) > target_n:
            # remove outermost undetected stall first
            for edge in [(0, 1), (-1, -2)]:
                if not result[edge[0]][1]:
                    result.pop(edge[0])
                    break
            else:
                result.pop()
        while len(result) < target_n:
            rightmost = result[-1][0]
            cx = rightmost[2] + med_w * 0.5
            result.append((make_box(cx), False))

    return result


def expand_box(box, pad_x=0.06, pad_y=0.04):
    x1, y1, x2, y2 = box
    pw = (x2 - x1) * pad_x
    ph = (y2 - y1) * pad_y
    return [x1 - pw, y1 - ph, x2 + pw, y2 + ph]


def box_to_poly(box):
    x1, y1, x2, y2 = expand_box(box)
    return [[int(x1), int(y1)], [int(x2), int(y1)],
            [int(x2), int(y2)], [int(x1), int(y2)]]


# ─── geometry helpers ─────────────────────────────────────────────────────────

def derive_lot_quad(stalls, frame_shape, margin=30):
    all_pts = [pt for s in stalls for pt in s['poly']]
    if not all_pts:
        h, w = frame_shape[:2]
        return [[0, 0], [w, 0], [w, h], [0, h]]
    pts = np.array(all_pts)
    x0 = max(0, int(pts[:, 0].min()) - margin)
    y0 = max(0, int(pts[:, 1].min()) - margin)
    x1 = min(frame_shape[1], int(pts[:, 0].max()) + margin)
    y1 = min(frame_shape[0], int(pts[:, 1].max()) + margin)
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def project_layout(stalls, lot_quad, map_size):
    mw, mh = map_size
    H = spatial.homography(lot_quad, mw, mh)
    return [{'poly': [[round(float(x), 1), round(float(y), 1)] for x, y in spatial.project(H, s['poly'])]}
            for s in stalls]


# ─── preview image ────────────────────────────────────────────────────────────

def save_preview(frame, stalls, lot_quad, map_size, out_path, inferred_mask=None):
    """Draw stalls on the camera frame and next to it a top-down map."""
    viz = frame.copy()
    q = np.array(lot_quad, np.int32)
    cv2.polylines(viz, [q], True, (0, 200, 255), 2)

    for i, s in enumerate(stalls):
        inferred = inferred_mask and not inferred_mask[i]
        color = (0, 140, 255) if inferred else (0, 255, 80)  # orange=inferred, green=detected
        p = np.array(s['poly'], np.int32)
        cv2.polylines(viz, [p], True, color, 2)
        c = p.mean(0).astype(int)
        cv2.putText(viz, str(i + 1), (c[0] - 7, c[1] + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3)
        cv2.putText(viz, str(i + 1), (c[0] - 7, c[1] + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

    # add legend
    cv2.rectangle(viz, (10, 10), (200, 55), (0, 0, 0), -1)
    cv2.putText(viz, 'GREEN = detected car', (14, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 80), 1)
    cv2.putText(viz, 'ORANGE = inferred empty', (14, 48), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 140, 255), 1)

    # top-down map
    mw, mh = map_size
    scale = 500 / mw
    MW, MH = int(mw * scale), int(mh * scale)
    top = np.full((MH, MW, 3), 38, np.uint8)
    H = spatial.homography(lot_quad, mw, mh)
    for i, s in enumerate(stalls):
        inferred = inferred_mask and not inferred_mask[i]
        fill = (30, 60, 80) if inferred else (25, 65, 35)
        border = (0, 140, 255) if inferred else (0, 200, 80)
        pts = spatial.project(H, s['poly'])
        poly_m = (pts * scale).astype(np.int32)
        cv2.fillPoly(top, [poly_m], fill)
        cv2.polylines(top, [poly_m], True, border, 2)
        c = poly_m.mean(0).astype(int)
        cv2.putText(top, str(i + 1), (c[0] - 6, c[1] + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, border, 1)

    fh = viz.shape[0]
    top_r = cv2.resize(top, (int(MW * fh / MH), fh))
    preview = np.hstack([viz, top_r])
    os.makedirs('work', exist_ok=True)
    cv2.imwrite(out_path, preview)
    print(f'Preview → {out_path}', flush=True)
    detected = sum(1 for v in (inferred_mask or [])) if inferred_mask else len(stalls)
    print(f'  GREEN=detected, ORANGE=inferred-empty', flush=True)


# ─── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', default='mylot')
    ap.add_argument('--url', default='rtmp://localhost:1935/live/mylot')
    ap.add_argument('--frames', type=int, default=20)
    ap.add_argument('--interval', type=float, default=2.0)
    ap.add_argument('--iou-thr', type=float, default=0.15,
                    help='IoU threshold for clustering; lower = finer separation (helps for close carport spots)')
    ap.add_argument('--min-votes', type=int, default=1,
                    help='detections needed to count as a real stall position (1 = accept any)')
    ap.add_argument('--capacity', type=int, default=0,
                    help='known total stall count; 0 = infer from detection + row extrapolation')
    ap.add_argument('--extend-ends', type=int, default=1,
                    help='stalls to add at each end of each row (catches edge empty spots)')
    ap.add_argument('--row-tol', type=float, default=0.55,
                    help='fraction of car height to use as row-grouping tolerance')
    ap.add_argument('--map', default='600x400')
    ap.add_argument('--conf', type=float, default=0.18)
    ap.add_argument('--imgsz', type=int, default=640)
    ap.add_argument('--device', default='mps')
    ap.add_argument('--model-path', default='models/yolo11x.pt')
    args = ap.parse_args()

    print('Loading YOLO…', flush=True)
    model = YOLO(args.model_path)

    boxes, last_frame = grab_frames(
        args.url, args.frames, args.interval,
        model, args.conf, args.imgsz, args.device
    )

    if len(boxes) == 0:
        raise SystemExit('No vehicles detected — check stream and parking lot.')

    print(f'\nTotal raw detections: {len(boxes)}', flush=True)

    avg_boxes = cluster_boxes(boxes, iou_thr=args.iou_thr, min_votes=args.min_votes)
    print(f'Clustered into {len(avg_boxes)} stable car positions', flush=True)

    if not avg_boxes:
        raise SystemExit('No stable positions found. Try --min-votes 1 or --iou-thr 0.10')

    # Group into rows and fill gaps / extend ends
    rows = detect_rows(avg_boxes, row_y_tol_frac=args.row_tol)
    print(f'Detected {len(rows)} row(s): {[len(r) for r in rows]}', flush=True)

    # If capacity given, split it proportionally across rows
    per_row_cap = None
    if args.capacity > 0 and len(rows) > 0:
        per_row_cap = [round(args.capacity * len(r) / len(avg_boxes)) for r in rows]
        # make totals exact
        diff = args.capacity - sum(per_row_cap)
        per_row_cap[0] += diff

    all_stalls: list[dict] = []
    inferred_mask: list[bool] = []  # True = detected car, False = inferred empty

    for ri, row in enumerate(rows):
        cap_row = per_row_cap[ri] if per_row_cap else None
        filled = fill_row(row, target_n=cap_row, extend_ends=args.extend_ends)
        for box, detected in filled:
            all_stalls.append({'poly': box_to_poly(box)})
            inferred_mask.append(detected)

    n_det = sum(inferred_mask)
    n_inf = len(inferred_mask) - n_det
    print(f'\nFinal stall layout: {len(all_stalls)} stalls '
          f'({n_det} from detected cars, {n_inf} inferred empty)', flush=True)

    mw, mh = (int(v) for v in args.map.split('x'))
    lot_quad = derive_lot_quad(all_stalls, last_frame.shape)
    layout = project_layout(all_stalls, lot_quad, [mw, mh])

    # load existing calib, preserve all fields
    calib_path = f'{CALIB_DIR}/{args.id}.json'
    existing = {}
    if os.path.exists(calib_path):
        existing = json.load(open(calib_path))

    h, w = last_frame.shape[:2]
    rec = {
        **existing,
        'id': args.id,
        'frame': [w, h],
        'lot_quad': lot_quad,
        'map_size': [mw, mh],
        'capacity': len(all_stalls),
        'stalls': all_stalls,
        'layout': layout,
        'surface': existing.get('surface', 'paved'),
    }

    os.makedirs(CALIB_DIR, exist_ok=True)
    json.dump(rec, open(calib_path, 'w'), indent=2)
    print(f'Saved {calib_path} — {len(all_stalls)} stalls', flush=True)

    save_preview(last_frame, all_stalls, lot_quad, [mw, mh],
                 f'work/{args.id}_spots_preview.jpg', inferred_mask)

    print('\nDone. Restart push.py:', flush=True)
    print(f'  pkill -f push.py && .venv/bin/python scripts/push.py --api http://localhost:3000', flush=True)


if __name__ == '__main__':
    main()
