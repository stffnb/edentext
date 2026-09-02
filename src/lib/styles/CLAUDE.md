# `src/lib/styles/` — named styles

Four families: paragraph and character styles here, **table styles in
`docs/architecture/tables.md`** (model in `tableStyles.ts`, editor half in
`editor/extensions/tableStyle.ts`), **list styles below**.

## List styles (`listStyles.ts`, `editor/extensions/listStyle.ts`)

LibreOffice's Listenformatvorlagen: a flat family of up-to-10-level definitions
(`ListLevelStyle` — bullet/number kind, marker, relative `indentCm`, `markerAlign`,
`startAt`; `multilevel` is style-wide). Assignment is `listStyleName` on the **outermost**
list only — nested lists inherit, as an ODF `<text:list>` does. Precedence per level:
node attr > style level > depth-cycle default, resolved by `effectiveListLevel` — the one
source the decoration walk (`listStyleDecos`, which also owns `data-eff-list-style` for
plain lists) and both exporters share. **The style level decides the depth's kind**
(`eff.kind`): a number level numbers a `<ul>` and a bullet level bullets an `<ol>` — in
ODF the list style alone says what a depth renders, the editor's node species doesn't
travel. `setListStyle` retypes the subtree to the levels' kinds; a Tab-nested list of
the other species still renders (and exports) what the level says, and both importers
build the species from the level, so a round trip normalizes it. The six built-ins are a **preset gallery of
patterns the depth cycle can't produce** — the outline chains Outline I.A.1 / A.I.1, the
kind-mixing Numbering with Bullets and Checklist, and the Diamond Bullets ladder — all on
the plain 1.27cm step (no indentCm). The one deliberate exception is Numbering 1.a.i, the
default cycle captured as a style so a style switch can lead back to it; any further
preset that only restates a dropdown format plus the default nesting has no place here.
Export writes the full named `<text:list-style>` into styles.xml and points the list at it
**only when nothing overrides** — ODF list styles have no parent chain, so an overridden
list keeps the fully resolved automatic clone and drops the name (marker formats count as
an override: they ride the L# levels). Probed: LibreOffice keeps a named reference on
`<text:list>` across a re-save, preserves `style:display-name`, normalizes `style:name` to
the `_20_`-encoded display name, and fills undefined levels with decimal — so the export
always writes all 10 levels. **UI**: `setListStyle` (outermost list; assigning clears the
subtree's direct marker attrs, as applying a Listenformatvorlage does) via a "List styles"
section in both chromes' bullet/numbering dropdowns, split by the style's level-1 kind;
the manager's fourth tab edits per level (level picker, kind, marker, indent step,
right-set label, start-at, style-wide multilevel).

## Paragraph styles (`styleSheet.ts`, `sheet.svelte.ts`, `editor/extensions/paragraphStyle.ts`)

LibreOffice's model: a style has a name, a **parent** it inherits from, a follow-on style, and two
property groups (`ParaProps` layout / `TextProps` text). `styleSheet.ts` is framework-free — the
built-ins (Standard → Heading → Heading 1–6 / Title / Subtitle, plus Quotations), `resolveStyle`
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
  `outlineLevel` (heading) and **keeps hard formatting**, as in Word/LibreOffice. The name rides
  along with that type switch: `setNode` copies the block's own attrs, and a following
  `updateAttributes` would look for the new type in the pre-chain state and set nothing — a
  paragraph left carrying a heading's name looks like a heading and is none (no outline entry).
  The heading's `styleName` is the one attr **not** kept on split, so Enter at the end of one
  starts a body paragraph;
  `clearDirectFormatting()` (Ctrl+M, also the ToolbarExpanded eraser button) drops marks and the
  style-governed block attrs but keeps the style and hyperlinks. `blockStyleName(node)` resolves a
  block's style (own → heading level → Standard).
- **The gallery lists `visibleStyles`, not `styleOrder`**: both reference products define ten
  heading levels but offer the first `GALLERY_HEADING_LEVELS` (5); the rest need the menu's "show
  all styles" (`showAllStyles`/`toggleAllStyles`, session-only) or a block already using them.
- **Rendering**: `Editor.svelte` writes `styleCss(sheet)` into a `#document-styles` element on every
  change (then a `FORCE_PAGE_RECALC` so pagination re-measures). One rule per style keyed by
  `data-style`, plus `hN:not([data-style])` fallbacks for imported headings, plus a **text-only
  rule for the list item carrying the block** (`li:has(> …)`): a list marker inherits the item's
  own font, never its paragraph's, so without it the number renders in the editor default while
  the text it labels follows the style (see `listMarker.ts`). `editor.css` only keeps
  a neutral `font: inherit; margin: 0` reset for `h1`–`h6`; all heading typography comes from the
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

- **Chapter numbering** (`outlineNumbering.ts`, `StyleSheet.outline`): one definition per
  document, level 1 first — format, prefix, suffix, `displayLevels` (how many levels the
  label shows) and start. `outlineCss` draws it with a counter per level that every
  heading of that level increments and every deeper one resets, so `2.1.4` restarts with
  its chapter; a heading in a cell, a list item or a frame is outside the count, as in
  both products. The label is a `hN::before`, like the list marker — **no text walk can
  read it**, so the contents rows carry their own copy (`outlineLabel`, counted the same
  way in `tableOfContents.ts`). ODF keeps it in one `text:outline-style` beside the named
  styles, Word as a multilevel numbering the heading styles point at (`w:numPr` on the
  style, `w:pStyle` in the level) — the DOCX pass mints that numbering's `w:num` itself,
  since no paragraph references it.
  A level also carries **how the label is set and where it sits**: the character style
  the file names (resolved into `labelText`, since Word's `w:lvl/w:rPr` names none), the
  paragraph's indent, its first line and the stop the label's tab runs to. The label is
  an *inline block* so one set larger than its heading grows the line as both products
  grow it, with the stop as its minimum width; `text-indent` inherits into that block
  and is zeroed there, or the hanging indent would shrink the label's own box by it.
  Probed: a label wider than its stop overruns it, and LibreOffice then advances to the
  paragraph's next tab stop (its own, else the 1.25cm grid, measured from the indent) —
  the editor butts the title against the label instead, up to one grid step short.
