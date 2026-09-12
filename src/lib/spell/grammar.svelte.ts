// Grammar checking through harper.js — a local Rust/WASM prose linter, English only.
// A reactive singleton like storage/printMarkup.svelte.ts: the language picker flips it,
// the grammarCheck extension reads it. Off by default; the binary is 16 MB.

import { hasGrammar, type DocumentLanguage } from '../storage/documentLanguage';

const KEY = 'edentext-grammar-check'; // app-wide, missing key = off

// A finding as plain data: Harper's Lint/Suggestion hold wasm pointers, and a
// decoration spec has to outlive them.
export type GrammarFix = { kind: 'replace' | 'remove' | 'insertAfter'; text: string };
export type GrammarLint = { from: number; to: number; message: string; fixes: GrammarFix[] };

// Hunspell stays the sole spelling authority — otherwise two waves of squiggles and two
// suggestion lists on the same word (Harper offers "Uber" for "Über").
const DROP = new Set(['spelling', 'typo']);

type Linter = { lint(text: string, opts: { language: 'plaintext' }): Promise<unknown[]> };

let enabled = $state(localStorage.getItem(KEY) === 'true');
let loading = $state(false);
let linter: Linter | null = $state.raw(null);
let code: DocumentLanguage = $state('');

const ignored = new Set<string>(); // session-only "Ignore all"
const subs = new Set<() => void>();

function notify(): void {
  for (const cb of subs) cb();
}

let pending: Promise<Linter | null> | null = null;
function load(): Promise<Linter | null> {
  if (!pending) {
    pending = (async () => {
      const [{ LocalLinter }, { binary }] = await Promise.all([import('harper.js'), import('harper.js/binary')]);
      const l = new LocalLinter({ binary });
      await l.setup();
      return l as unknown as Linter;
    })().catch((err) => {
      pending = null; // allow a retry
      console.error('[grammar] failed to load harper.js:', err);
      return null;
    });
  }
  return pending;
}

function ensureLoaded(): void {
  if (linter || loading || !enabled || !hasGrammar(code)) return;
  loading = true;
  void load().then((l) => {
    loading = false;
    linter = l;
    notify();
  });
}

export function grammarEnabled(): boolean {
  return enabled;
}

export function setGrammarEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  if (on) localStorage.setItem(KEY, 'true');
  else localStorage.removeItem(KEY);
  // ponytail: switching off stops the checking but does not free the wasm —
  // its memory never shrinks; only a reload gives it back.
  ensureLoaded();
  notify();
}

export function grammarLoading(): boolean {
  return loading;
}

export function grammarReady(): boolean {
  return enabled && linter !== null && hasGrammar(code);
}

export function setGrammarLanguage(next: DocumentLanguage): void {
  if (next === code) return;
  code = next;
  ensureLoaded();
  notify();
}

export async function lintText(text: string): Promise<GrammarLint[]> {
  if (!grammarReady()) return [];
  // Harper reads its input as markdown unless told otherwise.
  const lints = (await linter!.lint(text, { language: 'plaintext' })) as HarperLint[];
  const out: GrammarLint[] = [];
  for (const lint of lints) {
    try {
      if (DROP.has(lint.lint_kind().toLowerCase())) continue;
      const message = lint.message();
      const problem = lint.get_problem_text();
      if (ignored.has(`${message}\0${problem}`)) continue;
      // Spans are UTF-16 offsets, the same units ProseMirror counts in.
      const span = lint.span();
      out.push({
        from: span.start,
        to: span.end,
        message,
        fixes: lint.suggestions().map(toFix),
      });
    } finally {
      lint.free?.();
    }
  }
  return out;
}

export function ignoreGrammar(message: string, text: string): void {
  ignored.add(`${message}\0${text}`);
  notify();
}

export function subscribeGrammar(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

// The wasm-backed shapes we touch — the only place a Harper object is read.
type HarperSuggestion = { kind(): number; get_replacement_text(): string };
type HarperLint = {
  lint_kind(): string;
  message(): string;
  get_problem_text(): string;
  span(): { start: number; end: number };
  suggestions(): HarperSuggestion[];
  free?(): void;
};

// SuggestionKind: 0 Replace, 1 Remove, 2 InsertAfter.
const FIX_KINDS = ['replace', 'remove', 'insertAfter'] as const;

function toFix(s: HarperSuggestion): GrammarFix {
  return { kind: FIX_KINDS[s.kind()] ?? 'replace', text: s.get_replacement_text() };
}
