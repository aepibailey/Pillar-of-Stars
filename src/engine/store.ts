/**
 * Minimal observable store around the pure reducer. The UI subscribes; every
 * dispatch auto-saves (save at every decision point, §13).
 */

import { reduce, type Action, type Deps } from './reducer';
import { saveRun } from './save';
import type { RunState } from './types';

export type Listener = (state: RunState) => void;

export class Store {
  private state: RunState;
  private listeners = new Set<Listener>();

  constructor(
    initial: RunState,
    private deps: Deps,
  ) {
    this.state = initial;
  }

  getState(): RunState {
    return this.state;
  }

  getDeps(): Deps {
    return this.deps;
  }

  dispatch(action: Action): void {
    const next = reduce(this.state, action, this.deps);
    if (next === this.state) return;
    this.state = next;
    saveRun(next);
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
