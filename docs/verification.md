# Verification

2026-10-23. Final Single Player / Multiplayer entry flow.

- `npm run check` and all **45 tests** pass. The real four-WebSocket test covers automatic P1–P4 identities, 60 Hz, repeated rounds, score carry, and uninterrupted reconnection. Sixty frames took 999 ms locally.
- `wrangler deploy --dry-run` bundles the Worker and assets successfully.
- The four-WebSocket integration test also passes in local workerd and at `https://bombit-online.pages.dev`, including repeated rounds and uninterrupted reconnection. Sixty frames took 1,000 ms in workerd and 1,048 ms on the deployed service. Native timers are invoked without a Room receiver for Workers compatibility.
- Four independent replicas for each of 1, 2, 3, and 4 human players ran 12,000 frames (200 simulated seconds), then a second round of 600 frames. All checkpoints match. The four-player timeout follows the original score tie order. See [browser-qa.txt](browser-qa.txt).
- Real browser UI checks pass: original Multiplayer/difficulty/character selection, automatic invite joining, P1–P4, four-client checkpoints, pause/resume, and difficulty changes. During a five-second disconnect, the other clients advanced 300 frames; the returning browser caught up and matched their hash.
- Original Single Player works without a WebSocket: character keys, tutorial, movement input, local clock, and native pause/resume. The original online score screen's NEXT ROUND button emits the continuation request.
- [ui-qa-results.json](ui-qa-results.json) contains browser measurements. The two README screenshots are from this four-player run. WebGL is active; no browser runtime errors occurred.
- The updated UI suite also passes with in-memory room identities: fresh invitations join once, same-document transport reconnection preserves the seat, and refreshing either a guest or a host returns to the original menu without opening a WebSocket. Old room URLs and stored identities are cleared. See [refresh-qa-results.json](refresh-qa-results.json).
- The UI suite passes after the shared text baseline adjustment. Menu, selector, HUD, and result screenshots were inspected. With delayed font loading, Impact is loaded before the menu; 100 text redraws keep the same 2 px adjustment at 25 px, and changing to 50 px gives 4 px without drift, including explicit text bounds.

- Held Space places consecutive bombs in both native Single Player and online play. Actual-engine browser fixtures verify occupied cells, capacity, release, freeze/death gating, and all six weapon classes retaining one activation per press. Online lives start at 1; a real heart pickup changes the HUD to 2 while other pickups leave it at 1. The Bomb It 2 promotion stays hidden after native settings, localization, resize, and results. See [controls-qa-results.json](controls-qa-results.json).
- The complete four-browser UI suite passes with the updated input protocol. It also checks latest-direction priority, ignoring older held-key repeats, and stopping on release. See [controls-ui-qa-results.json](controls-ui-qa-results.json). Effect durations and native Single Player latency measurements are recorded in [gameplay-comparison.md](gameplay-comparison.md).

Browser checks used separate Chrome 155 contexts on one computer. They do not cover four geographically separate devices, all browser engines, or real mobile hardware.
