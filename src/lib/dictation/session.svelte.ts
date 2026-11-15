// The app's one dictation session: whether it listens, in which language, and the last
// error, for both chromes' buttons. It writes into whichever editor has the focus at the
// moment a phrase settles, so the dictation follows the caret into a header or a note.

import type { Editor } from '@tiptap/core';
import { dictationEngines, type DictationEngine, type DictationError } from './engine';
import { dictationHostOff, dictationServer, dictationSettings, setDictation } from '../storage/dictation.svelte';

// The installation's or the user's speech server once one is set up, else the browser's recognizers.
const engines = () => dictationEngines(dictationServer());
// The engine of the running session.
let engine: DictationEngine | null = null;

let listening = $state(false);
let error = $state<DictationError | null>(null);
// The language picked at the button for this session, over the one at the caret.
let chosen = $state<string | null>(null);
let active = $state('');
// The engine sending audio away and the language, waiting for the first consent.
let asking = $state<{ engine: DictationEngine; lang: string } | null>(null);

let target: () => Editor | null = () => null;
let docLang: () => string | null = () => null;
let shown: Editor | null = null;
let errorTimer: ReturnType<typeof setTimeout> | undefined;

/** Whether this browser can dictate and the user has not switched it off. */
export function dictationAvailable(): boolean {
  return engines().length > 0 && dictationSettings().enabled && !dictationHostOff();
}

/** Whether this browser or the user's speech server can recognize at all, switched on or not. */
export const dictationSupported = (): boolean => engines().length > 0;

/** `asking` names the speech server's host when the consent is for it, else 'browser';
 *  `installation` says that server is the installation's own. */
export function dictationState(): { listening: boolean; error: DictationError | null; chosen: string | null; lang: string; asking: string | null; installation: boolean } {
  return { listening, error, chosen, lang: active, asking: asking ? asking.engine.host ?? 'browser' : null, installation: !!asking?.engine.installation };
}

// A cloud engine needs the yes once: the browser's service as such, a speech server per host.
const consented = (e: DictationEngine) =>
  e.host ? dictationSettings().serverConsent === e.host : e.where !== 'cloud' || dictationSettings().consent;

/** The recognition language for later sessions; null takes the one at the caret again. */
export function chooseDictationLanguage(tag: string | null): void {
  chosen = tag;
  if (listening) { stopDictation(); void toggleDictation(); }
}

// The language at the caret, as spell checking reads it: the run's, else the paragraph's.
function caretLang(ed: Editor): string | null {
  const at = ed.state.selection.$from;
  const run = (ed.state.storedMarks ?? at.marks()).find((m) => m.type.name === 'textStyle')?.attrs;
  const block = at.parent.attrs;
  return run?.lang || run?.langAsian || block.lang || block.langAsian || null;
}

function showInterim(text: string): void {
  const ed = text ? target() : null;
  if (shown && shown !== ed && !shown.isDestroyed) shown.commands.setDictationInterim('');
  if (ed && !ed.isDestroyed) ed.commands.setDictationInterim(text);
  shown = ed;
}

function insert(text: string, lang: string): void {
  const ed = target();
  if (!ed || ed.isDestroyed) return;
  if (!ed.isEditable) return stopDictation(true);
  ed.commands.insertDictation(text, lang);
}

function fail(code: DictationError): void {
  listening = false;
  showInterim('');
  error = code;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { if (error === code) error = null; }, 8000);
}

// A marker at the caret while an engine without live text works on a phrase.
const WAITING = '…';

function begin(next: DictationEngine, lang: string): void {
  engine = next;
  listening = true;
  active = lang;
  next.start(lang, { interim: showInterim, busy: (on) => showInterim(on ? WAITING : ''), final: (text) => insert(text, lang), error: fail });
}

/** Starts listening, or stops: the first engine that can take the language, a cloud one
 *  only once the user agreed to send the audio away. */
export async function toggleDictation(): Promise<void> {
  if (listening) return stopDictation();
  const ed = target();
  if (!dictationAvailable() || !ed?.isEditable) return;
  const lang = chosen ?? caretLang(ed) ?? docLang() ?? navigator.language;
  error = null;
  for (const next of engines()) {
    if (!(await next.ready(lang))) continue;
    if (!consented(next)) asking = { engine: next, lang };
    else begin(next, lang);
    return;
  }
  fail('language');
}

/** The answer to the consent question; a yes is kept and starts the session. */
export function answerDictationConsent(yes: boolean): void {
  const ask = asking;
  asking = null;
  if (!yes || !ask) return;
  setDictation(ask.engine.host ? { serverConsent: ask.engine.host } : { consent: true });
  begin(ask.engine, ask.lang);
}

/** Ends the session; `discard` drops the words still being heard instead of inserting them. */
export function stopDictation(discard = false): void {
  if (!listening) return;
  listening = false;
  engine?.stop(discard);
  showInterim('');
}

// Focus taken by a field or a dialog outside every editor ends dictation; a ribbon button does not.
function leavesEditors(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement) || el.closest('.ProseMirror')) return false;
  return el.matches('input, textarea, select, [contenteditable="true"]') || !!el.closest('dialog');
}

/** Ties the session to the app: the editor with the focus and the document's language tag. */
export function bindDictation(editor: () => Editor | null, documentLanguage: () => string | null): () => void {
  target = editor;
  docLang = documentLanguage;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && listening) stopDictation(); };
  const onFocus = (e: FocusEvent) => { if (listening && leavesEditors(e.target)) stopDictation(); };
  const onHide = () => { if (document.hidden) stopDictation(); };
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    stopDictation(true);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('visibilitychange', onHide);
  };
}
