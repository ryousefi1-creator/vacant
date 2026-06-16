"""
Vacant — per-spot occupancy CLASSIFIER + learning-loop scaffold.

This is the Phase-2 path beyond detection+overlap. Instead of "find every car
then check overlap" (which fails when far cars are tiny), we WARP each parking
space to a fixed 48x48 patch and classify it full/empty. Warping normalizes size,
so a tiny far car and a big near car look the same to the model -> dissolves the
small-object problem that capped tiling at ~93% on PUCPR.

It is also the LEARNING LOOP's core: the same train() retrains on a growing pile
of a real camera's CONFIRMED crops (see --feedback-dir + LEARNING-LOOP.md). Today
we prove it on PKLot (labeled data we already have); tomorrow it ingests footage.

  # prove on the hard camera (train on early frames, test on later frames):
  python learn_occupancy.py --cam PUCPR --device mps

  # cross-lot generalization (honest hard test): train UFPR, test PUCPR
  python learn_occupancy.py --train UFPR04,UFPR05 --test PUCPR --device mps
"""
import argparse
import glob
import os

import cv2
import numpy as np
import torch
import torch.nn as nn

from pklot_eval import parse_spaces

SIZE = 48


def frames_for(cams):
    out = []
    for cam in cams:
        out += sorted(glob.glob(f'work/pklot/PKLot/PKLot/{cam}/Sunny/*/*.jpg'))
    return out


def warp(img, poly):
    src = poly.astype(np.float32)[:4]
    dst = np.float32([[0, 0], [SIZE, 0], [SIZE, SIZE], [0, SIZE]])
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (SIZE, SIZE))


def extract(frames, limit):
    X, y = [], []
    for ip in frames[:limit]:
        xp = os.path.splitext(ip)[0] + '.xml'
        if not os.path.exists(xp):
            continue
        spaces = parse_spaces(xp)
        img = cv2.imread(ip)
        if img is None or not spaces:
            continue
        for occ, poly in spaces:
            try:
                X.append(warp(img, poly))
                y.append(occ)
            except Exception:
                pass
    X = np.array(X, np.float32) / 255.0
    return X.transpose(0, 3, 1, 2), np.array(y, np.int64)


class TinyCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),   # 24
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),  # 12
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.AdaptiveAvgPool2d(1),
            nn.Flatten(), nn.Dropout(0.4), nn.Linear(64, 2))

    def forward(self, x):
        return self.net(x)


def run_epochs(model, Xtr, ytr, dev, epochs=10, bs=128):
    opt = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
    cls = np.bincount(ytr, minlength=2).astype(np.float32)
    w = torch.tensor(cls.sum() / (2 * np.maximum(cls, 1))).to(dev)  # balance the 63/37 class skew
    lossf = nn.CrossEntropyLoss(weight=w)
    Xtr, ytr = torch.tensor(Xtr).to(dev), torch.tensor(ytr).to(dev)
    n = len(Xtr)
    model.train()
    for ep in range(epochs):
        perm = torch.randperm(n)
        tot = 0.0
        for i in range(0, n, bs):
            idx = perm[i:i + bs]
            xb = Xtr[idx]
            if torch.rand(1).item() < 0.5:
                xb = torch.flip(xb, dims=[3])                                # horizontal flip
            xb = (xb * (0.8 + 0.4 * torch.rand(1, device=dev))).clamp(0, 1)  # brightness jitter
            opt.zero_grad()
            loss = lossf(model(xb), ytr[idx])
            loss.backward()
            opt.step()
            tot += loss.item() * len(idx)
        print(f"  epoch {ep + 1}/{epochs}  loss {tot / n:.4f}", flush=True)


@torch.no_grad()
def evaluate(model, X, y, dev):
    model.eval()
    pred = model(torch.tensor(X).to(dev)).argmax(1).cpu().numpy()
    acc = (pred == y).mean()
    # false_open = truly occupied called empty (DANGEROUS); false_occ = empty called taken
    fo = int(((y == 1) & (pred == 0)).sum())
    foc = int(((y == 0) & (pred == 1)).sum())
    return acc, fo, foc, pred


@torch.no_grad()
def render(model, frame_path, dev, out):
    img = cv2.imread(frame_path)
    model.eval()
    for occ, poly in parse_spaces(os.path.splitext(frame_path)[0] + '.xml'):
        patch = warp(img, poly).astype(np.float32).transpose(2, 0, 1)[None] / 255.0
        pred = int(model(torch.tensor(patch).to(dev)).argmax(1))
        col = {(1, 1): (0, 200, 0), (0, 0): (255, 150, 0), (0, 1): (0, 0, 255), (1, 0): (0, 140, 255)}[(pred, occ)]
        cv2.polylines(img, [poly], True, col, 2)
    cv2.imwrite(out, img)
    print(f"rendered {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cam', help='within-camera frame split (train early, test late)')
    ap.add_argument('--train', help='comma cams to train on (cross-lot mode)')
    ap.add_argument('--test', help='comma cams to test on (cross-lot mode)')
    ap.add_argument('--device', default='mps')
    ap.add_argument('--epochs', type=int, default=10)
    ap.add_argument('--limit', type=int, default=90, help='frames per camera to use')
    ap.add_argument('--feedback-dir', help='LOOP HOOK: dir of confirmed crops <label>/*.png appended to training')
    ap.add_argument('--out', default='models/occ_classifier.pt')
    args = ap.parse_args()
    dev = torch.device(args.device)

    if args.cam:  # within-camera: early frames train, late frames test (the deployed-camera case)
        fr = frames_for([args.cam])
        cut = int(len(fr) * 0.7)
        Xtr, ytr = extract(fr[:cut], args.limit)
        Xte, yte = extract(fr[cut:], args.limit)
        mode = f"within {args.cam} (early->late frames)"
    else:  # cross-lot: honest generalization test
        Xtr, ytr = extract(frames_for(args.train.split(',')), args.limit)
        Xte, yte = extract(frames_for(args.test.split(',')), args.limit)
        mode = f"train {args.train} -> test {args.test}"

    # LOOP HOOK: fold in a real camera's confirmed crops (this is what makes it learn over time)
    if args.feedback_dir:
        fb_X, fb_y = [], []
        for lab in (0, 1):
            for p in glob.glob(os.path.join(args.feedback_dir, str(lab), '*.png')):
                im = cv2.imread(p)
                if im is not None:
                    fb_X.append(cv2.resize(im, (SIZE, SIZE)))
                    fb_y.append(lab)
        if fb_X:
            fb_X = np.array(fb_X, np.float32).transpose(0, 3, 1, 2) / 255.0
            Xtr = np.concatenate([Xtr, fb_X]); ytr = np.concatenate([ytr, np.array(fb_y)])
            print(f"+ folded in {len(fb_y)} confirmed feedback crops")

    print(f"MODE: {mode}\ntrain {len(ytr)} patches ({ytr.mean():.0%} occupied) | test {len(yte)}", flush=True)
    model = TinyCNN().to(dev)
    run_epochs(model, Xtr, ytr, dev, args.epochs)
    acc, fo, foc, _ = evaluate(model, Xte, yte, dev)
    torch.save(model.state_dict(), args.out)
    print(f"\nRESULT  accuracy {acc * 100:.2f}%  | false_open(taken->empty) {fo}  false_occ(empty->taken) {foc}")
    print(f"saved {args.out}")
    rf = frames_for([args.cam])[int(len(frames_for([args.cam])) * 0.7)] if args.cam else frames_for(args.test.split(','))[0]
    render(model, rf, dev, 'work/learn_PUCPR_pred.jpg')


if __name__ == '__main__':
    main()
