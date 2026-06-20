"""
Vacant — automatic stall detection from a live RTMP/RTSP stream.

Samples frames from the stream while cars are parked, runs YOLO on each,
accumulates detection heatmap, clusters into stable stall positions, and
writes per-stall polygons + layout to calib/<id>.json so the dashboard
shows exact per-spot occupancy instead of an estimated count.

Run while at least a few cars are parked in the lot (more = more accurate):

  .venv/bin/python scripts/spot_detect_stream.py --id mylot
  .venv/bin/python scripts/spot_detect_stream.py --id mylot --frames 40 --device mps
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


def grab_frames(url: str, n: int, interval: float, model, conf: float, imgsz: int, device: str):
    """Grab N frames from the stream and run YOLO on each. Returns (all_boxes, last_frame)."""
    cap = cv2.VideoCapture(url)
    if not cap.isOpened():
        raise RuntimeError(f'Cannot open stream: {url}')

    all_boxes = []
    last_frame = None
    collected = 0

    print(f'Sampling {n} frames (~{n * interval:.0f}s)…', flush=True)
    for i in range(n):
        # drain buffer to get a fresh frame
        for _ in range(8):
            cap.grab()
        ok, frame = cap.read()
        if not ok or frame is None:
            print(f'  frame {i+1}: read failed, skipping', flush=True)
            continue

        last_frame = frame
        r = model.predict(frame, classes=VEHICLE, conf=conf, imgsz=imgsz, verbose=False, device=device)[0]
        if r.boxes is not None and len(r.boxes):
            boxes = r.boxes.xyxy.cpu().numpy()
            all_boxes.extend(boxes.tolist())
            print(f'  frame {i+1}/{n}: {len(boxes)} vehicle(s) detected', flush=True)
        else:
            print(f'  frame {i+1}/{n}: no vehicles', flush=True)

        if i < n - 1:
            time.sleep(interval)

    cap.release()
    return np.array(all_boxes, dtype=np.float32) if all_boxes else np.empty((0, 4), np.float32), last_frame


def iou(a, b):
    xi1, yi1 = max(a[0], b[0]), max(a[1], b[1])
    xi2, yi2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def cluster_boxes(boxes: np.ndarray, iou_thr: float = 0.3, min_votes: int = 1):
    """Greedy cluster: boxes that overlap an existing cluster centroid are merged.
    Returns list of average boxes for clusters seen >= min_votes times."""
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

    result = []
    for cl in clusters:
        if len(cl) >= min_votes:
            avg = np.mean(cl, axis=0)
            result.append(avg)
    return result


def box_to_poly(box, pad_x: float = 0.08, pad_y: float = 0.05):
    """Expand a box slightly and return as a 4-point polygon [[x,y],...]."""
    x1, y1, x2, y2 = box
    pw = (x2 - x1) * pad_x
    ph = (y2 - y1) * pad_y
    return [
        [int(x1 - pw), int(y1 - ph)],
        [int(x2 + pw), int(y1 - ph)],
        [int(x2 + pw), int(y2 + ph)],
        [int(x1 - pw), int(y2 + ph)],
    ]


def derive_lot_quad(stalls, frame_shape, margin: int = 30):
    """Derive a tight lot_quad from the union of all stall polygons."""
    all_pts = [pt for s in stalls for pt in s['poly']]
    if not all_pts:
        h, w = frame_shape[:2]
        return [[0, 0], [w, 0], [w, h], [0, h]]
    pts = np.array(all_pts)
    x0, y0 = max(0, pts[:, 0].min() - margin), max(0, pts[:, 1].min() - margin)
    x1 = min(frame_shape[1], pts[:, 0].max() + margin)
    y1 = min(frame_shape[0], pts[:, 1].max() + margin)
    return [[int(x0), int(y0)], [int(x1), int(y0)], [int(x1), int(y1)], [int(x0), int(y1)]]


def project_layout(stalls, lot_quad, map_size):
    """Project stall image-space polys to top-down map coords via homography."""
    mw, mh = map_size
    H = spatial.homography(lot_quad, mw, mh)
    layout = []
    for s in stalls:
        pts = spatial.project(H, s['poly'])
        layout.append({'poly': [[round(float(x), 1), round(float(y), 1)] for x, y in pts]})
    return layout


def save_preview(frame, stalls, lot_quad, map_size, out_path):
    viz = frame.copy()
    q = np.array(lot_quad, np.int32)
    cv2.polylines(viz, [q], True, (0, 200, 255), 2)
    for i, s in enumerate(stalls):
        p = np.array(s['poly'], np.int32)
        cv2.polylines(viz, [p], True, (0, 255, 80), 2)
        c = p.mean(0).astype(int)
        cv2.putText(viz, str(i + 1), (c[0] - 7, c[1] + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3)
        cv2.putText(viz, str(i + 1), (c[0] - 7, c[1] + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 80), 1)

    # top-down map
    mw, mh = map_size
    scale = 500 / mw
    MW, MH = int(mw * scale), int(mh * scale)
    top = np.full((MH, MW, 3), 45, np.uint8)
    H = spatial.homography(lot_quad, mw, mh)
    for i, s in enumerate(stalls):
        pts = spatial.project(H, s['poly'])
        poly_m = (pts * scale).astype(np.int32)
        cv2.fillPoly(top, [poly_m], (30, 70, 40))
        cv2.polylines(top, [poly_m], True, (0, 200, 80), 2)
        c = poly_m.mean(0).astype(int)
        cv2.putText(top, str(i + 1), (c[0] - 6, c[1] + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 100), 1)

    fh = viz.shape[0]
    top_r = cv2.resize(top, (int(MW * fh / MH), fh))
    preview = np.hstack([viz, top_r])
    os.makedirs('work', exist_ok=True)
    cv2.imwrite(out_path, preview)
    print(f'Preview saved → {out_path}', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', default='mylot')
    ap.add_argument('--url', default='rtmp://localhost:1935/live/mylot')
    ap.add_argument('--frames', type=int, default=25, help='number of frames to sample')
    ap.add_argument('--interval', type=float, default=2.0, help='seconds between frames')
    ap.add_argument('--iou-thr', type=float, default=0.25, help='IoU threshold for clustering detections into one stall')
    ap.add_argument('--min-votes', type=int, default=2, help='min times a position must be detected to count as a stall')
    ap.add_argument('--map', default='600x400', help='top-down map size WxH')
    ap.add_argument('--conf', type=float, default=0.20)
    ap.add_argument('--imgsz', type=int, default=640)
    ap.add_argument('--device', default='mps')
    ap.add_argument('--model-path', default='models/yolo11x.pt')
    args = ap.parse_args()

    print(f'Loading YOLO model…', flush=True)
    model = YOLO(args.model_path)

    boxes, last_frame = grab_frames(
        args.url, args.frames, args.interval,
        model, args.conf, args.imgsz, args.device
    )

    if len(boxes) == 0:
        raise SystemExit('No vehicles detected across any sampled frames. '
                         'Make sure cars are parked in the lot and Larix is streaming.')

    print(f'\nTotal detections across all frames: {len(boxes)}', flush=True)

    stall_boxes = cluster_boxes(boxes, iou_thr=args.iou_thr, min_votes=args.min_votes)
    if not stall_boxes:
        raise SystemExit(f'No stable stalls found (min_votes={args.min_votes}). '
                         'Try --min-votes 1 or sample more frames.')

    print(f'Inferred {len(stall_boxes)} stall(s) from {len(boxes)} detections.', flush=True)

    stalls = [{'poly': box_to_poly(b)} for b in stall_boxes]
    mw, mh = (int(v) for v in args.map.split('x'))
    lot_quad = derive_lot_quad(stalls, last_frame.shape)
    layout = project_layout(stalls, lot_quad, [mw, mh])

    # load existing calib to preserve all fields
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
        'capacity': len(stalls),
        'stalls': stalls,
        'layout': layout,
        'surface': existing.get('surface', 'paved'),
    }

    os.makedirs(CALIB_DIR, exist_ok=True)
    json.dump(rec, open(calib_path, 'w'), indent=2)
    print(f'Saved {calib_path} — {len(stalls)} stalls, capacity {len(stalls)}', flush=True)

    save_preview(last_frame, stalls, lot_quad, [mw, mh],
                 f'work/{args.id}_spots_preview.jpg')

    print('\nDone. Restart push.py to apply the new stall layout.', flush=True)
    print(f'  pkill -f push.py && .venv/bin/python scripts/push.py --api http://localhost:3000', flush=True)


if __name__ == '__main__':
    main()
