"""
Vacant — PKLot accuracy harness (the honest scoreboard).

Scores OUR pipeline (YOLO car detection + box-overlap occupancy) against PKLot's
human-labeled ground truth. PKLot cameras are ROOF-MOUNTED (high angle, like the
real Vacant installs) — so this measures accuracy on a REPRESENTATIVE angle, not
the worst-case U7 retrofit clip. Each PKLot space has a 4-point polygon + an
occupied="0/1" flag; we run YOLO, apply the overlap metric per space, and compare.

  python pklot_eval.py --data <dir with .jpg+.xml> --device mps --overlap 0.30
"""
import argparse
import glob
import json
import os
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from ultralytics import YOLO

VEHICLE = [2, 3, 5, 7]


def parse_spaces(xml_path):
    spaces = []
    try:
        root = ET.parse(xml_path).getroot()
    except Exception:
        return spaces
    for sp in root.iter('space'):
        occ = sp.get('occupied')
        contour = sp.find('contour')
        if occ is None or contour is None:
            continue
        pts = [[int(float(p.get('x'))), int(float(p.get('y')))] for p in contour.findall('point')]
        if len(pts) >= 4:
            spaces.append((int(occ), np.array(pts[:4], np.int32)))
    return spaces


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, help='dir with PKLot .jpg + matching .xml')
    ap.add_argument('--model', default='models/yolo11x.pt')
    ap.add_argument('--device', default=None)
    ap.add_argument('--conf', type=float, default=0.15)  # 2026-06-16: 0.15 strictly beats 0.20 on all 3 PKLot cams (recall up, false_occupied flat); tune per camera
    ap.add_argument('--imgsz', type=int, default=1280, help='inference res; 1280 LOCKED (640 misses small cars)')
    ap.add_argument('--overlap', type=float, default=0.30, help='occupied if car box covers >= this frac; LOCKED 0.30 global, tune 0.20-0.40 per camera')
    ap.add_argument('--limit', type=int, default=60, help='max images to score')
    ap.add_argument('--sweep', action='store_true', help='print accuracy across overlap thresholds (one YOLO pass)')
    ap.add_argument('--sample-out', default='work/pklot_sample.jpg')
    args = ap.parse_args()

    imgs = sorted(glob.glob(os.path.join(args.data, '*.jpg')))[:args.limit]
    assert imgs, f'no .jpg found in {args.data}'
    model = YOLO(args.model)

    TP = TN = FP_open = FP_occ = 0  # FP_open = truly occupied but we said empty (DANGEROUS)
    pairs = []  # (overlap_fraction, occupied_true) for the threshold sweep
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
        r = model.predict(frame, classes=VEHICLE, conf=args.conf, imgsz=args.imgsz, verbose=False, device=args.device)[0]
        xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
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
            frac = best / area
            pairs.append((frac, occ_true))
            pred = 1 if frac >= args.overlap else 0
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
            legend = [("GREEN = taken, correct", (0, 200, 0)), ("BLUE  = OPEN, correct", (255, 150, 0)),
                      ("RED   = car we MISSED", (0, 0, 255)), ("ORANGE= empty we wrongly called taken", (0, 140, 255))]
            for i, (txt, c) in enumerate(legend):
                cv2.putText(viz, txt, (10, 24 + i * 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, c, 2)
            cv2.imwrite(args.sample_out, viz)
            sample_done = True

    if args.sweep:
        print(f"# sweep ({len(pairs)} spaces, conf {args.conf}, imgsz {args.imgsz})")
        print("thr   acc%   false_open  false_occ")
        for i in range(11):
            thr = round(0.10 + 0.05 * i, 2)
            tp = tn = fo = foc = 0
            for frac, occ in pairs:
                pr = 1 if frac >= thr else 0
                if pr == occ:
                    tp += occ == 1
                    tn += occ == 0
                elif occ == 1:
                    fo += 1
                else:
                    foc += 1
            t = tp + tn + fo + foc
            print(f"{thr:.2f}  {100 * (tp + tn) / t:6.2f}  {fo:6d}  {foc:6d}")
        return
    total = TP + TN + FP_open + FP_occ
    occ_total, emp_total = TP + FP_open, TN + FP_occ
    print(json.dumps({
        'images': n_img, 'spaces_scored': total,
        'accuracy_pct': round(100 * (TP + TN) / total, 2) if total else 0,
        'false_open': FP_open, 'false_occupied': FP_occ,
        'occupied_recall_pct': round(100 * TP / occ_total, 2) if occ_total else None,
        'empty_recall_pct': round(100 * TN / emp_total, 2) if emp_total else None,
        'overlap_thresh': args.overlap, 'conf': args.conf, 'sample': args.sample_out,
    }, indent=2))


if __name__ == '__main__':
    main()
