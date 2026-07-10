# PILLAR OF STARS

_A long-form space opera RPG on a roguelite spine._

You are a survivor. The **Wake** — a militant crusader civilization — burned your
homeworld and scattered your people across an uncharted arm of the galaxy. Following
a broken star-map recovered from the ruins of the vanished **Ascended**, you cross the
arm one hard-won jump at a time, recruiting a crew, fighting orbital duels and blaster
standoffs, and piecing together a mystery that points toward the galactic core: the
**Pillar of Stars**.

This is one long journey, not a string of short runs. You pour hours into a single
captain — a real protagonist — as the Wake burns the road behind you.

## Status

Early development. Currently building **Milestone 1 — Skeleton (prove the loop):**
galaxy generation, jump map, fuel, the advancing Wake, placeholder events, and the
framing-forward stubs (cinematic opening, inciting map-recovery event, rough-waypoint
navigation).

## Documents

- [`docs/pillar-of-stars-design-doc.md`](docs/pillar-of-stars-design-doc.md) — the design document (v0.6). Source of truth.
- [`docs/pillar-of-stars-project-log.md`](docs/pillar-of-stars-project-log.md) — project log & supplementary context.
- [`DEVLOG.md`](DEVLOG.md) — running record of technical decisions (added during scaffolding).

## Tech

TypeScript + HTML5 Canvas, Vite build. Mobile-first (portrait, 390×844). No backend;
all state local. Seeded RNG, data-driven content, deterministic logic with unit tests.
