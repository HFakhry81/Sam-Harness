/**
 * Phase 9 — undo/redo stack for workflow editor drafts (pure, testable).
 */
export type HistorySnapshot<T> = {
  value: T;
  label?: string;
};

export class WorkflowHistory<T> {
  private past: HistorySnapshot<T>[] = [];
  private present: HistorySnapshot<T> | null = null;
  private future: HistorySnapshot<T>[] = [];
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = Math.max(1, limit);
  }

  /** Seed or replace current without creating undo entry. */
  reset(value: T, label = "reset"): void {
    this.past = [];
    this.future = [];
    this.present = { value: clone(value), label };
  }

  get current(): T | null {
    return this.present ? clone(this.present.value) : null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }

  /** Push a new state (clears redo). No-op if deep-equal to present. */
  push(value: T, label?: string): T {
    if (!this.present) {
      this.reset(value, label || "init");
      return clone(value);
    }
    if (stableStringify(this.present.value) === stableStringify(value)) {
      return clone(this.present.value);
    }
    this.past.push(this.present);
    if (this.past.length > this.limit) {
      this.past.shift();
    }
    this.present = { value: clone(value), label };
    this.future = [];
    return clone(this.present.value);
  }

  undo(): T | null {
    if (!this.canUndo || !this.present) return this.current;
    this.future.unshift(this.present);
    this.present = this.past.pop()!;
    return clone(this.present.value);
  }

  redo(): T | null {
    if (!this.canRedo || !this.present) return this.current;
    this.past.push(this.present);
    this.present = this.future.shift()!;
    return clone(this.present.value);
  }

  /** Status for UI badges. */
  status(): {
    canUndo: boolean;
    canRedo: boolean;
    undoDepth: number;
    redoDepth: number;
    label?: string;
  } {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoDepth: this.undoDepth,
      redoDepth: this.redoDepth,
      label: this.present?.label,
    };
  }
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v);
}
