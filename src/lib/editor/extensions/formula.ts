import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
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
  /** Display formula: its own centered line, as Word's m:oMathPara. */
  display: boolean;
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
      insertFormula: (attrs) => ({ commands, state }) => {
        // Adopt the cursor's marks so the formula sits in the run's font, as the
        // date/time field does.
        const marks = (state.storedMarks ?? state.selection.$to.marks())
          .map((m) => ({ type: m.type.name, attrs: m.attrs }));
        return commands.insertContent({
          type: this.name,
          attrs,
          ...(marks.length ? { marks } : {}),
        });
      },
      updateFormula: (pos, attrs) => ({ state, dispatch }) => {
        const node = state.doc.nodeAt(pos);
        if (!node || node.type.name !== this.name) return false;
        if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }, node.marks));
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
  }

  update(node: PMNode) {
    if (node.type.name !== 'formula') return false;
    if (node.attrs.latex !== this.node.attrs.latex || node.attrs.display !== this.node.attrs.display) {
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
