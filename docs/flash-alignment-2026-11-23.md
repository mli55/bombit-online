# Remaining 4399 differences aligned — 2026-11-23

Checked against 4399's `game.swf` (SHA-256 `a2b4cc65…5b54d`, see the
[settings audit](settings-audit-2026-11-04.md)). The gameplay scripts are
`DefineSprite_554/frame_1/DoAction.as` (`movHero`, `pushBomb`, `putSpecial`,
`bombExp`, `brickBreak`, `hurtHero`, `gameover`, map generation),
`DefineSprite_554/frame_2/DoAction.as` (stage setup and the game loop) and
`DefineSprite_519/frame_1/DoAction.as` (the clock). A local copy, which is not
committed, lives in `reference/4399/`.

All times below are Flash frames (1/35 s). The simulation runs at 60 Hz, and
every rule converts through elapsed simulation time, so a time is accurate to
one 60 Hz step.

## Kept product differences

These were kept on purpose:

- Pausing also stops the short 10-frame blasts.
- The single-player stage cap.
- Online play is 1–4 players, competitive, with one life per round, and keeps
  its own result screen (5000 ms, the host continues).
- A held fire key keeps placing bombs. Flash does this natively, so the rule
  below is the Flash one.

## Movement and fire (`player-controls.js`)

| Rule | Flash | Now |
| --- | --- | --- |
| Human movement | One cell per step, 6 frames (shoes 5/4/3, slowed 20); a step always finishes | Same step machine as the CPUs |
| Several keys held | Checked in a fixed order: left, up, right, down | Same, native and online (the client now sends every held direction) |
| Blocked step | Faces the direction without moving (walls, boxes, ice, or a bomb without a glove or that cannot slide) | Same |
| Cell used for damage | `Math.round` of the position: right and down switch at half way, left and up just after it | Same |
| Item pickup | At the end of a step | Same, for humans and CPUs |
| Fire during a step | Queued (`prevFire`), used when the hero is next at rest, so the bomb lands on the arrival cell | Same |
| Holding fire | A bomb attempt every frame at rest | Same |
| Specials | Need a hero at rest; a step started in the same frame loses the press. After a special, fire does nothing until released (`puttAble`). A rejected special is retried while held. Not while standing on a bomb | Same |
| Frozen | `stopTime` holds a hero at rest; a step under way finishes | Same, humans and CPUs |

## Bombs and flames

| Rule | Flash | Now |
| --- | --- | --- |
| Kicked bomb | Claims the next cell at once and moves one cell per 2 frames (17.5 cells/s); no fuse and no flame check while sliding; explodes on arrival next to a blocker | Same (`bomb-collision-fixes.js`) |
| What stops a kicked bomb | Bombs and bricks: walls, unbroken boxes, ice, the map edge | Same |
| Flame fade | After the damage ends, alpha drops 20% a frame; removed on the fifth frame | Same (`classic-timing.js`) |
| Ice in a bomb ray | Ice is a brick: the ray stops and breaks it, with brick score and a 65% drop | Same |

## Special weapons (`classic-weapons.js`)

| Weapon | Flash | Now |
| --- | --- | --- |
| Rocket | Speed grows 1 px/frame every frame (30 px cells), so it covers t(t+1)/2 px in t frames. Each frame at its rounded cell: an enemy within half a cell, then the edge or a wall (explodes one cell back), then a bomb or brick (explodes there) | Same, scaled to 49 px cells. Measured: 1, 3, 6, 10, 15 … px |
| Grenade | Lands 18 frames after the throw | Same; measured landing 18 frames after the throw |
| Rocket, grenade and mine blasts | `addBrickExp`: one cell for 10 frames; clears a brick or ice with no score and no drop; sets off a bomb or mine there | Same. The grenade hits its cell and its in-bounds, non-wall neighbors |
| Mine | Any enemy within half a cell sets it off, shielded or not; one-cell blast; hidden after its 60-frame timeline | Same |
| Gas bomb | Only an enemy whose center is exactly on it (a step ends there); removed by flames | Same |
| Ice column | Every 4 frames (4, 8, 12) checks the next cell as it is then; a brick or bomb skips the counter to 12, so cleanup (counter 49) comes early. Ice cells are bricks for everyone, the user included. Each cell freezes any hero, the user included, whose center is within 10/30 of a cell of its center, for the 40 frames of its effect | Same |
| Fire column | Same timing; stops at the edge or a wall; sets off bombs, breaks boxes and ice with score and drop; damage until cleanup | Same |

## Protection and round end (`classic-match.js`)

| Rule | Flash | Now |
| --- | --- | --- |
| Shield spent | 60 frames of protection | Same |
| Start of a stage | 60 + random(4) frames of protection per hero, during which flames do not hurt | Same, drawn from the seeded game random |
| CPU with a spare life | A hit costs a life and gives 60 frames of protection; only the last life kills. The hit still scores | Same, single player only |
| CPU lives | Carry over between stages | Same, single player only |
| Clock | Checked every 500 ms: t = 180 − 0.5 × floor(elapsed / 500); timeup when t < 1, at 179.5 s; display is int(t) | Same, also online |
| Time score | int(t × 10) on a win by elimination; 0 at timeup | Same |
| Timeup (single player) | Humans win only when the best living human stage score is strictly above the best living CPU score, getting the 1000 bonus without time score. Otherwise each living human loses a life. Easy has no automatic win | Same |
| Revival | Unless the campaign is over, every hero with no lives returns with one, for 1000 of its campaign total | Same |
| Result screen | 5500 ms; any key release skips it | Same, single player only |

## Map (`classic-map.js`)

Flash places the 2×2 center block, shuffles every cell except the spawns and
their four neighbors, and tries the 16 spawn diagonals first. A cell becomes a
hard wall only if no corner of its eight-neighbor ring is closed and the ring
has at most three open or closed runs. Every other cell then gets a soft brick
with random(100) < 60, except the spawns and their neighbors. The port now
builds its map this way from the seeded game random, and has no box limit.

## Verification

- `npm test`: 113 tests. New or rewritten: `player-controls.test.js` (step
  timing, key order, rounding, blockers, kicks, fire buffering and holding,
  specials, freezing, online masks), `classic-map.test.js` (spawns, center
  block, connectivity over 200 seeds, determinism, the clock),
  `explosion-timing.test.js` (the flame fade), `ai-movement.test.js` (a frozen
  CPU finishes its step). Times in tests are Flash frames, converted through one
  helper.
- Real Phaser engine, in a browser: human steps and key order, a bomb pressed
  mid-step landing on the arrival cell, a kicked bomb moving a cell per 2 frames
  and exploding at a wall, rocket distances and edge explosion, a rocket breaking
  a box silently, ice and fire column timing with early stop, freezing an enemy
  but not the user, ice blocking its user, a bomb ray breaking ice and scoring,
  the mine and gas triggers, grenade landing and cross, 60-frame shield
  protection, a CPU surviving with a spare life, timeup at 179.5 s with the
  00:01 → 00:00 display, the 5500 ms result and the key skip, and 40 s of live
  play on each difficulty with no errors.
- `qa.html`: four independent replicas for 1, 2, 3 and 4 humans, 200 simulated
  seconds and a second round each, with identical checksums.
