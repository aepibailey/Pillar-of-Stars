/**
 * DOM + canvas orchestration. Deliberately dumb: reads RunState, renders,
 * dispatches actions. All game logic lives in the reducer; all content lives
 * in /data. Text-heavy surfaces are DOM (thumb-sized touch targets); the map
 * is canvas.
 */

import { clampPower, effLevel, reactorOutput } from '../combat/engine';
import type {
  CombatShip,
  PowerAllocation,
  SubsystemId,
  TargetId,
  WeaponDef,
} from '../combat/types';
import { getEvent } from '../events/engine';
import {
  currentSector,
  exploreCost,
  isStranded,
  jumpCost,
  wakeFightChance,
} from '../engine/reducer';
import type { Store } from '../engine/store';
import type { RunState, WakeApproach } from '../engine/types';
import { systemsInCell } from '../galaxy/waypoint';
import { drawMap, type MapGeometry } from '../render/mapRenderer';
import { isConsumed, jumpsBehind } from '../threat/wake';

interface CombatDraft {
  power: PowerAllocation;
  targets: (TargetId | null)[];
  turn: number;
}

const TARGET_CHOICES: { id: TargetId; short: string }[] = [
  { id: 'hull', short: 'Hull' },
  { id: 'weapons', short: 'Wpn' },
  { id: 'engines', short: 'Eng' },
  { id: 'shields', short: 'Shd' },
];

export interface IntroFrame {
  /** Path under /public, resolved against the deploy base (e.g. "intro/1-homeworld.svg"). */
  image: string;
  gradient: [string, string];
  text: string;
}

interface UiRefs {
  hud: HTMLElement;
  panel: HTMLElement;
  overlay: HTMLElement;
  canvas: HTMLCanvasElement;
}

export class App {
  private refs: UiRefs;
  private selectedId: string | null = null;
  private introIndex = 0;
  private geometry: MapGeometry | null = null;
  private combatDraft: CombatDraft | null = null;

  constructor(
    private store: Store,
    private introFrames: IntroFrame[],
    private newRun: () => void,
  ) {
    this.refs = {
      hud: must('hud'),
      panel: must('panel'),
      overlay: must('overlay'),
      canvas: must('map') as HTMLCanvasElement,
    };
    this.refs.canvas.addEventListener('pointerdown', (e) => this.onMapTap(e));
    window.addEventListener('resize', () => this.render());
    // Redraw whenever the canvas's CSS box changes for ANY reason (panel
    // height changes, mobile URL-bar collapse, orientation) — keeps the
    // hit-test geometry in sync with what's actually on screen.
    new ResizeObserver(() => this.renderMap(this.store.getState())).observe(this.refs.canvas);
    store.subscribe(() => this.onStateChange());
  }

  start(): void {
    this.introIndex = 0;
    this.render();
  }

  private onStateChange(): void {
    const state = this.store.getState();
    // Drop stale selection when it no longer makes sense.
    if (this.selectedId === state.currentSystemId) this.selectedId = null;
    if (state.phase !== 'map') this.selectedId = null;
    this.render();
  }

  private onMapTap(e: PointerEvent): void {
    const state = this.store.getState();
    if (state.phase !== 'map') return;
    const rect = this.refs.canvas.getBoundingClientRect();
    // Stale-geometry guard: if the canvas has resized since the last draw,
    // the stored hit circles no longer match the pixels — redraw first.
    if (
      !this.geometry ||
      Math.abs(rect.width - this.geometry.width) > 0.5 ||
      Math.abs(rect.height - this.geometry.height) > 0.5
    ) {
      this.renderMap(state);
    }
    if (!this.geometry) return;
    const hit = this.geometry.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    this.selectedId = hit === state.currentSystemId ? null : hit;
    this.render();
  }

  // ---------- rendering ----------

  private render(): void {
    const state = this.store.getState();
    // Map draws LAST: the HUD/panel/overlay mutations above can change the
    // canvas's flex-allotted size, and drawMap must measure the settled
    // layout or its hit-test geometry is stale (the "taps don't register"
    // bug — see DEVLOG session 4).
    this.renderHud(state);
    this.renderPanel(state);
    this.renderOverlay(state);
    this.renderMap(state);
  }

  private renderHud(state: RunState): void {
    const behind = jumpsBehind(state.wake, state.visitOrder, state.currentSystemId);
    const fuelWarn = state.fuel <= 3 ? ' warn' : '';
    this.refs.hud.innerHTML = `
      <span class="stat">SECTOR <b>${state.sectorIndex + 1}</b></span>
      <span class="stat${fuelWarn}">FUEL <b>${fmt(state.fuel)}</b></span>
      <span class="stat">SCRAP <b>${state.scrap}</b></span>
      <span class="stat wake">WAKE <b>${fmt(behind)} back</b></span>
    `;
  }

  private renderMap(state: RunState): void {
    if (state.phase === 'intro') return;
    const sector = currentSector(state, this.store.getDeps().config);
    this.geometry = drawMap(this.refs.canvas, state, sector, this.selectedId);
  }

  private renderPanel(state: RunState): void {
    const { panel } = this.refs;
    if (state.phase !== 'map') {
      panel.innerHTML = '<p class="hint">…</p>';
      return;
    }
    const config = this.store.getDeps().config;
    const sector = currentSector(state, config);

    if (this.selectedId && this.selectedId !== state.currentSystemId) {
      const target = sector.systems[this.selectedId];
      const consumed = isConsumed(state.wake, target.id);
      const baseCost = jumpCost(state, target.id, config);

      if (baseCost === null) {
        panel.innerHTML = `
          <h2>${target.name}</h2>
          <p class="hint">Out of jump range — no lane connects from your position.</p>
          <button data-act="deselect">Back</button>
        `;
      } else if (!consumed) {
        panel.innerHTML = `
          <h2>${target.name}</h2>
          <button class="primary" data-act="jump" data-approach="casual" ${state.fuel < baseCost ? 'disabled' : ''}>Jump — ${fmt(baseCost)} fuel</button>
          <button data-act="deselect">Back</button>
        `;
      } else {
        // Wake-held space: pick your approach (patch §6).
        const approaches: { id: WakeApproach; label: string; sub: string }[] = (
          ['casual', 'fast', 'sneak'] as const
        ).map((id) => {
          const cost = config.wakeSpace[id].fuelCost;
          const sensorBonus =
            state.ship.subsystems.sensors.level -
            state.ship.subsystems.sensors.damage -
            this.store.getDeps().playerDef.subsystems.sensors;
          const pct = Math.round(wakeFightChance(config, id, sensorBonus) * 100);
          const labels: Record<WakeApproach, [string, string]> = {
            casual: ['Fly in casually', `${fmt(cost)} fuel · ${pct}% chance of contact`],
            fast: [
              'Run the line hot',
              `${fmt(cost)} fuel · ${pct}% contact · far easier to flee a fight`,
            ],
            sneak: ['Sneak through dark', `${fmt(cost)} fuel · ${pct}% contact`],
          };
          return { id, label: labels[id][0], sub: labels[id][1] };
        });
        panel.innerHTML = `
          <h2>${target.name}</h2>
          <p class="warn">Wake-held space. They are still here, and they are looking for you.</p>
          ${approaches
            .map(
              (a) =>
                `<button class="primary" data-act="jump" data-approach="${a.id}" ${state.fuel < config.wakeSpace[a.id].fuelCost ? 'disabled' : ''}>${a.label}<span class="sub">${a.sub}</span></button>`,
            )
            .join('')}
          <button data-act="deselect">Back</button>
        `;
      }

      panel.querySelectorAll<HTMLButtonElement>('[data-act="jump"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const approach = (btn.dataset.approach ?? 'casual') as WakeApproach;
          const cost = jumpCost(state, target.id, config, approach);
          if (cost !== null && state.fuel >= cost) {
            this.store.dispatch({ type: 'JUMP', toSystemId: target.id, approach });
          }
        });
      });
      panel.querySelector('[data-act="deselect"]')?.addEventListener('click', () => {
        this.selectedId = null;
        this.render();
      });
      return;
    }

    // Current system view
    const here = sector.systems[state.currentSystemId];
    const isGate = here.id === sector.gateSystemId;
    const decoded = state.decodedSectorIndexes.includes(state.sectorIndex);
    const inRegion = systemsInCell(sector, sector.waypointCell).some((s) => s.id === here.id);

    const costNow = exploreCost(state, config); // 0 when one node remains
    let html = `<h2>${here.name}${isGate ? ' — JUMP GATE' : ''}</h2>`;
    for (const node of here.nodes) {
      const explored = state.exploredNodeIds.includes(node.id);
      const canAfford = state.fuel >= costNow;
      const costLabel = costNow === 0 ? 'free — last site here' : `${fmt(costNow)} fuel`;
      html += explored
        ? `<button class="done" disabled>${node.name}<span class="sub">surveyed</span></button>`
        : `<button data-node="${node.id}" ${canAfford ? '' : 'disabled'}>${node.name}<span class="sub">explore · ${costLabel}</span></button>`;
    }
    if (isGate) {
      html += decoded
        ? '<button class="gate" data-act="gate">Enter the Jump Gate<span class="sub">the decoded map leg points through here</span></button>'
        : '<p class="hint warn">Gate locked — the data-core can\'t resolve the exit. Find the Ascended ruin in the marked signal region.</p>';
    }
    if (isStranded(state, config)) {
      const { maxWaitDays } = config.stranding;
      html += `
        <p class="hint warn">ADRIFT — no fuel to jump and nothing left to survey. Day ${state.strandedDays} of ${maxWaitDays}.</p>
        <button class="primary" data-act="wait">Wait 1 Day<span class="sub">passing traffic might find you — or something worse might</span></button>
      `;
    } else if (state.flags['mapRecovered'] && !decoded) {
      html += inRegion
        ? '<p class="hint">You are inside the signal region. The ruin is at one of these systems.</p>'
        : '<p class="hint">The data-core marks a signal region on the map — the ruin is somewhere in that area. Tap a system, then jump.</p>';
    } else {
      html += '<p class="hint">Tap a highlighted system on the map to select a jump.</p>';
    }
    html += this.repairSection(state);
    panel.innerHTML = html;
    panel.querySelector('[data-act="wait"]')?.addEventListener('click', () => {
      this.store.dispatch({ type: 'WAIT_DAY' });
    });
    panel.querySelectorAll<HTMLButtonElement>('[data-repair]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.store.dispatch({
          type: 'REPAIR',
          target: btn.dataset.repair as 'hull' | SubsystemId,
        });
      });
    });

    panel.querySelectorAll<HTMLButtonElement>('[data-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.store.dispatch({ type: 'EXPLORE', nodeId: btn.dataset.node as string });
      });
    });
    panel.querySelector('[data-act="gate"]')?.addEventListener('click', () => {
      this.store.dispatch({ type: 'ENTER_GATE' });
    });
  }

  private renderOverlay(state: RunState): void {
    const { overlay } = this.refs;
    switch (state.phase) {
      case 'intro':
        this.renderIntro(overlay);
        return;
      case 'event':
        this.renderEvent(overlay, state);
        return;
      case 'combat':
        this.renderCombat(overlay, state);
        return;
      case 'dead':
        this.renderEnd(overlay, state, false);
        return;
      case 'won':
        this.renderEnd(overlay, state, true);
        return;
      default:
        overlay.hidden = true;
        overlay.innerHTML = '';
    }
  }

  private renderIntro(overlay: HTMLElement): void {
    const frame = this.introFrames[this.introIndex];
    const last = this.introIndex >= this.introFrames.length - 1;
    overlay.hidden = false;
    const imgSrc = import.meta.env.BASE_URL + frame.image;
    overlay.innerHTML = `
      <div class="intro" style="background: linear-gradient(180deg, ${frame.gradient[0]}, ${frame.gradient[1]})">
        <div class="scene"><img src="${imgSrc}" alt="" draggable="false" /></div>
        <button class="skip" data-act="skip">SKIP ▸</button>
        <div class="caption">
          <p>${frame.text}</p>
          <div class="controls">
            <button class="primary" data-act="next">${last ? 'Begin' : 'Continue'}</button>
          </div>
        </div>
      </div>
    `;
    overlay.querySelector('[data-act="next"]')?.addEventListener('click', () => {
      if (this.introIndex >= this.introFrames.length - 1) {
        this.store.dispatch({ type: 'FINISH_INTRO' });
      } else {
        this.introIndex++;
        this.render();
      }
    });
    overlay.querySelector('[data-act="skip"]')?.addEventListener('click', () => {
      this.store.dispatch({ type: 'FINISH_INTRO' });
    });
  }

  private renderEvent(overlay: HTMLElement, state: RunState): void {
    if (!state.activeEvent) return;
    const def = getEvent(this.store.getDeps().events, state.activeEvent.defId);
    overlay.hidden = false;

    if (state.activeEvent.stage === 'options') {
      let html = `<div class="sheet"><h1>${def.title}</h1><p>${def.text}</p>`;
      def.options.forEach((opt, i) => {
        const req = opt.requires;
        const unmet =
          req !== undefined && ((req.scrap ?? 0) > state.scrap || (req.fuel ?? 0) > state.fuel);
        html += `<button class="primary" data-opt="${i}" ${unmet ? 'disabled' : ''}>${opt.label}${unmet ? '<span class="sub">not enough resources</span>' : ''}</button>`;
      });
      html += '</div>';
      overlay.innerHTML = html;
      overlay.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.store.dispatch({ type: 'RESOLVE_OPTION', optionIndex: Number(btn.dataset.opt) });
        });
      });
    } else {
      overlay.innerHTML = `
        <div class="sheet">
          <h1>${def.title}</h1>
          <p>${state.activeEvent.outcomeText ?? ''}</p>
          <button class="primary" data-act="ack">Continue</button>
        </div>
      `;
      overlay.querySelector('[data-act="ack"]')?.addEventListener('click', () => {
        this.store.dispatch({ type: 'ACK_OUTCOME' });
      });
    }
  }

  private ensureDraft(state: RunState): CombatDraft {
    const c = state.combat!;
    if (!this.combatDraft || this.combatDraft.turn !== c.turn) {
      this.combatDraft = {
        power: { ...c.player.power },
        targets: c.player.weapons.map(() => null),
        turn: c.turn,
      };
    }
    return this.combatDraft;
  }

  private renderCombat(overlay: HTMLElement, state: RunState): void {
    const c = state.combat;
    if (!c) return;
    overlay.hidden = false;
    const weapons = this.store.getDeps().weapons;

    if (c.outcome !== 'ongoing') {
      const verdict: Record<string, string> = {
        won: 'ENEMY DESTROYED',
        fled: 'YOU GOT AWAY',
        surrendered: 'YOU SURRENDERED',
        bribed: 'THEY TOOK THE SCRAP',
        lost: 'HULL BREACH',
      };
      const salvage =
        c.outcome === 'won'
          ? `<p class="dim">Salvage: +${c.salvageScrap} scrap · +${c.salvageFuel} fuel</p>`
          : '';
      overlay.innerHTML = `
        <div class="sheet">
          <h1>${verdict[c.outcome] ?? 'FIGHT OVER'}</h1>
          <p>${c.log[c.log.length - 1] ?? ''}</p>
          ${salvage}
          <button class="primary" data-act="combat-ack">Continue</button>
        </div>`;
      overlay.querySelector('[data-act="combat-ack"]')?.addEventListener('click', () => {
        this.store.dispatch({ type: 'COMBAT_ACK' });
      });
      return;
    }

    const draft = this.ensureDraft(state);
    const pool = reactorOutput(c.player);
    const used = draft.power.engines + draft.power.weapons + draft.power.shields;

    const powerRow = (chan: 'engines' | 'weapons' | 'shields', label: string) => `
      <div class="prow">
        <span>${label}</span>
        <button data-pw="${chan}" data-d="-1">−</button>
        <b>${draft.power[chan]}</b>
        <button data-pw="${chan}" data-d="1">+</button>
      </div>`;

    const weaponRows = c.player.weapons
      .map((slot, i) => {
        const def = weapons.find((w) => w.id === slot.defId) as WeaponDef;
        const ready =
          slot.cooldownLeft === 0 && slot.ammo !== 0 && effLevel(c.player.subsystems.weapons) > 0;
        const ammo = slot.ammo < 0 ? '∞' : String(slot.ammo);
        const cd = slot.cooldownLeft > 0 ? ` · charging` : '';
        const btns = TARGET_CHOICES.map(
          (t) =>
            `<button class="tgt ${draft.targets[i] === t.id ? 'on' : ''}" data-wt="${i}" data-tid="${t.id}" ${ready ? '' : 'disabled'}>${t.short}</button>`,
        ).join('');
        return `
          <div class="wrow ${ready ? '' : 'off'}">
            <div class="wname">${def.name} <span class="dim">${def.type} · ${def.powerCost}⚡ · ${ammo}${cd}</span></div>
            <div class="tgts">${btns}</div>
          </div>`;
      })
      .join('');

    const canBribe = c.acceptsBribe && state.scrap >= c.bribeCost;
    overlay.innerHTML = `
      <div class="sheet combat">
        <h1>Knife Fight — turn ${c.turn}</h1>
        ${this.shipStatus(c.enemy, c.enemy.name, false)}
        <div class="clog">${c.log.map((l) => `<div>${l}</div>`).join('')}</div>
        ${this.shipStatus(c.player, 'Your ship', true)}
        <div class="power">
          <div class="ptitle">POWER <span class="${used > pool ? 'warn' : 'dim'}">${used}/${pool}</span></div>
          ${powerRow('weapons', 'Weapons')}
          ${powerRow('shields', 'Shields')}
          ${powerRow('engines', 'Engines')}
        </div>
        <div class="weapons">${weaponRows}</div>
        <div class="cacts">
          <button class="primary" data-act="fire">Fire</button>
          <button data-act="flee">Flee (${c.player.fleeCharge}/${c.fleeThreshold})</button>
          ${c.acceptsSurrender ? '<button data-act="surrender">Surrender</button>' : ''}
          ${c.acceptsBribe ? `<button data-act="bribe" ${canBribe ? '' : 'disabled'}>Bribe (${c.bribeCost} scrap)</button>` : ''}
        </div>
      </div>`;

    overlay.querySelectorAll<HTMLButtonElement>('[data-pw]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chan = btn.dataset.pw as 'engines' | 'weapons' | 'shields';
        const delta = Number(btn.dataset.d);
        const trial = { ...draft.power, [chan]: draft.power[chan] + delta };
        draft.power = clampPower(c.player, trial);
        this.render();
      });
    });
    overlay.querySelectorAll<HTMLButtonElement>('[data-wt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.wt);
        const tid = btn.dataset.tid as TargetId;
        draft.targets[i] = draft.targets[i] === tid ? null : tid;
        this.render();
      });
    });
    overlay.querySelector('[data-act="fire"]')?.addEventListener('click', () => {
      this.store.dispatch({
        type: 'COMBAT_ACTION',
        combatAction: { type: 'FIRE', power: draft.power, targets: draft.targets },
      });
    });
    overlay.querySelector('[data-act="flee"]')?.addEventListener('click', () => {
      this.store.dispatch({
        type: 'COMBAT_ACTION',
        combatAction: { type: 'FLEE', power: draft.power },
      });
    });
    overlay.querySelector('[data-act="surrender"]')?.addEventListener('click', () => {
      this.store.dispatch({ type: 'COMBAT_ACTION', combatAction: { type: 'SURRENDER' } });
    });
    overlay.querySelector('[data-act="bribe"]')?.addEventListener('click', () => {
      this.store.dispatch({ type: 'COMBAT_ACTION', combatAction: { type: 'BRIBE' } });
    });
  }

  private shipStatus(ship: CombatShip, label: string, mine: boolean): string {
    const pct = Math.max(0, Math.round((ship.hull / ship.hullMax) * 100));
    const shields =
      '●'.repeat(ship.shieldLayers) +
      '○'.repeat(Math.max(0, effLevel(ship.subsystems.shields) - ship.shieldLayers));
    const disabled = (['weapons', 'engines', 'shields', 'reactor'] as const)
      .filter((id) => ship.subsystems[id].damage > 0)
      .map((id) => id.toUpperCase())
      .join(' ');
    return `
      <div class="shipstat ${mine ? 'mine' : 'foe'}">
        <div class="sname">${label}</div>
        <div class="hbar"><div class="hfill" style="width:${pct}%"></div><span>HULL ${ship.hull}/${ship.hullMax}</span></div>
        <div class="dim">shields ${shields || '—'}${disabled ? ` · offline: ${disabled}` : ''}</div>
      </div>`;
  }

  /** Ship line on the map panel: hull + repair buttons for combat damage (§5). */
  private repairSection(state: RunState): string {
    const ship = state.ship;
    const damaged = (['reactor', 'engines', 'weapons', 'shields', 'sensors'] as const).filter(
      (id) => ship.subsystems[id].damage > 0,
    );
    const hurt = ship.hull < ship.hullMax || damaged.length > 0;
    let html = `<div class="shipline">SHIP · HULL ${ship.hull}/${ship.hullMax}${
      damaged.length
        ? ` · <span class="warn">${damaged.map((d) => d.toUpperCase()).join(' ')}</span>`
        : ''
    }</div>`;
    if (!hurt) return html;
    if (state.scrap <= 0) {
      html += '<p class="hint">Repairs need scrap. You have none.</p>';
      return html;
    }
    if (ship.hull < ship.hullMax) {
      html += `<button data-repair="hull">Patch hull<span class="sub">1 scrap → +${this.store.getDeps().config.repair.hullPerScrap} hull</span></button>`;
    }
    for (const id of damaged) {
      html += `<button data-repair="${id}">Repair ${id}<span class="sub">1 scrap → −${this.store.getDeps().config.repair.subsystemDamagePerScrap} damage</span></button>`;
    }
    return html;
  }

  private renderEnd(overlay: HTMLElement, state: RunState, won: boolean): void {
    overlay.hidden = false;
    const cause = {
      wake: 'They were always going to find the trail. The sky fills with hulls the color of ash — and this time there is nowhere to run.',
      adrift:
        'Five days. You rationed the water, banked the reactor, watched the sky. Nobody came — nobody friendly, anyway. The ship becomes one more cold hulk drifting between stars, waiting for a salvage crew that will wonder, briefly, who you were.',
      robbed:
        'They wanted the ship more than you could afford to keep it. The boarding party works methodically through the corridors, and the last light aboard is the glow of their cutting torches.',
      destroyed:
        'The hull comes apart around you in the cold and the quiet. Somewhere, a debris field spreads where a ship used to be — and the map you carried scatters with it.',
    }[state.deathCause ?? 'adrift'];
    const title = won ? 'SECTOR 3 — THE ROAD GOES ON' : 'THE JOURNEY ENDS';
    const body = won
      ? `The gate spits you into a sky measurably closer to the Pillar — its light now throws shadows. The data-core hums, resolving the next leg of a road ten thousand years cold.\n\n(End of the M1 build. The journey continues in M2.)`
      : `${cause}\n\nThe captain's story ends here. With no crew aboard, there is no one to carry the journey on (§6.4) — begin again.`;
    overlay.innerHTML = `
      <div class="sheet">
        <h1>${title}</h1>
        <p>${body}</p>
        <p class="dim">jumps: ${state.stats.jumps} · events: ${state.stats.eventsResolved} · seed: ${state.seed}</p>
        <button class="primary" data-act="again">Begin Again</button>
      </div>
    `;
    overlay.querySelector('[data-act="again"]')?.addEventListener('click', () => {
      this.introIndex = 0;
      this.newRun();
    });
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** Trim trailing zeros: 10 → "10", 9.75 → "9.75", 3.2 → "3.2". */
function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}
