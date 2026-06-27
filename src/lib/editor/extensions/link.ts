import LinkBase from '@tiptap/extension-link';

// Event the toolbar listens for to open the link dialog (Ctrl/Cmd+K). The extension
// can't reach Svelte state directly, so it dispatches this on window instead.
export const OPEN_LINK_DIALOG_EVENT = 'odf-open-link-dialog';

// Hyperlink mark. Round-trips to ODF <text:a xlink:href> (odf-kit's native run path
// and export/odt.ts applyRuns; import/odt.ts convertInline). openOnClick is off so a
// click just places the cursor — Ctrl/Cmd+click opens the URL (Editor.svelte).
export const Link = LinkBase.configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: 'https',
  HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
}).extend({
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        window.dispatchEvent(new CustomEvent(OPEN_LINK_DIALOG_EVENT));
        return true;
      },
    };
  },
});
