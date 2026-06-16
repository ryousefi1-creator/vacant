"""
Vacant — accuracy eval for per-spot occupancy.

Turns "looks right" into a measured number. Two modes:

  # 1. make a labeling sheet: numbered stalls on sampled frames -> montage
  python eval.py --video V.mp4 --stalls stalls.json --label --frames 100,300,500,700

  # 2. score the detector against ground truth you labeled
  python eval.py --video V.mp4 --stalls stalls.json --gt gt.json --model yolo11x.pt --device mps

gt.json schema (occupied stall indices per frame):
  { "100": [0,1,2,8,9,10,11,12,13], "300": [...], ... }
Reports per-stall accuracy, open-count error, and which way it errs
(false-open = called empty but a car was there; false-occupied = the reverse).
"""
import argparse
import json
from pathlib import Path

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
            polys.append(np.array(r["poly"], dtype=np.int32))
            continue
        tl, tr, br, bl = r["corners"]
        n = r["count"]
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            polys.append(np.array(
                [lerp(tl, tr, t0), lerp(tl, tr, t1), lerp(bl, br, t1), lerp(bl, br, t0)],
                dtype=np.int32))
    return polys


def grab(video, idx):
    cap = cv2.VideoCapture(video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, f = cap.read()
    cap.release()
    return f if ok else None


def predict_occ(frame, model, stalls, stall_f, stall_area, conf, overlap, device):
    r = model.predict(frame, classes=VEHICLE, conf=conf, verbose=False, device=device)[0]
    xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
    quads = [np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32)
             for x1, y1, x2, y2 in xy]
    occ = []
    for i in range(len(stalls)):
        best = 0.0
        for cq in quads:
            a, _ = cv2.intersectConvexConvex(stall_f[i], cq)
            if a > best:
                best = a
        occ.append((best / stall_area[i]) >= overlap)
    return occ


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--stalls", required=True)
    ap.add_argument("--model", default="yolo11x.pt")
    ap.add_argument("--device", default=None)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--overlap", type=float, default=0.15)
    ap.add_argument("--label", action="store_true")
    ap.add_argument("--frames", default="100,300,500,700")
    ap.add_argument("--gt", default=None)
    args = ap.parse_args()

    stalls = build_stalls(json.load(open(args.stalls)))
    stall_f = [p.astype(np.float32) for p in stalls]
    stall_area = [max(float(cv2.contourArea(p)), 1.0) for p in stall_f]
    total = len(stalls)
    outdir = Path("work/eval")
    outdir.mkdir(parents=True, exist_ok=True)

    if args.label:
        idxs = [int(x) for x in args.frames.split(",")]
        tiles = []
        for idx in idxs:
            f = grab(args.video, idx)
            if f is None:
                continue
            for i, p in enumerate(stalls):
                cv2.polylines(f, [p], True, (0, 255, 255), 2)
                c = p.mean(axis=0).astype(int)
                cv2.putText(f, str(i), (c[0] - 8, c[1] + 5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4)
                cv2.putText(f, str(i), (c[0] - 8, c[1] + 5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
            cv2.rectangle(f, (0, 0), (210, 34), (0, 0, 0), -1)
            cv2.putText(f, f"frame {idx}", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.imwrite(str(outdir / f"f{idx}.jpg"), f)
            tiles.append(f)
        if tiles:
            h = min(t.shape[0] for t in tiles)
            tiles = [cv2.resize(t, (int(t.shape[1] * h / t.shape[0]), h)) for t in tiles]
            rows = [np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)]
            w = min(r.shape[1] for r in rows)
            rows = [r[:, :w] for r in rows]
            cv2.imwrite(str(outdir / "montage.jpg"), np.vstack(rows))
            print("wrote", outdir / "montage.jpg", "| label occupied stall #s per frame ->", args.gt or "gt.json")
        return

    model = YOLO(args.model)
    gt = json.load(open(args.gt))
    per_stall_correct = np.zeros(total, dtype=int)
    n_frames = 0
    tp = fp_open = fp_occ = 0  # exact matches, false-open, false-occupied
    open_err = []
    for fidx, occ_idx in gt.items():
        f = grab(args.video, int(fidx))
        if f is None:
            continue
        n_frames += 1
        pred = predict_occ(f, model, stalls, stall_f, stall_area, args.conf, args.overlap, args.device)
        truth = [i in set(occ_idx) for i in range(total)]
        for i in range(total):
            if pred[i] == truth[i]:
                per_stall_correct[i] += 1; tp += 1
            elif truth[i] and not pred[i]:
                fp_open += 1   # car there, we said open
            else:
                fp_occ += 1    # empty, we said occupied
        open_err.append((total - sum(pred)) - (total - sum(truth)))

    cells = n_frames * total
    acc = 100 * tp / cells if cells else 0
    print(json.dumps({
        "frames": n_frames, "stalls": total, "cells": cells,
        "per_cell_accuracy_pct": round(acc, 1),
        "false_open": fp_open, "false_occupied": fp_occ,
        "open_count_MAE": round(float(np.mean([abs(e) for e in open_err])), 2) if open_err else 0,
        "open_count_bias": round(float(np.mean(open_err)), 2) if open_err else 0,
        "worst_stalls": [int(i) for i in np.argsort(per_stall_correct)[:4]],
        "overlap": args.overlap, "conf": args.conf,
    }, indent=2))


if __name__ == "__main__":
    main()
