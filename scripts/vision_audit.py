"""
Vacant — Claude-vision feedback loop (the CV's self-check / drift auditor).

The YOLO counter can over- or under-count: a big FOREGROUND car fragments into several
boxes (overcount), far/occluded cars get missed (undercount). This loop gives the CV a
SECOND OPINION from Claude's own vision: fetch the live frame, run our detector, then ask
Claude to count the parked cars independently, and FLAG any lot where the two disagree.

This is the validated role for a VLM in this project — a low-frequency auditor / drift
alarm, NOT a per-frame recognizer. Disagreements are FLAGGED for review and LOGGED so
patterns accumulate (work/vision_audit_log.json); they are not silently used to overwrite
the detector (Claude can undercount heavy occlusion, so it's a check, not ground truth).

  .venv/bin/python scripts/vision_audit.py --id coalton1
  .venv/bin/python scripts/vision_audit.py --all
  .venv/bin/python scripts/vision_audit.py --all --model claude-opus-4-8   # max-accuracy audit
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import cv2
from ultralytics import YOLO
import spatial
from push import fetch, annotate_lot, detect_lot

from vision import load_key, claude_count

LOG = 'work/vision_audit_log.json'


def audit(model_yolo, calib, key, model_vlm, device='mps'):
    fr = fetch(calib['url'])
    xy = detect_lot(model_yolo, fr, calib, 0.15, 1920, 1280, 3, device)
    info = spatial.classify_cars(calib, xy, fr.shape)
    cv = sum(1 for d in info if d['status'] != 'out')
    ok, buf = cv2.imencode('.jpg', fr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    vlm = claude_count(key, buf.tobytes(), model_vlm)
    diff = None if vlm is None else cv - vlm
    verdict = ('unknown' if vlm is None else 'agree' if abs(diff) <= 1
               else 'CV-OVERCOUNT' if diff > 0 else 'CV-UNDERCOUNT')
    if verdict != 'agree':
        cv2.imwrite(f'work/audit_{calib["id"]}.jpg', annotate_lot(fr, calib, info))
    return {'id': calib['id'], 'name': calib['name'], 'cv_count': cv, 'claude_count': vlm,
            'diff': diff, 'verdict': verdict}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--model', default='claude-sonnet-4-6', help='vision model for the audit')
    ap.add_argument('--device', default='mps')
    args = ap.parse_args()

    key = load_key()
    calibs = spatial.load_calibs('calib')
    ids = [args.id] if args.id else [k for k, c in calibs.items() if c.get('url')]
    yolo = YOLO('models/yolo11x.pt')

    rows = []
    print(f"\n{'lot':22}{'CV':>5}{'Claude':>8}{'diff':>6}   verdict")
    print('-' * 56)
    for cid in ids:
        try:
            r = audit(yolo, calibs[cid], key, args.model, args.device)
        except Exception as e:
            print(f'  {cid}: audit failed ({type(e).__name__}) {e}')
            continue
        rows.append(r)
        flag = '' if r['verdict'] == 'agree' else '   <-- CHECK'
        print(f"  {r['name'][:20]:20}{r['cv_count']:>5}{str(r['claude_count']):>8}{str(r['diff']):>6}   {r['verdict']}{flag}")

    try:
        log = json.load(open(LOG)) if os.path.exists(LOG) else []
    except Exception:
        log = []
    log.append({'t': int(time.time()), 'model': args.model, 'rows': rows})
    json.dump(log, open(LOG, 'w'), indent=2)
    flagged = [r for r in rows if r['verdict'] not in ('agree', 'unknown')]
    print(f"\n{len(rows)} lots audited, {len(flagged)} flagged -> {LOG}")


if __name__ == '__main__':
    main()
