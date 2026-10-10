// The time and the identifiers that go into records: workspaces and their history, imported
// tables, score runs, selections. In a window, the wall clock and random identifiers. A headless
// run given a time (mavescape run --time, or SOURCE_DATE_EPOCH) fixes the clock for its session:
// every record carries that time, and identifiers count up from the start of the session, so that
// running it again writes the same bytes (requirement M1).

let fixed = null;
let counter = 0;

// Fixes the clock at an ISO 8601 time (Z or an offset); throws when it is not one.
export function fixClock(time) {
  const t = Date.parse(time);
  if (!Number.isFinite(t)) throw new Error(`"${time}" is not a time (give ISO 8601, such as 2026-10-09T12:00:00Z).`);
  fixed = new Date(t).toISOString();
  counter = 0;
}

export const clockFixed = () => fixed !== null;

// Now, as ISO 8601: the fixed time when there is one.
export const now = () => fixed ?? new Date().toISOString();

// A new identifier (letters and digits): random, or with a fixed clock the next of a count.
export function newId() {
  if (fixed) {
    counter += 1;
    return `f${counter.toString(36).padStart(19, '0')}`;
  }
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return random.replace(/-/g, '').slice(0, 20);
}
