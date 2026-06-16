# Vacant — Self-Improving Occupancy Loop (design + scaffold)

**Status:** scaffold proven on PKLot (`scripts/learn_occupancy.py`); production loop builds when a real camera is deployed. Today's detection+overlap recipe (98% close / 93% far) ships *without* this — the loop is the path to 99% + weather/night robustness + far-camera retrofits.

## Why a loop at all
The detection recipe is **static**: accuracy is fixed the day we ship. New lighting, weather, or a far angle? It stays flat or drops. A learning loop makes **month 3 better than month 1** by retraining on the camera's own mistakes.

## The architecture (3 stages)

```
   ┌─────────────┐     ┌──────────────────┐     ┌────────────────────┐
   │ 1. PREDICT  │ --> │ 2. CATCH MISTAKES│ --> │ 3. RETRAIN & ROLL  │
   │ per-spot CNN│     │ (feedback signal)│     │ on confirmed crops │
   └─────────────┘     └──────────────────┘     └─────────┬──────────┘
          ▲                                                │
          └────────────────── better model ◀──────────────┘
```

1. **Predict** — warp each spot to a 48×48 patch, classify full/empty (`TinyCNN`). Warping normalizes size → tiny far cars and big near cars look identical → kills the small-object problem that capped tiling at ~93%.
2. **Catch mistakes** — turn errors into labeled data via a feedback signal (below). Save the wrong patch with its *correct* label into `feedback/<0|1>/*.png`.
3. **Retrain & roll** — periodically re-run `train()` with those confirmed crops folded in (`--feedback-dir`). New model only ships if val accuracy improves (a guard, so a bad batch can't regress us).

## The feedback signals (where ground truth comes from — cheapest first)
- **Gate cross-check (free, automatic):** the entrance/exit counter (`count.py --line`) knows how many cars are *in the lot*. If spot-occupancy total ≠ gate total, some spot is wrong → flag those frames for review. Self-supervising, no human.
- **High-confidence auto-label (free):** only patches the model is ≥99% sure about become new training data (classic self-training). Cheap, but can entrench errors → pair with the gate check.
- **Human spot-check (cheap, gold):** an attendant taps the few spots the model flagged as uncertain. Minutes/week, highest-quality labels.

## Scaffold → production (what changes)
| Piece | Scaffold (today, PKLot) | Production (real camera) |
|---|---|---|
| Labels | PKLot's XML occupied flags | the 3 feedback signals above |
| Data | `work/pklot/.../*.jpg` | this camera's own footage |
| Train split | early frames → late frames | last month → this week |
| Retrain | manual run | weekly cron, ship-if-better guard |
| Spots | PKLot polygons | `auto_stalls.py` once per camera |

`scripts/learn_occupancy.py` already exposes the production seam: `--feedback-dir feedback/` folds a real camera's confirmed crops straight into training. That dir *is* the loop's memory.

## When to actually build it (the gate)
Don't build the production loop until **both**: (a) a real camera is deployed, and (b) the static recipe is measurably not enough on it. We're at 98% on the target (close) case with zero learning — so today this stays a scaffold. Building learning infra ahead of need is the classic premature-optimization trap.

## Honest caveats
- Within-camera frame splits leak a little (the same parked car persists across frames) → the scaffold number is optimistic vs a true cross-day deployment. The cross-lot mode (`--train UFPR04,UFPR05 --test PUCPR`) is the honest generalization test.
- A per-camera model that drifts (construction, repaint, camera nudged) needs the ship-if-better guard + a drift alarm (Claude-vision low-freq auditor — calibration only, per project memory).
