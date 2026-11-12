import type { Editor } from '@tiptap/core';
import { embedded } from '../embed/mode';
import { setUserName, userName } from '../storage/userName.svelte';
import { loadRetention } from '../storage/docScope';
import { AUTHOR_COLORS, authorColors } from '../editor/authorColors';
import { relayReady, relayUrl } from './channel';
import { linkKeys } from './key';
import { keepSessionCopy, putOpening, reloadAlone, takeOpening, type Opening } from './leave';
import { bindChat, chatPresence, receiveChat } from './chat.svelte';
import { joinSession, startSession, type Session, type SessionHost, type SessionUser, type SessionView } from './session';
import { cleanName, pickColor, shownName } from './names';
import { bindPresence } from './presence.svelte';
import { bindMentions } from './mentions.svelte';

// The app's one shared session (docs/architecture/collab.md): the starter's document goes
// along as the start file; a tab opened from a link (`#collab=`, `#view=`) joins and keeps no copy.

/** What the session takes from the open document. */
export type SessionApp = {
  editor: () => Editor | null;
  /** The open document as an .odt. */
  snapshot: () => Promise<Uint8Array>;
  /** Opens a start file unasked; `name` is without extension. */
  load: (bytes: Uint8Array, name: string) => Promise<boolean>;
  name: () => string;
  /** Asks a joiner without a name for one; '' joins as a guest. */
  askName: () => Promise<string>;
};

let relay: string | null = $state(null);
let session: Session | null = null;
let view: SessionView | null = $state(null);
let joined = false;
let watching = false;
// What this client tells the others: its name, and a colour nobody here had when it came.
let self: SessionUser = { name: '', color: AUTHOR_COLORS[0], since: 0 };

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

/** The colours this client would like: its recorded changes' colour, then one from its name. */
function preferred(app: SessionApp, name: string): string[] {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const own = name ? authorColors(app.editor()!.state.doc).get(name) : undefined;
  return [...(own ? [own] : []), AUTHOR_COLORS[h % AUTHOR_COLORS.length]];
}

// Two with one colour: whoever came later (by `since`, then by relay id) takes a free one.
// Each decides only for itself from what everyone shows, so nothing else is sent.
function recolor(app: SessionApp, next: SessionView): void {
  if (!session) return;
  const me = session.me;
  const others = [...next.peers.map((p) => ({ ...p, rid: p.peer })), ...next.readers.map((r) => ({ ...r, rid: r.id }))].filter((o) => o.rid !== me);
  if (!others.some((o) => o.color === self.color && (o.since < self.since || (o.since === self.since && o.rid < me)))) return;
  self = { ...self, color: pickColor(preferred(app, self.name), new Set(others.map((o) => o.color))) };
  session.setUser(self);
}

function host(app: SessionApp): SessionHost {
  const name = cleanName(userName());
  self = { name, color: preferred(app, name)[0], since: Date.now() };
  const user = () => ({ name: shownName(self.name, session?.me ?? 0), color: self.color });
  bindChat({ send: (text) => session?.chat(text) ?? false, user, reading: () => !!view?.reading });
  return {
    relay: relay!,
    snapshot: app.snapshot,
    load: app.load,
    name: app.name,
    user: () => self,
    onChange: (next) => {
      // Comments there when the doc first arrives were written before; only later ones can name this user.
      if (next.status === 'live' && view?.status !== 'live' && !watching) { watching = true; bindMentions(app.editor()); }
      view = next; chatPresence(next); recolor(app, next);
    },
    onChat: receiveChat,
  };
}

/** Takes `name` as the user's name (comments, recorded changes too) and tells the others. */
export function renameCollab(name: string): void {
  const clean = cleanName(name);
  setUserName(clean, loadRetention() !== 'none');
  if (!session || clean === self.name) return;
  self = { ...self, name: clean };
  session.setUser(self);
}

/** This client's colour in the session. */
export function collabColor(): string {
  return self.color;
}

/** Starts a session; `name`, when given, becomes the user's name first. */
export async function startCollab(app: SessionApp, name?: string): Promise<void> {
  const editor = app.editor();
  if (!editor || !relay || session) return;
  if (name !== undefined && cleanName(name)) renameCollab(name);
  session = await startSession(editor, host(app));
  bindPresence(session.awareness);
  expose();
}

/** Joins the link's session once (`key` is `collab=…` or `view=…`), as soon as the editor and the relay are there. */
export function joinCollab(app: SessionApp, key: string): void {
  if (!relay || !app.editor() || joined) return;
  joined = true;
  void (userName() ? Promise.resolve('') : app.askName()).then((name) => {
    const editor = app.editor();
    if (!editor) return;
    if (cleanName(name)) renameCollab(name);
    const keys = linkKeys(key);
    if (!keys) view = { status: 'invalid', peers: [], readers: [], link: location.href, viewLink: '', reading: false, keeps: false, kept: true, missing: 0, paused: false, dropped: 0 };
    else bindPresence((session = joinSession(editor, keys, host(app))).awareness);
    expose();
  });
}

/**
 * Ends this tab's part in the session. `choice` is a joiner's: keep its copy as a new
 * document or drop it, then reload alone, into a new document that takes `opening` if
 * given. False when keeping failed and nothing ended; throws when `opening` was not stored.
 */
export async function leaveCollab(app: SessionApp, choice: 'keep' | 'discard' | null, opening: Opening | null = null): Promise<boolean> {
  const editor = app.editor();
  if (choice && opening) await putOpening(opening);
  if (choice === 'keep' && (!editor || !(await keepSessionCopy(editor)))) {
    if (opening) await takeOpening().catch(() => null);
    return false;
  }
  session?.leave();
  session = null;
  view = null;
  bindChat(null);
  bindPresence(null);
  bindMentions(null);
  watching = false;
  if (choice) reloadAlone(!!opening);
  else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return true;
}

function expose(): void {
  // The session test reads the state and the frame counts (tests/collab/session.mjs).
  if (import.meta.env.DEV) (window as unknown as { __collab: unknown }).__collab = { session, view: () => view };
}
