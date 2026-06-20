"""
Interactive calibration for a live RTMP/RTSP stream (e.g. Larix Broadcaster).

Grabs a frame from the stream, lets you click the 4 ground corners of the
parking lot (TL → TR → BR → BL), then saves the calibration to calib/<id>.json.

  .venv/bin/python scripts/calibrate_stream.py --id mylot
  .venv/bin/python scripts/calibrate_stream.py --id mylot --url rtmp://localhost:1935/live/mylot
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, os.path.dirname(__file__))
import spatial

CALIB_DIR = 'calib'
LABELS = ['TL (top-left)', 'TR (top-right)', 'BR (bottom-right)', 'BL (bottom-left)']


def grab_frame(url: str) -> np.ndarray:
    cap = cv2.VideoCapture(url)
    if not cap.isOpened():
        raise RuntimeError(f'Cannot open stream: {url}')
    # drain buffer for freshest frame
    for _ in range(10):
        cap.grab()
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        raise RuntimeError('Failed to read frame from stream')
    return frame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', default='mylot')
    ap.add_argument('--url', default='rtmp://localhost:1935/live/mylot')
    ap.add_argument('--map', default='600x400', help='top-down map size WxH')
    ap.add_argument('--cap', type=int, default=0, help='lot capacity (0 = use detected count)')
    ap.add_argument('--surface', default='gravel', choices=['gravel', 'paved'])
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--imgsz', type=int, default=640)
    ap.add_argument('--device', default='mps')
    ap.add_argument('--frame', help='use a saved JPEG instead of grabbing from stream')
    args = ap.parse_args()

    print('Grabbing frame from stream…', flush=True)
    if args.frame:
        frame = cv2.imread(args.frame)
        if frame is None:
            raise SystemExit(f'Cannot read {args.frame}')
    else:
        frame = grab_frame(args.url)

    h, w = frame.shape[:2]
    print(f'Frame: {w}x{h}', flush=True)

    # save frame so calibrate.py can use it too
    os.makedirs('work', exist_ok=True)
    cv2.imwrite(f'work/{args.id}_calib_frame.jpg', frame)
    print(f'Frame saved to work/{args.id}_calib_frame.jpg', flush=True)

    points = []
    display = frame.copy()

    def on_click(event, x, y, flags, _param):
        if event != cv2.EVENT_LBUTTONDOWN:
            return
        if len(points) >= 4:
            return
        points.append([x, y])
        label = LABELS[len(points) - 1]
        print(f'  {label}: ({x}, {y})', flush=True)
        cv2.circle(display, (x, y), 8, (0, 255, 80), -1)
        cv2.putText(display, label.split()[0], (x + 10, y - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 80), 2)
        if len(points) > 1:
            cv2.line(display, tuple(points[-2]), (x, y), (0, 255, 80), 2)
        if len(points) == 4:
            cv2.line(display, (x, y), tuple(points[0]), (0, 255, 80), 2)
            cv2.polylines(display, [np.array(points, np.int32)], True, (0, 200, 255), 2)
            cv2.putText(display, 'Press S to save  R to redo  Q to quit',
                        (12, h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 200, 255), 2)
        cv2.imshow('Calibrate — click TL TR BR BL corners', display)

    print('\nClick the 4 corners of the parking lot in order: TL → TR → BR → BL', flush=True)
    print('After 4 clicks: S = save  R = redo  Q = quit\n', flush=True)

    cv2.namedWindow('Calibrate — click TL TR BR BL corners', cv2.WINDOW_NORMAL)
    cv2.resizeWindow('Calibrate — click TL TR BR BL corners', min(w, 1400), min(h, 900))
    cv2.setMouseCallback('Calibrate — click TL TR BR BL corners', on_click)
    # draw instructions on first display
    guide = display.copy()
    cv2.putText(guide, 'Click: TL  TR  BR  BL  corners of the parking lot',
                (12, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 220, 255), 2)
    cv2.imshow('Calibrate — click TL TR BR BL corners', guide)

    while True:
        key = cv2.waitKey(20) & 0xFF
        if key == ord('q'):
            print('Quit — nothing saved.', flush=True)
            break
        elif key == ord('r'):
            points.clear()
            display[:] = frame
            cv2.putText(display, 'Click: TL  TR  BR  BL  corners of the parking lot',
                        (12, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 220, 255), 2)
            cv2.imshow('Calibrate — click TL TR BR BL corners', display)
            print('Reset — click 4 corners again.', flush=True)
        elif key == ord('s') and len(points) == 4:
            cv2.destroyAllWindows()
            _save(args, frame, points, w, h)
            break

    cv2.destroyAllWindows()


def _save(args, frame, points, w, h):
    mw, mh = (int(v) for v in args.map.split('x'))
    quad = points  # [[x,y], ...]

    print('\nRunning YOLO detection on calibration frame…', flush=True)
    model = YOLO('models/yolo11x.pt')
    r = model.predict(frame, classes=spatial.VEHICLE, conf=args.conf,
                      imgsz=args.imgsz, verbose=False, device=args.device)[0]
    xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
    print(f'Detected {len(xy)} vehicles in calibration frame.', flush=True)

    H = spatial.homography(quad, mw, mh)
    contacts = [((x1 + x2) / 2, y2) for x1, y1, x2, y2 in xy]
    proj = spatial.project(H, contacts)

    # verification render
    viz = frame.copy()
    cv2.polylines(viz, [np.array(quad, np.int32)], True, (0, 200, 255), 3)
    for (x1, y1, x2, y2), (px, py), mp in zip(xy, contacts, proj):
        on = 0 <= mp[0] <= mw and 0 <= mp[1] <= mh
        cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), (0, 200, 0) if on else (120, 120, 120), 2)
        cv2.circle(viz, (int(px), int(py)), 5, (0, 0, 255), -1)

    scale = 600 / mw
    MW, MH = int(mw * scale), int(mh * scale)
    top = np.full((MH, MW, 3), 50, np.uint8)
    cv2.rectangle(top, (0, 0), (MW - 1, MH - 1), (80, 100, 120), 2)
    n_in = 0
    for mp in proj:
        if 0 <= mp[0] <= mw and 0 <= mp[1] <= mh:
            n_in += 1
            cx, cy = int(mp[0] * scale), int(mp[1] * scale)
            cv2.rectangle(top, (cx - 14, cy - 22), (cx + 14, cy + 22), (60, 70, 200), -1)
            cv2.rectangle(top, (cx - 14, cy - 22), (cx + 14, cy + 22), (180, 200, 255), 2)
    cv2.putText(top, f'{n_in} cars in lot', (8, MH - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 220, 240), 1)

    h_frame = viz.shape[0]
    top_r = cv2.resize(top, (int(MW * h_frame / MH), h_frame))
    verify = np.hstack([viz, top_r])
    os.makedirs('work', exist_ok=True)
    verify_path = f'work/calib_{args.id}_verify.jpg'
    cv2.imwrite(verify_path, verify)
    print(f'Verification image saved to {verify_path}', flush=True)

    # load existing calib to preserve fields
    existing = {}
    calib_path = f'{CALIB_DIR}/{args.id}.json'
    if os.path.exists(calib_path):
        existing = json.load(open(calib_path))

    capacity = args.cap if args.cap > 0 else max(len(xy), existing.get('capacity', 0))
    rec = {
        **existing,
        'id': args.id,
        'name': existing.get('name', args.id),
        'type': 'lot',
        'surface': args.surface,
        'url': existing.get('url', args.url),
        'frame': [w, h],
        'refresh_sec': existing.get('refresh_sec', 1),
        'lot_quad': quad,
        'map_size': [mw, mh],
        'capacity': capacity,
        'stalls': existing.get('stalls', None),
    }
    # keep imgsz override if present
    if 'imgsz' in existing:
        rec['imgsz'] = existing['imgsz']

    os.makedirs(CALIB_DIR, exist_ok=True)
    json.dump(rec, open(calib_path, 'w'), indent=2)
    print(f'\nSaved {calib_path}', flush=True)
    print(f'lot_quad: {quad}', flush=True)
    print(f'Restart push.py to pick up the new calibration.', flush=True)

    # show verification
    cv2.namedWindow('Verification — close to finish', cv2.WINDOW_NORMAL)
    cv2.resizeWindow('Verification — close to finish', min(verify.shape[1], 1400), min(verify.shape[0], 700))
    cv2.imshow('Verification — close to finish', verify)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
