# PILLAR OF STARS — Game Design Document

### A long-form space opera RPG on a roguelite spine · v0.6

---

## 1. High Concept

You are a survivor. The Wake — a militant crusader civilization — burned your homeworld and scattered your people across an uncharted arm of the galaxy. Now they hunt the survivors one by one, and their fleet front is closing behind you. You begin utterly alone — one refugee, one battered starship, an empty mess hall. Ahead: a galaxy generated fresh every run — new star systems, new alien species with their own cultures and agendas, new wars in progress — and scattered through it, the ruins of the **Ascended**: an ancient civilization whose power dwarfed everything the galaxy has ever seen, until one day, thousands of years ago, they simply vanished. The answer to defeating the Wake is buried in what they left behind. You jump system to system, recruiting a crew one hard-won soul at a time, fighting orbital duels and blaster shootouts, piecing together who the Ascended were — and deciding what to do with what you learn.

This is one long journey, not a string of short runs. You pour hours into a single captain — a real protagonist you grow attached to — as they cross the arm following a broken star-map toward the Ascended. Death is real and, late in the game, likely; but if your captain falls with crew still aboard, you may _choose_ to carry on as one of them rather than start over. The galaxy is procedural. The captain's story is yours.

**Elevator pitch:** a Fallout-style space-opera RPG — deep character, dialogue and choices, moral gray — with FTL's ship pressure, Star Control 2's alien-discovery wonder, and Stargate's ruin-archaeology and ascension mystery, all structured as one campaign-length journey with a roguelite's real stakes.

**Tone references:** Star Wars (scrappy survivors vs. a war machine), Stargate (ancient ruins, ascension), Fallout (scattered refugees, salvaged relic tech, moral gray).

**The title:** the Pillar of Stars is what the exiles call the galactic core — the dense, burning column of stars on the horizon of every night sky in the arm, the direction every survivor's story points. It guided their ancestors' myths; now it guides the hunted. The Core (§9.4) _is_ the pillar. Rendered literally in the sky system (§12.1): visible from every sector map, growing closer the deeper into the arm you travel.

**Era target:** SNES-to-PS1 sensibility. Chunky pixel/low-fi art, synth soundtrack, systems-deep but readable at a glance. Turn-based or pausable — playable one-handed at 0300.

---

## 2. Design Pillars

1. **Your captain's journey is the story.** One long campaign, not disposable runs — a protagonist you invest hours in, whose choices, crew, and scars accumulate into a story that's _only yours_. Procedural species, events, and consequences chain together and thread through that arc: the time the fungal collective saved you from pirates and then demanded your medbay as payment is one beat in a much longer tale.
2. **Pressure creates drama.** A pursuing threat (the "Wake") advances behind you each jump. You can never fully explore, repair, and grind — every jump is a tradeoff.
3. **Discovery is the reward.** New species, derelicts, anomalies, and one-off events are the loot that matters. Codex entries persist across runs (knowledge is the only meta-progression).
4. **Combat is a knife fight — in orbit and in the corridor.** Ship duels are subsystem chess: target their engines or their weapons? Personal combat is a laser blaster standoff behind crates. Both are short, tense, consequential.
5. **Your crew is your lifeline.** You start alone. Max crew is 4. Every recruit was bought, beaten, befriended, or begged — and each one changes how the ship runs and how the galaxy treats you. They are also literally how the journey survives you: when the captain falls, a surviving crew member is who you can carry on as (§6.4). Keeping them breathing is the game's central, ongoing tension.
6. **The void is beautiful.** Space games earn love through awe. Every system arrival, every planet, every nebula should be worth stopping to look at. Beauty is a feature with a budget, not a polish afterthought.
7. **Readable depth.** Every system fits on a phone screen. No stat requires a wiki.

---

## 3. Core Loop

```
JUMP to system → EXPLORE nodes (planets, stations, anomalies)
  → EVENTS (contact, ship combat, blaster shootouts, discovery, dilemma, recruits)
  → GAIN/LOSE (fuel, hull, crew, scrap, tech, intel)
→ MANAGE ship (repair, upgrade, assign crew)
→ The WAKE advances → JUMP again
→ Reach sector boss / gate → next sector (harder, stranger)
→ Sector 6: the Core. Final confrontation. Win or die.
```

Journey length target: one campaign-length run in the tens of hours (roughly 10–20+), played across many sessions. This is a long game you live inside, not a 45–90 minute sprint — the length is what earns the captain's growth, the crew bonds, and the weight of eventual loss. Sessions resumable at any point (auto-save between decisions).

The journey is **directed, not open-galaxy**: you follow a broken Ascended star-map (§9.3) recovered in the opening ruin, and the Wake at your back makes turning around suicidal. You always know roughly where you're headed — the next waypoint on the trail toward the Core — even as _how_ you get there stays procedural.

---

## 4. Run Structure

- **6 sectors**, each a procedurally generated map of 12–18 star systems connected by jump lanes (FTL-style node graph).
- Each sector has a **theme** drawn from a pool: contested warzone, dying stars, nebula shroud (sensors degraded), plague zone, ancient ruins belt, trade corridor. Themes modify event tables and hazards.
- **The Wake**: the hunter civilization's fleet front, consuming systems behind the player N jumps per turn. Systems they take go dark; entering one is a desperate gamble (great salvage, brutal odds, and they're looking for _you specifically_). Ahead of the front, Wake hunter-killer patrols, informants, and bounties on exile heads seed events in "safe" space.
- Sector exit is a **jump gate**, sometimes guarded, sometimes requiring a key item obtainable via event chains.
- **Why the path is linear (and not an open-galaxy sandbox):** the run is a pursuit _and_ a treasure hunt. The opening ruin hands you a corrupted map fragment pointing coreward (§9.3); each sector decodes the next leg of it. You're not free to wander the whole galaxy because you're chasing a specific trail with a war machine burning the road behind you. Freedom lives _inside_ each sector — which systems you explore, who you fight, what you take — not in the macro route.
- **The map is rough, not precise (why you search so much):** the recovered star-map (§9.3) is corrupted, so each waypoint resolves only to a _region_ — a cluster of systems, not a single planet. Think of a soldier navigating from a 4-digit grid reference: you know the objective is somewhere inside that square, but you have to walk it to find the exact spot. In game terms a waypoint highlights an _area_ of the sector map; the ruin or artifact is somewhere in it, and finding it means actually exploring the systems there. This is the diegetic engine of the whole exploration loop — the reason you tap through so many planets is that the map only ever tells you "somewhere around here." Better decoding (a cartographer or xeno-linguist crew member, cleaner fragments, event rewards) can _tighten_ a waypoint's resolution — from "this region" toward "this system" — turning map-clarity into a tangible, earnable advantage.

---

## 5. The Ship

The player ship is a top-down deck plan (FTL-style rooms) with subsystems:

| Subsystem    | Function                           | When damaged                    |
| ------------ | ---------------------------------- | ------------------------------- |
| Reactor      | Power budget for everything        | Rolling brownouts               |
| Engines      | Evasion, jump charge               | Can't flee, evasion 0           |
| Weapons      | Slots for equipped weapons         | Weapons offline                 |
| Shields      | Damage absorption layers           | Hull takes hits directly        |
| Sensors      | Event/anomaly detection, targeting | Fight blind, miss discoveries   |
| Life Support | Crew survival                      | Slow crew death, timer pressure |
| Medbay       | Heal crew                          | Injuries become permanent       |
| Comms        | Diplomacy options, distress calls  | Contact options locked          |

- **Power management**: reactor output < total subsystem demand. Routing power is a core decision in and out of combat.
- **Hull** is the run's health bar. Zero = death. Repairs cost scrap and time.
- 3–5 unlockable ship classes with different layouts/starting gear (unlocked by codex milestones, not grind).

---

## 6. Crew

**You start alone. Maximum crew: 4.** Flying solo is viable but punishing — one person can't route power, return fire, and patch hull at the same time. Every recruit is a meaningful upgrade and a real character, not a stat stick from a hiring menu.

### 6.0 The Captain (character creation)

Every run begins with creating your captain:

- **Minimum**: name and gender.
- **Appearance**: the captain is visible — in ground combat, the deck plan, dialogue portraits, and the succession screen — so appearance is fully customizable. Portrait and sprite are assembled from the same part-library system used for procedural species faces: skin tone, hair, features, clothing/armor palette, accessories. What you build in the creator is what walks into the cantina.
- **Background (pick 1)**: a light origin choice (ex-military, drifter merchant, disgraced scholar, frontier scavenger...) granting starting skills and one trait — and coloring event options. Backgrounds are data-driven like everything else.
- Custom captains can be **saved as presets** and reused across runs; the codex records each captain's fate.
- **Personal throughline**: the captain is the game's protagonist, not a disposable avatar — so their background (above) seeds a small set of recurring personal beats that surface across the long journey (an old service debt, a sibling somewhere among the scattered exiles, a rival from before, a promise made on the burning homeworld). These are light, data-driven hooks, not a fixed script: enough that by hour ten the captain is _someone specific_. That specificity is exactly what makes their death (§6.4) land as loss rather than a stat reset.

### 6.05 Growth: veterancy and legend

Success makes people better. Survive, win, and the captain and crew visibly grow across the run:

- **XP from doing**: ship fights, boardings, ground combat, first contacts, discoveries, and quest resolutions all grant XP to participants. The gunner earning kills gets better at gunnery; the linguist decoding languages gets faster at it. Growth follows use.
- **Levels raise skills**: each level lets a character raise a skill or, at milestones, gain a **second trait** chosen from a short list rolled from their history ("Boarding Veteran: +accuracy in corridor fights" only appears if they've actually survived boardings).
- **Veterancy tiers mirror threat bands**: GREEN → SEASONED → VETERAN → ELITE. A late-run crew that's survived everything should _be_ the elite crew other captains' sensors warn about.
- **The captain grows too** — same system, plus reputation: a storied captain unlocks parley options, intimidation plays, and recruitment leverage that a nobody doesn't have.
- **Scars**: serious injuries can leave permanent marks — a stiff arm (aim penalty, intimidation bonus), a cybernetic eye (sensor bonus, purity-taboo species react badly). Growth and damage both accumulate; a long run makes characters _storied_, not just strong.
- **Balance guardrails**: growth is strictly in-run (dies with the run; meta-progression stays knowledge-only per pillar 3). Enemy scaling by sector is tuned so a well-grown crew feels powerful but never invincible — the Wake and attrition, not level gates, remain the pressure. Succession keeps its sting: the dead captain's levels, traits, and scars are gone forever.

### 6.1 Recruitment archetypes

Potential crew appear through events, stations, combat, and species quests. Each has a **recruitment vector** — how you get them aboard:

| Archetype                    | How you get them                                                         | The catch                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The Mercenary**            | Pay their price in scrap (steep)                                         | Loyalty is rented. May demand raises, or walk at a rich port                                                                                                          |
| **The Duelist**              | Beat them in a blaster fight or ritual combat — they join out of respect | Species with _ritual combat_ values produce these often. Losing hurts                                                                                                 |
| **The Wide-Eyed Adventurer** | Just ask. They're thrilled. Too trusting for their own good              | Naive trait: falls for scams and traps in events until they "grow up" mid-run                                                                                         |
| **The Long Shot**            | Legendary specialist, near-impossible ask (0–5% base)                    | Convincible only via rare event chains (save their homeworld, return their stolen relic). The codex logs how each one _can_ be won — knowledge across runs is the key |
| **The Debtor**               | Buy out their indenture from a merchant league or crime boss             | Their old owner may come collecting anyway                                                                                                                            |
| **The Stowaway**             | Found hiding in your cargo hold three jumps after a station visit        | Free crew! But _why_ are they hiding, and who's chasing them?                                                                                                         |
| **The Defector**             | Surrenders during a boarding action or begs asylum mid-battle            | Their species now dislikes you; their enemies warm up                                                                                                                 |
| **The Salvage**              | A damaged machine-being or cryopod survivor found on a derelict          | Needs repair/revival investment first. May remember things about the precursors                                                                                       |
| **The Prisoner**             | Freed from a pirate hold or a hostile ship you boarded                   | Grateful — or a plant. Small chance of a sleeper agenda                                                                                                               |

- Each recruit: species, name, 2 skills (domain + level), 1 trait, 1 personal agenda, 1 recruitment vector.
- **Turning someone down or failing their recruitment can echo** — the duelist you lost to may show up later as a pirate captain.

### 6.2 What crew do

- **Ship roles**: assigned to subsystems for passive buffs — pilots add evasion, gunners add accuracy/crit, engineers speed repairs, medics keep injuries from becoming permanent, comms specialists unlock dialogue options.
- **Travel buffs**: a navigator reduces fuel cost on certain lanes; a scavenger finds extra scrap at derelicts; a xeno-linguist speeds first contact decoding.
- **Needs**: crew consume life support headroom and rations, expect a cut of earnings (morale), and have agendas that generate personal events. A max crew of 4 means every berth is precious — a brilliant jerk might not be worth the morale damage.
- Crew can be **injured, killed, poached, mutinied, or transformed by events**. Traits create texture: "Ex-cultist: bonus with theocratic factions, panics near ancient ruins."
- Aliens bring species abilities (see §8) and diplomatic modifiers — a Threxian crewmate makes Threxian patrols friendlier and their rivals hostile.

### 6.3 The companion slot

**Exactly one crew member can accompany the captain** on boarding actions and planetside excursions. The rest hold the ship (and their ship buffs stay active). Choosing your plus-one is a real decision: bring the gunslinger for a fight you expect, the medic for a plague ruin, the linguist for a tense parley — and lose their ship-side bonus while they're gone. Losses on the ground are permanent (see §6.4).

### 6.4 Death of the captain — continue or begin again

This is the emotional core of the long game. You will spend hours with your captain; as the sectors harden, their death becomes not just possible but likely. When it comes, it is real — nothing undoes it — but it is not automatically the end of the journey.

**When the captain dies, you choose:**

- **Continue as crew** — if a crew member survives, you may take up the journey as one of them. The expedition lives on; your captain does not. This is a _choice_, never automatic: some deaths hit so hard you'd rather start clean than carry the ship on as the medic who watched it happen, and the game honors that.
- **Begin again** — start a fresh captain in a new galaxy. You keep everything you've _learned_ — the codex, species knowledge, and ship unlocks (§8) carry over — so a restart is a new journey armed with hard-won knowledge, never a wipe to zero.

**Crew survival is the whole game's tension.** Continuing-as-crew is your primary lifeline, and it exists precisely because you've kept people alive. The forced "begin again" only happens when the captain falls **with no crew left** — i.e. when you were running solo. The game keeps teaching the same lesson: your crew is not just firepower, they are how the story survives you. Losing your last crewmate should feel like losing the journey, because it is.

Succession is survival, not a free respawn. Whichever crew member you continue as, the costs bite:

- **The captain is gone.** Their skills, trait, perk, species abilities, and personal throughline (§6.0) leave the game. Nothing transfers.
- **Morale craters.** All surviving crew take a heavy morale hit; agendas may activate ("with the old captain gone, maybe it's time I settled my own debts...").
- **Reputation was partly personal.** Factions that trusted _the captain_ cool toward the successor — honor-debts, ritual-combat respect, and personal promises don't automatically convey. Some doors close; occasionally one opens (the species that hated your old captain shrugs: "the ship is under new management").
- **The Wake surges** one extra jump during the chaos of the handover.
- **Playstyle mutates.** The new captain's skills define what you're now good at. The xeno-linguist inherits a gunboat; the mercenary inherits a diplomatic mission. Adapt.
- **Their agenda goes live.** The successor's personal agenda becomes a journey-level thread, and their own throughline (§6.0) becomes the new spine of the story — the defector may steer you toward their old fleet, the debtor's creditors now chase the whole ship.

**Boarding edge case:** if the captain falls during a boarding or planetside action, the companion (§6.3) must fight their way back to the ship for succession to occur. If they fall too, the journey ends there.

**Hard rules:** no crew remaining = the journey is over and you begin again. Simultaneous total loss (life-support failure, ship destruction) is final. The successor is now the captain in full — leading ground actions, carrying the story, and one blaster bolt from ending it all over again.

_(Optional Ironman toggle: for players who want the old sting, a hardcore mode makes any captain death final — no continue-as-crew. Off by default; the default game is the long journey above.)_

---

## 7. Combat

Two layers: **ship combat** in orbit, and **personal combat** — laser blaster shootouts — aboard ships and planetside. Both turn-based (mobile-first), both short and consequential.

### 7.1 Ship combat

**Structure:** two ships side by side over a planet backdrop, deck plans visible.

- **Weapons**: kinetics (cheap, ammo), lasers (power-hungry, shield-shredding), missiles (bypass shields, limited stock), ion (disables subsystems, no hull damage), exotics from discoveries (gravity lance, spore torpedo...).
- **Targeting**: player picks enemy subsystems. Killing engines prevents escape; killing weapons stops the bleeding; killing life support is a war crime some factions remember.
- **Defense**: shields (layered), evasion (engines + pilot), point defense vs missiles.
- **Non-combat outs**: fleeing (engine charge timer), surrender (lose cargo, keep ship), bribes, and faction-dependent parley.
- Enemy variety by faction doctrine: swarm drones, missile boats, shield fortresses, boarding cutters, EW ships that jam your sensors mid-fight.

### 7.2 Personal combat (blaster shootouts)

A compact tactical layer: small grid or zone-based map (a cargo bay, a cantina, a ridge line), 1–4 combatants per side, cover-based laser exchanges.

- **Party**: the captain + the companion slot crew member (see §6.3).
- **Actions**: move, take cover, aimed shot, snap shot, suppress, use item (medkit, stun grenade, breach charge), and skill actions from traits (a duelist's called shot, a machine-being's overcharge).
- **Cover and heat**: blasters overheat if fired every turn — rhythm management instead of ammo counting. Cover degrades as it absorbs fire.
- **Stakes**: captain death = run over. Injuries persist and need medbay time. Non-lethal (stun) settings enable capture and recruitment outcomes.
- **Triggers**: exploration events (ambushes, standoffs, defending a dig site, cantina brawls that escalate), species quests, and boarding actions.

### 7.3 Boarding

If you disable an enemy ship's **weapons AND engines**, it's dead in space — you can dock and board instead of finishing it from range. Boarding launches a personal combat scenario in their corridors with three resolution paths:

- **Neutralize** — fight the crew down. Full salvage rights, but hardware gets shot up in the process and some factions remember massacres.
- **Subdue** — stun weapons and demands. Take prisoners (ransom, information, or recruits — see §6.1), take cargo, leave the hull. Harder to execute than killing.
- **Ally** — lower the blaster and talk. Viable when their faction standing, your reputation, or the situation supports it (mutinous crews, press-ganged conscripts, coward captains). Can yield escorts, intel, or a Defector recruit.

Enemies can board **you** too — repel with your full crew in your own corridors, or vent a deck if you're desperate.

### 7.4 Reading the enemy (difficulty telegraphing)

Enemy crews range from green conscripts to legendary killers, and the player must be able to smell the difference _before_ committing:

- **Threat bands**: every crew has a hidden rating displayed as a readable band — GREEN / SEASONED / VETERAN / ELITE / **UNKNOWN** (when your sensors can't tell). Shown on the boarding-decision screen and in pre-fight event text.
- **Sensors matter**: sensor subsystem level + a comms/intel crew member sharpen the read — from "lifesigns: 4" up to full crew manifests with traits. Damaged sensors return UNKNOWN, and rolling the dice on UNKNOWN is a deliberate gamble the game should let you regret.
- **Diegetic tells**: hull scarring and kill-markers on the enemy sprite, disciplined vs. panicky radio chatter during the ship fight, faction reputation ("Void Jackals press-gang farmhands; the Ashen Choir trains from birth"), and bar rumors bought with intel.
- **Behavioral tells**: elite crews fight the ship duel better — smarter targeting, tighter evasion. The ship fight itself is intel for the boarding decision.
- Rewards scale with band: an ELITE crew's ship carries elite gear, rare recruits, and codex-worthy secrets. Risk is always priced.

---

## 8. Species, Cultures, Factions (the signature system)

Each run procedurally generates **4–6 major species** from component pools:

- **Morphology**: avian, fungal, machine, gaseous, chitinous, energy-being, uplifted fauna...
- **Government**: hive, theocracy, merchant league, junta, anarchic clans, AI custodianship...
- **Cultural values**: 2–3 drawn from a pool (honor-debt, knowledge-hoarding, ancestor worship, ritual combat, radical hospitality, purity taboos...). Values drive event logic: a species with _honor-debt_ remembers rescues and betrayals across the whole run.
- **Disposition matrix**: procedurally generated wars, alliances, and grudges between species. The player walks into a live geopolitical situation each run and can exploit, mediate, or ignore it.
- **First contact** is a mini-event: sensor readings → linguistic decoding (sensors + comms + crew skills) → dialogue. Botched contact creates lasting hostility.
- Species-specific: unique ship doctrines, trade goods, recruitable crew abilities, event chains, and one **species quest** per run with a real reward.
- **Ascended ruins**: 1–2 major ruin sites per sector hold lore fragments and relic tech — the archaeological backbone of the run (see §9).

**Codex**: persistent across runs. Every species component, event, artifact, and ending discovered gets an entry. Meta-progression = knowledge + ship unlocks, never stat inflation.

---

## 9. Narrative Spine — The Wake, the Exiles, the Ascended

### 9.1 The Wake

A militant crusader civilization that glassed the player's homeworld and now systematically hunts the scattered survivors. On the sector map they are the advancing front (§4); in play they are also hunter-killer patrols, checkpoint fleets, paid informants among other species, and bounties posted on exile heads. They are not mindless: they have doctrine, hierarchy, and reasons (revealed in fragments — their zealotry is connected to the Ascended, which the player pieces together late). Wake ships are the game's elite combat benchmark, and Wake boarding parties are never GREEN.

### 9.2 The Exiles

The player's own people, scattered across the arm. Encounters are rare (2–4 per run), always significant, and split into two camps:

- **The Hiders** — "Tell no one you found me. Let me disappear." They offer safehouses, quiet repairs, supplies, family news — but beg the player not to draw attention. If the player is careless (trailed by patrols, spending relic tech loudly, selling their location for profit — yes, that's an option, and it's as dark as it sounds), the Wake takes them. The codex records every exile saved, lost, or sold.
- **The Fighters** — "Anything to destroy them. Anything." They bring intel on Wake movements, sabotage opportunities, and the game's only guaranteed-loyal recruit vector (a Fighter exile crew member never mutinies against an exile captain). The cost: they push toward risk, and their vendettas generate dangerous events.

Camp interactions shape the run and the endings: a captain who shepherded Hiders to safety and a captain who built a Fighter cell reach the finale with different allies, obligations, and epilogues.

### 9.3 The Ascended

An ancient civilization of power beyond anything the modern galaxy has seen — and thousands of years ago, in a single moment, they vanished. No war, no bodies, no explanation. Only ruins and relics.

- **The inciting artifact**: the very first thing the player does is excavate an Ascended ruin and recover a **corrupted data-core** — a partial, damaged star-map pointing coreward, toward where the Ascended _went_. This is the map that shapes the whole journey (§3, §4): each sector you cross decodes another leg of it. Because it's corrupted, every waypoint it gives is _rough_ — a region to search, never a precise site (§4) — which is exactly why exploration takes real effort. It is also the first codex fragment. Everything downstream — the linear route, the pull toward the Core, the Wake's interest in _you specifically_ — flows from this opening discovery. The cinematic opening (§12.0) leads straight into it: homeworld falls, you flee, you find the map, you run.
- **Ruins are the research trail**: exploring later ruins (ground excursions — §7.2 maps, plus puzzle/lore events) yields more **fragments**: pieces of who the Ascended were, how they lived, and why they disappeared. Over the course of a single long journey, following the map, the player assembles enough to reach the truth and the endgame choice (§9.4). Fragments also persist in the codex across runs — deeper lore, alternate map branches, and ending variations unlock and enrich on subsequent journeys — but the core arc completes in one run (knowledge is still the meta-progression of pillar 3; it now _deepens_ the story rather than gating the first ending).
- **Relic tech**: ruins occasionally yield working Ascended technology — captain augments (personal buffs), weapon modifications, and ship systems (the exotic weapons of §7.1 — gravity lance, spore torpedo — are all of Ascended origin). Relics are the most powerful items in the game and always carry a catch: unstable, culturally offensive to purity-taboo species, or **loud** — active relic use can ping Wake sensors and draw the hunt closer. Power at the cost of attention.
- **The truth** (assembled across fragments): the Ascended were not destroyed. They learned to ascend to a higher level of consciousness — and left everything behind. The Wake knows this too, in corrupted form; it is the root of their crusade.

### 9.4 Endgame — the Choice

Reaching the Core with enough assembled fragments unlocks the final revelation and forks the run into one of two closing quests:

- **ASCEND** — follow the Ascended's path: complete the rite, transcend, and escape the horrors of this galaxy entirely. A salvation ending with variations: do you show your scattered people the way, or leave alone? Hiders saved and Fighters befriended change who stands with you at the threshold — and who refuses to follow.
- **RETRIBUTION** — weaponize what the Ascended left behind: locate the Wake homeworld and destroy it. A war ending with its own mirror-dark variations: break their fleet and end the hunt, or glass their world entirely and become the thing you fled. The galaxy's species — and the surviving exiles — remember which.

Reaching the Core is the climax of the journey, not a teaser for a later one: a single long run assembles enough of the map and the fragments to unlock the revelation and both closing quests. Which ending is available, and in what flavor, is driven by what _this_ captain did — exile-camp history (Hiders saved vs. a Fighter cell built), faction standing, relic use, and the moral weight of the road behind you. The "why" is personal from minute one; the "what winning means" is the choice you earn at the end of the road. Subsequent journeys deepen it — codex fragments unlock rarer ending variants, alternate map branches, and lore that recontextualizes the whole story — but you can see a real, satisfying ending on your first completed run.

---

## 10. Events & Exploration

- Systems contain 1–4 **nodes**: planets, moons, stations, derelicts, anomalies, signals.
- Event engine is **data-driven**: events are JSON/YAML entries with requirements (crew skill, species relations, cargo, sector theme), weighted outcomes, and follow-up hooks that can fire sectors later.
- Event categories: first contact, distress calls (genuine and trap), derelict exploration (mini choose-your-path), planetary surveys, trade encounters, faction warfare spillover, **exile encounters (Hiders and Fighters — §9.2)**, **Wake patrols/informants/bounty hunters**, **Ascended ruin excursions (§9.3)**, moral dilemmas, plain weirdness.
- Target: **150+ events at launch**, structured so adding content = adding data files, no engine changes. This is where Claude Code's content pipeline earns its keep.

---

## 11. Economy & Progression (in-run)

- **Currencies**: Scrap (repairs/upgrades), Fuel (jumps), Intel (reveals map, buys event options).
- **Stores** at stations: inventory shaped by owning species' culture and current wars.
- **Upgrades**: subsystem levels, new weapons, hull plating, crew hires, and **relic tech** from Ascended ruins (§9.3) — captain augments, weapon mods, and ship systems with run-warping effects and real costs (instability, cultural taboos, Wake attention).
- Difficulty curve enforced by sector scaling + the Wake, not by rubber-banding.

---

## 12. Art & Audio Direction

**Ambition statement:** this game must be _beautiful_, not just readable. Target the top of the pixel-art craft — Hyper Light Drifter, Owlboy, The Last Night — not utilitarian roguelike graphics. Beauty pillar (#6) gets explicit engineering budget: shaders, lighting, and parallax are core systems, not polish.

### 12.0 The cinematic opening

Before the player touches a control, a short cinematic tells the story that everything else hangs on: the fall of the homeworld. It can be simple — a handful of painted-pixel stills with text laid over them: a world at peace, the Wake's fleet arriving in the sky, the world burning, a single battered ship fleeing into the dark. No gameplay, roughly 30–60 seconds, skippable but built to be watched once. Its job is to make the player _care_ before they wake up alone in an empty mess hall, and to plant the Wake as a felt loss rather than an abstract chase-mechanic. It flows straight into the opening ruin and the recovery of the map-fragment (§9.3): homeworld falls → you flee → you find the map → you run. This is the RPG's cold open, and the reason the whole journey has stakes from minute one.

### 12.1 The void

- **Layered parallax starfields** (3–5 depth layers) with procedural nebulae rendered as soft gradient clouds — every sector gets a distinct sky palette from its theme (dying-stars sector burns ember-orange; nebula shroud drowns in violet fog).
- **System arrival is a moment.** Each jump ends on a brief, framed establishing shot: the local star flaring, planets in silhouette, station lights blinking on. 2 seconds of awe before the UI fades in. Skippable, never skipped.
- **Planets as art pieces**: large painted-pixel spheres with slow rotation, atmospheric rim-lighting, cloud layers, city lights on night sides, ring systems. Procedurally palette- and feature-shifted so no two runs share a sky.
- **Light is the language**: ships catch starlight directionally; laser fire illuminates hulls; explosions bloom. A simple 2D lighting pass (additive glow layers) delivers most of this cheaply.

### 12.2 Ships, people, places

- Ships as **top-down hull sprites with visible subsystem rooms** (consistent with §5 and the boarding/ground tactical renderer) — detailed, weathered, and faction-styled. Battle damage renders visibly: scorch marks, venting atmosphere, flickering room lights. Cinematic **side-profile ship portraits** are reserved for codex entries, arrival shots, and dialogue framing (stretch goal — never a gameplay surface).
- Species portraits assembled from morphology part libraries so procedural species get procedural faces — with dramatic portrait lighting, not flat mugshots.
- Ground-combat maps get the same care: cantina neon, jungle bioluminescence, derelict corridors lit only by your blaster's charge glow.
- **UI**: terminal/console framing consistent with a starship bridge — but elegant. Thin lines, restrained glow, generous negative space. High contrast, thumb-reachable. The UI should look like it belongs on the beautiful ship you're flying.

### 12.3 Motion & mood

- Everything drifts: stars parallax with map panning, ships bob at idle, nebulae churn almost imperceptibly. Stillness reads as dead; the void should feel alive.
- Screen-space moments: warp-jump streaks, shield shimmer, the Wake visualized as a creeping darkness eating the sector map's stars.
- Performance guardrail: all effects degrade gracefully on mid-range Android — beauty at 60fps beats spectacle at 24.

### 12.4 Audio

- Procedural or tracked synth score — ambient exploration layers, combat intensity layers, species leitmotifs. (Existing WebAudio synthwave engine from the Missile Command project is a proven starting point for the audio layer.)
- Sound design carries beauty too: the low hum of the reactor, muffled blaster fire through hull walls, the almost-silence of open space between beats.

---

## 13. Technical Architecture (Claude Code brief)

**Stack**: TypeScript + HTML5 Canvas (or PixiJS), Vite build, Capacitor wrapper later for a real Android APK. No backend; all local. Save = serialized run state in app storage.

**Proposed module layout:**

```
/src
  /engine        game loop, scenes, input (touch-first), rng (seeded!)
  /render        parallax sky, nebulae, planet renderer, lighting/glow layer, vfx
  /galaxy        sector/system/node generation
  /species       species generator, disposition matrix, dialogue
  /ship          subsystems, power, damage model
  /crew          stats, traits, agendas, recruitment vectors, companion slot
  /combat        ship combat state machine, weapons, AI doctrines
  /ground        personal combat: grid/zones, cover, heat, boarding resolution
  /threat        enemy crew generation, threat bands, sensor-based intel reveal
  /events        event engine, requirement/effect DSL
  /economy       stores, currencies, upgrades
  /codex         persistent discovery records
  /ui            screens, HUD, deck-plan renderer
  /audio         synth engine, adaptive layers
/data
  /events/*.json
  /species-parts/*.json
  /weapons.json  /ships.json  /traits.json  /sectors.json
  /recruit-archetypes.json  /ground-maps/*.json  /threat-bands.json
  /backgrounds.json  /growth-traits.json  /appearance-parts/*.json
/tests           unit tests: generation determinism, combat math, event logic
```

**Non-negotiables:**

- **Seeded RNG everywhere** — a run seed reproduces the whole galaxy (debuggable, shareable, testable).
- **Data-driven content** — engine code never hardcodes an event, species part, or weapon.
- **Deterministic combat math with unit tests** — balance tuning without regression roulette.
- **Save/resume at every decision point** — this game will be played in 5-minute fragments.

---

## 14. Milestones

**M1 — Skeleton (prove the loop):** galaxy gen + jump map + fuel + the Wake + placeholder events. Win = reach sector 3.
**M2 — The Knife Fight:** full ship subsystem model + ship combat vs 3 enemy archetypes + power management.
**M3 — Boots and Blasters:** personal combat layer (grid, cover, heat) + boarding flow (disable weapons+engines → neutralize/ally/subdue) + threat bands with sensor-based intel.
**M4 — Someone to Meet:** species generator + first contact + disposition matrix + recruitment system (all 9 archetypes, max-crew-4, companion slot, succession — the long-game continue-as-crew / begin-again flow of §6.4) + captain creation (name, gender, appearance, background, personal throughline) + XP/veterancy growth system + 40 events.
**M5 — A Reason to Return:** crew traits/agendas, stores, upgrades, codex, 100+ events, 3 ship classes.
**M6 — The Core:** the cinematic opening (§12.0) + the inciting map-fragment event (§9.3), sector themes, Wake patrol/bounty systems, exile encounters, Ascended ruin chains + fragment/codex pipeline, relic tech, single-run dual endgame (ASCEND / RETRIBUTION), balancing pass, audio layers.
**M7 — The Beauty Pass:** parallax/nebula sky system, system-arrival shots, planet rendering, lighting layer, motion polish. Budgeted as a full milestone per pillar #6 — not squeezed into shipping week.
**M8 — Ship It:** Capacitor Android build, touch polish, performance pass (60fps on mid-range Android).

M1–M3 is the fun test. If orbital knife fights + blaster standoffs + jump pressure isn't fun with placeholder art, stop and rethink before content investment.

**Framing-forward exception:** the cinematic opening (§12.0) and the inciting map-fragment event (§9.3) are _cheap narrative scaffolding_ worth placeholdering early — even in M1 — precisely because M1's bare "tap a planet, read an event" loop feels flat with no story wrapped around it. A 30-second stills-and-text intro and a single "you found the map, now run" opening beat cost almost nothing and make early playtests read as _the start of a story_ instead of a systems demo. Build the real, beautiful versions in M6; stub them in M1. (This is the direct fix for the "M1 feels flat" finding that drove the v0.6 pivot — see the project log.)

---

## 15. Stretch Goals (post-1.0)

- Daily seed challenge (same galaxy for everyone).
- Second playable "campaign" perspective (play as a species envoy ship, diplomacy-focused).
- Mod support (the data-driven design makes this nearly free).
- Ship capture: after a Subdue boarding, fly the prize home — swap hulls mid-run or sell it.
- Crew loyalty arcs: multi-sector personal questlines per recruit archetype with unique endings.

---

_PILLAR OF STARS — prepared as a project brief for Claude Code. Start at M1. Argue with everything above that deserves it._
