# Frames: images and text boxes

Covers `src/lib/editor/extensions/image.ts` and `textBox.ts` — node views, resize/rotate
handles, wrap modes, frame offsets — and their ODF/DOCX legs.

- **`image.ts`** (`Image`) — inline, as-character image atom (Word's "in line with text"). Attrs: `src` (data-URI), `alt`, `width`/`height` (**unscaled doc px @96dpi**, like `rowHeight`, and **fractional** — rounding a page-wide picture to whole px costs 0.3mm of height; `framePx` snaps back to a whole one within 0.05px, which is where our own export's 0.001cm quantization lands, so the round trip stays exact), `rotation` (CW degrees). The node view nests an `<img>` in a rotated "rotor" inside an axis-aligned wrapper that reserves the rotated bounding box (so text reflows around it). The rotor's transform makes it a stacking context, so a selected `.image-node` is given a `z-index` above the header/footer layer to keep handles that poke into a margin grabbable. It has eight zoom-aware resize handles — corners aspect-locked, edges single-axis (width- or height-only) — plus a rotation-arrow grip, and shows a live "Width … × Height …" (cm) badge while resizing; resize deltas are un-rotated onto the image's own axes so handles track the pointer at any angle (drag math mirrors `tableRowResize.ts`; width cap = the cell or page-text-column, height cap = the page text height). `setImage` command inserts it; the toolbar button (ToolbarExpanded), drag-drop and paste (Editor.svelte) read the file via `FileReader` → data-URI and clamp the initial size to the page text box. A picture that arrives by **URL** (an `<img>` pasted or dropped from a web page) is fetched into a data-URI right after the paste (`inlineRemoteImages`); one the site withholds is dropped with a message, since only a data-URI ever reaches a file. **Text wrap:** the `wrap` attr (`'inline'|'left'|'right'|'topBottom'|'through'`) makes the image a *floating* frame — `ImageToolbar.svelte` (a per-image floating toolbar wired in `Editor.svelte` like `TableToolbar`) sets the mode; `left`/`right` float the wrapper at its anchor paragraph (text flows on the open side via CSS `float`), `topBottom` is a **full-width `float`** (text only above/below), and `through` — Word's in-front-of / behind-text (`wp:wrapNone` + `behindDoc`), ODF's `style:wrap="run-through"` — leaves the flow entirely: `position: absolute` with no offsets keeps the static position it was anchored at, so it reserves neither width nor height, and `inFront` picks the side of the text it lands on. Its `wrapOffset` still counts from the text column (a cell's, a text box's): `placeInColumn` (`pageBreaks.ts`) measures the static position — which carries the anchor paragraph's indent and the text before the anchor — and sets the margin that reaches the column x — at once on a frame already in the document, so a drag's preview never shows a frame at the wrong x, and again on every pagination pass; ODT writes such an x with `horizontal-rel="paragraph"`, which LibreOffice measures from the column (probed; `paragraph-content` adds the indent). A frame the file places against the **page** takes both offsets from the page's corner instead (see `wrapFromPage`). Read as a side float instead it reserved a near-column-wide picture's whole height, which cost the image fixture a page and ~50 reports. A text box in that mode sits behind the text unless the file puts it in front (`inFront`); see Stacking order. Both frame toolbars and the ribbon's Arrange group offer the mode as the two entries Word's layout options have — behind the text and in front of it, one mode told apart by `inFront`. Picking **any** mode by hand drops the offsets and the frame of reference they were measured in (`droppedFrameAttrs`: `wrapFromPage`, `wrapFromBody`, `anchorPage`, `inFront`), or a page-placed frame set to a side wrap would export as page-relative with an offset that now counts from a paragraph. Every attribute change puts the node selection back (`atomAttrTr`): `setNodeMarkup` replaces a **leaf** node outright, so the selection maps off it and the frame would deselect itself — both its toolbars closing — on every wrap, resize or rotation commit. All modes use `float` deliberately: an in-flow `display:block` on an inline-atom node view splits the paragraph's inline content into anonymous block boxes, which desyncs ProseMirror's inline view descriptor and makes it drop the following page-break spacer widget; a float is out-of-flow and avoids that. Dragging an **inline** image runs ProseMirror's native node move (the `dropCursor` plugin shows the caret). Dragging a frame that is **out of the flow** (`through`, or page-anchored) moves it by its own offsets instead (`startFreeMove`, shared with `textBox.ts`): nothing wraps around it, so there is no text position to re-anchor to — and a page-placed frame is re-placed from its offsets on every pagination pass, so re-anchoring moved it nowhere at all. Those offsets count from a point the drag cannot move (the column, the page's corner), so the pointer delta is simply added to them — a column-placed frame without an x starts from the x its static position shows (`freeDragX`), or its first drag would jump by that much; the preview rides the node view's own `applyWrap`, and the commit is one undo step. Out of the flow the wrapper keeps the **unrotated** size: the offsets place the unrotated box in both formats (DOCX `posOffset`, ODF's `rotate`/`translate` re-centred on it), so a rotation turns the frame about a centre that stays put. Dragging a **floating** image runs a custom drag (`ImageView.startReposition`) that **live re-anchors** the node to the text position under the cursor, so the float and text reflow in real time as you drag; it's rAF-throttled and only moves when the cursor's line changes (a float can't move within a line), and stays a single undo step (first move records history, later moves are `addToHistory:false` and get rebased on undo). A paragraph that contains an image paginates **atomically** (`pageBreaks.ts` — pushed whole to the next page, spacer placed before it) so a page break never splits the paragraph next to the image's float (where ProseMirror drops the spacer widget). **Wrap distance:** `wrapDist` is the gap the file keeps beside a float, in cm (Word's `distL`/`distR`, ODF's `fo:margin-left`/`-right` on the graphic style) — only the side the text flows on, since the other one is the frame's own offset. A frame that declares none reserves **nothing**, beside it or above/below it: probed, LibreOffice wraps flush against it, and a gap of our own put every figure in a text box 3mm too tall and broke a line a word early. `setImageWrap` gives a frame the file never floated the 0.32cm a word processor's own wrap command writes. **Vertical alignment (as-char):** `vAlign` carries ODF's `style:vertical-pos`/`-rel` pair for an inline frame — `null` (LibreOffice's `top`/`baseline` and Word's only mode) stands the frame on the text baseline, `middle`/`below` centre it on the baseline or hang it below, and `text-top`/`text-middle`/`text-bottom` measure against the character area instead (CSS `vertical-align: text-top`/`text-bottom`; nothing in CSS centres on that area, so `text-middle` uses 0.36em for half of ascent − descent, which Liberation Serif/Sans, Times and Arial share). `from-top` becomes `vAlign: 'offset'` and puts the frame's top `wrapOffsetY` cm below the baseline whatever the relation says — all probed against LibreOffice, whose formula images use `middle`/`text` and `from-top` almost exclusively. A line an as-char frame has to itself — nothing beside it but whitespace — is as tall as the frame or the block's line height, whichever is more, with **no text descent below it** (probed); `image.ts` gives such a frame an `image-line` class, since CSS cannot ask whether a line holds real text. Hard breaks are the only line boundaries the model shows, so the run between two of them is what gets tested — which covers the frame-break-caption pattern common in LibreOffice's own guides; a frame alone on a *soft-wrapped* line is invisible from there. A frame that shares its line with text keeps the baseline and the descent. **Frame offsets:** `wrapOffset` is the frame's left edge in the text column (Word's `positionH` posOffset, ODF `svg:x`; an x either file measures from the page edge is taken less the section's left margin, and both exporters write it against the column), rendered as the float's near/far margin against the live column vars — an indented anchor paragraph can't skew it — and shared with `textBox.ts` through `frameMargins`. CSS queues floats of one side behind each other, so a second frame in the same line would sit beside the first instead of at its own x; `unstackFloat` sets its margins from the earlier frame's outer edge once laid out, cutting its gap at the column's edge where that alone dropped it below (a footer's page-number box left of its centred title; two hazard icons in a narrow cell, the second set where the first leaves room). A side-wrapped Word frame **centred** on the page or the column (`positionH` align `center`) is read as the x that centres it — a float has no middle. A `topBottom` float spans the column, so its own x moves the *rotor* inside the wrapper instead. `wrapFromPage` says that the frame is placed against the **page** the anchor lands on (Word's `positionV relativeFrom="page"`, ODF's `style:vertical-rel="page"` — how a cover page's blocks are placed): `placeFromPage` (`pageBreaks.ts`, deferred a frame so the frame is laid out first) reads that page off the page grid and measures the frame's static position, turning both offsets into the margins that reach the page's corner — `wrapOffsetY` below the page top, `wrapOffset` from the text column, which is where Word measures a `positionH` from and not where the anchor character happens to sit. Every pagination pass re-places them, since the spacers it inserts move the anchor under them. The frame stays anchored in the flow it belongs to and no page number is stored. `wrapFromBody` is the same against the top of that page's **body text area** (Word's `relativeFrom="margin"`, ODF's `vertical-rel="page-content"`), which is where a letterhead's header frames are placed; a header frame of that kind pushes the body down (`components.md`, Header and footer). Word's `bottomMargin` stays at the anchor: LibreOffice measures it from the body's end, Word from the page's bottom margin. An ODF text box that only states `fo:min-width` is read at the width its column leaves it, as LibreOffice lays it out. `wrapOffsetY` (`positionV`, `svg:y`) is otherwise the frame's top below the anchor paragraph's (above it, negative, only for a run-through frame, which overlaps whatever is there), drawn for `topBottom` only — no text sits beside such a frame, where a side float's top margin would push away lines Word keeps. Chromium places **every** line after a full-width float below it, even the ones the float's top margin leaves room for, so a frame set below the paragraph top is sunk behind that paragraph's text at import (`sinkOffsetFrames`, both importers), frames ordered top to bottom since files write them in z-order, and `sinkToOffset` (image and text box alike) measures what the lines and frames above it already cover, adding only the rest. The **block after the anchor paragraph clears the band** (`imageLinePlugin` marks the block with `data-wrap-band`, an `editor.css` sibling rule clears the next one): a float only pushes lines that intersect it, so a short block (a heading) would slot into the clearance gap a prior side float opens above the band — both word processors start it below; a page-break spacer and the block holding a band-sharing partner frame are exempt. The marker is an attribute, not a `:has()` in the selector: with `:has()` left of `+`, Chromium restyled every element under `.tiptap` on each insertion there — a spacer, a split paragraph — 150 ms at 124 pages, twice per keystroke that moved a page break. Two `topBottom` frames set against **opposite ends** of nearby paragraphs (`wrapAlign`, from Word's `positionH` align / ODF `style:horizontal-pos`) share one band and float to their own sides instead: `pairAlignedFrames` (import/odt.ts, both importers) keeps the attr only for such a pair — a lone one reserves the whole band, which is what the wrap means — and scales a pair up to 15% wider than the column down to it, since Word lets the two overlap in the middle and two floats cannot. A frame Word puts *inside* running text still lands after it: browsers can't wrap text around a freely-positioned box (CSS Exclusions are unimplemented). Inline images stay as-char. **Crop:** `crop` holds the share of each side the file cuts off (Word's `a:srcRect`, ODF's `fo:clip`); the node view draws the picture that much larger inside an `.image-crop` box that clips it — `object-view-box` would do it in one property, but only Chromium has it and html2canvas has neither. `fo:clip` lengths count against the picture's own size, its pixels at the resolution it states (PNG `pHYs`, JPEG JFIF; `imageSizeCm`) — probed; where it states none LibreOffice takes the screen's (128dpi on macOS), the editor 96dpi. Works inside table cells. In a header or footer too: see the zone frames in `components.md` (Header and footer). Images live as data-URIs in the autosaved JSON; `autosave.ts` warns once if that exceeds the localStorage quota.
- **`textBox.ts`** (`TextBox`) — an **inline** text box / basic shape carrying editable block content (`group: 'inline'`, `inline: true`, `content: '(paragraph|heading|bulletList|orderedList)+ | table'`, `isolating`) — the frame both formats write, a character in a run that holds paragraphs. It rides a paragraph, so `inline` really is in the line, and a box reaches a table cell or a list item through their paragraphs, as one does in Word. Attrs: `width`/`height` (px @96dpi; height renders as **min-height** — content grows the box — unless `fixedHeight`: then the box is that tall and clips at its inset's edge, as a Word box without `a:spAutoFit` or an ODF frame without `fo:min-height` is in both word processors, probed — LibreOffice draws nothing in the bottom inset; `paddingTopCm`/`paddingBottomCm` are the top and bottom insets where they differ from the sides, Word's `tIns`/`bIns`, ODF's `fo:padding-top`/`-bottom`), `rotation` (CW deg), `wrap` (image's `WrapMode`), `shapeKind` (see the shape table below), `fillColor`/`strokeColor` (`null` = transparent/no border), `strokeWidthPt`. Padding is the fixed `TEXTBOX_PADDING_CM` (0.15cm). **Wrap** follows `ImageView.applyWrap` exactly: `inline` is an `inline-block` in the line, `left`/`right` are floats, `topBottom` a **full-width float** whose wrapper spans the column while `placeInBand` moves the rotor across it, `through` leaves the flow. Never `display:block` — that splits the paragraph's inline content into anonymous block boxes and ProseMirror drops the following page-break spacer. A paragraph holding a box paginates **atomically** (`pageBreaks.ts`), whichever way the box wraps. `TextBoxView` mirrors `ImageView` (wrapper reserving the rotated bbox → rotor carrying fill/stroke/rotation → `contentDOM`); the rotor is out of flow and auto-grows, so a ResizeObserver refits the wrapper. **Click model (Word-like):** `stopEvent`/`isFrameHit` claim mouse events on a ~6px frame ring (rotation-/zoom-aware) → NodeSelection + handles (the shared `image-*` handle classes/CSS); clicks further inside pass to ProseMirror (caret). A shape drawn as an outline (`textbox-outlined`) is hit where CSS paints it instead: the wrapper, rotor and content take no pointer events, the outline's paths (`pointer-events: visible`, a move cursor) and the content's blocks do — so the whole shape off its text grabs it, as in Word, and the empty corners of its box hit the page beneath. The box is browser-`draggable` only while node-selected, so PM's native drag moves it without hijacking text selection — except out of the flow, where the ring drag runs `startFreeMove` (PM's node move would re-anchor it). **Reaching the position beside the box:** a frame nobody is editing is an atom to the browser — a `contenteditable="false"` node decoration, dropped while the caret is in its text — and `ArrowLeft`/`ArrowRight` at the box's first/last text position step out to `before`/`after` the node. Without both, a box that starts its paragraph captures the caret: there is no text position beside it, so the browser pulls the caret meant for the box's own place in the line into the frame and everything typed there lands inside it. The frame then has to place the caret itself on the click that enters it (`onFrameMouseDown`, `stopEvent`), since a non-editable one gets none from the browser. A nested `contentEditable` island is not the way — ProseMirror's `hasFocus` is `activeElement == view.dom`, and an island holding focus makes it read no selection at all. Commands: `insertTextBox()` (at the caret, cursor inside; refused inside a box), `setTextBoxAttrs()` (NodeSelection *or* cursor inside; helper `findTextBox`), `setTextBoxAlign()`. **Two guards** the schema cannot express live in the extension's plugin: a `filterTransaction` refuses a box inside a box — both word processors refuse it and neither format's writer has a place for one — and an `appendTransaction` grows a selection ending inside a box it did not start in out to the box's own bounds, since deleting such a range dissolves the frame and spills its text into the body. `TextBoxToolbar.svelte` (wired in `Editor.svelte` like the image toolbar, also shown while the caret is inside a box) sets wrap/shape/fill/stroke, the alignment and `textVertical` — the box's text running **top-to-bottom, right-to-left** (`writing-mode: vertical-rl` on the content area, which is all the browser needs). It round-trips as the style's own writing mode in ODF — a plain box is a Writer text frame (its `TbxFr` style chains to `Frame`; see `src/lib/export/CLAUDE.md`) and takes it in the graphic properties, a drawing *shape* only in its style's paragraph properties (both probed) — and Word's `w:bodyPr vert`; ODF's bottom-to-top and Word's `vert270` read as the same one direction the browser lays out. **Vertical anchor:** `textVAlign` (`top`/`middle`/`bottom`) is where the text sits in a box taller than it is — ODF's `draw:textarea-vertical-align`, Word's `wps:bodyPr anchor` (its two spread modes read as bottom; nothing in CSS spreads lines). The node view flexes the rotor, whose handles are positioned absolutely and stay out of that flow. Set in the ribbon's Shape Format tab, beside the vertical-text button; not on the frame toolbar, which is the compact subset. The name is not `vAlign` — that attr is a *frame's* own place on the line (above), and the as-char import path writes it on a box too. **DOCX autofit:** the shape body writes `<a:noAutofit/>`, which is what LibreOffice writes for the same frame — read as `spAutoFit` it gives the frame `fo:min-height="0"` and draws its text detached from the shape, over whatever follows (probed). So a growing box goes out as tall as it renders (`withRenderedBoxHeights`, the DOCX save) and comes back fixed — the one attr a `.docx` cannot carry. **LibreOffice puts a `wrapTopAndBottom` anchor's band above its anchor paragraph** whatever the anchor says — probed against `posOffset` 0/635, `align top`, `relativeFrom` line/column, `allowOverlap`, and against a file LibreOffice exported itself; `wp:inline` is the one form it places right, and a band-wrapped box keeps `wp:anchor` anyway (Word is the reference for `.docx`). **Where it sits across the column:** only a **band-wrapped** box has a place of its own — `wrapAlign` (`null`/`center`/`right`, drawn by `placeInBand`), and the toolbar's three buttons show for that mode alone, dropping any `wrapOffset` when one is picked. A side wrap names the side itself; a box **in the line** is a character its paragraph places, exactly as a picture is, so the ordinary paragraph alignment does it and a second control on the frame toolbar would only be the same thing under a frame icon. That ordinary command needs one correction, though (`TextAlignInFrames`): a **selected** box is one node whose range covers its own paragraphs, so it would align the box's contents along with the block holding it — with the frame selected only that block is meant (`setTextBoxAlign`), while the caret inside the box still aligns that text. An as-char frame must name the **baseline pair** explicitly in ODF (`style:vertical-pos="top" style:vertical-rel="baseline"`): the `Frame` parent hangs a frame that names none below the line, where a style-less as-char frame (an image) stands on it — probed, and the measured difference between the two formats until it was written.

## A side float below its anchor

A left or right float takes its `wrapOffsetY` as a top margin, and `shape-outside: inset(<gap>
0 0 0) margin-box` keeps the lines beside that margin at full width, as Word and LibreOffice
set them: only the picture excludes text. CSS floats cannot overlap, where LibreOffice lets
two frames touch, so the offset stops short of the next float on the same side
(`sinkSideFloat`, re-measured on every pagination pass); pushed aside instead, the next one squeezed its text to a letter a line.
Measured on six such pictures: 3–7mm high before, all within tolerance.

## A floating table

A table Word takes out of the flow (`w:tblpPr` — every cover-page layout has one) is a **frame
holding nothing but that table**, as LibreOffice keeps one: the blocks after it start where the
table does, and text wraps beside it — a *table* never does (`.tableWrapper` clears floats;
LibreOffice starts one below a 5cm or a column-wide frame, probed). The box's content is an
alternation for that reason: a table in a box is all of it or nothing, since neither writer has a
place for one beside text in a frame. Both exporters write the file's own floating table back
(`w:tblpPr` via the package's `float`, ODF's `draw:frame`/`draw:text-box`), not a shape.

## A box in static HTML

A box is inline and its content is blocks, and no `<p>` can hold those: the browser's parser breaks
the paragraph open around it. This only matters where the document goes through an **HTML string** —
`generateHTML`, `editor.getHTML()`. Copy and paste inside the editor is unaffected (ProseMirror
pastes its own cached slice), and the raster PDF path reads the live DOM. The **vector print path**
(`export/pdf.ts`) handles it: `hoistTextBoxes` gives each box a paragraph of its own before
serializing, and `buildBodyHtml` drops the two empty paragraphs the split then leaves around it — so
the box prints as a block between whole paragraphs, which is how it printed as one. The
**clipboard** handles it the other way: `boxClipboardSerializer` (a `clipboardSerializer` prop)
writes each box as an inline `<span data-tbx>` carrying its blocks as JSON, and the `span[data-tbx]`
parse rule's `getContent` reads them back — so a paste into another window keeps the box where it
stood in the line, while a program that cannot read the attribute still gets the span's plain text.
An **AutoText** entry stores the slice's nodes for the same reason (`storage/autoText.ts`). Pasted
foreign HTML goes the other way round: ProseMirror fits pasted blocks into the caret's line by
wrapping each one that doesn't fit in the only inline node that holds blocks — a box — so
`unwrapPastedBoxes` (`editor/paste.ts`, called from `transformPasted`, whose direct prop wins over
every plugin's) spills a **size-less** box's blocks back where the paste went. Every real box
carries a size, from the insert command or either importer. Left in, a paste into a box was dropped
whole: a box inside a box never enters the document.

## What a frame costs a big document

Every frame is refitted by **one** `ResizeObserver` for the whole document, and a round's reads run
before its writes: a per-view observer is delivered in a callback of its own, so the wrapper written
for one frame makes the browser lay the document out again before the next one's `offsetWidth` is
read — 1.4 s of forced layout on a document holding 450 frames, and the ProseMirror DOM observer
flushes (each reading the selection, each another layout) once per callback on top. The size is read
from the rotor, not taken from the observation: `offsetWidth` snaps to the pixel grid the frame sits
on, and the fractional border box moves blocks below it by a pixel. Both node views also leave the
DOM alone when `update()` brings the same `attrs` object — everything they write is drawn from the
attrs, and text typed inside a box keeps them, so there is nothing to redraw.

## Clicking a float

A block after a float keeps its own box **over** the float — only its line boxes move out of the way
— so the block on top takes every click meant for the frame, and the frame stops selecting once
anything follows it (a caption is the usual first such block). `editor.css` lifts a floating frame
(`.image-node[data-wrap]`) above the in-flow boxes; nothing is hidden, since text flows beside a
frame and never across it. A page-anchored frame is excluded — it carries its own place in the stack
(`inFront`).

A frame **behind** the text cannot be lifted at all — it has to paint under the text —
so the browser hit-tests the page and every paragraph over it first and a cover picture
took no click whatever. `behindTextPlugin` (`image.ts`) walks `elementsFromPoint` for the
topmost such frame and hands the mousedown to its own node view, which selects and drags
it as a click on any other frame does; a text run painted over the point stops the walk,
so text keeps the caret. A shape is hit on its outline or text, handed the element hit.

## Stacking order

A free frame (run-through or page-anchored; floats never overlap) has a rank, `zIndex`, that
`stackZ` (`image.ts`) turns into its layer: in front of the text 1–21, under the header layer;
behind it every **picture paints over every shape** — probed against LibreOffice, which puts a cover
photo over the blocks a template layers under it whatever order the file names — with the page
sheets at -200 (`PageSheetLayer`). Ties and ranks past the caps (20, 60) go by document order. The
Arrange group's four buttons (`restackFrame`) move a frame within that layer and renumber all of
them from 0. Imports rank `draw:z-index` / `relativeHeight` among frames anchored nearby (`stackRank`); exports
write the rank as it is, so it reads back as itself — LibreOffice renumbers every object on save.
DOCX gives each frame its own `relativeHeight` (rank, then document order); LibreOffice 24.2 flips ties.

## Shapes (`utils/shapes.ts`)

Every kind past the three CSS can draw is **one polygon in a 0…100 box**, given once and
used three ways: the node view draws it as an SVG `path` (`preserveAspectRatio="none"` to
stretch it to the frame, `vector-effect="non-scaling-stroke"` so the line stays even under
that distortion), the ODF export scales the same points into the 21600 viewBox of
`draw:enhanced-path`, and Word gets the preset's `prst` name and draws its own geometry.
Adding a shape is one entry in `SHAPES` — no icon, no export branch, no importer case.

- The three rectangular kinds keep the geometry **LibreOffice itself writes** (the
  round-rectangle path pre-evaluated for modifier 3600); a polygon derives its own.
- A ring (pentagon, star) is stretched onto the whole box per axis (`fit`): an
  odd-cornered shape leaves gaps at its bounds, and the presets both word processors draw
  fill their frame.
- `textArea` is where text goes inside the outline. It travels as ODF `draw:text-areas`
  and pads `.textbox-content` in the editor — where a polygon's frame carries **no**
  padding of its own, so the outline covers its whole box and the ring moves to the text.
  LibreOffice ignores the text area of a preset it recognizes and sets the text at the
  frame's top left instead, as it already does for our ellipse.
- An importer maps the file's `draw:type`/`prst` back through the same table;
  `shapeFromOdfType`/`shapeFromPrst` return **null** for a preset we can't draw, which is
  what makes the warning possible instead of flattening it to a rectangle.

## Lines and arrows

`line`, `lineArrow` and `lineDoubleArrow` are **two endpoints, not a box**: they hold no text (the
paragraph the schema requires is hidden and never exported), take no fill, and run across the
frame's diagonal — `flipV` and `flipH` naming the corner they start at, which is what Word's two
flips and ODF's endpoint order both encode. A single head is always the end's, so a file's
line headed at its start alone is read run back (both flips toggled): a callout arrow pointing left
survives either format. Drawn in the frame's **real pixels** (`linePaths`), not the stretched 0…100
box a polygon uses: an arrow head has to keep its shape however flat the frame is, and the head
scales with the pen (`arrowHeadPx`, floored so a hairline still shows one). A selected line is dragged by its **two ends** (`startEndpoint`), the other staying put, Shift snapping to 45° and a rotation folded into the ends; in the text its corner stays at the anchor, so a box turned into a line leaves the text in front of it (`through`, as LibreOffice draws one).

The three share their `odf`/`prst` names, because **the heads are what tell them apart**: both
importers read the heads a file declares and `lineKindFor` names the kind, so a `straightConnector1`
with no heads is a plain line and a `line` preset with both is a double arrow.

- **ODF** gives a line its own element — `<draw:line svg:x1/y1/x2/y2>`, no width or
  height — and its heads are a **named marker**, so `applyTextBoxes` also writes the one
  `<draw:marker draw:name="Arrow">` definition into `styles.xml`, LibreOffice's own name
  and path. It goes in only when a line asks for it, and needs `ensureDrawNamespaces`:
  an undeclared `draw:` prefix there makes the whole file unreadable.
- **DOCX** keeps the frame and flips it (`<a:xfrm flipH="1" flipV="1">`), the heads riding the
  shape's `<a:ln>` as `a:headEnd`/`a:tailEnd`, and writes no `wps:txbx` at all.
- An anchored frame's DOCX `positionV` posOffset is floored at one twip: on exactly 0,
  LibreOffice's wrap layout paints a neighbouring inline box's text outside its shape
  (probed; LO never writes less itself). The importer reads the twip back as no offset.
- A line is a frame of **no height**, and a zero-high SVG viewport turns rendering off
  altogether (per spec), so `applyLine` gives it at least the stroke and lets the line
  overflow it by half, as it does in any flat frame.
## Freeform outlines (`shapePath`)

A drawing this editor offers no tool to author — a polygon, a polyline, a bezier curve,
a connector's elbow — still has to survive being opened and saved. The box keeps the
file's own outline in `shapePath`, an SVG `d` in the same **0…100 box** a preset's
points live in (`utils/shapes.ts`), and its presence is what makes the box draw itself.
An outline that never closes is **stroked only**, whatever fill its style declares,
which is how both products draw a polyline.

- **Reading** takes four path dialects, all through `parseSvgPath`, which resolves the
  relative commands both products write into absolute `M`/`L`/`C`/`Z`: ODF's
  `draw:points` (polygon closed, polyline open), its `svg:d` (`draw:path`, and a
  `draw:connector`, which carries the resolved elbow beside its endpoints), a
  `non-primitive` `draw:enhanced-path`, DrawingML's `a:custGeom` path list, and VML's
  `path` — whose cases are SVG's the other way round (`parseVmlPath`).
- A geometry of **formulas and arcs** is resolved once, for the shape's size, into a
  plain outline (`utils/enhancedGeometry.ts`): ODF's `draw:equation`s, `$N` modifiers
  and every path command, arcs as cubics (`arcBeziers`, quarter turns at most).
  LibreOffice writes its presets with an empty viewBox — the space is then the shape's
  size in 1/100 mm (`logwidth`/`logheight`) — and keeps the arcs (`G`, OOXML's
  `arcTo`) only in `drawooo:enhanced-path`, its `draw:` path being a stripped copy, so
  that one is read first. `drawooo:sub-view-size` gives each `N`-ended part its own
  space. A reference that will not resolve still drops the shape.
- An outline keeps its **parts** in ODF's notation: each ends with `N`, `F` marks one
  stroked only and `S` one filled only (`outlineParts`) — a preset fills its face once
  and draws its mouth or edges as lines over it. The node view draws the filled and the
  stroked parts as two paths, ODF writes the flags back, DOCX one `<a:path>` per part
  with `fill="none"`/`stroke="0"`. Flattened into one path, LibreOffice's even-odd fill
  cancelled a face drawn twice (probed). A part may also be **shaded** — `H I J K`,
  DrawingML's `darken`/`darkenLess`/`lighten`/`lightenLess` — and takes the fill scaled
  toward black by 0.6/0.8 or mixed 40/20 % toward white, truncated (`shadeColor`,
  measured on LibreOffice's cube). LibreOffice reads the shading only from
  `drawooo:enhanced-path`, so ODF writes that beside the plain `draw:` path.
- A **text area** (`shapeTextArea`, the 0…100 box) comes from ODF's `draw:text-areas`
  or DrawingML's `a:rect` and goes back out as both; the node view pads the text into
  it as into a built-in polygon's `textArea`.
- A **DrawingML preset** writes no path, only its name and adjust values. The ones the
  editor has no kind for (callouts, smiley, moon, connectors, …) are drawn from
  `utils/shapePresets.json`, LibreOffice's own table of all 187 in the same formula
  language (`scripts/make-shape-presets.mjs`, MPL-2.0, text areas included), with the
  file's `a:avLst` over its defaults and the flips mirrored in. Such a box keeps
  `shapePreset` (name, adjust values, flips) beside `shapePath`, its snapshot at import:
  the node view loads the table lazily and redraws outline and text area for the size it
  renders at, so a depth or corner keeps its measure. DOCX writes the `prstGeom` back;
  ODF writes the table's geometry as LibreOffice does (`draw:type="ooxml-name"`, empty
  viewBox, equations, `drawooo:` path), which LibreOffice resizes itself and which reads
  back as the preset. Handles are not draggable. A `custGeom`'s guides (`a:gdLst`) and
  `arcTo` go through `drawingMlGuides`/`drawingMlArc`; it and LibreOffice's own shape
  types stay fixed outlines.
- **Arrow heads** on an open outline ride `arrowHeads` (`start`/`end`/`both`): ODF's
  `draw:marker-*` on the style, DrawingML's `a:headEnd`/`a:tailEnd`, VML's
  `startarrow`/`endarrow`. The node view draws them like a line's, in real pixels along
  the path's first and last segment (`pathHeadPaths`); LibreOffice draws both exports'.
- **Groups** have no node: a `draw:g` opens as its members, as a DOCX `wpg:wgp` does.
  The members' coordinates are the anchor's (probed), the group's box is their union
  and its style places that box; the first member carries the placement and the rest
  run through over it (`convertDrawGroup`).
- **Writing** goes back out as the shape's own geometry: ODF a `non-primitive`
  `<draw:enhanced-geometry>` in its 21600 viewBox (probed: LibreOffice writes that
  straight back out unchanged), DOCX an `<a:custGeom>` path list in the shape's EMU
  extent. Both render in LibreOffice exactly as the editor draws them.
