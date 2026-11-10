import type { Editor } from '@tiptap/core';
import { embedded } from '../embed/mode';
import { userName } from '../storage/userName.svelte';
import { AUTHOR_COLORS, authorColors } from '../editor/authorColors';
import { relayReady, relayUrl } from './channel';
import { keyBytes } from './key';
import { keepSessionCopy, reloadAlone } from './leave';
import { joinSession, startSession, type Session, type SessionHost, type SessionView } from './session';

// The app's one shared session (docs/architecture/collab.md): the starter's document goes
// along as the start file; a tab opened from the link (`#collab=`) joins and keeps no copy.

/** What the session takes from the open document. */
export type SessionApp = {
  editor: () => Editor | null;
  /** The open document as an .odt. */
  snapshot: () => Promise<Uint8Array>;
  /** Opens a start file unasked; `name` is without extension. */
  load: (bytes: Uint8Array, name: string) => Promise<boolean>;
  name: () => string;
  /** Asks for the user's name where none is set; false = declined. */
  named: () => Promise<boolean>;
};

let relay: string | null = $state(null);
let session: Session | null = null;
let view: SessionView | null = $state(null);
let joined = false;

/** Where sessions go; null embedded, without a relay, or until it answered. */
export function collabRelay(): string | null {
  return relay;
}

export function collabView(): SessionView | null {
  return view;
}

/** Asks the relay once whether it is there. */
export function probeRelay(): void {
  if (embedded) return;
  const url = relayUrl();
  void relayReady(url).then((ok) => { if (ok) relay = url; });
}

function host(app: SessionApp): SessionHost {
  return {
    relay: relay!,
    snapshot: app.snapshot,
    load: app.load,
    name: app.name,
    user: () => {
      const name = userName();
      let h = 0;
      for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return { name, color: authorColors(app.editor()!.state.doc).get(name) ?? AUTHOR_COLORS[h % AUTHOR_COLORS.length] };
    },
    onChange: (next) => { view = next; },
  };
}

export async function startCollab(app: SessionApp): Promise<void> {
  const editor = app.editor();
  if (!editor || !relay || session || !(await app.named())) return;
  session = await startSession(editor, host(app));
  expose();
}

/** Joins the link's session once, as soon as the editor and the relay are there. */
export function joinCollab(app: SessionApp, key: string): void {
  if (!relay || !app.editor() || joined) return;
  joined = true;
  void app.named().then((named) => {
    const editor = app.editor();
    if (!named || !editor) return;
    if (!keyBytes(key)) view = { status: 'invalid', peers: [], link: location.href, keeps: false, kept: true, missing: 0, paused: false };
    else session = joinSession(editor, key, host(app));
    expose();
  });
}

/**
 * Ends this tab's part in the session. `choice` is a joiner's: keep its copy as a new
 * document or drop it, then reload alone. False when keeping failed and nothing ended.
 */
export async function leaveCollab(app: SessionApp, choice: 'keep' | 'discard' | null): Promise<boolean> {
  const editor = app.editor();
  if (choice === 'keep' && (!editor || !(await keepSessionCopy(editor)))) return false;
  session?.leave();
  session = null;
  view = null;
  if (choice) reloadAlone();
  else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return true;
}

function expose(): void {
  // The session test reads the state and the frame counts (tests/collab/session.mjs).
  if (import.meta.env.DEV) (window as unknown as { __collab: unknown }).__collab = { session, view: () => view };
}
