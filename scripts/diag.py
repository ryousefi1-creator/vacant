"""
Vacant — diagnostic. NOT a fix. Shows objectively, for one frame, what the
detector sees vs where the stalls are, so we can see WHY near/far rows are
getting confused before changing anything.

Draws: every vehicle detection box (cyan) + its ground-contact dot (magenta),
the stall cells (numbered, white), and prints per cell how many ground-contacts
fall inside it.

  python diag.py --video V.mp4 --stalls stalls.json --frame 150 --device mps
"""
import argparse
import json

import cv2
import numpy as np
from ultralytics import YOLO

VEHICLE = [2, 3, 5, 7]


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def build_stalls(rows):
    polys = []
    for r in rows:
        if "poly" in r:
            polys.append(np.array(r["poly"], dtype=np.int32)); continue
        tl, tr, br, bl = r["corners"]; n = r["count"]
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            polys.append(np.array([lerp(tl, tr, t0), lerp(tl, tr, t1),
                                   lerp(bl, br, t1), lerp(bl, br, t0)], dtype=np.int32))
    return polys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--stalls", required=True)
    ap.add_argument("--frame", type=int, default=150)
    ap.add_argument("--model", default="models/yolo11x.pt")
    ap.add_argument("--device", default=None)
    ap.add_argument("--conf", type=float, default=0.25)
    args = ap.parse_args()

    stalls = build_stalls(json.load(open(args.stalls)))
    cap = cv2.VideoCapture(args.video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    ok, frame = cap.read(); cap.release()
    assert ok

    r = YOLO(args.model).predict(frame, classes=VEHICLE, conf=args.conf,
                                 verbose=False, device=args.device)[0]
    xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
    contacts = [((x1 + x2) / 2, y2) for x1, y1, x2, y2 in xy]

    viz = frame.copy()
    for x1, y1, x2, y2 in xy:
        cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), (255, 200, 0), 1)
    for cx, cy in contacts:
        cv2.circle(viz, (int(cx), int(cy)), 4, (255, 0, 255), -1)

    print(f"frame {args.frame}: {len(xy)} vehicles detected")
    for i, p in enumerate(stalls):
        inside = sum(cv2.pointPolygonTest(p, (float(cx), float(cy)), False) >= 0 for cx, cy in contacts)
        cv2.polylines(viz, [p], True, (255, 255, 255), 2)
        c = p.mean(0).astype(int)
        cv2.putText(viz, str(i), (c[0] - 7, c[1] + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
        cv2.putText(viz, str(i), (c[0] - 7, c[1] + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
        print(f"  cell {i}: {inside} ground-contact(s) inside")

    cv2.imwrite("work/diag_full.jpg", viz)
    # zoom the middle third where near/far confusion lives
    h, w = viz.shape[:2]
    crop = viz[int(h * 0.42):int(h * 0.85), int(w * 0.28):int(w * 0.72)]
    crop = cv2.resize(crop, (crop.shape[1] * 2, crop.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
    cv2.imwrite("work/diag_zoom.jpg", crop)
    print("wrote work/diag_full.jpg + work/diag_zoom.jpg")


if __name__ == "__main__":
    main()
