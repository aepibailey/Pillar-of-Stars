# PILLAR OF STARS — Project Log & Supplementary Context

_Companion file to pillar-of-stars-design-doc.md — captures decisions and context from development conversations that aren't (yet) written into the doc itself._

---

## Status as of this log

- Design doc is at **v0.6**, title finalized as **PILLAR OF STARS**. (v0.6 = the long-form RPG pivot — see "Major pivot" section below.)
- Full narrative spine (Wake / Exiles / Ascended), crew/recruitment/succession system, growth/veterancy, and captain customization are all written into the doc.
- Claude Code kickoff prompt (below) has been prepared. Environment setup guidance was given (connect GitHub at claude.ai/code, requires Pro/Team/Enterprise). Milestone 1 build status: not yet confirmed started — check DEVLOG.md in the repo for the real answer once a session has run.
- A "contradiction" flagged by Claude Code during early review (deck-plan camera angle) has already been resolved and folded into the doc — see below for the reasoning, in case it comes up again.

---

## Major pivot — long-form RPG direction (design doc → v0.6)

The biggest change since v0.5. Triggered by playing M1 and finding it flat: tap planet → read text → pick option → repeat, with no story and no attachment. The diagnosis came out two-part:

1. **M1 is _supposed_ to feel thin.** The core texture — combat, pillar #4 — doesn't land until M2–M3, so judging fun at M1 is tasting flour before the cake bakes. The fun test is M1–M3, not M1 alone (§14 says so).
2. **A real structural question was hiding underneath.** The v0.5 design was a short-run roguelike (45–90 min, growth dies each run, endings gated across many runs), while the game actually being pictured is a Fallout/Stargate/Firefly/BSG-style long RPG: one captain you grow attached to over hours, a story that unfolds, a climactic moral choice (ASCEND vs. RETRIBUTION).

**Resolution — a "long roguelite RPG":**

- **One long journey, not short runs.** Run-length target moved from 45–90 min to a campaign in the tens of hours (§3). The captain is now a genuine protagonist; Fallout-lean RPG framing runs through §1, §2, and §6.0.
- **Death reworked (§6.4).** Captain death is real but the journey needn't end: _choose_ to continue as a surviving crew member, or begin again fresh. Continue-as-crew is a **choice, never automatic**. Begin-again keeps codex + unlocks, so it's never a wipe to zero.
- **Crew survival = core tension.** Forced restart only happens on a _solo_ death (no crew left). This makes keeping crew alive the central ongoing stake and reinforces pillar #5. Almost no new engineering — the §6.4 succession mechanic already existed in v0.5; the long run simply gives it emotional weight.
- **Endings reachable in one run (§9.4).** Reversed the v0.5 "gated across many runs." A single long journey now assembles enough map + fragments to reach a real ASCEND / RETRIBUTION ending. Subsequent runs deepen variants; they're no longer required to see an ending.
- **Captain personal throughline (§6.0).** Background now seeds recurring personal beats so the captain is _someone specific_ by late game and death lands as loss.
- **Optional Ironman toggle** noted in §6.4 for players who want true permadeath. Off by default.

**New narrative scaffolding:**

- **Cinematic opening (§12.0).** A short, simple intro — painted-pixel stills + text — showing the homeworld's fall, so the player cares before gameplay begins.
- **Inciting artifact + linearity justification (§9.3, §4).** The player's first act is excavating a ruin and recovering a corrupted Ascended data-core: a partial star-map pointing coreward. This _is_ why the game is a directed journey and not an open-galaxy sandbox — you're chasing a broken treasure map with the Wake burning the road behind you. Each sector decodes the next leg.
- **Milestone note (§14).** Build order is unchanged (the combat-first fun test still holds), but the intro + opening map event are cheap enough to _placeholder in M1_ — the direct fix for the "M1 feels flat" complaint: wrap the skeleton in the start of a story.

**Open follow-ups:**

- A working name for the inciting data-core artifact — candidates to vet later (the same collision-search discipline as the title): _the Waystone_, _the Cartouche_, _First Light_, _the Threnody_. None checked yet.
- **Resolved — map visibility:** rough-waypoint navigation. The decoded map resolves only to _regions_ (grid-square resolution — the 4-digit-grid land-nav analogy: you know it's somewhere in the square, you have to walk it to pinpoint it), never exact nodes. Corruption = coarse resolution; searching within the region _is_ the exploration loop, so it's the diegetic reason the player checks so many planets. Decoding quality (cartographer/linguist crew, cleaner fragments, event rewards) can tighten resolution over time. Written into §4 and §9.3.

---

## Naming history (why "Pillar of Stars" and not something else)

The title went through several rounds once the Wake/Exiles/Ascended narrative was locked in. Worth keeping this record in case the name ever needs to change (trademark issues, etc.) — the reasoning shouldn't have to be reconstructed from scratch.

**Rejected — name collisions found via search:**

- _Relict_ — existing games use this title
- _Coreward_ — existing games use this title
- _Afterlight_ — existing game and existing movie
- _Ashfall Exodus_ — existing book
- _Anabasis_ — a Battlestar Galactica Deadlock expansion mode, and thematically too close (a hunted fleet fleeing jump-by-jump) — using it would read as derivative of the exact game Pillar of Stars resembles

**Runner-up, vetted clean:** _Exilarch_ — a real historical title, "ruler of the exile," the recognized leader of a scattered people during captivity. No collision found in games. Strong thematic fit: the captain becomes this over a run, and the title has a second meaning via succession — the office survives even when the person doesn't. **Worth revisiting if Pillar of Stars ever runs into a collision or just stops feeling right.**

**Winner:** _Pillar of Stars_ — what the exiles call the galactic core: the dense, burning column of stars every survivor's story points toward. It guided their ancestors' myths; now it guides the hunted. The Core _is_ the pillar, rendered literally in the sky system and visible from every sector map, growing closer run over run. This meaning is now written into §1 of the design doc.

---

## Claude Code kickoff prompt (current version)

This is the prompt prepared to hand to Claude Code alongside the design doc, updated for the current title:

```
You are the lead engineer on PILLAR OF STARS, a long-form space opera RPG on a roguelite spine.
I am the designer and playtester. The complete design document is in
this repo: pillar-of-stars-design-doc.md. Read it fully before writing
anything — it is the source of truth for all design decisions.

YOUR FIRST TASKS (in order):

1. Read the entire design doc. Summarize back to me: the core loop,
   the narrative spine, and the M1 scope — so I can confirm we're
   aligned before any code is written.

2. Flag anything in the doc that is ambiguous, contradictory, or
   technically risky. Argue with anything that deserves it. I'd rather
   fix the design now than refactor later.

3. Propose the tech decisions the doc leaves open, with a
   recommendation and rationale for each:
   - Canvas 2D vs. PixiJS for rendering
   - State management approach
   - Test framework
   Wait for my sign-off.

4. Scaffold the project per §13: Vite + TypeScript, the module layout
   as specified, ESLint/Prettier, and a test setup. Create a DEVLOG.md
   where you record every significant technical decision and why.

5. Implement Milestone 1 ONLY (§14): galaxy generation, jump map,
   fuel, the Wake advancing, and placeholder events. Definition of
   done: I can open the dev build on my phone, tap through jumps on a
   procedurally generated sector map, watch the Wake consume systems
   behind me, run out of fuel and die, or reach sector 3 and see a
   win screen. The Pillar of Stars (the Core) should be visible on
   the sector map horizon from day one — even as a placeholder glow.

WORKING RULES:

- Do not build ahead of the current milestone. No speculative systems.
- Non-negotiables from §13 are law: seeded RNG everywhere (one seed
  reproduces an entire galaxy), data-driven content (no hardcoded
  events/species/weapons in engine code), deterministic game logic
  with unit tests, save/resume at every decision point.
- Mobile-first: touch targets, portrait layout, test at 390x844.
  Desktop browser is a bonus, never the priority. (See "Desktop
  scaling notes" below if this priority ever flips.)
- Write unit tests for generation determinism and any math (fuel,
  damage, XP) as you go, not after.
- Small, frequent commits with clear messages. Never leave main in a
  broken state.
- When the design doc and technical reality conflict, stop and ask me
  — do not silently reinterpret the design.
- At the end of each work session, update DEVLOG.md and tell me:
  what's done, what's next, and what you need from me.

Start with task 1.
```

Repo name suggestion used at the time: `pillar-of-stars`.

---

## Post-M1 hand-off prompt (v0.6) — paste after the doc is committed

Use this once the updated **v0.6** design doc and this log are committed to the repo (Claude Code reads the repo, so the doc must be updated _first_ or it'll be working from stale truth). This is the instruction that carries the v0.6 pivot into the build after the M1 playtest:

```
CONTEXT UPDATE — the design doc has been revised to v0.6. Before writing any
more code, re-read the full design doc; it is still the source of truth and it
has changed under you. Also read the project log section "Major pivot —
long-form RPG direction."

WHY IT CHANGED: I playtested M1. It runs, but it played flat — tap a planet,
read an event, pick an option, repeat, with no story. That's partly expected
(M1 is the skeleton; the combat that gives this game its texture doesn't arrive
until M2–M3), but it surfaced a real structural decision. We've pivoted from a
short-run roguelike to a long-form space-opera RPG on a roguelite spine. Deltas
to internalize:
- One long journey (tens of hours), not 45–90 min runs. §3.
- The captain is a real protagonist you keep alive. On death you CHOOSE to
  continue as a surviving crew member or begin again fresh — never automatic;
  total restart only on a solo death. §6.4.
- ASCEND/RETRIBUTION endings are reachable in a single long run, not gated
  across many. §9.4.
- Captain personal throughline seeded from background. §6.0.
- New cold open: a cinematic intro (§12.0) of the homeworld's fall, flowing into
  an opening ruin where the player recovers a corrupted Ascended data-core — a
  partial star-map that directs the whole journey (§9.3) and is why the route is
  linear, not open-galaxy (§4).
- The map gives ROUGH WAYPOINTS only — region/grid-square resolution, like a
  4-digit military grid: you know the objective is somewhere in the square and
  must search the systems there to pinpoint it. Corruption = coarse resolution.
  This is the diegetic reason the player searches many planets. §4/§9.3.

TASKS, IN ORDER:

1. Re-read the revised design doc (full) and the log's pivot section. Summarize
   back to me, briefly: (a) the new run/death model (§3, §6.4), (b) the opening
   flow (cinematic → ruin → corrupted map → rough-waypoint search), and (c)
   anything in the current M1 code or your architecture that the pivot now
   contradicts or puts at risk. Wait for my sign-off before coding.

2. ARCHITECTURE GUARDRAIL (do NOT build future systems — just don't block them):
   the pivot means "one long run" and "captain ≠ run" (succession continues the
   run under a new character). Make sure nothing in the save schema, run-state,
   or economy hardcodes a short-run assumption or ties run identity to the
   captain. If M1 code already does, flag it and propose the minimal refactor. Do
   NOT implement succession, growth, or endings now — those are M4/M6. This step
   is only about not painting us into a corner.

3. FRAMING-FORWARD STUBS for M1 (sanctioned by §14 — the direct fix for the flat
   playtest). Build as placeholders, data-driven, this milestone:
   a. Cinematic opening (§12.0): a skippable stills-and-text sequence, placeholder
      art fine, text/frames driven from a data file (e.g. /data/intro.json),
      showing the homeworld's fall. ~4–6 frames.
   b. Opening inciting event (§9.3): immediately after the intro, an Ascended ruin
      excavation that hands the player the corrupted data-core / partial map.
      Author it as a normal data-driven event, flagged as the fixed run-opener —
      no engine hardcoding.
   c. Rough-waypoint map overlay (§4/§9.3): on the existing sector map, show the
      objective as a REGION/grid-square highlight ("artifact likely in this
      area"), not a pin on one node. The player still explores nodes to find the
      actual ruin inside that region. Placeholder visuals fine; the mechanic —
      waypoint = area, not point — is the deliverable.
   Keep all four non-negotiables intact (seeded RNG, data-driven, deterministic +
   tested, save/resume). Add unit tests where there's logic — e.g. waypoint region
   selection must be seed-deterministic.

4. After the stubs land and I've replayed M1, proceed to M2 (§14 — the knife
   fight: ship subsystem model + ship combat vs 3 archetypes + power management).
   That combat is the real fun test; the stubs above just make M1 read as the
   start of a story while we build toward it.

WORKING RULES (unchanged): data-driven content only, seeded RNG everywhere,
deterministic math with unit tests, save/resume at every decision point,
mobile-first (390x844), small frequent commits, never leave main broken, and when
the doc and technical reality conflict, STOP and ask me. Update DEVLOG.md at the
end of the session: what's done, what's next, what you need from me.

Start with task 1.
```

---

## Resolved: deck-plan camera contradiction

Claude Code correctly flagged that §5 described the ship as a "top-down deck plan" while §12.2 (art direction) described "side-profile sprites" — two different camera angles for the same object.

**Resolution:** top-down is canonical for every gameplay surface — the deck plan, boarding combat, and ground combat all share one tactical renderer (important because boarding fights happen inside the ship's deck plan and planetside fights use the same grid/cover system — building two separate tactical renderers for one game wasn't worth the cost). Top-down also stacks better in portrait orientation on a phone. Side-profile ship art was demoted to codex entries, system-arrival shots, and dialogue framing only — cinematic, never a gameplay surface, and explicitly a stretch goal.

**This is already fixed in the design doc (§12.2).** Noted here only because it was a live back-and-forth with Claude Code and is a good example of the "flag contradictions, argue with the doc" behavior worth reinforcing if it happens again on a different section.

---

## Desktop / MacBook Pro scaling notes (not yet written into the doc)

Explored but not yet formalized as a doc appendix — flagged here as an open task if desktop becomes a real target rather than a "works incidentally" bonus.

- The current stack (browser-based: Vite + TypeScript + Canvas) requires **no architecture change** to run on a Mac. "Scaling for desktop" is really about relaxing the mobile-first constraint, not adding new required scope.
- Concrete things a desktop target unlocks: finer combat targeting (subsystem quadrants, called shots, drag-select for ground combat crew), more simultaneous UI (zoomable sector map, multiple panels at once — crew roster + ship status + comms log together), keyboard hotkeys for weapon groups/crew assignment/quick-travel, and a higher visual-fidelity budget (more parallax layers, higher-res planet rendering, more simultaneous VFX without the mobile performance guardrail from §12.3).
- **Open task:** if desktop becomes a real priority, add a "Desktop Scope" appendix to the design doc listing the specific control/UI upgrades above, rather than leaving it as an informal conversation.
- **Open fork not yet re-decided:** §7 currently specifies turn-based combat, justified partly by mobile-first reasoning (no precision timing, interruptible, works one-handed). If desktop ever becomes the _primary_ target rather than a bonus, this is the one design choice worth revisiting — real-time-with-pause plays better on a big screen with a mouse. Turn-based is the safe default either way (loses nothing on PC), so no urgency to change it — just flagging that the mobile-first justification weakens if the primary platform changes.

---

## Model-usage working notes (process, not design — but useful to keep handy)

Guidance worked out for deciding when to escalate from a standard/cheaper model to a stronger one during the Claude Code build phase:

**Default:** use the lighter/faster model for routine implementation (most CRUD, wiring, straightforward features). Escalate to the strongest available model for: genuine architecture decisions, tricky/intermittent bugs, large multi-file refactors, and anything touching deterministic math that has to be correct (seeded galaxy generation, combat formulas, succession edge cases).

**Signals the current model is "fighting back" — cue to escalate:**

- Fixes the symptom, not the cause (bug patched, reappears adjacent to it two prompts later)
- Contradicts itself across the session without noticing
- Repeated failed attempts (2–3+) at the same fix with only cosmetic differences
- Asks questions it should be able to answer itself from the doc/codebase
- Vague or hand-wavy explanation when asked _why_ a fix worked
- Build/test results oscillate (pass/fail/pass/fail) without meaningfully converging

**Before switching models:** try giving more context first — point it at the specific design doc section, ask it to re-read relevant files, ask it to state its plan before executing. Often "fighting back" is under-contexted, not under-powered. If that doesn't resolve it within a turn or two, that's the actual cue to switch. Drop back to the lighter model once the hard part is solved — no need to stay on the expensive model for routine work afterward.

**On token/cost budgeting:** Anthropic does not publish fixed token quotas per Claude Code plan — capacity is multiplier-based (Pro baseline, Max 5x, Max 20x) and burn rate depends on conversation length, file sizes, and how many tool calls a single instruction triggers. Don't budget by estimate; check actual usage via `/status` or `/usage` inside Claude Code and extrapolate from real data.

---

## How to use this file

Upload this alongside `pillar-of-stars-design-doc.md` into a Claude Project's knowledge base (suggested project name: "Pillar of Stars"). The design doc is the source of truth for the game itself; this log fills the gaps — naming history, the kickoff prompt, resolved ambiguities, and process notes — that were discussed but don't belong inside the design doc's own structure. Update it as new non-doc decisions come up (e.g., if the desktop appendix gets written, move that content into the doc and trim it from here).
