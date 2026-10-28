# Flash Bomb It 1 timing audit

Checked 2026-10-24. The previous comparison in `gameplay-comparison.md`
measured the HTML5 port, not the original Flash game. They differ substantially.

## Sources and method

- Original SWF obtained from the [Bomb It 1 archive](https://vidkidz.tistory.com/2322),
  attachment `bomb-it-1.swf`. SHA-256:
  `cc3ae432ddc56a15b38ac73ac01e288f41708e88ae421fd1c6bca4726b5f2f44`.
- Read the SWF header: **35 fps**. Inspected ActionScript with JPEXS 26.4.0.
  Gameplay lives in `DefineSprite_561/frame_1/DoAction.as` and
  `DefineSprite_561/frame_2/DoAction.as`. No SWF or decompiled source is added
  to this repository. Frame counts below are source-derived, not video estimates.
- Compared with the preserved `original/bombit-1.min.js` and
  `original/assets/json/balance.json`. The latter was also fetched from the
  [HTML5 distributor](https://html5.gamedistribution.com/rvvASMiM/bf359863a59f41c7b7e06ab637d009e4/assets/json/balance.json)
  to confirm the 2500/3000/20000 ms settings.

### Direct 4399 verification

Also checked 4399's actual hosted release on 2026-10-24, rather than assuming
that an independent archive has the same settings:

1. [Q版泡泡堂, game 3881](https://www.4399.com/flash/3881.htm) links to
   [its play page](https://www.4399.com/flash/3881_4.htm).
2. That page uses `webServer` from `/js/serversxiao.js` and loads
   [jifen2.htm](https://sxiao.4399.com/4399swf/upload_swf/ftp18/liuxy/20160125/04/jifen2.htm).
   Normal requests need the referring 4399 play page because of hotlink protection.
3. The wrapper loads `mainload.swf`, which loads `game.swf` in the same directory.
   **Both SWFs specify 35 fps**, so the outer loader does not change the timing.
4. Decompiled `DefineSprite_554/frame_1/DoAction.as` and `frame_2/DoAction.as`
   from 4399's game. Both gameplay scripts are **text-identical** to the archive's
   corresponding `DefineSprite_561` scripts (after decoding text/newlines).
   This verifies the 60-frame bomb fuse, 300-frame freeze, 600-frame slow,
   4/8/12-frame columns with frame-49 cleanup, and 10-frame impact window.

| Evidence | SHA-256 |
| --- | --- |
| 4399 `mainload.swf` (52,439 bytes) | `f322ddebb75128a2a921c5aa4b380705d53fa28ac914198f32498a1da88eefe0` |
| 4399 `game.swf` (2,167,060 bytes) | `a2b4cc65115e4b6eb813962d80e91f1e65746a91f27e91d5e86fa1963ed5b54d` |
| Identical gameplay frame-1 text, UTF-8 / LF | `25e52d755e74b40e44598b1100d3be275021ef7e090e54db6abf6de7186f796f` |
| Identical gameplay frame-2 text, UTF-8 / LF | `1637da7eaf871e9fdc0c7c15fe200262a9b12cf1a356a7078d41c9d1806c36df` |

The hosted files have different overall hashes because the 4399 release includes
its own integration. The evidence establishes parity of the audited gameplay
timers; it does not claim that every HTML5 animation or collision rule matches
4399. The adaptation boundaries below still apply.

## Findings and applied changes

| Effect | Flash source | Nominal seconds | Previous HTML5 behavior |
| --- | --- | ---: | --- |
| Ordinary bomb fuse | `putBomb`: 60-frame countdown | 1.714 | 2.5 |
| Ordinary bomb danger | Rays grow one cell/frame; 10 frames after growth | (power + 10) / 35; 0.314–0.429 at power 1–5 | Originally 0.5, locally shortened to 0.3 |
| Frozen character | Ice refreshes `stopTime` to 300; counts down when no longer touched | 8.571 after final ice contact | 3 from first contact |
| Confuse / slow | `slowTime` countdown of 600 | 17.143 | 20 |
| Ice / fire column | Create cells at frames 4, 8, 12; clear area at frame 49 | 1.4 from activation; cell lifetimes 1.286 / 1.171 / 1.057 | 1.5 active timer, but weapons updated twice per frame |
| Mine detonation | Remove mine immediately; `addBrickExp` lasts 10 frames | 0.286 short single-cell hit window | 0.5 hit window; spent explosion left in registry |
| Grenade / rocket impact | Same 10-frame `addBrickExp` hit window | 0.286 | 0.5 |

The mine is **not** a persistent fire area or a reusable trap. The original does
have a brief nonzero detonation window. We preserve that window and clear the
cell and explosion registry afterward. Mine hiding time is separate from its
detonation; no guessed Flash hiding time is introduced.

A shield also blocks a mine. Checked 2026-10-28 against 4399's `game.swf` (same
SHA-256 as above), `DefineSprite_554/frame_1`: a triggered mine only calls
`addBrickExp`, and every explosion cell damages through the one `hurtHero`,
which spends the shield before taking a life. Upstream HTML5 kills a mine victim
through a separate `activateMine` that skips the shield check, so
`public/gameplay-fixes.js` spends the shield there instead. The HTML5 2 s
invulnerability is kept (Flash `varShield = 60`, 1.714 s); both cover the
10-frame mine blast.

`public/classic-timing.js` applies these timing rules to native Single Player
and online games while preserving the upstream files. All timers use simulation
time, including pause and replay. Removing the second weapon update also stops
projectiles from moving twice per frame. Ground ice refreshes the freeze timer;
the timer then counts down after the ice expires.

This is a timing adaptation on the HTML5 engine, not a full Flash reimplementation.
HTML5 artwork, animation clips, collision rules and weapon ranges are retained.
For ordinary bombs, visual flames end with the dangerous cells: the Flash-only
five-frame harmless fade after damage stops is not reproduced. Projectile flight
animations, mine hiding animation, and unrelated life/shield rules are not claimed
to match the Flash version exactly.

## Round ending and verification

Online evaluates elimination after the entire simulation frame. If every room
human is dead, it ends immediately, stops CPU movement, plays the loss cue,
displays `YOU LOSE`, and reports `winner: null, win: false`. The host can start
the next round. One surviving human keeps the match running unless they are the
only character left. Human membership uses selected character IDs, not array
positions. Existing competitive human-versus-human rules are retained.

`npm test` covers propagation, damage cleanup, pause, death effects, controls,
room state and real WebSocket traffic. `scripts/qa-classic.mjs` boots independent
real browser engines and checks human elimination, equal results across seats,
next-round reset, 1–4-human outcomes, timing boundaries, pause, and spent-mine
cleanup. It also verifies that a bomb can kill a frozen opponent before thaw.

Observed at the online 60 Hz clock: fuse **1.717 s**, thaw **8.583 s** after final
contact, slow **17.150 s**, column cleanup **1.400 s**, mine danger cleanup within
**0.300 s**. These are quantized to the next simulation step. Browser fixtures
drive the production replay API with controlled boards; they are not remote
multiplayer latency measurements.

Run with the server already running:

```sh
node scripts/qa-classic.mjs
```

As with existing QA scripts, `PLAYWRIGHT_MODULE`, `CHROME_BIN`, `BASE_URL` and
`QA_OUTPUT_DIR` select the runtime and output directory. Default output is
`.local/classic-qa/`, including the `YOU LOSE` screenshot and measured results.
