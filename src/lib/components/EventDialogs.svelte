<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import LinkDialog from './LinkDialog.svelte';
  import BookmarkDialog from './BookmarkDialog.svelte';
  import CrossRefDialog from './CrossRefDialog.svelte';
  import FormulaDialog from './FormulaDialog.svelte';
  import { OPEN_LINK_DIALOG_EVENT } from '../editor/extensions/link';
  import { OPEN_BOOKMARK_DIALOG_EVENT, bookmarkNames, findBookmark } from '../editor/extensions/bookmark';
  import { OPEN_CROSS_REF_DIALOG_EVENT } from '../editor/extensions/crossReference';
  import { EDIT_FORMULA_EVENT } from '../editor/extensions/formula';

  // The four dialogs the toolbar buttons, Ctrl+K, the context menu and a double-click on
  // a formula all open by event. Mounted once in App.svelte, outside the chrome: a
  // dialog inside a chrome part that is not mounted would hear nothing.
  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  let linkOpen = $state(false);
  let linkUrl = $state('');
  let bookmarkOpen = $state(false);
  let crossRefOpen = $state(false);
  let formulaOpen = $state(false);
  let formulaLatex = $state('');
  let formulaDisplay = $state(false);
  let formulaPos = $state<number | null>(null);

  let hasSelection = $derived(tick >= 0 && !!editor && !editor.state.selection.empty);
  let isLink = $derived(tick >= 0 && !!editor?.isActive('link'));
  let bmNames = $derived(tick >= 0 && editor ? bookmarkNames(editor.state.doc) : []);

  function openLink() {
    if (!editor) return;
    linkUrl = (editor.getAttributes('link').href as string) ?? '';
    linkOpen = true;
  }

  // A bare host or e-mail gets a scheme, as in Word and LibreOffice.
  function normalizeUrl(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    if (/^(https?:|mailto:|tel:|ftp:|#|\/)/i.test(s)) return s;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
    return `https://${s}`;
  }

  function applyLink(raw: string) {
    linkOpen = false;
    if (!editor) return;
    const href = normalizeUrl(raw);
    if (!href) return;
    // With nothing selected outside a link, the URL becomes its own link text.
    if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }

  // Without a selection too: the list is where a bookmark is found, renamed and dropped.
  function openBookmark() {
    if (!editor) return;
    crossRefOpen = false;
    bookmarkOpen = true;
  }

  function openCrossRef() {
    if (!editor) return;
    bookmarkOpen = false;
    crossRefOpen = true;
  }

  // The window stays open on a jump: it is modeless and movable, so the point of the
  // list is to walk the bookmarks without reopening it.
  function goToBookmark(name: string) {
    const found = editor && findBookmark(editor.state.doc, name);
    if (!editor || !found) return;
    editor.chain().focus().setTextSelection({ from: found.from, to: found.to }).scrollIntoView().run();
  }

  function applyFormula(latex: string, display: boolean) {
    if (!editor) return;
    if (formulaPos != null) editor.chain().focus().updateFormula(formulaPos, { latex, display }).run();
    else editor.chain().focus().insertFormula({ latex, display }).run();
    formulaPos = null;
  }

  $effect(() => {
    const onLink = () => openLink();
    const onBm = () => openBookmark();
    const onXr = () => openCrossRef();
    // With a formula's position and source: the double-click on an existing one.
    // Without: a toolbar button, which starts an empty dialog.
    const onFormula = (e: Event) => {
      const d = (e as CustomEvent<{ pos: number; latex: string; display: boolean } | null>).detail;
      formulaPos = d ? d.pos : null;
      formulaLatex = d ? d.latex : '';
      formulaDisplay = d ? d.display : false;
      formulaOpen = true;
    };
    window.addEventListener(OPEN_LINK_DIALOG_EVENT, onLink);
    window.addEventListener(OPEN_BOOKMARK_DIALOG_EVENT, onBm);
    window.addEventListener(OPEN_CROSS_REF_DIALOG_EVENT, onXr);
    window.addEventListener(EDIT_FORMULA_EVENT, onFormula);
    return () => {
      window.removeEventListener(OPEN_LINK_DIALOG_EVENT, onLink);
      window.removeEventListener(OPEN_BOOKMARK_DIALOG_EVENT, onBm);
      window.removeEventListener(OPEN_CROSS_REF_DIALOG_EVENT, onXr);
      window.removeEventListener(EDIT_FORMULA_EVENT, onFormula);
    };
  });
</script>

<LinkDialog open={linkOpen} initialUrl={linkUrl} canRemove={isLink} onApply={applyLink} onRemove={() => { linkOpen = false; editor?.chain().focus().extendMarkRange('link').unsetLink().run(); }} onClose={() => (linkOpen = false)} />
<BookmarkDialog open={bookmarkOpen} names={bmNames} canApply={hasSelection} onApply={(n) => { bookmarkOpen = false; editor?.chain().focus().setBookmark(n).run(); }} onRemove={(n) => editor?.chain().focus().removeBookmark(n).run()} onRename={(from, to) => !!editor?.chain().focus().renameBookmark(from, to).run()} onGoTo={goToBookmark} onClose={() => (bookmarkOpen = false)} />
<CrossRefDialog open={crossRefOpen} {editor} {tick} onClose={() => (crossRefOpen = false)} />
<FormulaDialog bind:open={formulaOpen} initialLatex={formulaLatex} initialDisplay={formulaDisplay} onApply={applyFormula} />
