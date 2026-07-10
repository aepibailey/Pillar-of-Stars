/**
 * Canvas 2D sector map. Deliberately behind one draw() entry point so a future
 * PixiJS swap (M7 beauty pass) replaces this module, not the game.
 */

import { Rng } from '../engine/rng';
import type { RunState } from '../engine/types';
import type { Sector } from '../galaxy/types';
import { isConsumed } from '../threat/wake';

export interface MapGeometry {
  toPx(x: number, y: number): { x: number; y: number };
  hitTest(px: number, py: number): string | null;
}

const PAD_X = 26;
const PAD_TOP = 44;
const PAD_BOTTOM = 26;
const HIT_RADIUS = 26;

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}

const starCache = new Map<string, Star[]>();

function starsFor(seed: string, sectorIndex: number): Star[] {
  const key = `${seed}::${sectorIndex}`;
  let stars = starCache.get(key);
  if (!stars) {
    const rng = Rng.fromString(seed, `starfield:${sectorIndex}`);
    stars = [];
    for (let i = 0; i < 110; i++) {
      stars.push({
        x: rng.next(),
        y: rng.next(),
        r: rng.range(0.4, 1.4),
        a: rng.range(0.15, 0.7),
      });
    }
    starCache.set(key, stars);
  }
  return stars;
}

export function drawMap(
  canvas: HTMLCanvasElement,
  state: RunState,
  sector: Sector,
  selectedId: string | null,
): MapGeometry {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const toPx = (x: number, y: number) => ({
    x: PAD_X + x * (w - PAD_X * 2),
    y: PAD_TOP + y * (h - PAD_TOP - PAD_BOTTOM),
  });

  // --- background ---
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, w, h);

  for (const s of starsFor(state.seed, state.sectorIndex)) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#cdd6f4';
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // --- the Pillar of Stars: the Core on the horizon, day one (§1, §12.1) ---
  const pillarIntensity = 0.4 + state.sectorIndex * 0.18;
  const pg = ctx.createRadialGradient(w / 2, -h * 0.25, 10, w / 2, -h * 0.25, h * 0.75);
  pg.addColorStop(0, `rgba(255, 226, 170, ${Math.min(0.85, pillarIntensity)})`);
  pg.addColorStop(0.35, `rgba(214, 168, 255, ${Math.min(0.4, pillarIntensity * 0.45)})`);
  pg.addColorStop(1, 'rgba(120, 100, 200, 0)');
  ctx.fillStyle = pg;
  ctx.fillRect(0, 0, w, h * 0.6);
  // dense core stars inside the glow
  const coreRng = Rng.fromString(state.seed, 'pillar-stars');
  ctx.fillStyle = '#fff3d6';
  for (let i = 0; i < 60; i++) {
    const px = w / 2 + (coreRng.next() - 0.5) * w * 0.7 * coreRng.next();
    const py = coreRng.next() * 26;
    ctx.globalAlpha = coreRng.range(0.2, 0.9);
    ctx.fillRect(px, py, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(255, 226, 170, 0.55)';
  ctx.textAlign = 'center';
  ctx.fillText('· THE PILLAR OF STARS ·', w / 2, 14);

  // --- rough waypoint region (§4/§9.3): an AREA, never a pin ---
  const waypointVisible =
    state.flags['mapRecovered'] && !state.decodedSectorIndexes.includes(state.sectorIndex);
  if (waypointVisible) {
    const { cols, rows } = sector.grid;
    const cell = sector.waypointCell;
    const a = toPx(cell.col / cols, cell.row / rows);
    const b = toPx((cell.col + 1) / cols, (cell.row + 1) / rows);
    ctx.fillStyle = 'rgba(255, 191, 71, 0.09)';
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = 'rgba(255, 191, 71, 0.65)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 191, 71, 0.8)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SIGNAL REGION', a.x + 4, a.y + 12);
  }

  // --- jump lanes ---
  const drawn = new Set<string>();
  for (const id of sector.systemIds) {
    const sys = sector.systems[id];
    for (const other of sys.links) {
      const key = id < other ? `${id}|${other}` : `${other}|${id}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const o = sector.systems[other];
      const p1 = toPx(sys.x, sys.y);
      const p2 = toPx(o.x, o.y);
      const dark = isConsumed(state.wake, id) || isConsumed(state.wake, other);
      ctx.strokeStyle = dark ? 'rgba(120, 40, 40, 0.35)' : 'rgba(140, 160, 220, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }

  // --- systems ---
  const here = sector.systems[state.currentSystemId];
  for (const id of sector.systemIds) {
    const sys = sector.systems[id];
    const p = toPx(sys.x, sys.y);
    const consumed = isConsumed(state.wake, id);
    const isCurrent = id === state.currentSystemId;
    const isGate = id === sector.gateSystemId;
    const adjacent = here?.links.includes(id) ?? false;
    const visited = state.visitOrder.includes(id);

    if (consumed) {
      // the Wake, eating your trail
      const rg = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 16);
      rg.addColorStop(0, 'rgba(200, 40, 30, 0.5)');
      rg.addColorStop(1, 'rgba(60, 5, 5, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a0f0f';
    } else if (isGate) {
      ctx.fillStyle = state.decodedSectorIndexes.includes(state.sectorIndex)
        ? '#7ef0a8'
        : '#5a6a8a';
    } else if (visited) {
      ctx.fillStyle = '#9db0d8';
    } else {
      ctx.fillStyle = '#dfe6fa';
    }

    if (isGate) {
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, consumed ? 4.5 : 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (consumed) {
      ctx.strokeStyle = 'rgba(220, 70, 50, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y - 5);
      ctx.lineTo(p.x + 5, p.y + 5);
      ctx.moveTo(p.x + 5, p.y - 5);
      ctx.lineTo(p.x - 5, p.y + 5);
      ctx.stroke();
    }

    if (adjacent && !isCurrent && state.phase === 'map') {
      ctx.strokeStyle = 'rgba(126, 240, 168, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (id === selectedId && !isCurrent) {
      ctx.strokeStyle = '#ffbf47';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (isCurrent) {
      ctx.strokeStyle = '#6fd9ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#6fd9ff';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('YOU', p.x, p.y - 17);
    }

    ctx.fillStyle = consumed ? 'rgba(200,120,110,0.5)' : 'rgba(205, 214, 244, 0.55)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(sys.name, p.x, p.y + 20);
  }

  return {
    toPx,
    hitTest(px: number, py: number): string | null {
      let best: string | null = null;
      let bestD = HIT_RADIUS;
      for (const id of sector.systemIds) {
        const sys = sector.systems[id];
        const p = toPx(sys.x, sys.y);
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      return best;
    },
  };
}
