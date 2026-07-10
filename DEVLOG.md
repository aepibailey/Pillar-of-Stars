# DEVLOG — Pillar of Stars

Running record of significant technical decisions and why. Newest sessions at the bottom.

---

## Session 1 — 2026-07-10 · Setup, scaffold, Milestone 1

### Repo & workflow

- Repo: `aepibailey/Pillar-of-Stars` (GitHub capitalizes it; lowercase URLs redirect fine).
- All work is developed and pushed on branch `claude/pillar-of-stars-setup-gjnadt` (designer-approved), not `main`.
- Design doc v0.6 and project log live in `docs/` and are the source of truth.

### Tech decisions (designer signed off)

| Decision         | Choice                                                 | Why                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering        | **Canvas 2D now, behind a single `drawMap()` seam**    | M1–M3 needs nodes, lines, text, and a glow — Canvas 2D does that with zero deps and no WebGL quirks on mid-range Android. PixiJS only earns its weight at the M7 beauty pass (parallax layers, many lit sprites); the renderer module is the swap point. Text-heavy surfaces (intro, events, panel) are **DOM**, not canvas — better touch targets and accessibility on phones. |
| State management | **Hand-rolled serializable `RunState` + pure reducer** | The §13 non-negotiables dictate it: save/resume needs one plain JSON-serializable object; determinism needs every transition to be a pure function of `(state, action)` with RNG state carried _inside_ the state. Redux is ceremony we don't need; MobX proxies poison serialization. A ~40-line `Store` wrapper gives the UI subscriptions and auto-save on every dispatch.   |
| Tests            | **Vitest**                                             | Native to the Vite stack — same transform pipeline, TS out of the box, Jest-compatible API.                                                                                                                                                                                                                                                                                     |

### Design rulings captured from the designer

1. **Waypoint grid**: systems get (x,y) positions in normalized sector space; a **4×4 grid** overlays it; a waypoint = one highlighted cell. Grid dimensions live in `data/config.json` (so later "decoding quality tightens resolution" can shrink cells without engine changes).
2. **The Wake follows the player's actual jump path** (designer's call — they're hunting _you_), not a distance front. See "Wake model" below.

### Architecture guardrail (§6.4: captain ≠ run)

- `RunState.runId` is the journey's identity. The captain is a `Character` in `RunState.characters`, referenced by `captainId` — succession (M4) reassigns the reference, nothing else. Economy, flags, decoded sectors, and the Wake all hang off the run, never the captain. There is a unit test asserting `runId !== captainId` and that the captain is roster-referenced.
- M1 ships an implicit captain ("The Survivor") since captain creation is M4.

### Engine decisions

- **RNG**: xmur3 string-hash → mulberry32. Two patterns: _derived streams_ (`seed::sector:2`) for stateless regeneration of content, and a _persistent event stream_ whose 32-bit state is serialized in `RunState.rngState.events` so save/resume continues the exact roll sequence. Seed comes from `?seed=` query param or is randomly generated at run start — the single sanctioned non-deterministic moment.
- **Sectors are derived data**: regenerated (memoized) from `(seed, index)` on load, never stored in the save. Keeps saves tiny and _proves_ generation determinism every session.
- **Galaxy gen**: 12–18 systems, entry pinned bottom (trailing), gate pinned top (coreward — toward the Pillar). Positions via best-candidate rejection sampling; lanes via Prim's MST (guarantees connectivity — unit-tested) plus short extra edges for loops, degree-capped at 4.
- **Ruin/waypoint selection**: the ruin system is never entry or gate, and generation _prefers_ cells containing ≥2 systems so the signal region is a real search area rather than a disguised pin. The waypoint cell is derived from the ruin's position; both are seed-deterministic (tested).

### Wake model (M1)

- After a grace period (`wakeGraceJumps`, default 3), each player **jump** lets the Wake consume the oldest not-yet-consumed system in the player's first-visit order. Exploring nodes does not advance it — jumps are the clock.
- Consumed systems are **transitable at extra fuel cost** (§4's "desperate gamble"; the brutal-odds combat arrives M2+). They are _not_ walls — this also prevents soft-locks when the search region is behind you.
- **Caught** = the front advances onto the system you occupy, **or** the whole trail is already eaten (at that point the hunt's next meal is you — closes the loophole where a player could orbit inside consumed space indefinitely; found via unit test, fixed same session).
- Wake resets with fresh grace each sector (the gate jump breaks pursuit). Tuning knob `wakeConsumesPerJump` exists for the §6.4 succession surge later.

### Sector progression & the gate

- Each sector's **jump gate is locked until the sector's ruin is found** (exploring the ruin node fires the `sector-ruin` event → `decodeSector` effect). Rationale: §4 says each sector "decodes the next leg" and gates may require key items; this gives the waypoint search real teeth instead of being optional flavor. **Flagging for designer review** — easy to relax to "gate open, ruin optional" by changing one data effect if the search feels mandatory-tedious in playtests.
- Win = arriving at sector 3 (1-based; `winSector` in config), per the M1 definition of done.

### Death rules (M1)

- **Wake**: caught as above → death.
- **Attrition**: death when there is _nothing left to do_ — no affordable jump AND no unexplored node in the current system (and no unlocked gate here). Fuel 0 alone is not instant death: scavenging your last nodes for fuel while adrift is exactly the desperate beat we want. Cause reported as `fuel` or `stranded`.
- M1 has no crew, so every death is a solo death → "Begin Again" only, consistent with §6.4.

### Events & data

- All content is JSON under `/data` (`config.json`, `intro.json`, `events/core.json`). The engine knows an effects vocabulary (`fuel`, `scrap`, `flags`, `decodeSector`) and trigger predicates (`nodeTypes`, `fixed`) — never event ids.
- Fixed-trigger flags (`run-opener`, `sector-ruin`) mark structurally special events _in data_; the engine looks them up by flag. **Data contract tests** enforce the authoring rules: every opener outcome must set `mapRecovered`, every sector-ruin outcome must `decodeSector`, every node type must have ≥1 event, all option weights positive.
- 13 events shipped: the opener, the sector-ruin, 10 node events across planet/station/derelict/anomaly, 1 Wake-flavor event. Placeholder quality, tuned mildly fuel-positive so both deaths and wins are reachable.
- **Fuel numbers are invented** (doc has none): start 10, jump costs 1, consumed-transit +1, refuels via events (+1..+3). First tuning target after playtest.

### Verification

- 60 unit tests green (rng, galaxy determinism, waypoint, wake, events, reducer, save round-trip); `tsc`, ESLint, Prettier, and production build clean.
- Playwright smoke test (`scripts/smoke.mjs`, manual — not in CI) drives the real build at **390×844**: intro → opener → map → node event → reload-resumes-mid-run, zero console errors, screenshots checked.

### What's done / next / needed

- **Done**: Tasks 0–6. M1 complete per definition of done: intro → ruin → corrupted map → rough-waypoint search → jumps → Wake consuming the trail → fuel death / wake death / sector-3 win. Pillar glow on the horizon from day one.
- **Next**: designer playtest of M1 on phone; fuel/grace tuning from real play; then M2 (ship subsystems + combat vs 3 archetypes + power management).
- **Needed from designer**: playtest feedback; a ruling on the gate-locked-until-ruin choice above; eventually a name for the data-core artifact (log lists candidates).

---

## Session 2 — 2026-07-10 · GitHub Pages deployment

- **Live playtest build**: https://aepibailey.github.io/Pillar-of-Stars/ — deployed by `.github/workflows/deploy.yml` on every push to the working branch (and `main`, for later). The workflow gates deployment on lint + the full test suite, builds with `BASE_PATH=/Pillar-of-Stars/` (Vite `base` comes from that env var; local builds default to `/`), and publishes `dist/` via `actions/deploy-pages`.
- The repo had to go **public** for Pages (designer's call — free GitHub accounts can't use Pages on private repos). The Pages site is public by URL in any case.
- First two workflow runs failed usefully: run 1 caught a missing `@types/node` (Vite config reads `process.env`), run 2 caught Pages-not-enabled-on-private-repo. Both fixed; run 3 green end to end.
- Playtest notes: saves live in the browser's localStorage (per-device, survives refreshes; clearing site data wipes the run). Pin a galaxy with `?seed=NAME` for reproducible bug reports — include the seed (shown on death/win screens) with any feedback.

---

## Session 3 — 2026-07-10 · M1 playtest patch 1

### What changed (one commit per patch section)

1. **Intro art (§12.0)**: five authored SVG scenes replace the emoji placeholders — non-Earth homeworld, capital-ship arrival, burning city with a visible fleeing crowd (needed a firelight band behind the silhouettes — black-on-black at first), the exodus with ships dying mid-escape, and the Pillar itself as the closing shot. Still data-driven: `data/intro.json` references images under `public/intro/`.
2. **Opening beat (§9.3)**: "The Buried Door" rewritten to the canonical framing — blind jump on random coordinates → uninhabited world, no sentient life → ruins → faint patterned EM trace → the corrupted data-core. Event structure was already correct (auto-fires after intro, data-flagged run-opener); text-only change.
3. **Wake probe**: destroy = 70% clean / 10% loss-noticed (+1 Wake jump) / 20% transmission (+2); sneak = 50/50 (+1 on spotted). New generic `wakeAdvance` effect drives pursuit through the standard advance path (grace absorbs first); a catching advance kills on outcome-ACK so the player reads the text. Weights in data; distribution unit-tested.
4. **Fuel economy**: exploration = an intra-system jump — 0.25 fuel and 0.2 Wake advance each. **Confirmed before building: the Wake previously advanced ONLY on inter-system jumps; exploration contributed nothing — so no double-count.** Wake math moved to integer hundredths-of-a-jump (exact fractional determinism). Fuel-regain outcome probability cut 30% per pool via exact odds math (added "come up empty" outcomes where an option always paid); the depot's scrap→fuel trade untouched per the patch. Side effect (flagged, accepted): the "adrift at fuel 0, scavenge the last node" beat is gone — exploring needs fuel now.
5. **Ruins**: all ruin nodes read "Ancient Ruins" (no unique names, and the signal ruin is indistinguishable by label). Sectors roll 1–2 decoy ruins, placed outside the waypoint region first. Decoy excavation: 70% safe loot / 15% danger-with-loot / 15% danger-and-empty (= 30% dangerous, half of those still pay) — weights in data, distribution unit-tested. Decoys never decode the sector.
6. **Wake-space re-entry**: three approaches, all config-driven (`wakeSpace` in config.json) — casual (1 fuel TOTAL, 70% contact), run hot (3 fuel, 60%, much cheaper flee), sneak (4 fuel, 30% − 5%/sensor level). Contact fires an M1-fidelity placeholder event at ONE marked swap point in the JUMP handler; M2 replaces that call with the combat state machine (the event engine posed no obstacle). `ship.sensors` stub (level 0) exists so the sneak formula already reads the future subsystem.

**Designer rulings captured**: approach fuel prices are TOTAL jump cost (casual = normal 1); hull losses join fight placeholders when the M2 ship model exists; sensors stubbed at 0 until M2/M3.

**Save schema v2** — WakeState shape and ship stub changed; pre-patch saves reset on next load.

**Verification**: 88 unit tests green (new suites: probe distribution, ruin distribution + routing, wake-space math/integration/data contracts); build + lint clean; smoke test at 390×844 zero-error, all five intro frames eyeballed.

### Logged for later milestones (do NOT build yet)

- **M2/M6 — Wake-space cloak (relic tech, §9.3/§11)**: a late-game cloak item discoverable in Ascended ruins. Effect: −75% fight chance across ALL THREE wake-space approaches, at +1 fuel on the approach cost. Zero effect outside the ship — no benefit in boarding or planetside combat. Slot it into the relic pipeline when relics exist.
- **M3 — sensor leveling / threat-probability display**: full spec from the designer — player-visible fight-probability readouts per approach driven by sensor subsystem level, beyond the §7.4 threat-band reveal. The sneak formula already consumes `ship.sensors`; M3 adds the leveling loop and the UI surface. Belongs with the sensor/intel work (threat bands, UNKNOWN reads).
- **M5 — shop/store mechanic**: buy/sell/trade at stations, including selling sensor DOWNGRADES for scrap (trade safety for money), and a pressure rule: every 3 transactions triggers a +1 Wake jump (commerce is loud). Explicitly M5 scope (§14); spec parked here so M5 starts warm.

### What's next / needed

- **Next**: designer replay of the patched build; then M2 — The Knife Fight (ship subsystems, power management, combat vs 3 archetypes), swapping the wake-fight placeholder at its marked seam.
- **Needed**: playtest feedback on the new economy (does 0.25/explore make searching feel like spending?), and the standing gate-locked-until-ruin ruling.
