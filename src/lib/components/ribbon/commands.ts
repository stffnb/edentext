import en, { type Messages } from '../../i18n/locales/en';
import { PAGE_FORMAT_CM, type NamedPageFormat } from '../../storage/pageFormat';

export const TABS = ['home', 'insert', 'layout', 'references', 'review', 'view'] as const;
export const CONTEXTUAL = ['tableDesign', 'tableLayout', 'pictureFormat', 'shapeFormat', 'headerFooter'] as const;
export type Tab = (typeof TABS)[number] | (typeof CONTEXTUAL)[number];

export const OPEN_COMMAND_SEARCH_EVENT = 'odf-open-command-search';

// The search box's index. A hit switches to the first of its tabs that is shown (null: the
// File menu), clicks `via` to open a menu if it has one, then the control marked
// `data-cmd="<id>"`, so the control stays the one source of what the command does.
// Ids a loop renders are `<prefix>-<key>`.
export type RibbonCommand = { id: string; tab: Tab | Tab[] | null; label: (m: Messages) => string; via?: string };

const c = (tab: Tab | Tab[] | null, id: string, label: (m: Messages) => string, via?: string): RibbonCommand => ({ id, tab, label, via });
const FRAME: Tab[] = ['pictureFormat', 'shapeFormat'];
const CASES = ['none', 'upper', 'lower', 'capitalize', 'smallCaps'] as const;
const CASE_MODE = { none: 'none', upper: 'uppercase', lower: 'lowercase', capitalize: 'capitalize', smallCaps: 'smallCaps' } as const;
const WRAPS = [['inline', 'wrapInline'], ['left', 'wrapLeft'], ['right', 'wrapRight'], ['topBottom', 'wrapTopBottom'], ['behind', 'wrapBehind'], ['front', 'wrapFront']] as const;
const ORDERS = [['forward', 'orderForward'], ['backward', 'orderBackward'], ['front', 'orderFront'], ['back', 'orderBack']] as const;
const INDEX_KINDS = ['toc', 'figures', 'tables', 'alphabetical', 'bibliography'] as const;

export const RIBBON_COMMANDS: RibbonCommand[] = [
  c(null, 'newDocument', (m) => m.app.newDocument),
  c(null, 'newFromTemplate', (m) => m.templates.title),
  c(null, 'open', (m) => m.app.open),
  c(null, 'browserDocuments', (m) => m.browserDocs.title),
  c(null, 'save', (m) => m.app.save),
  c(null, 'saveAsOdt', (m) => `${m.ribbon.saveAs} (.odt)`),
  c(null, 'saveAsDocx', (m) => `${m.ribbon.saveAs} (.docx)`),
  c(null, 'rasterPdf', (m) => m.app.rasterPdf),
  c(null, 'vectorPdf', (m) => m.app.vectorPdf),
  c(null, 'saveTemplate', (m) => m.app.template),
  c(null, 'print', (m) => m.app.print),
  c(null, 'protect', (m) => m.password.menu),
  c(null, 'docProperties', (m) => m.docProps.title),
  c(null, 'about', (m) => m.about.label),

  c('home', 'paste', (m) => m.contextMenu.paste),
  c('home', 'cut', (m) => m.contextMenu.cut),
  c('home', 'copy', (m) => m.contextMenu.copy),
  c('home', 'growFont', (m) => m.toolbarExpanded.growFont),
  c('home', 'shrinkFont', (m) => m.toolbarExpanded.shrinkFont),
  c('home', 'pastePlain', (m) => m.contextMenu.pasteWithoutFormatting, 'paste'),
  c('home', 'fontFamily', (m) => m.toolbarExpanded.fontName),
  c('home', 'fontSize', (m) => m.toolbarExpanded.fontSize),
  c('home', 'changeCase', (m) => m.ribbon.case.title),
  ...CASES.map((k) => c('home', `case-${CASE_MODE[k]}`, (m) => m.ribbon.case[k], 'changeCase')),
  c('home', 'bold', (m) => m.toolbar.bold),
  c('home', 'italic', (m) => m.toolbar.italic),
  c('home', 'underline', (m) => m.toolbar.underline),
  c('home', 'strike', (m) => m.toolbar.strikethrough),
  c('home', 'subscript', (m) => m.toolbarExpanded.subscript),
  c('home', 'superscript', (m) => m.toolbarExpanded.superscript),
  c('home', 'emphasis', (m) => m.ribbon.emphasis.title),
  c('home', 'highlight', (m) => m.toolbarExpanded.highlightColor),
  c('home', 'fontColor', (m) => m.toolbarExpanded.fontColor),
  c('home', 'clearFormatting', (m) => m.toolbarExpanded.clearFormatting),
  c('home', 'bulletList', (m) => m.toolbar.bulletList),
  c('home', 'orderedList', (m) => m.toolbar.orderedList),
  c('home', 'indentLess', (m) => m.toolbarExpanded.decreaseIndent),
  c('home', 'indentMore', (m) => m.toolbarExpanded.increaseIndent),
  c('home', 'formattingMarks', (m) => m.toolbarExpanded.formattingMarks),
  c('home', 'lineSpacing', (m) => m.toolbarExpanded.lineSpacing),
  ...(['left', 'center', 'right', 'justify'] as const).map((a) => c('home', `align-${a}`, (m) => m.align.alignTo(m.align[a]))),
  c('home', 'paragraphShading', (m) => m.toolbarExpanded.paragraphShading),
  c('home', 'paragraphBorders', (m) => m.toolbarExpanded.paragraphBorders),
  c('home', 'find', (m) => m.ribbon.find),
  c('home', 'replace', (m) => m.ribbon.replace),
  c('home', 'aiPane', (m) => m.ai.name),

  c('insert', 'pageBreak', (m) => m.ribbon.pageBreak),
  c('insert', 'table', (m) => m.ribbon.table),
  c('insert', 'picture', (m) => m.ribbon.picture),
  c('insert', 'textBox', (m) => m.ribbon.textBox),
  c('insert', 'link', (m) => m.ribbon.link),
  c('insert', 'bookmark', (m) => m.ribbon.bookmark),
  c('insert', 'crossRef', (m) => m.ribbon.crossRef),
  c('insert', 'header', (m) => m.ribbon.header),
  c('insert', 'footer', (m) => m.ribbon.footer),
  c('insert', 'pageNumber', (m) => m.ribbon.pageNumber),
  c('insert', 'hfOptions', (m) => m.ribbon.hfOptions),
  c('insert', 'autoText', (m) => m.autoText.title),
  c('insert', 'ruby', (m) => m.ruby.title),
  c('insert', 'dateTime', (m) => m.ribbon.dateTime),
  c('insert', 'symbol', (m) => m.ribbon.symbol),
  c('insert', 'equation', (m) => m.ribbon.equation),

  c('layout', 'margins', (m) => m.ribbon.margins),
  ...(['normal', 'narrow', 'wide'] as const).map((k) => c('layout', `margins-${k}`, (m) => m.ribbon.marginPresets[k], 'margins')),
  c('layout', 'orientation', (m) => m.toolbarExpanded.orientation),
  ...(['portrait', 'landscape'] as const).map((o) => c('layout', `orientation-${o}`, (m) => m.toolbarExpanded[o], 'orientation')),
  c('layout', 'pageSize', (m) => m.ribbon.size),
  ...(Object.keys(PAGE_FORMAT_CM) as NamedPageFormat[]).map((f) => c('layout', `pageSize-${f}`, (m) => m.toolbarExpanded.pageFormats[f], 'pageSize')),
  c('layout', 'columns', (m) => m.toolbarExpanded.columns),
  ...([['1', 'columnsOne'], ['2', 'columnsTwo'], ['3', 'columnsThree']] as const).map(([n, k]) => c('layout', `columns-${n}`, (m) => m.toolbarExpanded[k], 'columns')),
  c('layout', 'breaks', (m) => m.ribbon.breaks),
  c('layout', 'sectionBreak', (m) => m.ribbon.sectionBreak, 'breaks'),
  c('layout', 'hyphenation', (m) => m.ribbon.hyphenation),
  c('layout', 'pageNumberFormat', (m) => m.ribbon.pageNumberFormat),
  c('layout', 'lineNumbers', (m) => m.ribbon.lineNumbers),
  c('layout', 'pageDecor', (m) => m.ribbon.pageDecor),
  c('layout', 'foldMarks', (m) => m.ribbon.foldMarks),
  c('layout', 'indentLeft', (m) => m.ribbon.indentLeft),
  c('layout', 'indentRight', (m) => m.ribbon.indentRight),
  c('layout', 'spaceBefore', (m) => m.ribbon.spaceBefore),
  c('layout', 'spaceAfter', (m) => m.ribbon.spaceAfter),

  c('references', 'toc', (m) => m.ribbon.toc),
  ...INDEX_KINDS.map((k) => c('references', `toc-${k}`, (m) => m.ribbon.indexes[k], 'toc')),
  c('references', 'tocOptions', (m) => m.ribbon.tocOptions),
  c('references', 'tocUpdate', (m) => m.ribbon.tocUpdate),
  c('references', 'headingNumbering', (m) => m.ribbon.headingNumbering),
  c('references', 'footnote', (m) => m.toolbarExpanded.insertFootnote),
  c('references', 'endnote', (m) => m.toolbarExpanded.insertEndnote),
  c('references', 'noteOptions', (m) => m.ribbon.noteOptions),
  c('references', 'citation', (m) => m.ribbon.citation),
  c('references', 'citationStyle', (m) => m.bibliography.style),
  c('references', 'caption', (m) => m.ribbon.insertCaption),
  c('references', 'indexEntry', (m) => m.ribbon.indexEntry),

  c('review', 'thesaurus', (m) => m.thesaurus.title),
  c('review', 'wordCount', (m) => m.status.statistics),
  c('review', 'autoCorrect', (m) => m.ribbon.autoCorrect),
  c('review', 'newComment', (m) => m.comments.newComment),
  c('review', 'commentPlace', (m) => m.comments.showPane),
  c('review', 'prevComment', (m) => `${m.comments.title}: ${m.revisions.prev}`),
  c('review', 'nextComment', (m) => `${m.comments.title}: ${m.revisions.next}`),
  c('review', 'changePlace', (m) => m.revisions.showPane),
  c('review', 'prevChange', (m) => `${m.ribbon.groups.revisions}: ${m.revisions.prev}`),
  c('review', 'nextChange', (m) => `${m.ribbon.groups.revisions}: ${m.revisions.next}`),
  c('review', 'trackChanges', (m) => m.revisions.record),
  c('review', 'protectChanges', (m) => m.revisions.protect),
  c('review', 'compareDocument', (m) => m.revisions.compare),
  c('review', 'mergeDocument', (m) => m.revisions.merge),
  c('review', 'markupDisplay', (m) => m.revisions.display),
  c('review', 'accept', (m) => m.revisions.accept),
  c('review', 'acceptAll', (m) => m.revisions.acceptAll),
  c('review', 'reject', (m) => m.revisions.reject),
  c('review', 'rejectAll', (m) => m.revisions.rejectAll),
  c('review', 'printMarkup', (m) => m.revisions.printMarkup),
  c('review', 'reviewSettings', (m) => `${m.settings.title}: ${m.settings.sections.review}`),
  c('review', 'spellLanguage', (m) => m.spellPicker.label),

  c('view', 'navigator', (m) => m.navigator.title),
  c('view', 'ruler', (m) => m.ruler.show),
  c('view', 'fieldShadings', (m) => m.view.fieldShadings),
  c('view', 'splitView', (m) => m.view.split),
  c('view', 'pagesAcross', (m) => m.view.pagesAcross),
  c('view', 'zoomOut', (m) => m.status.zoomOut),
  c('view', 'zoomIn', (m) => m.status.zoomIn),
  c('view', 'zoomReset', (m) => m.status.resetZoom),

  c('tableDesign', 'tableStyle', (m) => m.table.tableStyle),
  c('tableDesign', 'cellShading', (m) => m.table.cellShading),
  c('tableDesign', 'tableBorders', (m) => m.borders.title),
  c('tableDesign', 'headerRow', (m) => m.styles.regions.headerRow),
  c('tableDesign', 'firstColumn', (m) => m.styles.regions.firstColumn),
  c('tableDesign', 'repeatHeaderRow', (m) => m.ribbon.repeatHeaderRow),
  c('tableLayout', 'tableDelete', (m) => m.common.remove),
  ...(['deleteRow', 'deleteColumn', 'deleteTable'] as const).map((k) => c('tableLayout', `tableDelete-${k}`, (m) => m.table[k], 'tableDelete')),
  c('tableLayout', 'insertAbove', (m) => m.ribbon.insertAbove),
  c('tableLayout', 'insertBelow', (m) => m.ribbon.insertBelow),
  c('tableLayout', 'insertLeft', (m) => m.ribbon.insertLeft),
  c('tableLayout', 'insertRight', (m) => m.ribbon.insertRight),
  c('tableLayout', 'mergeCells', (m) => m.table.mergeCells),
  c('tableLayout', 'splitCells', (m) => m.table.splitCellsAria),
  ...(['Top', 'Middle', 'Bottom'] as const).map((k) => c('tableLayout', `cellAlign-${k}`, (m) => m.table[`cellAlign${k}`])),
  c('tableLayout', 'cellMargins', (m) => m.ribbon.cellMargins),
  c('tableLayout', 'sort', (m) => m.table.sortAria),
  c('tableLayout', 'tableFormula', (m) => m.table.formulaAria),
  c('tableLayout', 'numberRecognition', (m) => m.table.numberRecognition),

  ...WRAPS.map(([k, key]) => c(FRAME, `wrap-${k}`, (m) => m.image[key])),
  ...ORDERS.map(([k, key]) => c(FRAME, `order-${k}`, (m) => m.image[key])),
  c('pictureFormat', 'altText', (m) => m.ribbon.altText),
  c('shapeFormat', 'shape', (m) => m.textBox.shape),
  c('shapeFormat', 'fillColor', (m) => m.textBox.fillColor),
  c('shapeFormat', 'borderColor', (m) => m.textBox.borderColor),
  c('shapeFormat', 'borderWidth', (m) => m.textBox.borderWidth),
  c('shapeFormat', 'verticalText', (m) => m.textBox.verticalText),
  ...(['Top', 'Middle', 'Bottom'] as const).map((k) => c('shapeFormat', `textAlign-${k}`, (m) => m.textBox[`vAlign${k}`])),

  c('headerFooter', 'hfPageCount', (m) => m.hf.pageCount),
  c('headerFooter', 'hfChapter', (m) => m.hf.chapter),
  c('headerFooter', 'differentFirstPage', (m) => m.toolbarExpanded.differentFirstPage),
  c('headerFooter', 'differentOddEven', (m) => m.toolbarExpanded.differentOddEven),
  c('headerFooter', 'hfTabs', (m) => m.paragraphDialog.tabsButton),
  c('headerFooter', 'closeHf', (m) => m.ribbon.closeHf),
];

/** The shown tab a command lives on: null for the File menu, undefined while none of its
 *  tabs is shown. */
export function tabOf(cmd: RibbonCommand, shown: readonly Tab[]): Tab | null | undefined {
  return cmd.tab === null ? null : [cmd.tab].flat().find((x) => shown.includes(x));
}

// The file commands an embedding host application takes over (`embed/mode.ts`).
const HOST_FILE_COMMANDS = new Set(['newDocument', 'newFromTemplate', 'open', 'browserDocuments', 'saveAsOdt', 'saveAsDocx', 'saveTemplate']);

/** What the search offers: commands on a shown tab or in the File menu, the assistant
 *  only while it is on, the kept-documents list only when documents are kept, and no
 *  file command the host application has taken over. */
export function searchableCommands(cmds: RibbonCommand[], shown: readonly Tab[], opts: { ai: boolean; volatile: boolean; embedded?: boolean }): RibbonCommand[] {
  return cmds.filter((c) => tabOf(c, shown) !== undefined
    && (opts.ai || !c.id.startsWith('ai'))
    && !(opts.volatile && c.id === 'browserDocuments')
    && !(opts.embedded && HOST_FILE_COMMANDS.has(c.id)));
}

/** Runs a hit's control: a field is focused, anything else clicked. A colour split's own
 *  half applies the last colour, so its palette is opened through the chevron. */
export function actOnCommand(el: Element | null): void {
  const target = el?.matches('button, input, select') ? el : el?.querySelector('.color-chevron') ?? el?.querySelector('button, input, select');
  if (target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && !['checkbox', 'radio'].includes(target.type))) {
    target.focus();
    if (target instanceof HTMLInputElement) target.select();
  } else (target as HTMLElement | null | undefined)?.click();
}

// The paragraph styles the Home gallery shows, under their translated names.
export function styleCommands(names: string[]): RibbonCommand[] {
  return names.map((n) => c('home', `style-${n}`, (m) => m.styleNames[n] ?? n));
}

// Case, accents and umlaut dots fold away, so "uber" finds "Über".
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function score(q: string, text: string): number {
  const s = norm(text);
  if (s.startsWith(q)) return 3;
  if (s.split(/[\s\-/()]+/).some((w) => w.startsWith(q))) return 2;
  return s.includes(q) ? 1 : 0;
}

// The English label also matches, so "table" works under every UI language.
// ponytail: no typo tolerance or per-locale synonyms; add them when searches miss.
export function searchCommands(query: string, cmds: RibbonCommand[], m: Messages, recent: string[], limit = 8): RibbonCommand[] {
  const q = norm(query.trim());
  if (!q) return recent.map((id) => cmds.find((cmd) => cmd.id === id)).filter((cmd) => !!cmd).slice(0, limit);
  const rank = (id: string) => (recent.includes(id) ? recent.indexOf(id) : recent.length);
  return cmds
    .map((cmd, i) => ({ cmd, i, s: Math.max(score(q, cmd.label(m)), score(q, cmd.label(en))) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || rank(a.cmd.id) - rank(b.cmd.id) || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.cmd);
}
