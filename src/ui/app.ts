/**
 * DOM + canvas orchestration. Deliberately dumb: reads RunState, renders,
 * dispatches actions. All game logic lives in the reducer; all content lives
 * in /data. Text-heavy surfaces are DOM (thumb-sized touch targets); the map
 * is canvas.
 */

import { clampPower, effLevel, planVolley, reactorOutput } from '../combat/engine';
import type {
  CombatShip,
  CombatState,
  FireStatus,
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
  /** A transient modal layered over the current screen: ship stats or combat help. */
  private modal: 'ship' | 'combat-help' | null = null;
  private shipBtn!: HTMLButtonElement;

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
    // Bottom-left "Ship" button: opens ship stats from the map without combat.
    this.shipBtn = document.createElement('button');
    this.shipBtn.className = 'shipbtn';
    this.shipBtn.textContent = 'Ship';
    this.shipBtn.addEventListener('click', () => {
      this.modal = 'ship';
      this.render();
    });
    must('map-wrap').appendChild(this.shipBtn);
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
    this.renderModal(state);
    this.shipBtn.style.display = state.phase === 'map' && !this.modal ? 'block' : 'none';
  }

  /** A modal (ship stats / combat help) layered over whatever the phase drew. */
  private renderModal(state: RunState): void {
    if (!this.modal) return;
    const { overlay } = this.refs;
    if (this.modal === 'combat-help' && state.phase !== 'combat') {
      this.modal = null;
      return;
    }
    overlay.hidden = false;
    overlay.innerHTML = this.modal === 'ship' ? this.shipStatsSheet(state) : this.combatHelpSheet();
    overlay.querySelector('[data-act="modal-close"]')?.addEventListener('click', () => {
      this.modal = null;
      this.render();
    });
  }

  private shipStatsSheet(state: RunState): string {
    const ship = state.ship;
    const config = this.store.getDeps().config;
    const weapons = this.store.getDeps().weapons;
    const rows = (['reactor', 'engines', 'weapons', 'shields', 'sensors'] as const)
      .map((id) => {
        const sub = ship.subsystems[id];
        const eff = Math.max(0, sub.level - sub.damage);
        const dmg = sub.damage > 0 ? ` <span class="warn">(−${sub.damage} dmg)</span>` : '';
        return `<div class="statrow"><span>${id}</span><b>${eff}/${sub.level}</b>${dmg}</div>`;
      })
      .join('');
    const wlist = ship.weapons
      .map((slot) => {
        const def = weapons.find((w) => w.id === slot.defId) as WeaponDef;
        const ammo = slot.ammo < 0 ? 'unlimited' : `${slot.ammo} rounds`;
        return `<div class="statrow"><span>${def.name}</span><b class="dim">${def.type} · ${def.powerCost}⚡ · ${ammo}</b></div>`;
      })
      .join('');
    return `
      <div class="sheet">
        <h1>${ship.name}</h1>
        <div class="hbar"><div class="hfill" style="width:${Math.round((ship.hull / ship.hullMax) * 100)}%"></div><span>HULL ${ship.hull}/${ship.hullMax}</span></div>
        <p class="dim" style="margin-top:8px">REACTOR POWER POOL: ${reactorOutput(ship)}. In combat you split this across weapons/shields/engines — each channel also can't exceed its subsystem level (shown as allocated/max).</p>
        <h2 style="margin-top:10px">Subsystems <span class="dim">(effective/level)</span></h2>
        ${rows}
        <h2 style="margin-top:10px">Weapons</h2>
        ${wlist}
        <p class="dim">Scrap: ${state.scrap} · repair from the map panel (${config.repair.hullPerScrap} hull / scrap).</p>
        <button class="primary" data-act="modal-close">Close</button>
      </div>`;
  }

  private combatHelpSheet(): string {
    return `
      <div class="sheet">
        <h1>How the fight works</h1>
        <h2>Power</h2>
        <p>Your reactor makes a fixed number of power bars each turn. You divide them between:
        <br>• <b>Weapons</b> — how many/which guns can fire (each gun needs a set amount of power).
        <br>• <b>Shields</b> — rebuilds and sustains your shield layers.
        <br>• <b>Engines</b> — dodge chance, and charges your escape jump.</p>
        <p>Each row shows <b>allocated/max</b>. The <b>max</b> is that system's level — a level-3 weapons bay can hold at most 3 power no matter how big your reactor is. The total across all three can't beat your reactor pool.</p>
        <h2>Weapon lines</h2>
        <p>Each weapon shows its <b>type</b>, its <b>power cost</b> (the ⚡ number), and <b>ammo</b> (∞ = unlimited). Pick a target part of the enemy ship (Hull to kill it; Weapons/Engines/Shields to cripple it).</p>
        <p class="warn">If a weapon's power cost is more than the power you've put into Weapons, it will NOT fire — its row turns red and the log says so. Give Weapons more power, or don't target that gun this turn.</p>
        <h2>The weapon types</h2>
        <p>• <b>Kinetic</b> — cheap, limited ammo. Shield layers soak it; useless until shields are down.
        <br>• <b>Laser</b> — power-hungry, strips shield layers fast and burns through once they're gone. Your shield-breaker.
        <br>• <b>Missile</b> — ignores shields entirely, but the enemy's point-defense may shoot it down. Limited ammo.
        <br>• <b>Ion</b> — does no hull damage; it disables an enemy subsystem for a while. A setup weapon.</p>
        <button class="primary" data-act="modal-close">Got it</button>
      </div>`;
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

    // allocated/max per channel: max = subsystem effective level; + is also
    // gated by the reactor pool being full (items 4 & 6 visibility).
    const powerRow = (chan: 'engines' | 'weapons' | 'shields', label: string) => {
      const max = effLevel(c.player.subsystems[chan]);
      const cur = draft.power[chan];
      const canInc = cur < max && used < pool;
      return `
      <div class="prow">
        <span>${label}</span>
        <button data-pw="${chan}" data-d="-1" ${cur <= 0 ? 'disabled' : ''}>−</button>
        <b>${cur}/${max}</b>
        <button data-pw="${chan}" data-d="1" ${canInc ? '' : 'disabled'}>+</button>
      </div>`;
    };

    // Same fire plan the engine will use, so the warning matches the outcome.
    const plan: FireStatus[] = planVolley(
      { ...c.player, power: draft.power },
      draft.targets,
      weapons,
    );
    const statusNote: Record<FireStatus, string> = {
      fire: '',
      hold: '',
      underpowered: '⚠ not enough weapon power',
      cooldown: 'recharging',
      'no-ammo': 'out of ammo',
      offline: 'weapons offline',
    };
    const weaponRows = c.player.weapons
      .map((slot, i) => {
        const def = weapons.find((w) => w.id === slot.defId) as WeaponDef;
        const st = plan[i];
        const selectable = st !== 'offline' && st !== 'no-ammo' && st !== 'cooldown';
        const ammo = slot.ammo < 0 ? '∞' : String(slot.ammo);
        const note = statusNote[st] ? ` <span class="warn">· ${statusNote[st]}</span>` : '';
        const rowCls = st === 'underpowered' ? 'warn' : selectable ? '' : 'off';
        const btns = TARGET_CHOICES.map(
          (t) =>
            `<button class="tgt ${draft.targets[i] === t.id ? 'on' : ''}" data-wt="${i}" data-tid="${t.id}" ${selectable ? '' : 'disabled'}>${t.short}</button>`,
        ).join('');
        return `
          <div class="wrow ${rowCls}">
            <div class="wname">${def.name} <span class="dim">${def.type} · ${def.powerCost}⚡ · ammo ${ammo}</span>${note}</div>
            <div class="tgts">${btns}</div>
          </div>`;
      })
      .join('');

    const canBribe = c.acceptsBribe && state.scrap >= c.bribeCost;
    overlay.innerHTML = `
      <div class="sheet combat">
        <div class="chead"><h1>Knife Fight — turn ${c.turn}</h1><button class="explain" data-act="explain">? Explain</button></div>
        ${this.shipStatus(c.enemy, c.enemy.name, false, c.enemyThreat)}
        <div class="clog">${c.log.map((l) => `<div>${l}</div>`).join('')}</div>
        ${this.shipStatus(c.player, 'Your ship', true)}
        <div class="power">
          <div class="ptitle">REACTOR POWER <span class="${used > pool ? 'warn' : 'dim'}">${used}/${pool} used</span> <span class="dim">— each row is allocated/max</span></div>
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

    overlay.querySelector('[data-act="explain"]')?.addEventListener('click', () => {
      this.modal = 'combat-help';
      this.render();
    });

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

  private shipStatus(
    ship: CombatShip,
    label: string,
    mine: boolean,
    threat?: CombatState['enemyThreat'],
  ): string {
    const pct = Math.max(0, Math.round((ship.hull / ship.hullMax) * 100));
    const shields =
      '●'.repeat(ship.shieldLayers) +
      '○'.repeat(Math.max(0, effLevel(ship.subsystems.shields) - ship.shieldLayers));
    const disabled = (['weapons', 'engines', 'shields', 'reactor'] as const)
      .filter((id) => ship.subsystems[id].damage > 0)
      .map((id) => id.toUpperCase())
      .join(' ');
    // Threat band (§7.4): a readable difficulty tag; sensor upgrades sharpen it later.
    const band = threat ? `<span class="threat t-${threat.toLowerCase()}">${threat}</span>` : '';
    return `
      <div class="shipstat ${mine ? 'mine' : 'foe'}">
        <div class="sname">${label} ${band}</div>
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
