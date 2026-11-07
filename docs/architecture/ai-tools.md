# AI assistant tools

What the assistant may change and how (`ai/tools.ts`), and how every feature is kept within its reach.
The assistant as a whole: `docs/architecture/ai.md`.

## Edits

- **Modes.** A switch under the chat field picks Chat or Edit (`mode` in `edentext-ai`, Edit
  by default). Chat offers only `read_paragraphs` and a prompt without the editing lines, and
  `runTool` refuses any other call a model makes anyway; the user copies what a reply proposes.
- **Text tools** (`replace_text`, `rewrite_paragraph`, `insert_paragraphs`,
  `delete_paragraphs`) go through `trackedReplace` (`trackChanges.ts`). Each edit becomes
  a revision by the localized author `t().ai.author`, whether or not recording is on.
  The Review pane accepts or rejects it. An edit over another author's pending change
  is refused: `markDeleted` would strike their insertion through under the AI's name. Track changes has no
  paragraph removal, so a paragraph `delete_paragraphs` leaves empty goes directly (a cell
  or frame keeps its last one).
- **`format`** uses `applyFormat`, the search-replace formatting, plus mark removal and the
  highlight; alignment, spacing, indent, line height, shading and a page break before are
  paragraph attributes set on the whole paragraphs, and `list` runs the list commands
  (`deeper`/`shallower` nest). `css` takes any further CSS (see Coverage); `list-style-type`
  and `start` there retype a list. `style` is a paragraph, character or list style; `link`
  and `bookmark` mark the text. Track changes cannot record formatting, so it applies
  directly and is undoable.
- **`set_style`** creates or changes a paragraph style (`putStyle`), by internal or display
  name; `border`/`border_top`/`border_bottom` take CSS (`borderAttr`), so a rule under every
  heading goes into its style, and `heading_numbers` sets the chapter numbering (`setOutline`).
- **`insert_frame`** builds the dialect's `<aside>` or `<img alt>` and inserts the frame at the
  start of the paragraph, directly; **`frame`** changes one's wrap (beside, above and below, in
  the line, in front of or behind the text), size, gap, position (`x_cm` from the column, `y_cm`
  from the paragraph, page or text area), rotation and stacking (`restackFrame`), moves it to
  another paragraph, deletes it (tracked, like text), or captions a picture: picture and caption
  go into one borderless text box in its place, as LibreOffice frames them.
  A paragraph's formatting lists its frames (`frame 1: picture 4×5cm right gap 0.32cm`), a
  sized picture in the line too, numbered as the tool takes them (deleted ones not counted), with position and rotation once set; a frame's CSS `margin` is its gap, else a new
  frame's.
- Numbers and booleans may come as strings, and every error names what is accepted ("unknown
  style …; styles are: …"), for small models.
- After a round that changed the text, a style or went through the host (page, zone, language),
  `runTurn` waits until `isPaginating` is false (`layoutSettled`) and appends `document now N
  pages, last page about X% full` to the round's last tool result; after 3s or in a hidden
  tab it appends nothing, since a stale count misleads more than none.
- A chat message sent while a turn runs shows at once and is queued (`takeQueued`): after
  the next round of tools, `runTurn` appends it to that round's last tool result, the one
  place both providers take text before the model's next step, and the reply goes on below
  it. A turn that ends without another round sends the queue as the next turn. Commands
  wait until nothing runs; Stop drops the queue.
- **`review`** accepts or rejects tracked changes, one (`R1`, numbered like comments from the
  turn's snapshot, listed after the document) or all, optionally one author's.
  The assistant's own changes go through at once; anyone else's only after the user
  confirms (`confirm` in `TurnContext`), since an opened document or attachment can ask the
  model to settle the reviewers' work. Without a way to ask they stay.
- **`add_comment`** comments as the assistant; **`reply_comment`** answers a thread and
  **`resolve_comment`** closes it, both directly and undoable.
- **`table`** (`table_insert` stays as an alias) adds a row or column with the table
  commands and tracks the new cells' text: inline HTML goes into the copied paragraph, a list or
  several paragraphs take its place; deleting rows or columns, `widths` (each cell's
  `colwidth` weights), `merge_right`/`merge_down`, `split`, `delete_table`, `shade`, `borders`,
  `style`, `css` (the cell's and its row's CSS), `formula`, `sort` (by the cell's column) and
  the `header_row`/`first_column`/`repeat_header` switches apply directly; one `value`
  carries each action's argument.
- **`set_columns`** runs `setColumns` over the paragraphs' range, which refuses a bare
  cursor's whole-document case; columns apply directly.
- **`set_header_footer`**, **`set_page`** and a document-wide **`set_language`** go through the `AiHost` that `App.svelte` hands
  the pane, since zones and page setup are its `$state` (storage would be overwritten by the
  next effect). `set_page` also sets the page number style, line numbers, hyphenation, fold
  marks, page border, background and watermark and the title, subject and keywords, which
  the document message lists as `Settings:` once they differ from a new document's; its
  `footnote_numbers` go straight to `setNoteSettings`. Setting a zone closes an open zone editor first; a first-page or even-page
  zone switches that variant on; `section` n > 1 writes that section's set (a gap filled
  with a copy of section 1's, which it showed), listed back as `Section 2 header:`. A reply's `<header>`, `<footer>` (`data-page`) and `<page>`
  (`splitDocumentHtml`) take the same way from `insert_paragraphs` and from a draft's
  Insert at cursor; the draft preview shows them as a line above and below. Only a draft into
  an empty document is asked for them.
- **`set_language`** takes a name ("English (UK)", "German") or tag; for paragraphs
  `from`/`to` it runs `setBlockLanguage` with any valid tag, for the document only a
  `LANGUAGES` entry (`pickDocumentLanguage` in the host).
- **`replace_text`** lets a form blank (a run of dots or underscores, an ellipsis) in `find`
  match any such run: a model miscounts long ones.
- **Paragraph numbers** come from the turn's snapshot. Every transaction during the turn
  is appended to a `Mapping`, so a number still finds its paragraph after earlier edits.
  Inserted paragraphs only get a number in the next turn.
- **Commands** insert like a paste. While recording is on, the change is
  tracked under the user's own name.

## Coverage

`tests/unit/ai-coverage.test.ts` is the coverage matrix: every schema node, mark and
attribute and every `RIBBON_COMMANDS` id has one entry, and a feature added without one
fails the suite. An entry is

- a **check**: tool calls on a small document and what must hold after them. Every check
  also asserts that `serializeDoc` changed, so what the assistant can set it can read;
- `same(key)`: reached the way another entry is (a ribbon command and its schema attr);
- `na(why)`: deliberately out of reach (UI and view actions, import-only attributes, Asian
  layout, the password, the user's recording switch);
- `browser(how)`: reached through CSS that only a browser parses, skipped in jsdom;
- `todo(what)`: an open gap, listed by `npm test` as a todo.

**Vocabulary, not parameters.** A feature is reached through what a model already writes:
CSS in `format.css` (paragraph CSS — margins, indents, line height, background, borders,
`break-*`, `widows`, `hyphens`, `direction`, `page: <name>` for a new section,
`tab-stops: 8cm center, 16cm right dotted` — sets the paragraphs; a property the browser
drops from `el.style` is read from the attribute, the rest the runs, both
through `htmlToSlice`, so the paste path's CSS parsing is the format vocabulary),
`frame.css` for a text box (background, border, padding, `writing-mode`,
`vertical-align`, `border-radius`), `table` action `css` for a cell and its row, and the
HTML guide's elements for fields (`\(…\)` formula, `<a id>` bookmark, `<a href="#x">`
cross-reference, `{figure}`/`{table}` caption numbers, `<dfn>`, `<cite>`,
`<time datetime format>`). Read and write use the same forms where they can (`\(…\)`,
`{figure}`), else a token (`{ref #x page}`, `{footnote}`, `{cite Key}`). A new feature
should first get a CSS or HTML mapping in `ai/dialect.ts`, then a parameter only if no
standard form exists.

**Budget.** The same file caps the tool schemas plus the edit-mode system prompt at 15,500
characters (about 3,900 tokens), so the request stays small enough for a local model. A
new parameter has to fit it or free room elsewhere.

**Open (todo):** none.
