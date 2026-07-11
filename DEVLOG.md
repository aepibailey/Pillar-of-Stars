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

---

## Session 4 — 2026-07-10 · M1 playtest patch 2

### What changed

1. **Homeworld art (slide 1)**: carved bays/lakes into the continent silhouettes with ocean-colored bites (the ocean gradient moved to userSpaceOnUse so carve fills match the water exactly), added peninsulas, multiple green shades plus arid interior belts, and irregular ice caps at both poles.
2. **The Ancients slides**: two new frames close the intro — the lore beat (a race vanished tens of millennia ago; centuries of coreward expeditions; "only ever more ruins") and the gut-feeling bridge at the excavation rim. **Placement call**: end of the sequence, directly before The Buried Door, so "this time is different" is the final line before the player recovers the data-core. Slide 5's text was trimmed so the Ascended aren't introduced twice.
3. **BUG FIX — unreliable system selection.** Root cause: **stale hit-test geometry**. The render pass drew the map _before_ re-rendering the panel, so whenever the panel's height changed (node lists and hints differ per system) or the mobile URL bar collapsed, the canvas was resized _after_ the draw — leaving the stored hit circles offset from the pixels. Taps then missed until some lucky tap (e.g. on the player's own marker, a large target) forced a redraw — exactly the reported "tap your current location first, then it works." Not a listener leak; the listener was fine. Fix is three layers: (a) the map now draws LAST in the render pass, measuring the settled layout; (b) a ResizeObserver on the canvas redraws on any CSS box change; (c) the tap handler compares the live canvas size against the geometry's recorded size and redraws before hit-testing if stale.
4. **Wake tuning**: intra-system exploration advance 0.2 → 0.1 jumps (config-only change).
5. **Free final exploration.** **"Last remaining node" definition (confirmed against tracking logic)**: exploration is tracked per node id, so "last" = exactly one unexplored node remaining in the current system at the moment of the action — order-independent; skipping nodes changes nothing. No ambiguity found. **Deliberate edge, flagged**: a single-node system's only exploration is also "the action that completes the system," so it's always free (~a quarter of systems roll 1 node). If that reads as a loophole, the alternative is "free only if the player already paid ≥1 explore here" — one-line change. Free closers still advance the Wake 0.1; only fuel is waived. Side benefit: the "adrift at 0 fuel, one last site to scavenge" desperation beat from M1 is partially restored.

### Verification

91 tests green (new: free-closer cost, single-node edge, not-stranded-at-zero-fuel-with-free-closer); build + lint clean; smoke run at 390×844 through the full 7-frame intro → opener → map → event → reload-resume with zero console errors.

---

## Session 5 — 2026-07-10 · Stranded: the Wait-1-Day mechanic

### What was built

Running dry is no longer instant death. When stranded (no affordable jump, no affordable unexplored node, no open gate here), the panel offers **Wait 1 Day**, up to `stranding.maxWaitDays` (5) per stranding. Each day is **one mutually-exclusive roll** (designer ruling — replaced the spec's two independent rolls): 15% **tow**, 15% **robbery**, 70% **quiet day**. All probabilities and rewards live in `data/config.json` + `data/events/core.json`; rolls come off the serialized event RNG stream, so a save/resume mid-stranding continues the exact sequence.

- **Tow**: a hauler drags the ship to the **BFS-nearest station system** (`galaxy/search.ts`; deterministic — BFS follows generated link order; the start system counts if it has a station). The `stranded-tow` event offers tiered fuel purchases (3/2, 6/4, 9/6 fuel/scrap) via a new generic **`option.requires`** mechanism — data-driven resource requirements the engine enforces and the UI greys out. A broke player takes the free tow and re-strands at the dock with a fresh 5-day clock ("per stranding" reset). Fallback: a sector with zero stations (never seen, but possible) keeps the player in place and the rescuers trade directly.
- **Robbery**: `stranded-robbery` fight, placeholder fidelity per the standing M2 note. Win (50/50 in data, tunable — spec gave no win probability, flagged): **+2 scrap, +4 fuel** (the +4 ends the stranding). Loss: **death** (designer ruling), via a new generic `death` effect in the events vocabulary; lands on outcome-ACK so the text reads first. Death cause `robbed`.
- **Quiet day**: `stranded-quiet` flavor event, three weighted texts, no effects.
- **The Wake advances 1 jump per 2 full days waited** (days 2 and 4), through the normal advance path (grace absorbs first; being caught while adrift is death by `wake`).
- **Day 5 unrescued** → death cause `adrift` — hard run end; per designer, no §6.4 succession (ship and crew are lost together, nothing to succeed from).

### Judgment calls / notes

- Designer rulings captured: robbery loss = **death**; rolls **mutually exclusive** (single roll/day); tow = nearest-station + trade event (M5's real shop replaces the trade options later).
- Robbery **win probability** was unspecified — shipped 50/50 in data, one number to tune.
- The wait mechanic applies to **any** dead-end stranding (including fuel-in-tank-but-all-exits-unaffordable edge cases), not strictly fuel-0 — same flavor, no second code path. Old instant-death causes `fuel`/`stranded` are gone; causes are now `wake` / `adrift` / `robbed`.
- Save schema **v3** (`strandedDays` added): pre-patch saves reset.

### Verification

106 tests green — new suite covers the roll distribution (~15/15/70 over 3k seeded rolls), the full rigged-quiet 5-day sequence with Wake advances exactly on days 2 and 4 and `adrift` death after day 5, tow movement + requirement-gated purchases, robbery win/lose paths, determinism, and BFS station search on synthetic sectors.

---

## ✅ MILESTONE 1 COMPLETE — 2026-07-10

M1 ("Skeleton — prove the loop", §14) is signed off by the designer. What shipped across sessions 1–5:

- **The loop**: seeded galaxy generation (12–18 systems/sector, deterministic from one seed), jump map with fractional fuel, the Wake hunting the player's own trail, data-driven placeholder events, and a win at sector 3 (§14 definition of done met — playable on phone at 390×844).
- **Framing-forward stubs (§14 exception)**: a 7-frame cinematic opening (§12.0) driven from `data/intro.json` — the homeworld's fall, the exodus, the Pillar, and the Ancients lore bridging into the opening ruin; "The Buried Door" run-opener (§9.3) that recovers the corrupted data-core; and rough-waypoint region navigation (§4) — the waypoint is a 4×4 grid cell to search, never a pin.
- **Playtest-driven depth added in M1**: the Wake probe encounter, decoy ruins with excavation risk, Wake-space re-entry approaches (casual/fast/sneak), and the out-of-fuel "Wait 1 Day" stranding mechanic (tow / robbery / adrift-death).
- **Architecture**: pure-reducer `RunState` (run identity ≠ captain, §6.4 guardrail held), auto-save at every decision point, all content in `/data`, seeded RNG everywhere, 106 unit tests covering generation determinism, fuel/Wake/waypoint math, event data contracts, and every probability distribution.
- **Deployed**: live at https://aepibailey.github.io/Pillar-of-Stars/ via CI that gates on lint + tests.

**Known M1 placeholders that M2+ must replace** (carried forward as integration debt):

- The Wake-space contact fights (`wake-fight`, `wake-fight-fast`) and the stranded robbery (`stranded-robbery`) resolve as **placeholder events** (weighted fuel/scrap outcomes). Each fires at a single marked seam. M2's real ship-combat state machine replaces the two wake-space seams; the stranded robbery is a boarding scenario and likely waits for M3.
- `ship.sensors` is a lone stub (level 0); M2 expands it into the full §5 subsystem model.
- `hull` does not yet exist in `RunState`; M2 introduces it as the run's health bar (§5).

**Standing design question still open from M1**: the gate-locked-until-ruin rule (each sector's jump gate stays locked until the signal ruin is found). Left as-is pending a play verdict.

---

## Session 6 — 2026-07-11 · Milestone 2: The Knife Fight (§5, §7.1)

Ship combat is in. Built in three commits: the deterministic core, run integration, then the UI.

### The ship model (§5)

- The run's `ship` is now the full 8-subsystem model (reactor/engines/weapons/shields/sensors/life-support/medbay/comms), each with a level and accumulated damage (effective level = level − damage). Hull is the run health bar; hull 0 = death (`destroyed`). The old `{sensors}` stub is gone.
- The persistent ship IS a `CombatShip` — combat clones it, resets transient fields (power/shields/flee), and writes hull, subsystem damage, and spent ammo back when the fight ends. One shape, no translation layer.
- **In M2 only reactor/engines/weapons/shields/sensors do work.** Life-support/medbay/comms exist in the model (the deck plan is whole) but draw no consequences until crew/diplomacy land (M3–M4). Flagged, not faked.

### Combat (§7.1)

- New `phase: 'combat'` + `CombatState` on RunState, driven by a pure state machine in `src/combat/` with its **own RNG cursor inside the state** — one seed reproduces a whole fight and save/resume mid-turn is exact. Turn = one decision (power + per-weapon targets + action) → player volley → enemy volley (doctrine) → upkeep.
- **Power management (§5):** a reactor pool split across weapons/shields/engines; demand exceeds supply, so routing is the core choice. Reactor damage browns out the pool. `clampPower` enforces caps and sheds overflow (shields → engines → weapons last).
- **Weapons (data-driven, `data/weapons.json`):** kinetic (ammo, absorbed by shield layers), laser (power-hungry, strips shield layers and burns through when it clears them), missile (bypasses shields, ammo, but point-defense can intercept), ion (disables a subsystem, no hull damage, absorbed by shields). Targeting a subsystem trades raw hull damage for a disable (`subsystemHullFactor` spill).
- **Defenses:** layered shields (regen while powered), evasion from engine power (the "+ pilot" half waits for M4 crew), point-defense vs missiles.
- **Non-combat outs:** flee (engine-charge timer; enemy keeps firing), surrender (faction-gated; pays scrap), bribe (faction-gated; pays scrap). Faction _parley_ is M4 — absent here, not stubbed as always-fail.

### The 3 archetypes (`data/enemies.json`)

Gunship (evasion + targeting), Missile Boat (forces point-defense), Shield Fortress (forces lasers + power routing). Each teaches a different defensive mechanic. Real Wake ships are the elite benchmark of M6; these stand in for now.

### Integration & designer rulings

- **Wake-space contact now launches a real fight** at the seam M1 marked; the `wake-fight`/`wake-fight-fast` placeholder events are retired. The fast approach's promised easier escape became a **flee-charge head start**. (Ruling 1: the **stranded robbery stays a placeholder** — a fuel-dead ship can't ship-fight; that's a boarding scenario for M3.)
- **Hostile-ship node encounter** (ruling 5): a data-driven event (`config.hostileEncounterChance`, default 0.16) whose "engage" outcome launches combat via a new `launchCombat` event effect. `?hostile=1` forces it for on-demand playtesting (a dev affordance alongside `?seed=`).
- **Repair (ruling 3):** `REPAIR` spends scrap to mend hull/subsystems on the map; rates in `config.repair`.
- **Starting loadout (ruling 4):** the ship carries all four weapon types from the first fight, for testing.
- **Save schema v4** (ship model + combat state); pre-M2 saves reset.

### Verification

**137 unit tests** (24 combat-core + 8 integration new): weapon-vs-defense mechanics, power/evasion math, ammo/cooldowns, every outcome, determinism + mid-fight save round-trip, launch/resolve/salvage/death, repair, and the wake-space→combat wiring. Build + lint clean. A Playwright combat smoke test (`scripts/smoke-combat.mjs`, `?hostile=1`) drives a full fight at 390×844 — engage → power/target/fire loop → enemy destroyed → salvage → back to map, zero console errors.

### Open / next

- **M1–M3 is the fun test.** M2 combat wants a playtest: are the three fights readable and distinct? Is the power split a real decision at reactor 4? Tuning knobs (weapon damage, hull totals, evasion, salvage) are all in `/data`.
- Combat balance numbers are first-pass guesses — expect a tuning patch.
- Next milestone is **M3 (Boots and Blasters):** personal combat + boarding (disable weapons+engines → neutralize/subdue/ally) + threat bands with sensor-based intel — at which point the stranded robbery becomes a real boarding fight and the enemy-read layer (§7.4) arrives.

---

## Session 7 — 2026-07-11 · M2 playtest patch 1 (combat bugs, feedback, UX)

### Root-cause findings (reported before fixing, per request)

- **Item 6 — the "4 power but only 3 to weapons" cap.** `clampPower` capped each channel at the subsystem's effective level. The player ship's **weapons subsystem is level 3** (`ship-player.json`) while the reactor is level 4, so the weapons channel was capped at 3 — not a slot limit, the per-channel subsystem-level cap. **Designer decision:** keep the cap (it's meaningful — your weapons bay really is level 3), but **make it visible.** Reverted my initial "allow full pool" change; each power row now reads **allocated/max** (e.g. `3/3`), the `+` button disables at the channel max or when the reactor pool is full, and the Ship panel + Explain screen both spell the rule out.
- **Item 4/5 — silent weapon skips.** `fireVolley` `return`ed with no log when a targeted weapon couldn't fire (cooldown, no ammo, or `powerCost > weapon power`). `resolveHit` always logged, so the only silent path was these pre-fire skips — including the laser-vs-hull "no report" case (it was starved of weapon power).

### What changed

1. **Derelict traps → real combat (§10):** the distress-beacon "bait" outcome now launches a fight against a new **weak GREEN archetype** (`derelict-scavenger`, hull 8) via `launchCombat`, replacing the M1 flat scrap loss.
2. **Explain button (in-combat):** a `? Explain` opens a plain-language help modal — power allocation, the allocated/max rule, the four weapon types, weapon-line numbers, and the under-power rule.
3. **Ship stats from the map:** a bottom-left **Ship** button opens a stats modal (hull, reactor pool, per-subsystem effective/level, weapons + ammo) without entering combat or repair.
4. **Under-power made loud:** shared `planVolley()` decides per-weapon fire status for BOTH the engine and the UI, so the warning matches the outcome. An under-powered targeted weapon turns its row **red** with "not enough weapon power", and firing logs "**NOT ENOUGH POWER**". Cooldown/no-ammo/offline are also flagged and logged.
5. **Every weapon reports every turn:** `fireVolley` now emits a log line for every targeted weapon — hit, miss, or the reason it held fire. Untargeted weapons stay silent (you chose not to fire them).
6. **Power cap surfaced:** allocated/max per channel, as above.
7. **Threat band in combat (§7.4):** each archetype carries a `threat` band (GREEN/SEASONED/VETERAN/ELITE), shown next to the enemy name. Sensor-based sharpening/UNKNOWN is a later milestone; for now it shows the best read.
8. **Surrender hurts:** now **loses all scrap and half current fuel** (was a token scrap loss).
9. **Wake ship names:** a dedicated brutal name pool (`data/names-wake.json` — "Cruel Awakening", "Dark Devourer", …), used only for **wake-space** fights as "`<name> <class>`". Other factions keep their archetype names. Archetypes gained a `className` (Skirmisher/Missile Boat/Bastion/Skiff). Noted in-file: the general ship-name pool still wants more entries in a later pass.

### Verification

**147 tests** (10 new patch tests): planVolley classification, the "NOT ENOUGH POWER" log, every-weapon-reports, the weapons-level cap still holding at 3, threat band in state, wake naming vs faction naming, painful surrender, and the derelict-trap → scavenger-combat path. Build + lint clean. Combat smoke at 390×844 exercises the fight, the Explain modal, and the Ship panel with zero console errors.

### Note for later

- Sensor upgrades should sharpen the threat read (and introduce UNKNOWN) — M3 sensor/intel work.
- General (non-Wake) ship/faction name pool needs expansion — not blocking.

---

## Session 8 — 2026-07-11 · Combat turn model locked to SIMULTANEOUS + tutorial deferred

### (a) What the turn model WAS before this prompt — SEQUENTIAL

`combatReduce` resolved the player's volley first, then the enemy's, with two sequential tells:

1. If the player's volley reduced the enemy hull to 0, the code short-circuited to `won` and **the enemy never fired back** that turn.
2. The enemy's return volley was computed against the **already-damaged** enemy, so if the player disabled the enemy's weapons this turn, the enemy couldn't fire this turn.

Both meant the enemy effectively _reacted_ to the player's action inside a single turn.

### (b) What changed — refactored to SIMULTANEOUS (required, not optional)

Intended design is simultaneous commit: the player inputs a full turn while the enemy AI decides independently, and both resolve together on "Fire". Refactor (contained to `src/combat/engine.ts`):

- Both sides' firing plans are now decided from the **turn-start state** via `planVolley`, BEFORE either volley lands. Neither volley's damage can change the other's firing decisions (a killing blow no longer cancels the enemy's simultaneous shot; ion-disabling the enemy's weapons bites NEXT turn, not this one).
- `fireVolley` takes a precomputed `plan` argument (was recomputing internally).
- Win/lose is evaluated AFTER both volleys. **Mutual destruction = loss** (player-death precedence): you can't sail on at 0 hull, and letting "won" win a mutual-kill would strand a dead ship on the map. Flagged as my call, one-line to flip.
- RNG order stays fixed (player rolls, then enemy) purely for deterministic replay — it does NOT make either side react to the other; the plans were already locked.
- **Reveal stays plain** (the per-turn combat log shows both sides' lines together). No cinematic — that's M7.

Locked in now so later combat features build on the correct resolution model. 3 new tests assert: enemy fires on the player's killing turn; disabling enemy weapons doesn't stop its shot that turn; mutual destruction → loss. 150 tests green, build/lint clean. No save-schema change.

### (c) Deferred — scripted first-combat TUTORIAL (planned END-OF-M2 task, NOT started)

Per the designer: the player's very first fight should be a guided encounter that explains each combat element (subsystem power allocation, weapon types, power-cost/ammo readouts, the insufficient-power warning) inline as it comes up, instead of relying on the `? Explain` button.

**Do NOT build until the closing task of M2**, after the current round of combat UI bugs/fixes has stabilized (silent weapon fire ✓, power-allocation cap ✓, combat-log reporting ✓, simultaneous turn model ✓ — all now done), so the tutorial script isn't written against a moving UI. Requires explicit designer sign-off before starting. Reference: this prompt (Session 8, item 2). Logged so it isn't forgotten.

---

## Session 9 — 2026-07-11 · Scripted first-combat tutorial built — M2 COMPLETE

Designer signed off ("execute all remaining end of M2 tasks"), so the deferred first-combat tutorial (Session 8, item c) is now built. This was the closing task of M2.

### What was built — data-driven coach cards over the first real fight

A guided overlay that walks the player through the combat screen the **first time** they ever enter a ship fight, then never shows again. It layers explanations on whatever the first fight actually is — it does **not** force a scripted weak enemy (a possible follow-up; flagged below).

- **Content is data:** `data/tutorial-combat.json` — 8 steps (`{ title, text }`), so the script can change without touching engine or UI code (per the non-negotiable). Steps cover, in order: the simultaneous turn model → the enemy box + threat band → your ship/hull + Flee & Bribe are real options → reactor power and the allocated/max cap → what each channel (weapons/shields/engines) does → the four weapon types with power-cost/ammo readouts → the red "won't fire" under-power warning → target-then-Fire.
- **UI-only, engine-untouched:** implemented entirely in `src/ui/app.ts` as a fixed bottom coach card (`.tut`/`.tutcard`, gold border, z-index 20 over the combat sheet). No reducer, no combat-engine, no save-schema change.
- **Persistent, one-time:** dismissal is stored in `localStorage` under `pillar-of-stars.tutorial.combat`. `maybeActivateTutorial` arms it only when a live fight starts (`phase === 'combat'` && `outcome === 'ongoing'`) and it hasn't been completed; walking to the last step ("Start fighting") or Skip marks it done. It hides while any modal (Explain/Ship) is open and re-appears after.
- **The `? Explain` button still exists** as the always-available repeat reference; the tutorial is the once-only inline version the designer asked for.

### Verification

- New `scripts/smoke-tutorial.mjs` (390×844): confirms the card appears on the **first** fight, walks all 8 steps, disappears after the walk, and does **NOT** reappear on the **second** fight — zero console errors.
- Fixed a self-inflicted interaction: because the coach card overlays the bottom of the combat sheet (where Fire lives), `scripts/smoke-combat.mjs` now pre-sets the tutorial-done flag after clearing localStorage, so it tests combat mechanics without the card intercepting Fire. (Real players click through the card first, so Fire is never blocked in play.)
- Also fixed a stale-DOM bug found while wiring this: `renderTutorial` now clears `tutorialEl.innerHTML` when inactive, so a hidden card can't leave an invisible-but-clickable button behind.
- **150 tests green** (no engine change, so no new unit tests — the tutorial is UI-only and covered by the smoke). Build + tsc + lint clean. smoke, smoke-combat, smoke-tutorial all pass.

### M2 status — COMPLETE

The Knife Fight (§14) is done: ship subsystem model, power management with the allocated/max cap, four weapon types, three+ archetypes with threat bands, simultaneous turn resolution, surrender/flee/bribe, derelict-trap → combat, Wake ship naming, and now the first-combat tutorial.

### Notes for later / open forks

- **Tutorial rides the real first fight, not a scripted soft opener.** If the very first hostile roll is a tough archetype, the tutorial explains the screen but the fight itself can still be brutal. If we'd rather guarantee a gentle first encounter, that's a separate change (bias the first hostile roll toward `derelict-scavenger`/GREEN) — flagging for a designer call, not building unprompted.
- Sensor upgrades → sharpen threat read + UNKNOWN (M3). General non-Wake name pool still wants expansion. Both unchanged from Session 7/8.

---

## Session 10 — 2026-07-11 · Green first fight + missile point-defense transparency

### (a) First fight is now a GREEN shakedown

Designer call: the player's very first fight should be gentle so the first-combat tutorial opens on a winnable bout. `launchCombat` (`src/engine/reducer.ts`) now forces the **first** combat of a run (`stats.combats === 0`) to the GREEN `derelict-scavenger` **whenever the encounter archetype is `'random'`** (hostile-ship surveys and wake-space contact). Scripted archetypes keep their own enemy — a derelict trap was already `derelict-scavenger` anyway — so nothing else is overridden, and every fight after the first rolls normally. New integration test asserts the first random fight is `derelict-scavenger`/GREEN; the existing gunship-forced tests still pass because those deps exclude the scavenger and fall through to the normal roll.

### (b) Missile point-defense — what the mechanic actually is (reported before changing)

Investigated `src/combat/engine.ts` `resolveHit`. The mechanic is a **flat, per-missile chance-to-intercept roll against the *defending* ship's `pdChance` stat** — a fixed 0–1 probability carried by each ship (`archetype.pdChance` / the player def):

- For a missile: roll `rng.next() < target.pdChance`. Below ⇒ intercepted, no damage. Otherwise ⇒ full damage (missiles also ignore shields entirely — that's their identity).
- It is **independent per missile** — each missile in a salvo rolls on its own. It is **NOT** tied to salvo size, missile count, a depletable PD magazine, sensors, or subsystem damage. Purely the target's flat `pdChance`.
- Current values: `derelict-scavenger` 0.1, `gunship` 0.2, `shield-fortress` 0.3, `missile-boat` 0.5; **player 0.4**. Higher = better point defense = more of the *incoming* missiles get shot down.
- Point defense affects **missiles only** — kinetic/laser/ion are governed by evasion/shields instead.

The interception and the landed hit were **already logged**, so there was no silent disappearance; the gap was purely **pre-fire visibility** (the player couldn't see intercept risk before committing a missile).

### (c) What was added to surface it

- **Pre-fire read (rough, not precise):** a new `pdBand()` UI helper maps `pdChance` → `low / moderate / high` (a word band on purpose — a precise % is sensor-tier, M3). Each **missile weapon line** now shows `· intercept risk <band>`, and the **enemy ship box** shows `· point defense <band>`. Non-missile weapons show nothing (PD doesn't touch them).
- **Log clarity (every action reported):** intercept now reads "**— shot down by point defense.**"; a missile that gets through now reads "**— slips past point defense and shields, strikes <target>.**" so both outcomes are explicit and consistent with the every-weapon-reports rule.
- **Explain reference:** the `? Explain` sheet gained a **Point defense** section and its missile line now notes each missile rolls independently.

### Verification

151 tests (new first-fight-green integration test; existing interception unit tests at `pdChance` 0/1 still cover both branches). Build + tsc + lint clean. Tutorial + combat smokes pass at 390×844: first fight renders as **Scavenger Skiff GREEN** with "point defense low", the Missile Rack line shows "intercept risk low", zero console errors.

### Notes / open forks for the designer

- **PD is flat and target-based.** If you'd rather it scale with salvo size (saturating point defense — fire 4 missiles, the 4th is likelier to leak) or with a dedicated enemy PD subsystem the player can ion-disable, that's a mechanic change, not just a display one — flag it and I'll rework `resolveHit`. Today it's one independent roll per missile.
- The rough band thresholds (≤0.15 low, ≤0.35 moderate, else high) are a first cut; easy to retune.

---

## Session 11 — 2026-07-11 · Point defense becomes a targetable subsystem (+ saturating salvos)

### #1 finding (reported before building)

Point defense was **not modeled as a subsystem** and was **not tied to Weapons**. It was a single flat float `pdChance` (0–1) on the ship, rolled per missile in `resolveHit`, fully independent of every subsystem — so nothing the player could target suppressed it. (Also corrected the record: the "saturating rework" wasn't actually in progress; Session 10 shipped only PD *transparency* + the green first fight. So this session built saturation **and** the targetable subsystem together.)

### The final model

PD now has **two separated knobs**:
- **Capacity** = the new **`pointDefense` subsystem**'s effective level = how many incoming warheads it can *engage per turn* (the saturation cap).
- **Quality** = the existing `pdChance` = odds each *engaged* warhead is actually shot down.

**Resolution (`src/combat/engine.ts`):** each volley opens with a per-turn budget `pd.left = pdCapacity(defender)` (= `effLevel(pointDefense)`), threaded through the whole volley. Missiles resolve in order; each one, while budget remains, spends 1 and rolls `pdChance`. Once budget is spent, further warheads that turn **auto-leak**. Missiles also gained a **`salvo`** (warheads per shot, each an independent roll + capacity draw; 1 ammo per shot). The budget is a live counter fixed at volley start, so an ion hit landing earlier in the *same* simultaneous volley can't shrink capacity mid-flight — it bites next turn. No new serialized `CombatState` field; the only save-shape change is the extra subsystem key, so **`SCHEMA_VERSION` 4 → 5** (old saves cleanly discarded).

**Two viable paths (the point of the task):**
- **Cripple:** target `pointDefense` (ion is ideal) → capacity drops → at 0 every missile lands unopposed.
- **Saturate:** fire a salvo larger than capacity → the overflow leaks even against full-health PD.

**Starting numbers (tunable):** capacity — scavenger 0, gunship 1, shield-fortress 2, **missile-boat 2**, player 2. Quality `pdChance` unchanged. Missile Rack: **damage 5 → 2, salvo 3** (so total on-target is comparable but now interacts with PD); enemy Warhead Launcher stays single-warhead.

**Two design calls I made** (AskUserQuestion tooling failed, and you'd said "continue"): (a) gave the starter Missile Rack a **salvo of 3** so the saturate path is real *now* with one weapon — otherwise saturation only mattered once you owned multiple launchers; (b) PD damage reduces **capacity only**, not per-warhead quality — one clean lever, matching your "reduce saturation capacity" framing. Both are one-line tunes if you'd prefer otherwise.

### #3 transparency

- `pointDefense` is a first-class targetable subsystem: new **PD** target chip on every weapon row, a subsystem row in the Ship-stats sheet, and a live **`point defense N/M`** readout on the enemy box (2/2 undamaged, 1/2 damaged, 0/2 → "(disabled)"; ships with none say "no point defense").
- Missile lines show a capacity-aware **intercept risk** (`none — PD down` / low / moderate / high, plus "· salvo overwhelms" when your salvo already beats their capacity).
- **Four distinct log lines** for a warhead's fate: "shot down by point defense" / "beats point defense, strikes X" / "point defense is down, strikes X unopposed" / "overwhelms saturated point defense, strikes X" — so the player always knows *why* one got through (crippled vs. saturated intact PD). Explain sheet rewritten with a "Point defense (and how to beat it)" section.

### Verification

154 tests (4 new: full intercept when capacity ≥ salvo; disabled PD → whole salvo unopposed + log; salvo > capacity saturates with the overflow leaking at pdChance 1 + log; ion targets & damages the PD subsystem). Build + tsc + lint clean. Combat UI verified at 390×844: the 5-target row (incl. PD) fits, the green first fight shows "no point defense" + "intercept risk none — PD down". Existing interception tests updated for the capacity model.
