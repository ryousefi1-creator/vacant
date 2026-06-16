"""
Vacant — bird's-eye rectification TEST (proof that top-down separates the rows).

The near row and the row behind it are parallel lines in the real world, so we
fit a line through each row's car ground-contacts and use those 4 points to
compute a homography that maps the slanted ground plane to top-down. In that
view the two rows fall onto two separate horizontal bands -> the near/far
entanglement disappears.

  python birdseye.py --video V.mp4 --roi u7_stalls.json --frame 150 --device mps
"""
import argparse
import json

import cv2
import numpy as np
from ultralytics import YOLO

VEHICLE = [2, 3, 5, 7]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--roi", required=True)
    ap.add_argument("--frame", type=int, default=150)
    ap.add_argument("--model", default="models/yolo11x.pt")
    ap.add_argument("--device", default=None)
    ap.add_argument("--conf", type=float, default=0.25)
    args = ap.parse_args()

    quad = np.array(json.load(open(args.roi))[0]["corners"], dtype=np.int32)
    model = YOLO(args.model)

    contacts = []
    for r in model.predict(source=args.video, stream=True, classes=VEHICLE,
                           conf=args.conf, verbose=False, device=args.device):
        b = r.boxes
        if b is None or not len(b):
            continue
        for x1, y1, x2, y2 in b.xyxy.cpu().numpy():
            contacts.append(((x1 + x2) / 2, y2))
    contacts = np.array(contacts)

    # near row = contacts inside the row hint; fit its ground line
    near_m = np.array([cv2.pointPolygonTest(quad, (float(cx), float(cy)), True) >= -40
                       for cx, cy in contacts])
    near = contacts[near_m]
    mn, bn = np.polyfit(near[:, 0], near[:, 1], 1)

    # far row = band just ABOVE the near line; rows are PARALLEL in the world, so
    # force the far line to share the near slope and only fit its offset (robust to
    # sparse far detections that otherwise make the two lines cross)
    res = contacts[:, 1] - (mn * contacts[:, 0] + bn)
    far = contacts[(res < -25) & (res > -100)]
    mf = mn
    bf = float(np.median(far[:, 1] - mn * far[:, 0]))

    XL, XR = float(near[:, 0].min()), float(near[:, 0].max())
    src = np.float32([[XL, mn * XL + bn], [XR, mn * XR + bn],
                      [XR, mf * XR + bf], [XL, mf * XL + bf]])  # NL, NR, FR, FL

    W, H = 1000, 640
    NEAR_Y, FAR_Y, MX = 540, 300, 90
    dst = np.float32([[MX, NEAR_Y], [W - MX, NEAR_Y], [W - MX, FAR_Y], [MX, FAR_Y]])
    Hm = cv2.getPerspectiveTransform(src, dst)

    cap = cv2.VideoCapture(args.video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    ok, frame = cap.read(); cap.release()
    warp = cv2.warpPerspective(frame, Hm, (W, H))

    mapped = cv2.perspectiveTransform(contacts.reshape(-1, 1, 2).astype(np.float32), Hm).reshape(-1, 2)
    for (ox, oy), (wx, wy) in zip(contacts, mapped):
        r0 = oy - (mn * ox + bn)
        col = (0, 0, 255) if abs(r0) < 22 else ((0, 200, 0) if -120 < r0 < -22 else (180, 180, 180))
        if 0 <= wx < W and 0 <= wy < H:
            cv2.circle(warp, (int(wx), int(wy)), 6, col, -1)
            cv2.circle(warp, (int(wx), int(wy)), 6, (0, 0, 0), 1)
    cv2.line(warp, (0, NEAR_Y), (W, NEAR_Y), (0, 0, 255), 1)
    cv2.line(warp, (0, FAR_Y), (W, FAR_Y), (0, 200, 0), 1)
    cv2.putText(warp, "NEAR row (red)", (10, NEAR_Y + 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    cv2.putText(warp, "FAR row (green)", (10, FAR_Y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 0), 2)
    cv2.imwrite("work/birdseye_warp.jpg", warp)

    # PRIMARY PROOF: clean top-down scatter — every car as a dot, no image warp
    board = np.full((H, W, 3), 32, np.uint8)
    cv2.line(board, (0, NEAR_Y), (W, NEAR_Y), (0, 0, 255), 1)
    cv2.line(board, (0, FAR_Y), (W, FAR_Y), (0, 200, 0), 1)
    for (ox, oy), (wx, wy) in zip(contacts, mapped):
        r0 = oy - (mn * ox + bn)
        col = (0, 0, 255) if abs(r0) < 22 else ((0, 200, 0) if -100 < r0 < -25 else (170, 170, 170))
        if 0 <= wx < W and 0 <= wy < H:
            cv2.circle(board, (int(wx), int(wy)), 4, col, -1)
    cv2.putText(board, "TOP-DOWN scatter: each dot = one car detection, mapped through the homography.",
                (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    cv2.putText(board, "Clean horizontal bands = rows separated.", (10, 52),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    cv2.imwrite("work/birdseye_topdown.jpg", board)

    src_viz = frame.copy()
    cv2.polylines(src_viz, [src.astype(np.int32)], True, (0, 255, 255), 2)
    for cx, cy in contacts:
        r0 = cy - (mn * cx + bn)
        col = (0, 0, 255) if abs(r0) < 22 else ((0, 200, 0) if -120 < r0 < -22 else (180, 180, 180))
        cv2.circle(src_viz, (int(cx), int(cy)), 4, col, -1)
    cv2.imwrite("work/birdseye_src.jpg", src_viz)

    print(json.dumps({"contacts": len(contacts), "near_cars_band": int(near_m.sum()),
                      "far_band": int(len(far)), "near_line": [round(mn, 3), round(bn, 1)],
                      "far_line": [round(mf, 3), round(bf, 1)]}, indent=2))


if __name__ == "__main__":
    main()
