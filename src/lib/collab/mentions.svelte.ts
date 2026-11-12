import type { Editor } from '@tiptap/core';
import { comments } from '../editor/extensions/comment';
import { mentions } from '../ai/tools';
import { userName } from '../storage/userName.svelte';
import { setShowComments } from '../storage/markup.svelte';
import { selectRange } from '../components/reviewItems';
import { cleanName } from './names';

// `@Name` in a comment (docs/architecture/review.md): the comment keeps it as plain text.
// The one named finds out on their own side, from the comments that arrive while in the
// session: a notice, the card marked until looked at, a count on the status bar.

const CHECK_MS = 400;
const NEWS_MS = 8000;

let bound: Editor | null = null;
let seen = new Set<string>();
let unseen = $state<string[]>([]);
let news = $state<{ key: number; id: string; name: string }[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
let next = 0;

/** The comments that name this user and were not looked at yet. */
export function unseenMentions(): string[] { return unseen; }
export function mentionNews(): { key: number; id: string; name: string }[] { return news; }

function entries(editor: Editor) {
  return comments(editor.state.doc).flatMap((c) => [{ key: `${c.id}#0`, id: c.id, author: c.author, text: c.text },
    ...c.replies.map((r, i) => ({ key: `${c.id}#${i + 1}`, id: c.id, author: r.author, text: r.text }))]);
}

function check(): void {
  timer = undefined;
  const editor = bound;
  if (!editor) return;
  const me = userName();
  for (const e of entries(editor)) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    if (!me || e.author === me || !mentions(e.text, [me])) continue;
    if (!unseen.includes(e.id)) unseen = [...unseen, e.id];
    const item = { key: next++, id: e.id, name: cleanName(e.author) };
    news = [...news, item].slice(-3);
    setTimeout(() => { news = news.filter((n) => n.key !== item.key); }, NEWS_MS);
  }
  const at = editor.state.selection.from;
  const inside = unseen.length ? comments(editor.state.doc).filter((c) => unseen.includes(c.id) && at >= c.from && at <= c.to) : [];
  if (inside.length) unseen = unseen.filter((id) => !inside.some((c) => c.id === id));
}
const soon = () => { timer ??= setTimeout(check, CHECK_MS); };

/** Marks a mention looked at, as opening its card does. */
export function sawMention(id: string): void {
  if (unseen.includes(id)) unseen = unseen.filter((x) => x !== id);
}

/** Opens the comment in the pane and selects it. */
export function goToMention(id: string): void {
  const c = bound && comments(bound.state.doc).find((x) => x.id === id);
  sawMention(id);
  news = news.filter((n) => n.id !== id);
  if (!bound || !c) return;
  setShowComments(true);
  selectRange(bound, c.from, c.to, true, c.id);
}

/** Watches `editor`'s comments from now on (what is there already counts as seen), or stops. */
export function bindMentions(editor: Editor | null): void {
  bound?.off('update', soon);
  bound?.off('selectionUpdate', soon);
  clearTimeout(timer);
  timer = undefined;
  bound = editor;
  unseen = [];
  news = [];
  seen = new Set(editor ? entries(editor).map((e) => e.key) : []);
  editor?.on('update', soon);
  editor?.on('selectionUpdate', soon);
}
