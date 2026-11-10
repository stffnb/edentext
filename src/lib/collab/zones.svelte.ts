import type { Awareness } from 'y-protocols/awareness';
import type { Peer } from './session';

// In a session one person at a time edits a header or footer zone: whoever opens one puts
// its id (`hf:<section>:<key>`) in the awareness field `zone`, and the others see it held.
// It frees when the zone closes, the person leaves, or their awareness times out.

// Raw state: an effect that claims a zone runs again when a session starts under it.
let shared = $state.raw<Awareness | null>(null);
// Each zone another client holds, by the lowest client id when two claimed it at once.
let held = $state.raw<Record<string, Peer>>({});
let heldSig = '';

/** Follows the session's awareness until the returned function is called. */
export function shareZones(awareness: Awareness): () => void {
  shared = awareness;
  const read = () => {
    const next: Record<string, Peer> = {};
    for (const [id, s] of awareness.getStates()) {
      const zone = s.zone, user = s.user;
      if (id === awareness.clientID || typeof zone !== 'string' || !user) continue;
      if (!next[zone] || id < next[zone].id) next[zone] = { id, name: String(user.name ?? ''), color: String(user.color ?? ''), keeps: s.keeps === true };
    }
    // Carets change the awareness on every move; the zones only now and then.
    const sig = JSON.stringify(next);
    if (sig !== heldSig) { heldSig = sig; held = next; }
  };
  awareness.on('change', read);
  read();
  return () => {
    awareness.off('change', read);
    if (shared === awareness) shared = null;
    heldSig = '';
    held = {};
  };
}

/** Who else has the zone open, outside a session nobody. */
export function zoneHolder(id: string): Peer | null {
  return held[id] ?? null;
}

/** Whether this client gives the zone up: another claimed it too and has the lower id. */
export function yieldsZone(id: string): boolean {
  const h = held[id];
  return !!h && !!shared && h.id < shared.clientID;
}

/** Tells the others which zone this client has open, or none. */
export function claimZone(id: string | null): void {
  if (shared && (shared.getLocalState()?.zone ?? null) !== id) shared.setLocalStateField('zone', id);
}
