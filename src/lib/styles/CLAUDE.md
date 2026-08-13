# `src/lib/styles/` — named styles

Three families: paragraph and character styles here, **table styles in
`docs/architecture/tables.md`** (model in `tableStyles.ts`, editor half in
`editor/extensions/tableStyle.ts`).

## Paragraph styles (`styleSheet.ts`, `sheet.svelte.ts`, `editor/extensions/paragraphStyle.ts`)

LibreOffice's model: a style has a name, a **parent** it inherits from, a follow-on style, and two
property groups (`ParaProps` layout / `TextProps` text). `styleSheet.ts` is framework-free — the
built-ins (Standard → Heading → Heading 1–5 / Title / Subtitle, plus Quotations), `resolveStyle`
(parent chain root-first, nearest wins, cycle-safe), `styleOrder`, and `styleCss`. `sheet.svelte.ts`
holds it as a reactive singleton persisted to `edentext-styles` (same shape as `i18n.svelte.ts`).

- **Pair kerning** (`TextProps.kerning` → `font-kerning`) is where the two formats
  disagree: ODF kerns unless `style:letter-kerning="false"`, Word kerns **nothing** unless
  `w:kern` names the point size to start at — and a browser kerns always. Probed: the same
  string runs 5% narrower kerned, which broke a line a word early on every Word document in
  the corpus. **Both states are stored, per style**: a style inherits its parent's, so a
  Title whose own `w:kern` names 14pt has to say so to overrule a document kerning nothing
  (measured at 26pt: 0.34mm, which is the difference between a title of one line and of
  two). A style set below its own threshold counts as off. Export writes the state it has —
  ODF `style:letter-kerning`, DOCX `w:kern="1"` wherever kerning is on. A single **run**
  overriding its style still needs a mark we don't have.

- **Assignment**: the `ParagraphStyle` extension adds a global `styleName` attr on paragraph/heading,
  rendered as `data-style`. `setParagraphStyle(name)` switches the node type when the style has an
  `outlineLevel` (heading) and **keeps hard formatting**, as in Word/LibreOffice;
  `clearDirectFormatting()` (Ctrl+M, also the ToolbarExpanded eraser button) drops marks and the
  style-governed block attrs but keeps the style and hyperlinks. `blockStyleName(node)` resolves a
  block's style (own → heading level → Standard).
- **Rendering**: `Editor.svelte` writes `styleCss(sheet)` into a `#document-styles` element on every
  change (then a `FORCE_PAGE_RECALC` so pagination re-measures). One rule per style keyed by
  `data-style`, plus `hN:not([data-style])` fallbacks for imported headings, plus a **text-only
  rule for the list item carrying the block** (`li:has(> …)`): a list marker inherits the item's
  own font, never its paragraph's, so without it the number renders in the editor default while
  the text it labels follows the style (see `listMarker.ts`). `editor.css` only keeps
  a neutral `font: inherit; margin: 0` reset for `h1`–`h5`; all heading typography comes from the
  styles. Inline attrs/marks still win — the Word/LO precedence.
- **ODF I/O is style-aware.** *Export*: `buildOdt(…, styles)` takes the sheet;
  `applyNamedStyles` (inside `rewriteStylesXml`) writes every built-in plus the user styles the
  document references — merged into the blocks odf-kit already emits, appended otherwise, with
  `style:parent-style-name`/`-next-style-name` so the chain stays a chain. `stripManagedProps`
  first drops the producer's values for the properties the model owns, so anything a style leaves
  open really inherits. A block whose style isn't the ODF default for its node type carries a
  `STY` sentinel (U+E00D, `hasCustomAttrs` routes it through `applyRuns`); `applyParagraphStyles`
  then either points it at the named style or clones its automatic style with the named one as
  parent — so direct formatting keeps overriding the style.
  *Import*: `StyleResolver.namedParagraphStyles()`/`namedAncestor()` separate the file's named
  styles from automatic ones (= direct formatting). `collectStyleSheet` keeps the styles blocks
  actually reference plus their parent chains (own props = resolved minus the parent's, so
  relative sizes and repeated values don't land raw) over the built-ins, and `OdtImportResult.styles`
  hands them to `App.svelte`. Suppression no longer compares against constants: `blockDefaults`
  builds a per-block **yardstick** from the block's named style (size, margins, indent, font, bold,
  color, italic/underline/strike), and only what exceeds it becomes direct formatting. Only
  top-level blocks get a `styleName` — list items and cells reference producer plumbing styles.
- **DOCX I/O works the same way.** *Export*: `buildDocx(…, styles)` emits the registry as
  docx-lib `paragraphStyles` (`id` via `docxStyleId` — "Heading 1" → `Heading1`, "Standard" →
  Word's `Normal` — plus `basedOn`/`next`), and every paragraph carries `style:` instead of a
  heading level (`Heading1` is the same id `HeadingLevel.HEADING_1` used to reference).
  *Import*: `DocxStyles.namedParagraphStyles()`/`styleIndentTwip()`/`defaultParagraphStyle()` feed
  `collectStyleSheet`; `registryName` maps Word's standard styles onto the registry (the document's
  default paragraph style always becomes `Standard`, whatever the file calls it). `blockAttrs` now
  reads DIRECT `w:pPr` only — style-level spacing/alignment lives in the style — and `blockDefaults`
  builds the yardstick from `paragraphRun` (docDefaults ← the style chain).
- `HEADING_STYLE_OVERRIDES` (`export/odt.ts`) is still the fallback yardstick for blocks whose file
  declares no style; `tests/unit/style-resolve.test.ts` asserts the built-ins match it.
- **Character styles** are the second family (`sheet.character`, LibreOffice's Emphasis /
  Strong Emphasis / Source Text): the `CharacterStyle` mark (`charStyle`, attr `name`) tags a run
  and renders `data-char-style` (`priority: 102`, so the span wraps the direct formatting's —
  a stylesheet rule beats an ancestor's inline style), `styleCss` emits a rule per style, and the gallery lists them
  under the paragraph styles (clicking the active one toggles it off). **ODF**: export bakes the
  style's resolved formatting onto the run *and* prefixes a `CST` sentinel (U+E00E) so
  `applyCharacterStyles` re-points that span at a clone whose parent is the named
  `style:family="text"` style; `hasCharStyleRun` routes such paragraphs through `applyRuns`.
  Import maps a span whose chain reaches a named text style back to the mark
  (`namedAncestor(…, 'text')`) and folds the style into the run's yardstick (`charDefaults`).
  **DOCX**: `w:rStyle` + `characterStyles` on export, `namedCharacterStyles()` on import.

- **Style manager** (`StyleManagerDialog.svelte`, mounted **once** in `App.svelte`; the entry
  points — "Manage styles…" at the foot of the gallery, "Manage table styles…" at the foot of
  the insert-table dropdown — only call `openStyleManager(family)`, and the `family` prop picks
  the tab on every open): the registry as an inheritance tree, live-editing a style's own properties (empty field
  = inherit again; the placeholder shows the inherited value), plus LibreOffice's
  **new/update from selection** — `propsFromBlock` reads the block's attrs and its first run's
  marks, `styleDelta` reduces that against the parent's resolved props, and the block is then
  retagged and `clearDirectFormatting()`ed so the formatting lives in the style alone. Rename and
  delete re-point the registry (`renameStyle`/`deleteStyle` in `sheet.svelte.ts`, children
  re-parent to the grandparent) and retag the affected blocks; built-ins offer a reset instead.
  Two family tabs: **character styles** are edited the same way (text properties only, plus a
  "New" button for an empty one — a run needn't be selected). There `runFormatting` reads the
  selection's first run instead of the block, `applyCharStyle` drops the direct marks the new
  style now carries before setting the `charStyle` mark, and `retag` rewrites the mark's `name`
  instead of the block attr. The third tab holds the **table styles**: a flat list (no tree), an
  area picker driving fill/text fields, three border controls (outer / row lines / column
  lines, the inner two falling back to `innerBorder`), and New/Rename/Remove (no "from
  selection"). Its preview shows the style with every area on, since it edits the definition
  rather than one table's look. The
  text fields are shared by all three families via `ownText`/`resolvedText`/`editText`.
