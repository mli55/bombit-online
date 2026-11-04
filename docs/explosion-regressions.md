# Explosion and rocket regressions — 2026-11-04

后续原生单人高刷新率、碰弹、黄色投掷武器及双人复查见 [单人/双人完整规则对照](single-double-audit-2026-11-04.md)。
## Repeated explosion updates

The bundled Phaser `Group.update` traverses the live children array backwards.
When a spreading blast triggers and removes a bomb at a lower index, the current
blast shifts down and is visited again in the same simulation frame. Its elapsed
time is added again, accelerating propagation and cleanup. This is distinct from
the intended early detonation of a bomb struck by another explosion.

Actual-engine reproduction with bombs placed every three frames recorded 9, 33,
and 72 duplicate updates for 10, 40, and 100 bombs respectively. Simultaneously
placed isolated bombs retained their normal fuse; changing the fuse constant
would not have addressed the bug.

`classic-timing.js` snapshots each gameplay row's children and tracks visited
objects across rows for the current grid update. Removed objects are skipped;
moving an object into another row cannot update it twice. The same scenarios now
have zero duplicates, including native Single Player. First detonation remains
103 online frames (1.7167 seconds), independent of bomb count, and blast lifetimes
remain `(power + 10) / 35`, quantized to the simulation step.

## Rocket impact and stale map writes

The original rocket cached cells ahead of its launch point. Its cleanup restored
one of those cached values into its current cell, even if it never reached the
cached cell. An adjacent hard wall therefore caused the launch cell to become
`WALL` while `isEmpty` remained true. The rocket also remained visible for its
500 ms impact timer and failed to mark the impact cell dangerous in this case.

`rocket-fixes.js` stops modifying map contents during flight. Impact immediately
removes the projectile and creates a separate single-cell `WeaponExplosion`:
before a hard wall, at the boundary cell, or in the struck brick/bomb cell. It
shares the existing overlap-aware cleanup and 10/35-second damage window, which
expires within 0.300 seconds at 60 Hz. Struck bricks are destroyed and struck
bombs chain normally. Live opponents are detected within half a cell's radius;
dead opponents are ignored. Pausing stops flight and impact timers.

Reference: the already audited 4399 `game.swf`, SHA-256
`a2b4cc65115e4b6eb813962d80e91f1e65746a91f27e91d5e86fa1963ed5b54d`,
`DefineSprite_554/frame_1/DoAction.as`, rocket handling and `addBrickExp`.
The HTML5 rocket's flight speed/animation are retained; this is not a claim of
complete Flash physics parity.

## Verification

- `npm test`: 83 passing tests, including the live-array failure reproduction,
  chain removals, row changes, and newly appended effects.
- `scripts/qa-bomb-timers.mjs`: 1/100 simultaneous and 10/40/100 staggered bombs,
  plus native Single Player; no duplicate updates, normal fuse and blast timing.
- `scripts/qa-rocket-collisions.mjs`: 25 cases across four directions, nearby and
  distant walls, boundaries, bricks, bombs, opponents, overlap and pause. Repeated
  in a fresh browser client with matching results and final state checksum.
- Existing classic timing, rules/AI replay, controls and settings browser suites
  pass after both fixes.

Browser suites accept `BASE_URL`, `PLAYWRIGHT_MODULE`, `CHROME_BIN` and
`QA_OUTPUT_DIR`; their JSON results are written under `.local/` by default.
