# Bot movement during status changes — 2026-11-06

A bot receiving slow partway between two cell centers could rewind, corrupt its
logical cell position, and then interpolate diagonally through terrain on its
next turn. This was a defect in the adapted AI movement, not intended gas behavior.

The old movement formula was `elapsedMoveSteps / currentMoveDuration`. A normal
move taking six AI ticks becomes twenty ticks under slow. Changing duration after
four ticks changed progress from `4/6` to `5/20`, moving backward while the facing
direction remained unchanged. The upstream direction-based cell tracker assumes
forward movement; its recovery path could then advance the logical cell away
from the bot's actual coordinates. Slow expiry could instead jump progress
forward. A speed pickup had the same structural problem.

`public/classic-ai.js` now stores normalized progress and adds only the next
step's distance at the current speed. Applying or refreshing slow preserves the
already covered distance; expiry or shoes affect only subsequent movement.
Moves end exactly at the target center before choosing another direction.
Uninterrupted normal/slow moves still take six/twenty 35 Hz ticks. A small
endpoint tolerance avoids an extra tick caused by floating-point accumulation.
A bot frozen mid-step now also stops its existing movement until thaw, rather
than merely being prevented from choosing a new move. Pause retains the existing
gameplay guard.

The new progress is an instance scalar, so the existing multiplayer state digest
includes it. Reconnection replays it from the original inputs; there is no new
server protocol or wall-clock dependency.

Verification:

- New regression tests use the actual upstream `Player`/`PlayerAI` methods and
  cell-tracking logic. Before the fix, six of the initial seven cases failed;
  after the fix, all eight cases pass, including a subsequent speed-pickup case.
- `npm test`: 99 tests pass. Syntax checks pass.
- `scripts/qa-ai-slow.mjs`: 48 real-engine cases, four directions and gas onset,
  slow expiry, freeze/pause in an L-shaped corridor bordered by solid terrain.
  Native Single Player runs at controlled 30/60/144 Hz display timestamps.
  Gas is applied by a real BATTERY mine and the existing collision/damage path,
  rather than setting the slow flag directly. Old AI code reproduces the
  backward movement in this browser test.
- Online two-player fixtures produce identical per-frame state digest summaries
  in two independent browser instances.
- Existing three-difficulty native AI/rules and independent online AI replay
  suites pass.

Run with a server already started:

```sh
node scripts/qa-ai-slow.mjs
```

The usual `PLAYWRIGHT_MODULE`, `CHROME_BIN`, `BASE_URL`, and `QA_OUTPUT_DIR`
variables select runtime and output. Optional `QA_AI_SOURCE` substitutes an
explicit local AI source in the test browser to reproduce the previous defect.
Results are saved under `.local/ai-slow-qa/` by default.
