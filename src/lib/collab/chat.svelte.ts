import type { ChatIn, SessionView } from './session';
import { mentions } from '../ai/tools';
import { userName } from '../storage/userName.svelte';

// The session's chat (docs/architecture/collab.md): messages live only in this tab's memory
// while it is in the session, never in the doc, a file or autosave. The receiver drops a
// text too long and more than RATE messages per sender in RATE_MS; the sender keeps to both.

export const MAX_CHAT = 2000;
const RATE = 5;
const RATE_MS = 10_000;
const KEPT = 200;
// Who is listed in the first moments after going live was already there, not arriving.
const SETTLE_MS = 3000;
// Arrivals without a pause of GROUP_MS make one line; a departure waits GRACE_MS for the
// same name to come back, so a reload or a short break of someone's line says nothing.
const GROUP_MS = 2500;
const GRACE_MS = 8000;
const NEWS_MS = 6000;

/** `who` groups a run of messages by one person: `me`, or the sender's relay id. */
export type ChatLine =
  | { kind: 'message'; key: number; who: string; name: string; color: string; reading: boolean; own: boolean; at: number; text: string; mention?: boolean }
  | { kind: 'presence'; key: number; names: string[]; reading: boolean; came: boolean; at: number };
type Comer = { name: string; reading: boolean; at: number };

/** What the chat needs from the session: sending, and this tab's own name and colour. */
export type ChatLink = { send(text: string): boolean; user(): { name: string; color: string }; reading(): boolean };

let lines = $state<ChatLine[]>([]);
let unread = $state(0);
let mentioned = $state(0);
let open = $state(false);
let link: ChatLink | null = null;
let next = 0;
const recent = new Map<string, number[]>();
let present: Map<string, { name: string; reading: boolean }> | null = null;
let liveAt = 0;
let arriving: Comer[] = [];
let leaving: Comer[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let news = $state<Extract<ChatLine, { kind: 'presence' }>[]>([]);

/** The latest lines saying who came or went, for the status bar while the chat is shut. */
export function presenceNews(): Extract<ChatLine, { kind: 'presence' }>[] { return news; }

export function chatLines(): ChatLine[] { return lines; }
export function chatUnread(): number { return unread; }
/** How many of the unread messages name this user after an `@`. */
export function chatMentions(): number { return mentioned; }
export function chatOpen(): boolean { return open; }

export function setChatOpen(value: boolean): void {
  open = value;
  if (value) unread = mentioned = 0;
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
  unread = mentioned = 0;
  open = false;
  recent.clear();
  present = null;
  liveAt = 0;
  arriving = [];
  leaving = [];
  news = [];
  clearTimeout(flushTimer);
  flushTimer = undefined;
}

// Groups what is due by kind into one line each, and keeps the rest for later.
function flush(): void {
  flushTimer = undefined;
  const now = Date.now();
  // Arrivals wait until none came for GROUP_MS, so a group arriving together is one line.
  const settled = arriving.length && now - Math.max(...arriving.map((c) => c.at)) >= GROUP_MS;
  const due = [...(settled ? arriving : []).map((c) => ({ ...c, came: true })),
    ...leaving.filter((c) => now - c.at >= GRACE_MS).map((c) => ({ ...c, came: false }))];
  if (settled) arriving = [];
  leaving = leaving.filter((c) => now - c.at < GRACE_MS);
  const made: Extract<ChatLine, { kind: 'presence' }>[] = [];
  for (const came of [true, false]) for (const reading of [false, true]) {
    const names = due.filter((c) => c.came === came && c.reading === reading).map((c) => c.name);
    if (names.length) made.push({ kind: 'presence', key: next++, names, reading, came, at: now });
  }
  for (const line of made) add(line);
  if (made.length) {
    news = [...news, ...made].slice(-3);
    const keys = new Set(made.map((n) => n.key));
    setTimeout(() => { news = news.filter((n) => !keys.has(n.key)); }, NEWS_MS);
  }
  const waits = [...(arriving.length ? [Math.max(...arriving.map((c) => c.at)) + GROUP_MS] : []), ...leaving.map((c) => c.at + GRACE_MS)];
  if (waits.length) flushTimer = setTimeout(flush, Math.max(0, Math.min(...waits) - now));
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
  const mention = mentions(m.text, [userName()]);
  add({ kind: 'message', key: next++, who, name: m.name, color: m.color, reading: m.reading, own: false, at: Date.now(), text: m.text, mention });
  if (!open) { unread++; if (mention) mentioned++; }
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
  for (const [id, p] of present) if (!listed.has(id)) leaving.push({ ...p, at: now });
  for (const [id, p] of listed) {
    if (present.has(id)) continue;
    const back = leaving.findIndex((c) => c.name === p.name && c.reading === p.reading);
    if (back >= 0) leaving.splice(back, 1);
    else arriving.push({ ...p, at: now });
  }
  present = listed;
  clearTimeout(flushTimer);
  flush();
}
