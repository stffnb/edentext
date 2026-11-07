// The AI client: SSE split anywhere in a chunk, both providers' stream shapes and
// request bodies, error mapping, and the kill switch that hands out no config.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sseEvents, streamChat, AiError, aiErrorText } from '../../src/lib/ai/client';
import { aiConfig, plainHttpEndpoint, setAi } from '../../src/lib/storage/ai.svelte';
import en from '../../src/lib/i18n/locales/en';

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

function sse(events: unknown[], { anthropic = false } = {}): string {
  return events.map((e) => (anthropic ? `event: ${(e as { type: string }).type}\n` : '') + `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
}

// Every byte its own chunk: a parser that only splits whole lines would fail here.
function bytewise(text: string): ReadableStream<Uint8Array> {
  return stream(...text.split(''));
}

function mockFetch(body: string | ((init: RequestInit) => Response), status = 200) {
  const fn = vi.fn(async (_url: string, init: RequestInit) => (typeof body === 'function' ? body(init) : new Response(bytewise(body), { status })));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const openai = { provider: 'openai' as const, endpoint: 'http://mock.test/v1/', apiKey: 'k', model: 'm' };
const anthropic = { provider: 'anthropic' as const, endpoint: 'https://api.anthropic.com/v1', apiKey: 'sk', model: 'claude' };

afterEach(() => vi.unstubAllGlobals());

describe('sseEvents', () => {
  it('reassembles events across chunk boundaries and CRLF', async () => {
    const out = [];
    for await (const ev of sseEvents(stream('event: a\r\nda', 'ta: 1\r\n\r\ndata: x\ndata: y\n\n', 'data: tail'))) out.push(ev);
    expect(out).toEqual([{ event: 'a', data: '1' }, { event: 'message', data: 'x\ny' }, { event: 'message', data: 'tail' }]);
  });
});

describe('OpenAI-compatible', () => {
  it('streams text and merges tool-call fragments by index', async () => {
    const fetch = mockFetch(sse([
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'format', arguments: '{"fr' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'om":2}' } }] } }] },
      '[DONE]',
    ]));
    const seen: string[] = [];
    const res = await streamChat(openai, {
      system: 'S',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c0', name: 'read_paragraphs', args: '{}' }] },
        { role: 'tool', id: 'c0', content: 'ok' },
      ],
      tools: [{ name: 'format', description: 'd', parameters: { type: 'object' } }],
    }, (d) => seen.push(d));
    expect(seen.join('')).toBe('Hello');
    expect(res).toEqual({ text: 'Hello', toolCalls: [{ id: 'c1', name: 'format', args: '{"from":2}' }] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://mock.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'S' });
    expect(body.messages[2].tool_calls[0]).toEqual({ id: 'c0', type: 'function', function: { name: 'read_paragraphs', arguments: '{}' } });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c0', content: 'ok' });
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'format', description: 'd', parameters: { type: 'object' } } });
  });

  it('asks again without tools when the model takes none', async () => {
    let calls = 0;
    mockFetch((init) => {
      calls++;
      const body = JSON.parse(init.body as string);
      if (body.tools) return new Response(JSON.stringify({ error: { message: 'model does not support tools' } }), { status: 400 });
      return new Response(sse([{ choices: [{ delta: { content: 'ok' } }] }, '[DONE]']));
    });
    const res = await streamChat(openai, { system: '', messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'x', description: '', parameters: {} }] }, () => {});
    expect(res.text).toBe('ok');
    expect(calls).toBe(2);
  });

  it('sends a tool call’s thought signature back, and reads an error wrapped in an array', async () => {
    const extra = { google: { thought_signature: 'sig' } };
    mockFetch(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'format', arguments: '{}' }, extra_content: extra }] } }] }, '[DONE]']));
    const res = await streamChat(openai, { system: '', messages: [] }, () => {});
    expect(res.toolCalls[0].extra).toEqual(extra);

    const fetch = mockFetch(() => new Response('[{"error":{"code":400,"message":"Function call is missing a thought_signature"}}]', { status: 400 }));
    const err = await streamChat(openai, {
      system: '',
      messages: [{ role: 'assistant', content: '', toolCalls: res.toolCalls }, { role: 'tool', id: 'c1', content: 'ok' }],
      tools: [{ name: 'format', description: '', parameters: {} }],
    }, () => {}).catch((e) => e);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string).messages[1].tool_calls[0].extra_content).toEqual(extra);
    // A turn that already ran tools is not asked again without them.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(err.message).toBe('Function call is missing a thought_signature');
  });
});

describe('Anthropic', () => {
  it('builds the browser request and assembles tool input', async () => {
    const fetch = mockFetch(sse([
      { type: 'message_start' },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'replace_text' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"paragraph"' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':3}' } },
      { type: 'message_stop' },
    ], { anthropic: true }));
    const res = await streamChat(anthropic, {
      system: 'S',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a', toolCalls: [{ id: 't0', name: 'format', args: '{"from":1}' }, { id: 't9', name: 'format', args: '{"from":2}' }] },
        { role: 'tool', id: 't0', content: 'ok' },
        { role: 'tool', id: 't9', content: 'ok' },
        { role: 'user', content: 'next' },
      ],
    }, () => {});
    expect(res).toEqual({ text: 'Done', toolCalls: [{ id: 't1', name: 'replace_text', args: '{"paragraph":3}' }] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const h = init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('S');
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.messages[1].content[1]).toEqual({ type: 'tool_use', id: 't0', name: 'format', input: { from: 1 } });
    // Both results and the next question share one user turn.
    expect(body.messages[2].content.map((b: { type: string }) => b.type)).toEqual(['tool_result', 'tool_result', 'text']);
  });
});

describe('errors', () => {
  it('maps status codes and network failures', async () => {
    mockFetch(() => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    await expect(streamChat(openai, { system: '', messages: [] }, () => {})).rejects.toMatchObject({ kind: 'auth', status: 401 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await streamChat(openai, { system: '', messages: [] }, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('network');
    expect(aiErrorText(err, en.ai.errors, 'http://localhost:11434/v1')).toContain('OLLAMA_ORIGINS');
    expect(aiErrorText(new AiError('notFound', 404), en.ai.errors, '')).toBe(en.ai.errors.notFound);
  });
});

describe('kill switch', () => {
  it('hands out no config while off, nor while unconfigured', () => {
    setAi({ enabled: false, endpoint: 'http://x/v1', model: 'm' });
    expect(aiConfig()).toBeNull();
    setAi({ enabled: true, model: '' });
    expect(aiConfig()).toBeNull();
    setAi({ model: 'm' });
    expect(aiConfig()?.model).toBe('m');
    setAi({ endpoint: '', model: '' });
    expect(localStorage.getItem('edentext-ai')).toBeNull();
    setAi({ enabled: false });
    expect(JSON.parse(localStorage.getItem('edentext-ai')!).enabled).toBe(false);
    setAi({ enabled: true });
  });

  it.each([
    ['http://192.168.1.5:11434/v1', true], ['http://ai.example.com/v1', true],
    ['https://api.openai.com/v1', false], ['http://localhost:11434/v1', false],
    ['http://127.0.0.1:1234/v1', false], ['http://[::1]:8080', false], ['', false],
  ])('warns that %s is unencrypted: %s', (url, plain) => expect(plainHttpEndpoint(url)).toBe(plain));
});

describe('Ollama', () => {
  it('talks to the native API with the context size and reads its JSON lines', async () => {
    const fetch = mockFetch([
      { message: { role: 'assistant', content: 'Hi' }, done: false },
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'format', arguments: { from: 1, bold: true } } }] }, done: false },
      { done: true },
    ].map((l) => JSON.stringify(l)).join('\n'));
    const cfg = { provider: 'openai' as const, endpoint: 'http://localhost:11434/v1', apiKey: '', model: 'granite', contextTokens: 16384 };
    const deltas: string[] = [];
    const res = await streamChat(cfg, {
      system: 'S',
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'format', args: '{"from":2}' }] }, { role: 'tool', id: 'c', content: 'ok' }],
      tools: [{ name: 'format', description: 'd', parameters: {} }],
    }, (d) => deltas.push(d));
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body.options).toEqual({ num_ctx: 16384 });
    expect(body.messages[2].tool_calls[0].function.arguments).toEqual({ from: 2 });
    expect(body.messages[3]).toEqual({ role: 'tool', content: 'ok' });
    expect(res).toEqual({ text: 'Hi', toolCalls: [{ id: 'call_0', name: 'format', args: '{"from":1,"bold":true}' }] });
    expect(deltas).toEqual(['Hi']);
  });
});
