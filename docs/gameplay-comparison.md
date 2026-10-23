# Original HTML5 comparison

Measured on 2026-10-23 using the preserved engine, its native single-player clock, and the online 60 Hz clock. Values are observed behavior rather than config constants alone.

| Effect | Native clock | Online clock |
| --- | ---: | ---: |
| Bomb fuse | 2.51 s | 2.52 s |
| Explosion flame and dangerous cells | 0.50 s | 0.50 s |
| Player frozen | 3.01 s | 3.02 s |
| One cell in a three-cell ice wall | 0.95 s | 0.93 s |

The original updates its ice-column object both as a Phaser child and through the grid. Its configured 1.5 s active timer therefore runs twice per frame. The online adapter preserves this behavior. Ground ice and the player's frozen duration are separate. These durations were not changed.

After this baseline comparison, the bomb flame duration was intentionally shortened from 0.50 s to 0.30 s in both Single Player and Multiplayer. The same cleanup ends the visible flame and its dangerous cells together. The 2.5 s bomb fuse is unchanged.

Single Player opened through the native menus uses no WebSocket. In a local Chrome headless sample, 445 logic frames ran in about 7.42 s; frame intervals were about 16.7 ms. Twelve actual keyboard presses reached their first player displacement in a median 8.4 ms, maximum 16.7 ms. Bypassing the inactive adapter wrapper with Phaser's native update produced the same frame count and similar latency (median 9.5 ms, maximum 17 ms). This is a local browser measurement, not a guarantee for every device or a complete upstream-site comparison.

Online input previously prioritized up/down/left/right regardless of press order. It now follows the original last-pressed direction rule and ignores repeats from older held keys. Online movement still waits for the server's ordered input frame; local Single Player does not.
