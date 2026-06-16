"""
Vacant — live IP-camera feed runner.

Connects to a network camera (MJPEG-over-HTTP like
http://HOST/mjpg/video.mjpg, or RTSP like rtsp://HOST/...), grabs a frame every
--interval seconds, runs the occupancy recipe, and emits a JSON status row +
an annotated frame. A parking lot changes slowly, so we SAMPLE (not every frame)
-> near-zero load, one box can watch many cameras.

  # one-shot plumbing test (grab 1 frame, process, save, exit):
  python live.py --url "http://HOST/mjpg/video.mjpg" --once

  # continuous, with this camera's marked spaces:
  python live.py --url "rtsp://HOST/stream" --stalls source/public/u7_stalls.json --interval 10
"""
import argparse
import json
import time

import cv2
import numpy as np
from ultralytics import YOLO

VEHICLE = [2, 3, 5, 7]


def grab(cap, tries=30):
    """MJPEG needs a few reads to fill its buffer; retry briefly."""
    for _ in range(tries):
        ok, frame = cap.read()
        if ok and frame is not None:
            return frame
        time.sleep(0.1)
    return None


def process(model, frame, stalls, conf, imgsz, device, overlap):
    r = model.predict(frame, classes=VEHICLE, conf=conf, imgsz=imgsz, verbose=False, device=device)[0]
    xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
    viz = frame.copy()
    if not stalls:  # no per-space map -> report OCCUPANCY (un-dodgeable count of cars present)
        for x1, y1, x2, y2 in xy:
            cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), (0, 200, 0), 2)
        return {'mode': 'occupancy', 'cars_present': len(xy)}, viz
    quads = [np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], np.float32) for x1, y1, x2, y2 in xy]
    open_n = 0
    for s in stalls:
        poly = np.array(s['poly'], np.int32)
        pf = poly.astype(np.float32)
        area = max(cv2.contourArea(pf), 1.0)
        best = max((cv2.intersectConvexConvex(pf, cq)[0] for cq in quads), default=0.0)
        taken = best / area >= overlap
        open_n += not taken
        cv2.polylines(viz, [poly], True, (0, 0, 255) if taken else (255, 150, 0), 2)
    return {'mode': 'per_spot', 'total': len(stalls), 'open': open_n, 'taken': len(stalls) - open_n}, viz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True, help='MJPEG http://.../video.mjpg or rtsp://...')
    ap.add_argument('--stalls', help='JSON list of {"poly":[[x,y]..]} for this camera (else report occupancy)')
    ap.add_argument('--interval', type=float, default=10, help='seconds between samples')
    ap.add_argument('--once', action='store_true', help='grab one frame, process, exit (plumbing test)')
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--imgsz', type=int, default=1280)
    ap.add_argument('--overlap', type=float, default=0.30)
    ap.add_argument('--device', default='mps')
    ap.add_argument('--model', default='models/yolo11x.pt')
    ap.add_argument('--out', default='work/live_frame.jpg')
    args = ap.parse_args()

    stalls = json.load(open(args.stalls)) if args.stalls else None
    model = YOLO(args.model)

    while True:
        cap = cv2.VideoCapture(args.url)
        if not cap.isOpened():
            print(json.dumps({'error': 'could not open stream', 'url': args.url}), flush=True)
            if args.once:
                return
            time.sleep(5); continue
        frame = grab(cap)
        cap.release()
        if frame is None:
            print(json.dumps({'error': 'no frame (stream dropped?)'}), flush=True)
            if args.once:
                return
            time.sleep(5); continue
        status, viz = process(model, frame, stalls, args.conf, args.imgsz, args.device, args.overlap)
        status['ts'] = int(time.time())
        status['frame'] = f'{frame.shape[1]}x{frame.shape[0]}'
        cv2.imwrite(args.out, viz)
        print(json.dumps(status), flush=True)  # <-- this line is what you'd POST to a DB / API
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == '__main__':
    main()
