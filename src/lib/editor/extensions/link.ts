import LinkBase from '@tiptap/extension-link';
import { DEFAULT_SHORTCUTS } from '../shortcuts';
import { autoCorrect } from '../../storage/autoCorrect.svelte';

// Event the toolbar listens for to open the link dialog (Ctrl/Cmd+K). The extension
// can't reach Svelte state directly, so it dispatches this on window instead.
export const OPEN_LINK_DIALOG_EVENT = 'odf-open-link-dialog';

// Hyperlink mark. Round-trips to ODF <text:a xlink:href> (odf-kit's native run path
// and export/odt.ts applyRuns; import/odt.ts convertInline). openOnClick is off so a
// click just places the cursor — Ctrl/Cmd+click opens the URL (Editor.svelte).
export const Link = LinkBase.configure({
  openOnClick: false,
  autolink: true,
  // LibreOffice's AutoCorrect ▸ URL recognition, switchable in its dialog.
  shouldAutoLink: () => autoCorrect().urls,
  linkOnPaste: true,
  defaultProtocol: 'https',
  HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
}).extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // A link a file gives no look of its own (Word writes the blue as a character
      // style, so a run without one is drawn like the text around it). ODF has no such
      // link: LibreOffice paints every text:a, styled or not — probed.
      plain: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute('data-plain'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.plain ? { 'data-plain': '' } : {}),
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      [DEFAULT_SHORTCUTS.link]: () => {
        window.dispatchEvent(new CustomEvent(OPEN_LINK_DIALOG_EVENT));
        return true;
      },
    };
  },
});
