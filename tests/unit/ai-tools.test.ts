// The assistant's tools on a real body editor: numbered paragraphs, tracked text edits
// under its own author, direct formatting, numbers that survive earlier edits, and the
// chat turn's tool loop against a scripted provider.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { Mapping } from '@tiptap/pm/transform';
import { extensions } from '../../src/lib/editor/extensions';
import { revisions, trackedReplace } from '../../src/lib/editor/extensions/trackChanges';
import { blockLine, blockTexts, htmlToSlice, serializeDoc } from '../../src/lib/ai/doc';
import { deleteStyle, setOutline, styleSheet } from '../../src/lib/styles/sheet.svelte';
import type { Node as PMNode } from '@tiptap/pm/model';
import { comments } from '../../src/lib/editor/extensions/comment';
import { answerComment, mentionsAi, runTool, runTurn, type AiHost, type PageSetup, type TurnContext } from '../../src/lib/ai/tools';
import type { ToolCall } from '../../src/lib/ai/client';

const AI = 'AI';

function makeEditor(html: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions, content: html });
}

function turn(editor: Editor): TurnContext {
  const ctx: TurnContext = { editor, blocks: blockTexts(editor.state.doc), mapping: new Mapping(), author: AI };
  editor.on('transaction', ({ transaction }) => ctx.mapping.appendMapping(transaction.mapping));
  return ctx;
}

const call = (name: string, args: unknown): ToolCall => ({ id: name, name, args: JSON.stringify(args) });
const texts = (e: Editor) => blockTexts(e.state.doc).map((b) => b.text);

afterEach(() => vi.unstubAllGlobals());

describe('serializeDoc', () => {
  it('numbers every textblock, marks headings and hides deleted text', () => {
    const editor = makeEditor('<h1>Title</h1><p>The quick fox</p><ul><li><p>item</p></li></ul>');
    const { view, state } = editor;
    view.dispatch(trackedReplace(state.tr, 12, 18, null, 'Ada'));
    editor.commands.setTextSelection(3);
    expect(serializeDoc(editor.state)).toBe('Document, one paragraph per line, numbered:\n[1 h1] Title\n[2] The fox\n[3 li] item\n\nPage: A4 portrait, margins 2/2/2/2 cm (top/right/bottom/left)\nLanguage: English (US) (en-US)\n\nTracked changes, numbered:\n[R1 deletion by Ada on paragraph 2] «quick »\n\nThe cursor is in paragraph 1.');
    editor.destroy();
  });

  it('notes style, alignment and the runs that carry direct formatting', () => {
    const editor = makeEditor('<p style="text-align:center"><strong>all bold</strong></p><p>a <em>b</em> c <em>d</em><strong><em>e</em></strong></p><p><span style="font-size:14pt">big</span> x</p>');
    expect(blockTexts(editor.state.doc).map(blockLine)).toEqual([
      '[1] all bold {align center; bold: all}',
      '[2] a b c de {italic: "b", "de"; bold: "e"}',
      '[3] big x {size 14pt: "big"}',
    ]);
    const pic = makeEditor('<p>see <img src="data:image/png;base64,AA==" alt="A red logo"> and <img src="data:image/png;base64,AA=="></p>');
    expect(blockTexts(pic.state.doc).map(blockLine)).toEqual(['[1] see {image "A red logo"} and {image}']);
    pic.destroy();
    editor.destroy();
  });

  it('notes a page break, spacing, rules, background, language and a style by its shown name', () => {
    const editor = makeEditor('<p data-style="Quotations" data-page-break-before="page" data-space-before="18" data-pborder-bottom="1pt solid #4B5563" lang="en-GB">q</p><p data-bg="rgb(238, 238, 238)"><span style="color: rgb(192, 0, 0)">red</span></p>');
    expect(blockTexts(editor.state.doc).map(blockLine)).toEqual([
      '[1] q {style "Quote"; page break before; space before 18pt; border bottom 1pt solid #4B5563; lang en-GB}',
      '[2] red {background #EEEEEE; color #C00000: all}',
    ]);
    editor.destroy();
  });

  it('shows list numbers, leaves out what the style gives, folds empty runs and marks columns', () => {
    const editor = makeEditor('<ol><li><p>one</p></li><li><p>two</p></li></ol><p><span style="font-size:12pt">plain</span></p><p></p><p></p><p></p><p>end</p>');
    editor.chain().setTextSelection({ from: editor.state.doc.content.size - 4, to: editor.state.doc.content.size - 1 }).setColumns(2).run();
    expect(serializeDoc(editor.state)).toMatch(/^Document[^\n]*\n\[1 li 1\] one\n\[2 li 2\] two\n\[3\] plain\n\[4–6\] \(empty\)\n— 2 columns —\n\[7\] end\n/);
    editor.destroy();
  });

  it('keeps the head and the selection when over budget', () => {
    const editor = makeEditor(Array.from({ length: 200 }, (_, i) => `<p>paragraph number ${i + 1}</p>`).join(''));
    const last = blockTexts(editor.state.doc)[149];
    editor.commands.setTextSelection(last.from);
    const out = serializeDoc(editor.state, undefined, 2000);
    expect(out).toContain('[1] paragraph number 1\n');
    expect(out).toContain('[150] paragraph number 150');
    expect(out).toMatch(/\[… paragraphs \d+–\d+ omitted/);
    expect(out.length).toBeLessThan(2400);
    editor.destroy();
  });
});

describe('tools', () => {
  it('leaves a picture marked as deleted out of what the model reads', () => {
    const editor = makeEditor('<p>a<img src="data:image/png;base64,iVBORw0KGgo=" alt="Old">b</p>');
    expect(blockTexts(editor.state.doc)[0].text).toBe('a{image "Old"}b');
    expect(runTool(turn(editor), call('delete_paragraphs', { from: 1, to: 1 })).result).toBe('ok');
    expect(blockTexts(editor.state.doc)[0].text).toBe('');
    editor.destroy();
  });

  it('removes empty paragraphs it deletes, but leaves a cell its last one', () => {
    const editor = makeEditor('<p>a</p><p></p><p></p><p>b</p><table><tr><td><p></p></td></tr></table>');
    expect(runTool(turn(editor), call('delete_paragraphs', { from: 2, to: 3 })).result).toBe('ok');
    // The paragraph after the table is the editor's own, for the caret.
    expect(texts(editor)).toEqual(['a', 'b', '', '']);
    expect(runTool(turn(editor), call('delete_paragraphs', { from: 3, to: 3 })).result).toMatch(/^error: empty range/);
    editor.destroy();
  });

  it('lists a picture in the line as a frame, so its size can be changed', () => {
    const editor = makeEditor('<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="Pic" width="378" height="189"></p>');
    expect(blockTexts(editor.state.doc).map(blockLine)[0]).toContain('frame 1: picture 10×5cm inline');
    expect(runTool(turn(editor), call('frame', { paragraph: 1, width_cm: 5, height_cm: 2.5 })).result).toBe('ok');
    expect(blockTexts(editor.state.doc).map(blockLine)[0]).toContain('frame 1: picture 5×2.5cm inline');
    editor.destroy();
  });

  it('removes a picture it inserted itself outright when it deletes it', () => {
    const editor = makeEditor('<p>Title</p>');
    expect(runTool(turn(editor), call('insert_paragraphs', { after: 1, html: '<p><img alt="Pic" width="4cm" height="3cm"></p>' })).result).toBe('ok');
    expect(runTool(turn(editor), call('delete_paragraphs', { from: 2, to: 2 })).result).toBe('ok');
    let images = 0;
    editor.state.doc.descendants((n) => { if (n.type.name === 'image') images++; });
    expect(images).toBe(0);
    expect(revisions(editor.state.doc).filter((r) => r.kind === 'deletion')).toHaveLength(0);
    editor.destroy();
  });

  it('replaces text as a tracked change by the assistant, and reject restores it', () => {
    const editor = makeEditor('<p>One</p><p>The <strong>quick</strong> fox</p>');
    const ctx = turn(editor);
    expect(runTool(ctx, call('replace_text', { paragraph: 2, find: 'quick', replace: 'slow' })).result).toBe('ok');
    expect(revisions(editor.state.doc).map((r) => [r.kind, r.text, r.author])).toEqual([['deletion', 'quick', AI], ['insertion', 'slow', AI]]);
    // The replacement keeps the passage's own formatting.
    const slow = revisions(editor.state.doc)[1];
    expect(editor.state.doc.nodeAt(slow.from)?.marks.some((m) => m.type.name === 'bold')).toBe(true);
    editor.commands.rejectRevisions(true);
    expect(texts(editor)).toEqual(['One', 'The quick fox']);
    editor.destroy();
  });

  it('keeps numbers valid after an earlier insertion', () => {
    const editor = makeEditor('<p>alpha</p><p>beta</p><p>gamma</p>');
    const ctx = turn(editor);
    expect(runTool(ctx, call('insert_paragraphs', { after: 0, html: '<p>new one</p><p>new two</p>' })).result).toBe('ok');
    expect(runTool(ctx, call('replace_text', { paragraph: 3, find: 'gamma', replace: 'delta' })).result).toBe('ok');
    editor.commands.acceptRevisions(true);
    expect(texts(editor)).toEqual(['new one', 'new two', 'alpha', 'beta', 'delta']);
    editor.destroy();
  });

  it('deletes and rewrites paragraphs as tracked changes', () => {
    const editor = makeEditor('<p>keep</p><p>drop me</p><p>old text</p>');
    const ctx = turn(editor);
    runTool(ctx, call('delete_paragraphs', { from: 2, to: 2 }));
    runTool(ctx, call('rewrite_paragraph', { paragraph: 3, html: 'new <em>text</em>' }));
    expect(texts(editor)).toEqual(['keep', '', 'new text']);
    editor.commands.rejectRevisions(true);
    expect(texts(editor)).toEqual(['keep', 'drop me', 'old text']);
    // Plain text and a whole <p> are a paragraph's new text too.
    runTool(ctx, call('rewrite_paragraph', { paragraph: 1, html: 'plain' }));
    runTool(ctx, call('rewrite_paragraph', { paragraph: 2, html: '<p>wrapped</p>' }));
    editor.commands.acceptRevisions(true);
    expect(texts(editor)).toEqual(['plain', 'wrapped', 'old text']);
    editor.destroy();
  });

  it('records formatting and a heading style as one change each', () => {
    const editor = makeEditor('<p>Summary line</p><p>body</p>');
    const ctx = turn(editor);
    expect(runTool(ctx, call('format', { from: 1, bold: true })).result).toBe('ok');
    expect(editor.state.doc.firstChild?.firstChild?.marks.map((m) => m.type.name)).toContain('bold');
    expect(runTool(ctx, call('format', { from: 1, bold: false, style: 'Heading 2' })).result).toBe('ok');
    const first = editor.state.doc.firstChild!;
    expect(first.type.name).toBe('heading');
    expect(first.attrs.level).toBe(2);
    expect(first.firstChild?.marks.some((m) => m.type.name === 'bold')).toBe(false);
    expect(revisions(editor.state.doc).map((r) => r.kind)).toEqual(['formatChange']);
    editor.commands.rejectRevisions(true);
    expect(editor.getHTML()).toBe('<p>Summary line</p><p>body</p>');
    editor.destroy();
  });

  it('refuses to edit over somebody else’s pending change', () => {
    const editor = makeEditor('<p>The quick fox</p>');
    editor.view.dispatch(trackedReplace(editor.state.tr, 5, 10, null, 'Ada'));
    const ctx = turn(editor);
    const r = runTool(ctx, call('rewrite_paragraph', { paragraph: 1, html: 'other' }));
    expect(r.result).toMatch(/^error: .*tracked changes/);
    expect(revisions(editor.state.doc).map((x) => x.author)).toEqual(['Ada']);
    editor.destroy();
  });

  it('labels cells by table, row and column, and inserts a filled row or column', () => {
    const editor = makeEditor('<p>x</p><table><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table>');
    expect(blockTexts(editor.state.doc).map((b) => b.kind)).toEqual(['', 'cell T1 r1 c1', 'cell T1 r1 c2', 'cell T1 r2 c1', 'cell T1 r2 c2']);
    const listed = makeEditor('<table><tr><td><p>A</p></td><td><ul><li><p>B</p></li></ul></td></tr></table>');
    expect(blockTexts(listed.state.doc).map((b) => b.kind)).toEqual(['cell T1 r1 c1', 'cell T1 r1 c2 li']);
    listed.destroy();
    const ctx = turn(editor);
    expect(runTool(ctx, call('table_insert', { paragraph: 3, where: 'column_right', cells: ['<strong>C</strong>', '3'] })).result).toBe('ok');
    expect(runTool(ctx, call('table_insert', { paragraph: 2, where: 'row_above', cells: ['h'] })).result).toBe('ok');
    expect(revisions(editor.state.doc).map((r) => [r.kind, r.text, r.author])).toEqual([['insertion', 'h', AI], ['insertion', 'C', AI], ['insertion', '3', AI]]);
    expect(blockTexts(editor.state.doc).map((b) => `${b.kind}=${b.text}`).slice(1, 10)).toEqual([
      'cell T1 r1 c1=h', 'cell T1 r1 c2=', 'cell T1 r1 c3=',
      'cell T1 r2 c1=A', 'cell T1 r2 c2=B', 'cell T1 r2 c3=C',
      'cell T1 r3 c1=1', 'cell T1 r3 c2=2', 'cell T1 r3 c3=3',
    ]);
    expect(runTool(ctx, call('table_insert', { paragraph: 1, where: 'row_below' })).result).toMatch(/not in a table/);
    editor.destroy();
  });

  it('gives a new row the formatting of the row it was inserted from', () => {
    const editor = makeEditor('<table><tr><td style="background-color:#ffcc00"><p style="text-align:justify">a</p></td><td><p style="text-align:right">1</p></td></tr></table>');
    expect(runTool(turn(editor), call('table_insert', { paragraph: 2, where: 'row_below', cells: ['b', '2'] })).result).toBe('ok');
    const cells: string[] = [];
    editor.state.doc.descendants((n) => { if (n.type.name === 'tableCell') cells.push(`${n.attrs.backgroundColor} ${n.firstChild!.attrs.textAlign} ${n.textContent}`); });
    expect(cells.slice(2)).toEqual(['#FFCC00 justify b', 'null right 2']);
    editor.destroy();
  });

  it('fills a new cell with a list or several paragraphs as tracked blocks', () => {
    const editor = makeEditor('<table><tr><td><p>a</p></td><td><p>1</p></td></tr></table>');
    expect(runTool(turn(editor), call('table', { paragraph: 1, action: 'row_below', cells: ['<ul><li>x</li><li>y</li></ul>', '<p>p</p><p>q</p>'] })).result).toBe('ok');
    expect(blockTexts(editor.state.doc).map((b) => `${b.kind}=${b.text}`).slice(2, 6)).toEqual(['cell T1 r2 c1 li=x', 'cell T1 r2 c1 li=y', 'cell T1 r2 c2=p', 'cell T1 r2 c2=q']);
    expect(revisions(editor.state.doc).map((r) => r.author)).toContain(AI);
    editor.destroy();
  });

  it('sets the document language through the host and a paragraph\'s on it', () => {
    const editor = makeEditor('<p>one</p><p>two</p>');
    const langs: string[] = [];
    const ctx = { ...turn(editor), host: { setZone: () => {}, setPage: () => {}, setLanguage: (c: string) => langs.push(c) } };
    expect(runTool(ctx, call('set_language', { language: 'English (UK)' })).result).toBe('ok');
    expect(runTool(ctx, call('set_language', { language: 'german' })).result).toBe('ok');
    expect(langs).toEqual(['en-GB', 'de']);
    expect(runTool(ctx, call('set_language', { language: 'Klingon' })).result).toMatch(/unknown language "Klingon"; languages are: English \(US\)/);
    expect(runTool(ctx, call('set_language', { language: 'it-IT', from: 2 })).result).toBe('ok');
    expect(editor.state.doc.child(1).attrs.lang).toBe('it-IT');
    expect(runTool(turn(editor), call('set_language', { language: 'de' })).result).toMatch(/cannot be changed here/);
    editor.destroy();
  });

  it('fills a form blank however many dots the model copies, and sets columns', () => {
    const editor = makeEditor(`<p>Name: ${'.'.repeat(40)} (employee)</p><p>Second</p><p></p>`);
    const ctx = turn(editor);
    expect(runTool(ctx, call('replace_text', { paragraph: 1, find: 'Name: ……', replace: 'Name: Ada Byron' })).result).toBe('ok');
    expect(texts(editor)[0]).toBe('Name: Ada Byron (employee)');
    expect(runTool(ctx, call('set_columns', { from: 3, count: 2 })).result).toMatch(/empty/);
    expect(runTool(ctx, call('set_columns', { from: 1, to: 2, count: 2 })).result).toBe('ok');
    expect(blockTexts(editor.state.doc).map((b) => b.columns)).toEqual([2, 2, 1]);
    editor.destroy();
  });

  it('lists comment threads, replies to one and resolves it', () => {
    const editor = makeEditor('<p>alpha</p><p>beta gamma</p>');
    editor.chain().setTextSelection({ from: 8, to: 12 }).addComment({ author: 'Ada', text: 'Why beta?' }).run();
    editor.commands.setTextSelection(1);
    expect(serializeDoc(editor.state)).toContain('Comments, numbered:\n[C1 on paragraph 2 «beta», by Ada, open] Why beta?');
    const ctx = { ...turn(editor), commentIds: undefined };
    expect(runTool(ctx, call('reply_comment', { comment: 1, text: 'It is the second letter.' })).result).toBe('ok');
    expect(runTool(ctx, call('resolve_comment', { comment: 1 })).result).toBe('ok');
    expect(runTool(ctx, call('resolve_comment', { comment: 2 })).result).toMatch(/no comment C2/);
    expect(serializeDoc(editor.state)).toContain('[C1 on paragraph 2 «beta», by Ada, resolved] Why beta?\n  ↳ AI: It is the second letter.');
    editor.destroy();
  });

  it('returns failures to the model as text', () => {
    const editor = makeEditor('<p>x</p>');
    const ctx = turn(editor);
    expect(runTool(ctx, call('replace_text', { paragraph: 9, find: 'a', replace: 'b' })).result).toMatch(/^error: no paragraph 9/);
    expect(runTool(ctx, { id: '1', name: 'format', args: '{oops' }).result).toMatch(/^error:/);
    expect(runTool(ctx, call('nope', {})).result).toBe('error: unknown tool nope');
    editor.destroy();
  });
});

describe('htmlToSlice', () => {
  it('keeps only what the schema knows', () => {
    const editor = makeEditor('<p></p>');
    const slice = htmlToSlice('<p onclick="x()">a<script>alert(1)</script><img src="https://evil.test/x.png" onerror="y()"><strong>b</strong></p>', editor.state);
    const json = JSON.stringify(slice.content.toJSON());
    expect(json).not.toMatch(/script|onerror|onclick|evil/);
    expect(slice.content.textBetween(0, slice.content.size)).toBe('ab');
    expect(htmlToSlice('```html\n<p>x</p>\n```', editor.state).content.textBetween(0, 3)).toBe('x');
    editor.destroy();
  });

  it('reads markdown emphasis as marks, but not a product', () => {
    const editor = makeEditor('<p></p>');
    const marks = (html: string) => {
      const out: string[] = [];
      htmlToSlice(html, editor.state).content.descendants((n) => { if (n.isText) out.push(`${n.marks.map((m) => m.type.name).join('+')}:${n.text}`); });
      return out;
    };
    expect(marks('<p>**Summary:** a *b*</p>')).toEqual(['bold:Summary:', ': a ', 'italic:b']);
    expect(marks('**x** and 2 * 3 * 4')).toEqual(['bold:x', ': and 2 * 3 * 4']);
    editor.destroy();
  });
});

describe('runTurn', () => {
  const cfg = { provider: 'openai' as const, endpoint: 'http://mock.test/v1', apiKey: '', model: 'm' };
  const reply = (delta: unknown) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);

  it('runs tool rounds until the model answers, and records the turn', async () => {
    const editor = makeEditor('<p>Hello world</p>');
    const bodies: { messages: { role: string; content?: string }[] }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return bodies.length === 1
        ? reply({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'replace_text', arguments: '{"paragraph":1,"find":"world","replace":"there"}' } }] })
        : reply({ content: '<p>Changed it.</p>' });
    }));
    const history: never[] = [];
    const tools: string[] = [];
    const answer = await runTurn({ cfg, editor, history, question: 'Change it', author: AI, onText: () => {}, onTool: (s) => tools.push(s), signal: new AbortController().signal });
    expect(answer).toBe('<p>Changed it.</p>');
    expect(tools).toHaveLength(1);
    expect(bodies[0].messages[1].content).toContain('[1] Hello world');
    expect(bodies[1].messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'ok' });
    expect(history).toEqual([{ role: 'user', content: 'Change it' }, { role: 'assistant', content: '<p>Changed it.</p>' }]);
    editor.commands.acceptRevisions(true);
    expect(texts(editor)).toEqual(['Hello there']);
    editor.destroy();
  });

  it('offers only reading in chat mode and refuses an edit all the same', async () => {
    const editor = makeEditor('<p>Hello world</p>');
    const bodies: { tools?: { function: { name: string } }[]; messages: { role: string; content?: string }[] }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return bodies.length === 1
        ? reply({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'replace_text', arguments: '{"paragraph":1,"find":"world","replace":"there"}' } }] })
        : reply({ content: 'I can only suggest it.' });
    }));
    await runTurn({ cfg: { ...cfg, mode: 'chat' as const }, editor, history: [], question: 'Change it', author: AI, onText: () => {}, onTool: () => {}, signal: new AbortController().signal });
    expect(bodies[0].tools?.map((d) => d.function.name)).toEqual(['read_paragraphs']);
    expect(bodies[1].messages.at(-1)?.content).toMatch(/^error: chat mode/);
    expect(texts(editor)).toEqual(['Hello world']);
    expect(revisions(editor.state.doc)).toHaveLength(0);
    editor.destroy();
  });

  it('answers "@AI" in a comment thread, through the tool or with its text', async () => {
    expect(mentionsAi('@AI please check')).toBe(true);
    expect(mentionsAi('see mail@AI.org or @AIR')).toBe(false);
    const editor = makeEditor('<p>alpha</p><p>beta gamma</p>');
    editor.chain().setTextSelection({ from: 8, to: 12 }).addComment({ author: 'Ada', text: '@AI why beta?' }).run();
    const id = comments(editor.state.doc)[0].id;
    const bodies: { tools?: { function: { name: string } }[]; messages: { role: string; content?: string }[] }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return bodies.length === 1
        ? reply({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'reply_comment', arguments: '{"comment":1,"text":"Second letter."}' } }] })
        : reply({ content: 'Done.' });
    }));
    await answerComment({ cfg: { ...cfg, mode: 'chat' as const }, editor, id, signal: new AbortController().signal });
    expect(bodies[0].tools?.map((d) => d.function.name)).toEqual(['read_paragraphs', 'reply_comment']);
    expect(bodies[0].messages.at(-1)?.content).toContain('In comment C1, Ada asks you: «@AI why beta?»');
    expect(comments(editor.state.doc)[0].replies.map((r) => r.text)).toEqual(['Second letter.']);
    vi.stubGlobal('fetch', vi.fn(async () => reply({ content: '<p>Because it is.</p>' })));
    await answerComment({ cfg, editor, id, signal: new AbortController().signal });
    expect(comments(editor.state.doc)[0].replies.map((r) => `${r.author}: ${r.text}`)).toEqual(['AI: Second letter.', 'AI: Because it is.']);
    editor.destroy();
  });

  it('hands a message sent meanwhile to the next round', async () => {
    const editor = makeEditor('<p>x</p>');
    const bodies: { messages: { role: string; content?: string }[] }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return bodies.length === 1
        ? reply({ tool_calls: [{ index: 0, id: 'r', function: { name: 'read_paragraphs', arguments: '{"from":1,"to":1}' } }] })
        : reply({ content: 'Done.' });
    }));
    const history: never[] = [];
    let queue = ['also bold'];
    await runTurn({ cfg, editor, history, question: 'q', author: AI, onText: () => {}, onTool: () => {}, signal: new AbortController().signal, takeQueued: () => { const q = queue; queue = []; return q; } });
    expect(bodies[1].messages.at(-1)?.content).toMatch(/\(The user adds while you work: also bold\)$/);
    expect(history[0]).toEqual({ role: 'user', content: 'q\n\nalso bold' });
    editor.destroy();
  });

  it('stops after a bounded number of rounds', async () => {
    const editor = makeEditor('<p>x</p>');
    const fetch = vi.fn(async () => reply({ tool_calls: [{ index: 0, id: 'r', function: { name: 'read_paragraphs', arguments: '{"from":1,"to":1}' } }] }));
    vi.stubGlobal('fetch', fetch);
    await runTurn({ cfg, editor, history: [], question: 'loop', author: AI, onText: () => {}, onTool: () => {}, signal: new AbortController().signal });
    // It keeps asking while tools are called, and still gives up on a model that never stops.
    expect(fetch.mock.calls.length).toBeGreaterThan(2);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(32);
    editor.destroy();
  });

  it('aborts', async () => {
    const editor = makeEditor('<p>x</p>');
    const ctrl = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      ctrl.abort();
      throw init.signal?.reason ?? new DOMException('aborted', 'AbortError');
    }));
    await expect(runTurn({ cfg, editor, history: [], question: 'q', author: AI, onText: () => {}, onTool: () => {}, signal: ctrl.signal })).rejects.toBeDefined();
    editor.destroy();
  });

  it('reads placeholders, fields and text boxes, and replaces a placeholder by its token', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    const editor = makeEditor('<p>Dear <span data-placeholder-field="Name"></span>, <span data-datetime-field="date"></span></p>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertTextBox();
    const blocks = blockTexts(editor.state.doc);
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([['', 'Dear ‹Name›, {date}'], ['box 1', '']]);
    expect(runTool(turn(editor), call('replace_text', { paragraph: 1, find: '‹Name›', replace: 'Ada' })).result).toBe('ok');
    expect(editor.state.doc.firstChild!.textContent).toContain('Ada');
    editor.destroy();
  });

  it('sets headers, footers and the page through the host, also from inserted HTML', () => {
    const editor = makeEditor('<p>Body</p>');
    const zones: [string, string, unknown][] = [];
    const pages: PageSetup[] = [];
    const host: AiHost = { setZone: (z, v, d) => zones.push([z, v, d]), setPage: (p) => pages.push(p) };
    const ctx = { ...turn(editor), host };
    expect(runTool(ctx, call('set_header_footer', { zone: 'footer', html: '<p style="text-align:center">Page {page} of {pages}</p>' })).result).toBe('ok');
    const footer = JSON.stringify(zones[0][2]);
    expect(zones[0].slice(0, 2)).toEqual(['footer', 'default']);
    expect(footer).toContain('"pageNumber"');
    expect(footer).toContain('"pageCount"');
    expect(footer).toContain('"textAlign":"center"');
    expect(runTool(ctx, call('set_header_footer', { zone: 'header', pages: 'first', html: '' })).result).toBe('ok');
    expect(zones[1]).toEqual(['header', 'first', null]);
    expect(runTool(ctx, call('set_page', { size: 'a5', orientation: 'landscape', margins_cm: '2 2 2 2.5', page_numbers_start: '3' })).result).toBe('ok');
    expect(pages[0]).toEqual({ format: 'A5', orientation: 'landscape', margins: { top: 2, right: 2, bottom: 2, left: 2.5 }, start: 3 });
    expect(runTool(ctx, call('set_page', { size: 'B12' })).result).toMatch(/unknown page size "B12"; sizes are: A3/);
    expect(runTool(ctx, call('insert_paragraphs', { after: 1, html: '<page size="letter"/><header><p>Letterhead</p></header><p>New</p>' })).result).toBe('ok');
    expect(pages[1]).toEqual({ format: 'letter' });
    // A typed box is a size of its own, or the named one it equals; its sides set the orientation.
    expect(runTool(ctx, call('set_page', { size: '20 x 12,3 cm' })).result).toBe('ok');
    expect(runTool(ctx, call('set_page', { size: '21x29.7' })).result).toBe('ok');
    expect(pages.slice(2)).toEqual([{ format: '12.3x20', orientation: 'landscape' }, { format: 'A4', orientation: 'portrait' }]);
    expect(runTool(ctx, call('set_page', { size: '0x20' })).result).toMatch(/unknown page size/);
    expect(JSON.stringify(zones[2][2])).toContain('Letterhead');
    expect(texts(editor)).toEqual(['Body', 'New']);
    expect(runTool(turn(editor), call('set_page', { size: 'A4' })).result).toMatch(/cannot be changed here/);
    editor.destroy();
  });

  it('formats paragraphs as blocks, makes lists and highlights', () => {
    const editor = makeEditor('<p>one</p><p>two</p><p>three</p>');
    const ctx = turn(editor);
    expect(runTool(ctx, call('format', { from: 1, to: 2, align: 'centre', space_after_pt: '6', indent_cm: 1, line_height: 1.5, background: '#eee', page_break_before: 'true' })).result).toBe('ok');
    const first = editor.state.doc.firstChild!;
    expect(first.attrs).toMatchObject({ textAlign: 'center', spaceAfter: 6, indent: 1, lineHeight: '1.5', backgroundColor: '#EEEEEE', breakBefore: 'page' });
    expect(runTool(ctx, call('format', { from: 3, find: 'hre', highlight: '#ffff00' })).result).toBe('ok');
    expect(editor.state.doc.lastChild!.child(1).marks.map((x) => x.type.name)).toContain('highlight');
    expect(runTool(ctx, call('format', { from: 2, to: 3, list: 'number' })).result).toBe('ok');
    expect(editor.state.doc.child(1).type.name).toBe('orderedList');
    expect(runTool(ctx, call('format', { from: 1, align: 'middle' })).result).toMatch(/align is one of/);
    editor.destroy();
  });

  it('creates and changes paragraph styles and the heading numbers', () => {
    const editor = makeEditor('<h1>Title</h1><p>x</p>');
    const ctx = turn(editor);
    expect(runTool(ctx, call('set_style', { name: 'Ad Copy', based_on: 'quote', size_pt: '14', bold: true, align: 'center' })).result).toBe('ok');
    expect(styleSheet().paragraph['Ad Copy']).toMatchObject({ parent: 'Quotations', text: { fontSizePt: 14, bold: true }, para: { textAlign: 'center' } });
    expect(runTool(ctx, call('set_style', { name: 'ad copy', color: '#c00000' })).result).toBe('ok');
    expect(styleSheet().paragraph['Ad Copy'].text).toMatchObject({ fontSizePt: 14, color: '#C00000' });
    expect(runTool(ctx, call('set_style', { name: 'Heading 1', heading_numbers: '1.1' })).result).toBe('ok');
    expect(styleSheet().outline).toBeTruthy();
    expect(runTool(ctx, call('set_style', { name: 'Heading 2', border_bottom: '1px solid #4b5563' })).result).toBe('ok');
    expect(styleSheet().paragraph['Heading 2'].para.borderBottom).toBe('0.75pt solid #4B5563');
    expect(runTool(ctx, call('set_style', { name: 'Heading 2', border: 'none' })).result).toBe('ok');
    expect(styleSheet().paragraph['Heading 2'].para.borderBottom).toBeUndefined();
    expect(runTool(ctx, call('set_style', { name: 'X', based_on: 'Nope' })).result).toMatch(/unknown style "Nope"; styles are:/);
    deleteStyle('Ad Copy');
    setOutline(null);
    editor.destroy();
  });

  it('changes widths, merges, shades, deletes and styles through the table tool', () => {
    const editor = makeEditor('<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>1</p></td><td><p>2</p></td><td><p>3</p></td></tr></table>');
    const ctx = turn(editor);
    const cells = () => { const out: PMNode[] = []; editor.state.doc.descendants((n) => { if (n.type.name === 'tableCell') out.push(n); return n.type.name !== 'tableCell'; }); return out; };
    expect(runTool(ctx, call('table', { paragraph: 1, action: 'widths', widths: [20, 40, 40] })).result).toBe('ok');
    expect(cells().map((c) => c.attrs.colwidth)).toEqual([[20], [40], [40], [20], [40], [40]]);
    expect(runTool(ctx, call('table', { paragraph: 4, action: 'shade', color: '#dddddd' })).result).toBe('ok');
    expect(cells()[3].attrs.backgroundColor).toBe('#DDDDDD');
    expect(runTool(ctx, call('table', { paragraph: 2, action: 'merge_right' })).result).toBe('ok');
    expect(cells()[1].attrs.colspan).toBe(2);
    expect(runTool(ctx, call('table', { paragraph: 1, action: 'borders', borders: 'none' })).result).toBe('ok');
    expect(cells()[0].attrs.borderTop).toBe('none');
    expect(runTool(ctx, call('table', { paragraph: 1, action: 'style', style: 'simple grid' })).result).toBe('ok');
    expect(editor.state.doc.firstChild!.attrs.tableStyle).toBe('Simple Grid');
    expect(runTool(ctx, call('table', { paragraph: 4, action: 'delete_row' })).result).toBe('ok');
    expect(cells().length).toBe(2);
    expect(runTool(ctx, call('table', { paragraph: 1, action: 'explode' })).result).toMatch(/action is one of/);
    editor.destroy();
  });

  it('anchors a text box or a picture placeholder at a paragraph', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    const editor = makeEditor('<p>Name</p><p>Rest</p>');
    const ctx = turn(editor);
    expect(runTool(ctx, call('insert_frame', { paragraph: 1, kind: 'picture', width_cm: 4, height_cm: 5, wrap: 'right', html: 'Photo' })).result).toBe('ok');
    const img = editor.state.doc.firstChild!.firstChild!;
    expect(img.type.name).toBe('image');
    expect(img.attrs).toMatchObject({ alt: 'Photo', width: 151, wrap: 'right' });
    expect(runTool(ctx, call('insert_frame', { paragraph: 2, kind: 'text_box', html: '<p>Contact</p>' })).result).toBe('ok');
    const box = editor.state.doc.child(1).firstChild!;
    expect(box.type.name).toBe('textBox');
    expect(box.textContent).toBe('Contact');
    editor.destroy();
  });

  it('changes a frame\'s wrap, size and gap, and lists it in the paragraph\'s formatting', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    const editor = makeEditor('<p>Name</p>');
    const ctx = turn(editor);
    expect(runTool(ctx, call('insert_frame', { paragraph: 1, kind: 'picture', wrap: 'right', gap_cm: '0.1 0.4 0.1 0.4' })).result).toBe('ok');
    expect(editor.state.doc.firstChild!.firstChild!.attrs.wrapDist).toEqual({ top: 0.1, right: 0.4, bottom: 0.1, left: 0.4 });
    expect(runTool(ctx, call('frame', { paragraph: 1, gap_cm: 0.6, width_cm: 3 })).result).toBe('ok');
    const img = editor.state.doc.firstChild!.firstChild!;
    expect(img.attrs).toMatchObject({ width: 113, wrapDist: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 } });
    expect(runTool(ctx, call('frame', { paragraph: 1, frame: 2 })).result).toMatch(/has 1 frame/);
    expect(serializeDoc(editor.state)).toContain('frame 1: picture 3×5cm right gap 0.6cm');
    editor.destroy();
  });

  it('places, stacks, rotates, moves, captions and deletes a frame', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    const pic = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Pic" width="151" height="113" data-wrap="right">';
    const editor = makeEditor(`<p>one ${pic}</p><p>two ${pic.replace('Pic', 'Other')}</p><p>three</p>`);
    const frames = () => { const out: PMNode[] = []; editor.state.doc.descendants((n) => { if (n.type.name === 'image' || n.type.name === 'textBox') out.push(n); }); return out; };
    expect(runTool(turn(editor), call('frame', { paragraph: 1, stack: 'front' })).result).toMatch(/in_front or behind/);
    expect(runTool(turn(editor), call('frame', { paragraph: 1, wrap: 'in_front', x_cm: 2, y_cm: 3, y_from: 'page', rotation: -90 })).result).toBe('ok');
    expect(runTool(turn(editor), call('frame', { paragraph: 2, wrap: 'in_front' })).result).toBe('ok');
    expect(blockTexts(editor.state.doc).map(blockLine)[0]).toContain('picture 4×3cm in front of text at x 2 y 3cm from page rotated 270°');
    expect(runTool(turn(editor), call('frame', { paragraph: 1, stack: 'front' })).result).toBe('ok');
    expect(frames().map((f) => [f.attrs.alt, f.attrs.zIndex])).toEqual([['Pic', 1], ['Other', 0]]);
    expect(runTool(turn(editor), call('frame', { paragraph: 2, move_to: 3, wrap: 'left' })).result).toBe('ok');
    expect(texts(editor)).toEqual(['one {image "Pic"}', 'two ', '{image "Other"}three']);
    expect(runTool(turn(editor), call('frame', { paragraph: 3, caption: 'Figure 1: a tractor' })).result).toBe('ok');
    const box = frames().find((f) => f.type.name === 'textBox')!;
    expect(box.attrs).toMatchObject({ wrap: 'left', width: 151, strokeColor: null, paddingCm: 0 });
    expect(box.child(0).firstChild!.attrs.wrap).toBe('inline');
    expect(box.child(1).attrs.styleName).toBe('Caption');
    expect(box.child(1).textContent).toBe('Figure 1: a tractor');
    expect(runTool(turn(editor), call('frame', { paragraph: 1, delete: true })).result).toBe('ok');
    expect(blockTexts(editor.state.doc)[0].text).toBe('one ');
    editor.destroy();
  });

  it('writes a footnote\'s text into the note its anchor gets', () => {
    const editor = makeEditor('<p>Intro</p>');
    expect(runTool(turn(editor), call('insert_paragraphs', { after: 1, html: '<p>Claim<sup class="footnote">Source, <em>2024</em>.</sup> here.</p>' })).result).toBe('ok');
    let note: PMNode | null = null;
    editor.state.doc.descendants((n) => { note ??= n.type.name === 'note' ? n : null; return !note; });
    expect(note!.textContent).toBe('Source, 2024.');
    expect(texts(editor)).toContain('Claim{footnote} here.');
    editor.destroy();
  });
});
