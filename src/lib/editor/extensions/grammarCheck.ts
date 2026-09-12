import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { changedRanges, type Range } from './spellCheck';
import { grammarReady, lintText, subscribeGrammar, type GrammarFix, type GrammarLint } from '../../spell/grammar.svelte';
import { isPaginating } from './pageBreaks';

// What the context menu reads off a decoration.
export type GrammarSpec = { message: string; text: string; fixes: GrammarFix[] };
type GrammarState = { set: DecorationSet; dirty: Range[] };

const grammarKey = new PluginKey<GrammarState>('grammarCheck');

const RESULTS_META = 'grammarCheck/results';
const CLEAR_META = 'grammarCheck/clear';
type Results = { block: Range; lints: GrammarLint[] }[];

// Don't grind while the user is typing, and don't hold a tick longer than this.
const QUIET_MS = 400;
const BUDGET_MS = 30;
// Below this a block has no sentence to judge.
const MIN_CHARS = 3;

// A block's text in document offsets: a leaf node is one character wide, so an
// offset into this string is an offset into the document.
function blockText(doc: PmNode, block: Range): string {
  return doc.textBetween(block.from, block.to, undefined, '￼');
}

function applyResults(doc: PmNode, set: DecorationSet, results: Results): DecorationSet {
  const decos: Decoration[] = [];
  let next = set;
  for (const { block, lints } of results) {
    next = next.remove(next.find(block.from, block.to));
    for (const l of lints) {
      const from = block.from + l.from;
      const to = block.from + l.to;
      if (to <= from || to > block.to) continue;
      const spec: GrammarSpec = { message: l.message, text: doc.textBetween(from, to, undefined, '￼'), fixes: l.fixes };
      decos.push(Decoration.inline(from, to, { class: 'pm-grammar-error' }, spec));
    }
  }
  return decos.length ? next.add(doc, decos) : next;
}

// The grammar finding covering `pos`, if any — used by the context menu.
export function grammarErrorAt(state: EditorState, pos: number): (Range & GrammarSpec) | null {
  const found = grammarKey.getState(state)?.set.find(pos, pos);
  if (!found?.length) return null;
  const d = found[0];
  return { from: d.from, to: d.to, ...(d.spec as GrammarSpec) };
}

// The transaction that applies one suggestion, keeping the text's marks.
export function grammarFix(state: EditorState, at: Range, fix: GrammarFix): Transaction {
  const { tr, doc, schema } = state;
  if (fix.kind === 'remove') return tr.delete(at.from, at.to).scrollIntoView();
  const marks = doc.resolve(at.from).marksAcross(doc.resolve(at.to)) ?? doc.resolve(at.from).marks();
  const text = schema.text(fix.text, marks);
  if (fix.kind === 'insertAfter') return tr.insert(at.to, text).scrollIntoView();
  return tr.replaceWith(at.from, at.to, text).scrollIntoView();
}

// Every textblock worth linting, in document order but rotated onto the one holding
// the caret, so the visible page finishes first.
function buildQueue(state: EditorState): Range[] {
  const blocks: Range[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.content.size >= MIN_CHARS) blocks.push({ from: pos + 1, to: pos + node.nodeSize - 1 });
    return false;
  });
  const caret = state.selection.from;
  const i = blocks.findIndex((b) => b.to >= caret);
  return i > 0 ? blocks.slice(i).concat(blocks.slice(0, i)) : blocks;
}

// The blocks the dirty ranges touch, so an edit re-lints only what changed.
function dirtyBlocks(doc: PmNode, dirty: Range[]): Range[] {
  const out = new Map<number, Range>();
  for (const { from, to } of dirty) {
    const $pos = doc.resolve(Math.min(from, doc.content.size));
    if (from === to) {
      if ($pos.parent.isTextblock) out.set($pos.before(), { from: $pos.start(), to: $pos.end() });
      continue;
    }
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      out.set(pos, { from: pos + 1, to: pos + node.nodeSize - 1 });
      return false;
    });
  }
  return [...out.values()];
}

// Same block twice (edited and in document order) — the first wins.
function dedupe(blocks: Range[]): Range[] {
  const seen = new Set<number>();
  return blocks.filter((b) => !seen.has(b.from) && seen.add(b.from));
}

export const GrammarCheck = Extension.create({
  name: 'grammarCheck',

  addProseMirrorPlugins() {
    return [
      new Plugin<GrammarState>({
        key: grammarKey,
        state: {
          init: () => ({ set: DecorationSet.empty, dirty: [] }),
          apply(tr, old, _oldState, newState) {
            if (tr.getMeta(CLEAR_META)) return { set: DecorationSet.empty, dirty: [] };
            let { set, dirty } = old;
            if (tr.docChanged) {
              set = set.map(tr.mapping, tr.doc);
              dirty = dirty
                .map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }))
                .concat(changedRanges(tr));
            }
            const results = tr.getMeta(RESULTS_META) as Results | undefined;
            if (results) return { set: applyResults(newState.doc, set, results), dirty: [] };
            return set === old.set && dirty === old.dirty ? old : { set, dirty };
          },
        },
        props: {
          decorations(state) {
            return grammarKey.getState(state)?.set;
          },
        },
        view(view: EditorView) {
          const whenIdle = typeof requestIdleCallback === 'function'
            ? (cb: () => void) => requestIdleCallback(cb, { timeout: 2000 })
            : (cb: () => void) => setTimeout(cb, 200);

          let queued = false;
          let queue: Range[] = [];
          let queueDoc: PmNode | null = null;
          let swept = false; // a full pass has finished at least once
          let lastEdit = 0;

          const schedule = () => {
            if (queued || view.isDestroyed) return;
            queued = true;
            whenIdle(() => {
              queued = false;
              if (!view.isDestroyed) void pump();
            });
          };

          async function pump(): Promise<void> {
            if (!grammarReady()) {
              queue = [];
              queueDoc = null;
              swept = false;
              if (grammarKey.getState(view.state)?.set.find().length) {
                view.dispatch(view.state.tr.setMeta(CLEAR_META, true));
              }
              return;
            }
            // A pagination pass redraws the view, and a check next to one pays for
            // that redraw too; a recent keystroke means more are coming.
            if (isPaginating(view) || Date.now() - lastEdit < QUIET_MS) return schedule();

            let rebuilt = false;
            if (!queue.length || queueDoc !== view.state.doc) {
              const dirty = grammarKey.getState(view.state)?.dirty ?? [];
              const edited = dirtyBlocks(view.state.doc, dirty);
              // Until one full pass is through, the edited blocks only jump the queue.
              queue = swept ? edited : dedupe(edited.concat(buildQueue(view.state)));
              queueDoc = view.state.doc;
              rebuilt = true;
            }

            const doc = queueDoc;
            const results: Results = [];
            const deadline = Date.now() + BUDGET_MS;
            while (queue.length && Date.now() < deadline) {
              const block = queue.shift()!;
              const lints = await lintText(blockText(doc, block));
              // An in-flight result is never mapped forward: a lint costs 3 ms, so
              // re-linting is cheaper than the bookkeeping and cannot be subtly wrong.
              if (view.isDestroyed) return;
              if (view.state.doc !== doc) {
                queue = [];
                return schedule();
              }
              // Every checked block is reported, so a block that lost its last
              // finding loses its decoration too.
              results.push({ block, lints });
            }
            // The dispatch also clears the dirty ranges the rebuild just consumed.
            if (results.length || rebuilt) view.dispatch(view.state.tr.setMeta(RESULTS_META, results));
            if (queue.length) schedule();
            else swept = true;
          }

          const unsubscribe = subscribeGrammar(() => {
            queue = [];
            queueDoc = null;
            swept = false;
            schedule();
          });
          schedule();

          return {
            update(v, prevState) {
              if (!v.state.doc.eq(prevState.doc)) {
                lastEdit = Date.now();
                schedule();
              }
            },
            destroy() {
              unsubscribe();
            },
          };
        },
      }),
    ];
  },
});
