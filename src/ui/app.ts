/**
 * DOM + canvas orchestration. Deliberately dumb: reads RunState, renders,
 * dispatches actions. All game logic lives in the reducer; all content lives
 * in /data. Text-heavy surfaces are DOM (thumb-sized touch targets); the map
 * is canvas.
 */

import { getEvent } from '../events/engine';
import { currentSector, jumpCost } from '../engine/reducer';
import type { Store } from '../engine/store';
import type { RunState } from '../engine/types';
import { systemsInCell } from '../galaxy/waypoint';
import { drawMap, type MapGeometry } from '../render/mapRenderer';
import { isConsumed, jumpsBehind } from '../threat/wake';

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
    if (state.phase !== 'map' || !this.geometry) return;
    const rect = this.refs.canvas.getBoundingClientRect();
    const hit = this.geometry.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    this.selectedId = hit === state.currentSystemId ? null : hit;
    this.render();
  }

  // ---------- rendering ----------

  private render(): void {
    const state = this.store.getState();
    this.renderHud(state);
    this.renderMap(state);
    this.renderPanel(state);
    this.renderOverlay(state);
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
      const cost = jumpCost(state, target.id, config);
      const consumed = isConsumed(state.wake, target.id);
      panel.innerHTML = `
        <h2>${target.name}</h2>
        ${consumed ? '<p class="warn">Wake-held space. Transit is a desperate gamble — extra fuel to run dark.</p>' : ''}
        ${
          cost === null
            ? '<p class="hint">Out of jump range — no lane connects from your position.</p>'
            : `<button class="primary" data-act="jump">Jump — ${cost} fuel${state.fuel < cost ? ' (not enough)' : ''}</button>`
        }
        <button data-act="deselect">Back</button>
      `;
      panel.querySelector('[data-act="jump"]')?.addEventListener('click', () => {
        if (cost !== null && state.fuel >= cost) {
          this.store.dispatch({ type: 'JUMP', toSystemId: target.id });
        }
      });
      panel.querySelector('[data-act="deselect"]')?.addEventListener('click', () => {
        this.selectedId = null;
        this.render();
      });
      const btn = panel.querySelector('[data-act="jump"]') as HTMLButtonElement | null;
      if (btn && cost !== null && state.fuel < cost) btn.disabled = true;
      return;
    }

    // Current system view
    const here = sector.systems[state.currentSystemId];
    const isGate = here.id === sector.gateSystemId;
    const decoded = state.decodedSectorIndexes.includes(state.sectorIndex);
    const inRegion = systemsInCell(sector, sector.waypointCell).some((s) => s.id === here.id);

    const exploreCost = config.exploreFuelCost;
    let html = `<h2>${here.name}${isGate ? ' — JUMP GATE' : ''}</h2>`;
    for (const node of here.nodes) {
      const explored = state.exploredNodeIds.includes(node.id);
      const canAfford = state.fuel >= exploreCost;
      html += explored
        ? `<button class="done" disabled>${node.name}<span class="sub">surveyed</span></button>`
        : `<button data-node="${node.id}" ${canAfford ? '' : 'disabled'}>${node.name}<span class="sub">explore · ${fmt(exploreCost)} fuel</span></button>`;
    }
    if (isGate) {
      html += decoded
        ? '<button class="gate" data-act="gate">Enter the Jump Gate<span class="sub">the decoded map leg points through here</span></button>'
        : '<p class="hint warn">Gate locked — the data-core can\'t resolve the exit. Find the Ascended ruin in the marked signal region.</p>';
    }
    if (state.flags['mapRecovered'] && !decoded) {
      html += inRegion
        ? '<p class="hint">You are inside the signal region. The ruin is at one of these systems.</p>'
        : '<p class="hint">The data-core marks a signal region on the map — the ruin is somewhere in that area. Tap a system, then jump.</p>';
    } else {
      html += '<p class="hint">Tap a highlighted system on the map to select a jump.</p>';
    }
    panel.innerHTML = html;

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
        html += `<button class="primary" data-opt="${i}">${opt.label}</button>`;
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

  private renderEnd(overlay: HTMLElement, state: RunState, won: boolean): void {
    overlay.hidden = false;
    const cause = {
      fuel: 'The drive cells run dry between stars. The ship coasts, silent, and the Wake is never in a hurry.',
      wake: 'They were always going to find the trail. The sky fills with hulls the color of ash — and this time there is nowhere to run.',
      stranded: 'No fuel to jump, nothing left to scavenge. The void does not negotiate.',
    }[state.deathCause ?? 'fuel'];
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
