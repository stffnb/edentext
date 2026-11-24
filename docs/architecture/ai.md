# AI assistant

A Copilot-style assistant on a provider the user brings: an OpenAI-compatible
`/chat/completions` server (Mistral, OpenRouter, Gemini, Ollama, LM Studio), OpenAI's
`/responses` or Anthropic's `/messages`. There is no edentext server; the browser talks to the provider
directly with the key from Settings ▸ AI.

## Kill switch

`storage/ai.svelte.ts` holds one app-wide key, `edentext-ai`, with `{enabled, provider,
endpoint, apiKey, model, contextTokens, mode, side, commands}`. On is the default, so the button is found; without an endpoint and model nothing is sent, and switching off is stored. `aiEnabled()` gates every surface:

- the AI button at the right end of every ribbon tab (`aiPane`) and its command-search entry;
- the context menu's AI submenu (body editor only), which stays, greyed with a hint
  pointing to Settings ▸ AI;
- `Alt+I` and the pane.

An embedding host's `ai: false` (`docs/architecture/embed.md`) switches it off above the
user's choice, unstored, and hides Settings ▸ AI and the context menu's submenu.

## Installation presets

A self-hoster presets the provider in `edentext.config.json` next to `index.html`
(`storage/hostConfig.svelte.ts`): `ai: { enabled, provider, endpoint, model, contextTokens,
locked }`, every field optional. It is fetched once at start (2 s limit, `no-cache`, the
service worker passes it through), never stored and checked strictly: unknown keys and
wrong types are dropped. A 404 presets nothing; the desktop app does not look for it.
Its `templates` section (the gallery's entries) is described in `docs/self-hosting.md`.

- **Order:** an embed option's object, then the file, then the user. `enabled: false`
  switches the assistant off like `ai: false`.
- **Unlocked**, the preset holds while the user has no address of their own; a model typed
  over it still counts. Settings ▸ AI shows "Set up by this installation" with the model,
  offers it as the provider "This installation" and hides the key row.
- **`locked: true`** uses only the host's fields; they show disabled. The kill switch,
  mode, side and commands stay the user's.
- **No key in the file**, which anyone can read: the host's endpoint is a same-origin proxy
  (`/ai/v1`, Helm chart and Docker image) that adds it. `aiInUse()` never sends the user's
  key there, and `ai/client.ts` sends no empty `x-api-key`.

`App.svelte` aborts every request in flight when the switch goes off. The network is gated
in the types as well: `ai/client.ts` is the only `fetch`, and it needs an `AiConfig`, which
`aiConfig()` only returns while the switch is on and an endpoint and model are set.

The key is stored unencrypted, like every other setting. Every repo on the same GitHub
Pages origin can read it, and the settings row says so. An address on plain `http://`
off this machine (`plainHttpEndpoint`) swaps the address row's hint for a warning that
text and key travel in the clear; a LAN model server is still allowed.

## Trust

The model reads text the user did not write: an opened document, an attachment, a
comment. Such text can instruct it, so the tools are limited to what a reader would
undo or see:

- Text edits are tracked changes under the assistant's name; Keep/Undo settles them.
- `review` settles anyone else's changes only after the user confirms
  (`docs/architecture/ai-tools.md`).
- A few tools act directly and undoably (comments, page setup, zones, language,
  columns, table structure); none reaches the network or the file system.
- A link the model writes is a normal link, so its URL could carry document text to
  another site, but only when the reader opens it (Ctrl-click, `noopener`). The model's
  HTML goes through the schema, which drops scripts, handlers and remote images, and the
  build's CSP blocks script on top.

## Modules

| File | Role |
|---|---|
| `ai/client.ts` | `streamChat`: request builders, SSE parsing and stream reducers for both providers; `AiError` and its user text |
| `ai/doc.ts` | The document as numbered lines (`blockTexts`, `serializeDoc`); the model's HTML as a slice (`htmlToSlice`) |
| `ai/tools.ts` | Tool schemas, `runTool`, the chat turn `runTurn`, prompts, and the abort registry |
| `ai/commands.ts` | Slash commands (`parseCommand`, `commandRequest`) and the helpers that place a reply |
| `components/AiPane.svelte` | Docked chat, right of the pages or left (`side` in `edentext-ai`, Settings ▸ AI; `order: -1` in the editor row). The history survives closing the pane and a reload (`storage/aiChat.ts`, doc-scoped `edentext-ai-chat`, written once a reply is complete); a new or opened document starts a new one |

## Document in, content out

**Input.** Every textblock is one line, `[n kind] text`; a cell's kind names its table, row
and column (`cell T1 r2 c3`, from `TableMap`, so merged cells count once); a list item or
numbered heading also carries the number the page shows (`li VI`, from `listNumberAt` and
`headingNumbers`), since the text refers to it; a text box's paragraphs follow their anchor
as `box 1`, and a list item in a cell carries both (`cell T1 r1 c2 li`). Inline atoms read as
tokens that cover them whole (`{image "alt"}`, `‹Name›` for a placeholder, `{date}`), so
`replace_text` can replace one. Style (by its shown name), alignment, page break, spacing, rules,
background, language and the direct formatting the paragraph style does not already give
follow in braces (`formatNote`), quoting the runs, colours as hex, so `find` still matches the
bare text; a page break or extra space explains a page the model cannot see. A run
of empty paragraphs folds to `[12–28] (empty)`. Lines mark where a page starts (`— page 2 —`,
from the last layout pass, `pageLayout`), how full the last page is, and where text columns
begin and end; the page setup (`Page: A4 portrait, margins …`), the document language and the headers and footers
(`{page}` for the field) follow. Comment threads follow the document as `[C1 on paragraph 4 «quote», by Ada,
open]` with their replies; their numbers come from the turn's snapshot. Text marked as a deletion is
left out, so the model reads the text as it will look once accepted. Past the budget
(`docBudget`: half the context size set in Settings ▸ AI, at four characters a token), the
head and the paragraphs around the selection are kept, and `read_paragraphs` returns
the rest. The selection goes along as quoted text; a chip above the chat field shows it
and its × deselects.

**Output.** The model writes the HTML it knows anyway, described in one short guide
(`HTML_GUIDE`, in the chat and draft prompts): semantic tags and plain CSS. `ai/dialect.ts`
(`normalizeAiHtml`) rewrites that into the data-* form the schema parses: paragraph CSS to
spacing, indent, line height, shading, borders and block font; a style class by internal or
display name; `<hr>` to a page break; `width` on `<td>`/`<col>` to every cell's `colwidth`
weight (the `<col>`s go, since TipTap reads them by cell index and skips the first);
`<aside>` to a text box anchored in the next paragraph; `<img alt>` without `src` to a
placeholder picture (a canvas PNG, which DOCX keeps; an SVG without a canvas); `<input
placeholder>`, `<time>`/`{date}`, `<section columns>` and `<nav>` to a placeholder, a date
field, text columns and a table of contents. `<sup class="footnote">` (or `endnote`) becomes
an anchor with a fresh id; its text cannot ride the slice, so `fillNotes` writes it into the
note the sync plugin made once the slice is in. A remote image is dropped and reported back.
Text with a tab is parsed with whitespace preserved, after the dialect collapsed the rest itself.
`htmlToSlice` parses the result in an
inert `DOMParser` document, drops the whitespace between top-level blocks (each would become
a paragraph holding a space), then goes through the schema, then `fitPastedSlice` (the paste
path's fixes). That drops scripts, handlers, unknown tags and remote images. Previews
serialize the slice back with `DOMSerializer`, so they show only what would be inserted.

## Edits and coverage

The tools, how each edit lands, and the coverage matrix with its prompt budget:
`docs/architecture/ai-tools.md`.

## Reply actions

- **Citations.** The prompt asks for `¶12` / `¶12–14`; `linkCitations` turns them into buttons
  after rendering, and a click selects those paragraphs by `blockTexts` of the current
  document, so a reply's numbers drift once later edits insert paragraphs before them.
- **Copy** writes the rendered reply as HTML and plain text. Insert at cursor shows under a draft only: a chat reply is
  mostly explanation.
- **Regenerate** (last reply) and **edit** (any question) go through `resend`: the entries from
  that question on go, the tracked changes they left pending are rejected, and the history is
  cut to the question's `historyAt`; a command keeps the selection it was first sent with.
- **Keep / Undo** under a reply accept or reject the tracked changes that turn made (`revs`,
  the assistant's revision ids new after `runTurn`) in one step, the `format` tool's run formatting too (`trackedFormat`).
  Its `clear` argument and table actions are no revisions, so Undo leaves them; Ctrl+Z takes them back.

## Attached files

The paperclip or a drop onto the pane attaches files as material (`ai/sources.ts`): .docx and
.odt through the importers, .txt/.md/.csv and .html as text; a PDF or a protected file is
refused. Their text (`sourcesBlock`, half the document budget shared out) prefaces the next
question that starts a turn or command, and only that one: the history keeps the question,
and the stored chat the file names (`files`) but not the text (`context`), so Regenerate
and Edit resend the files within the session only.

## Comments

A new comment or a reply that names the assistant (`mentionsAi`: `@` plus its localized
name or `@AI`, case-insensitive, not inside a word or address) starts `answerComment`
from `App.svelte`; a reply dispatches `AI_COMMENT_EVENT` from `CommentCard`. It is a turn
of its own, without the chat history: the newest message of the thread is the question,
chat mode adds `reply_comment` to the read-only tools, edit mode asks for the change first.
A model that answers as text instead of through the tool gets its text posted as the reply.
`aiAnswering` (thread id → `''` while running, else the error) drives the card's status
line; the request joins `startRequest`, so switching off or opening another document aborts it.

## Slash commands

A chat message starting with `/` is a command: `/draft <what>`, `/rewrite <how>`, and the
presets `/rephrase`, `/shorten`, `/formal`, `/fix`, `/translate [language]` (a preset takes
extra words as an addition; translate falls back to the UI language). Typing `/` lists them,
filtered by name or localized label. A command sends its fixed prompt without tools, so
small local models manage it; the rewrite commands need a selection, captured when sent. The
reply is a proposal: Replace or Insert below for a rewrite, Insert at cursor for a draft,
refused once the selected text changed. It enters the chat history, so a follow-up refines it.

Own commands (Settings ▸ AI, `commands` in `edentext-ai`) are saved prompts. `/name more`
expands to the prompt plus the rest (`expandCustom`) and runs as an ordinary chat turn, so it
has the tools in Edit mode; the chat shows what was typed. A built-in name wins, and the row
says so; the `/` list shows own commands after the built-ins, labelled by the prompt's first line.

Drafting has no window of its own: the context menu and `Alt+I` open the chat with
`/draft ` filled in (`OPEN_AI_CHAT_EVENT`, `askAi`). Rewriting has none either: with a
selection the chat shows the presets as chips, and they and the context menu's presets send
the command at once (`send` in the event); translate and Rewrite… fill the field instead.
After `/translate ` the `/` list offers the languages, filtered as typed; one sends at once.

## Providers

- **OpenAI** (`api.openai.com`, regional hosts too) is spoken to on `/responses` (`isOpenaiApi`):
  its reasoning models answer tools on `/chat/completions` with a 400, which the tool-less retry
  below would hide. `store: false`: a reply's reasoning items ride on its first call's `extra`.
- **Anthropic** needs `anthropic-dangerous-direct-browser-access: true` to answer a browser.
  Claude 5 thinks by default out of `max_tokens`, hence 32000; a reply stopped by `max_tokens`
  or `refusal` is an error, not a cut-off tool call run as `{}` or an empty answer.
- **Ollama** on its default port is spoken to natively (`/api/chat`, JSON lines): its `/v1`
  ignores a context size and loads the model with its own default, cutting a longer prompt
  silently; the native call sends `num_ctx` from the context size. A tool result names its tool
  (`tool_name`), as Ollama matches results by name.
- **Ollama** accepts `app://` (the desktop shell) by default. A web origin has to be
  listed in `OLLAMA_ORIGINS`; the network error says so for a localhost endpoint.
- **Models without tool support**: a 400 that mentions tools is retried once without tools,
  unless the turn already ran tools.
- **OpenRouter** gets `provider.require_parameters` with tools: otherwise a model none of whose
  providers take tools has them dropped silently.
- **Mistral**'s reasoning models stream `delta.content` as chunks; only the text ones are read.
- **Gemini 3** attaches a thought signature to each tool call (`extra_content`); it goes back
  unchanged with the call, or the next round answers 400.

Signing in with a ChatGPT subscription (Codex OAuth, desktop only) is not built.
