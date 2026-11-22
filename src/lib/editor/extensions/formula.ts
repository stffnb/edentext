import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { atomAttrTr } from './image';
import { cmToPx } from '../../storage/pageMargins';
import { parseLatex } from '../../math/latex';
import { mathmlDocument } from '../../math/mathml';

// Inline atom for a mathematical formula. It stores only the LaTeX source; the MathML
// the browser typesets, the ODF formula object and the DOCX OMML are all derived from
// it. See docs/architecture/formulas.md.

// Event the toolbar listens for to open the formula dialog on an existing formula
// (double-click); the extension can't reach Svelte state directly.
export const EDIT_FORMULA_EVENT = 'odf-edit-formula';

export interface FormulaAttrs {
  latex: string;
  /** Display formula: its own line, at its paragraph's alignment, as Word's m:oMathPara. */
  display: boolean;
  /** The box a file stores for the formula, in cm, and how far its bottom hangs below
   *  the baseline (null: centred on the character area). Gone once the source changes. */
  width?: number | null;
  height?: number | null;
  drop?: number | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formula: {
      insertFormula: (attrs: FormulaAttrs) => ReturnType;
      updateFormula: (pos: number, attrs: FormulaAttrs) => ReturnType;
    };
  }
}

// The <math> markup for a formula, built from our own AST — never from foreign XML,
// so setting it as innerHTML can't smuggle in scripted annotation-xml.
export function formulaMathml(latex: string, display: boolean): string {
  return mathmlDocument(parseLatex(latex), display);
}

export const Formula = Node.create({
  name: 'formula',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-formula') ?? '',
        renderHTML: (attrs) => ({ 'data-formula': attrs.latex }),
      },
      display: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-display') === 'true',
        renderHTML: (attrs) => ({ 'data-display': attrs.display ? 'true' : 'false' }),
      },
      ...Object.fromEntries((['width', 'height', 'drop'] as const).map((name) => [name, {
        default: null,
        parseHTML: (el: HTMLElement) => { const v = parseFloat(el.getAttribute(`data-box-${name}`) ?? ''); return Number.isFinite(v) ? v : null; },
        renderHTML: (attrs: Record<string, unknown>) => (attrs[name] == null ? {} : { [`data-box-${name}`]: String(attrs[name]) }),
      }])),
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-formula]' }];
  },

  // The HTML face carries the source, so copy/paste between documents round-trips.
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'formula' }), node.attrs.latex as string];
  },

  renderText({ node }) {
    return node.attrs.latex as string;
  },

  addCommands() {
    return {
      insertFormula: (attrs) => ({ commands, state, tr }) => {
        // A display formula opening an empty paragraph centers it, as both word processors do.
        const { $from, empty } = state.selection;
        const lone = attrs.display && empty && $from.parent.content.size === 0 && 'textAlign' in $from.parent.attrs;
        // Adopt the cursor's marks so the formula sits in the run's font, as the
        // date/time field does.
        const marks = (state.storedMarks ?? state.selection.$to.marks())
          .map((m) => ({ type: m.type.name, attrs: m.attrs }));
        return commands.insertContent({
          type: this.name,
          attrs,
          ...(marks.length ? { marks } : {}),
        }) && (!lone || !!tr.setNodeAttribute(tr.selection.$from.before(), 'textAlign', 'center'));
      },
      updateFormula: (pos, attrs) => ({ state, dispatch }) => {
        const node = state.doc.nodeAt(pos);
        if (!node || node.type.name !== this.name) return false;
        if (!dispatch) return true;
        // The stored box is the old source's: a changed formula is typeset at its own size.
        const box = attrs.latex === node.attrs.latex ? {} : { width: null, height: null, drop: null };
        const tr = atomAttrTr(state, pos, { ...node.attrs, ...box, ...attrs }, node.marks);
        const $pos = state.doc.resolve(pos);
        if (attrs.display && !node.attrs.display && $pos.depth > 0 && $pos.parent.childCount === 1 && 'textAlign' in $pos.parent.attrs) {
          tr.setNodeAttribute($pos.before(), 'textAlign', 'center');
        }
        dispatch(tr);
        return true;
      },
    };
  },

  addNodeView() {
    return ({ node, getPos }) => new FormulaView(node as PMNode, getPos as () => number);
  },
});

// Node view: the typeset <math>. Double-click reopens the dialog on this formula.
class FormulaView {
  dom: HTMLElement;
  private node: PMNode;

  constructor(node: PMNode, getPos: () => number) {
    this.node = node;
    this.dom = document.createElement('span');
    this.dom.className = 'formula';
    this.dom.setAttribute('data-formula', (node.attrs.latex as string) ?? '');
    if (node.attrs.display) this.dom.setAttribute('data-display', 'true');
    this.render();
    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent(EDIT_FORMULA_EVENT, {
        detail: { pos: getPos(), latex: this.node.attrs.latex, display: this.node.attrs.display },
      }));
    });
  }

  private render() {
    this.dom.innerHTML = formulaMathml(this.node.attrs.latex as string, !!this.node.attrs.display);
    // A stored box sets the line as the file's own layout did; the formula is centred in it.
    const { width, height, drop } = this.node.attrs as FormulaAttrs;
    const sized = !!width && !!height;
    this.dom.classList.toggle('formula-sized', sized);
    this.dom.classList.toggle('formula-mid', sized && drop == null);
    if (!sized) { this.dom.removeAttribute('style'); return; }
    // Centred on the character area the box only adds what it is taller than the line
    // (editor.css); with a drop its bottom hangs that far below the baseline.
    this.dom.style.cssText = `width:${cmToPx(width!)}px;` + (drop == null ? `--fh:${cmToPx(height!)}px`
      : `height:${cmToPx(height!)}px;vertical-align:${-cmToPx(drop)}px`);
  }

  update(node: PMNode) {
    if (node.type.name !== 'formula') return false;
    if ((['latex', 'display', 'width', 'height', 'drop'] as const).some((k) => node.attrs[k] !== this.node.attrs[k])) {
      this.node = node;
      this.dom.setAttribute('data-formula', (node.attrs.latex as string) ?? '');
      if (node.attrs.display) this.dom.setAttribute('data-display', 'true');
      else this.dom.removeAttribute('data-display');
      this.render();
    }
    this.node = node;
    return true;
  }

  selectNode() { this.dom.classList.add('selected'); }
  deselectNode() { this.dom.classList.remove('selected'); }
  stopEvent() { return false; }
  ignoreMutation() { return true; }
}
