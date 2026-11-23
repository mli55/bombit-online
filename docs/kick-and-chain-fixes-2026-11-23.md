# Kick contact and breaking boxes — 2026-11-23

Checked against 4399's `game.swf` (SHA-256 `a2b4cc65…5b54d`, see
[settings audit](settings-audit-2026-11-04.md)), gameplay script
`DefineSprite_554/frame_1/DoAction.as`.

## A gloved kick waits for contact

Flash moves heroes cell by cell. `movHero` starts a step from a cell center, and
only then calls `pushBomb` when the next cell holds a bomb, so the hero is
touching the bomb when it is kicked. The HTML5 port kicks as soon as the hero's
center crosses into the cell next to the bomb, while still up to half a cell
(24.5 px) away. In the real engine, a hero walking right from three cells away
kicked with a 17 px gap.

`bomb-collision-fixes.js` now lets a human kick only at the same contact edge
that stops the walk. The same walk kicks with a 0 px gap. A hero already standing
against the bomb still kicks immediately. AI kicks are unchanged.

Not changed: a kicked bomb still slides at 0.5 px/ms (about 10.2 cells/s), while
Flash moves it one cell per 2 frames (17.5 cells/s). See the settings audit.

Superseded later the same day by [Remaining 4399 differences aligned](flash-alignment-2026-11-23.md): humans now move in Flash cell steps, so a kick happens from rest at the cell next to the bomb, and the contact gate and its test were removed. Kicked bombs now move one cell per 2 frames.

## A second wave passes through a breaking box

In Flash a ray stops at the brick it breaks, but `brickBreak` clears the cell at
once (`bg.brick = ""`). A later ray, for example from a second bomb placed beside
the first, passes through that cell and can break the next brick. The HTML5 box
keeps `BLOCK` until its break animation ends, so the second ray stopped there,
broke nothing, and scored the box again.

`classic-timing.js` now stops a ray only at a box still listed in `grid.boxes`.
`Grid.destroyBox` removes a box from that list as soon as it is hit. In the real
engine, bombs at (2,5) and (3,5) with power 4 now clear boxes at (5,5) and (6,5).
Each ray still stops at the box it breaks itself.

## Verification

- `test/kick-contact.test.js` ran the upstream `PlayerHuman.checkMoveRight` with
  the fix (removed with the gate; kicks are now covered by `player-controls.test.js`).
- `test/explosion-timing.test.js` covers a breaking box that a later wave passes
  through, the next box breaking, and scoring it once. Its timings are written in
  Flash frames through `advanceToFlashFrame`.
- Both scenarios were run in the real Phaser engine in a browser.
