import type { ChatIn, SessionView } from './session';

// The session's chat (docs/architecture/collab.md): messages live only in this tab's memory
// while it is in the session, never in the doc, a file or autosave. The receiver drops a
// text too long and more than RATE messages per sender in RATE_MS; the sender keeps to both.

export const MAX_CHAT = 2000;
const RATE = 5;
const RATE_MS = 10_000;
const KEPT = 200;
// Who is listed in the first moments after going live was already there, not arriving.
const SETTLE_MS = 3000;

/** `who` groups a run of messages by one person: `me`, or the sender's relay id. */
export type ChatLine =
  | { kind: 'message'; key: number; who: string; name: string; color: string; reading: boolean; own: boolean; at: number; text: string }
  | { kind: 'presence'; key: number; name: string; reading: boolean; came: boolean; at: number };

/** What the chat needs from the session: sending, and this tab's own name and colour. */
export type ChatLink = { send(text: string): boolean; user(): { name: string; color: string }; reading(): boolean };

let lines = $state<ChatLine[]>([]);
let unread = $state(0);
let open = $state(false);
let link: ChatLink | null = null;
let next = 0;
const recent = new Map<string, number[]>();
let present: Map<string, { name: string; reading: boolean }> | null = null;
let liveAt = 0;

export function chatLines(): ChatLine[] { return lines; }
export function chatUnread(): number { return unread; }
export function chatOpen(): boolean { return open; }

export function setChatOpen(value: boolean): void {
  open = value;
  if (value) unread = 0;
}

/** Whether `who` may send another message now, noting it if so. */
function admit(who: string, now: number): boolean {
  const times = (recent.get(who) ?? []).filter((t) => now - t < RATE_MS);
  if (times.length >= RATE) { recent.set(who, times); return false; }
  recent.set(who, [...times, now]);
  return true;
}

function add(line: ChatLine): void {
  lines = [...lines, line].slice(-KEPT);
}

/** Starts an empty chat for a session (or ends it with null). */
export function bindChat(to: ChatLink | null): void {
  link = to;
  lines = [];
  unread = 0;
  open = false;
  recent.clear();
  present = null;
  liveAt = 0;
}

export type SendResult = 'sent' | 'offline' | 'busy' | 'empty';

/** Sends `text`, cut at MAX_CHAT, and shows it at once; nothing is kept for later. */
export function sendChat(text: string): SendResult {
  const body = text.slice(0, MAX_CHAT);
  if (!body.trim()) return 'empty';
  if (!link) return 'offline';
  const now = Date.now();
  const times = (recent.get('me') ?? []).filter((t) => now - t < RATE_MS);
  if (times.length >= RATE) return 'busy';
  if (!link.send(body)) return 'offline';
  admit('me', now);
  const me = link.user();
  add({ kind: 'message', key: next++, who: 'me', name: me.name, color: me.color, reading: link.reading(), own: true, at: now, text: body });
  return 'sent';
}

/** A message the session passed on, kept unless it breaks a limit. */
export function receiveChat(m: ChatIn): void {
  const who = String(m.from);
  if (!link || m.text.length > MAX_CHAT || !m.text.trim() || !admit(who, Date.now())) return;
  add({ kind: 'message', key: next++, who, name: m.name, color: m.color, reading: m.reading, own: false, at: Date.now(), text: m.text });
  if (!open) unread++;
}

/** Turns changes in the lists of writers and readers into lines saying who came or left. */
export function chatPresence(view: SessionView): void {
  if (!link || view.status !== 'live') return;
  const now = Date.now();
  const listed = new Map<string, { name: string; reading: boolean }>([
    ...view.peers.map((p) => [`w${p.id}`, { name: p.name, reading: false }] as const),
    ...view.readers.map((p) => [`r${p.id}`, { name: p.name, reading: true }] as const),
  ]);
  if (!present || now - liveAt < SETTLE_MS) {
    if (!present) liveAt = now;
    present = listed;
    return;
  }
  for (const [id, p] of listed) if (!present.has(id)) add({ kind: 'presence', key: next++, name: p.name, reading: p.reading, came: true, at: now });
  for (const [id, p] of present) if (!listed.has(id)) add({ kind: 'presence', key: next++, name: p.name, reading: p.reading, came: false, at: now });
  present = listed;
}
