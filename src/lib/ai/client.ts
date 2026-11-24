// Streaming chat against the provider the user configured: OpenAI's /responses, the
// OpenAI-compatible /chat/completions (Mistral, OpenRouter, Gemini, LM Studio, …), Ollama's
// own /api/chat or Anthropic's /messages. Plain fetch and server-sent events; the one place AI talks to
// the network, and only with a config, which storage/ai hands out while the switch is on.

import type { AiConfig } from '../storage/ai.svelte';
import type { Messages } from '../i18n/locales/en';

/** `extra`: a provider's opaque per-call data (Gemini's thought signature), sent back as it came. */
export type ToolCall = { id: string; name: string; args: string; extra?: unknown };
/**
 * `replay`: the provider's own record of a reply that called tools (its reasoning), sent back
 * as it came for the rest of that turn; the history between questions keeps only the text.
 */
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; replay?: unknown }
  | { role: 'tool'; id: string; content: string };
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ChatRequest = { system: string; messages: ChatMessage[]; tools?: ToolDef[] };
export type ChatResult = { text: string; toolCalls: ToolCall[]; replay?: unknown };

type CompatReplay = { content?: unknown[]; reasoning_details?: unknown[] };

export class AiError extends Error {
  constructor(readonly kind: 'network' | 'auth' | 'notFound' | 'rate' | 'http', readonly status = 0, detail = '') {
    super(detail || kind);
  }
}

type SseEvent = { event: string; data: string };

/** Server-sent events from a response body, one per blank-line-separated block. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const parse = (block: string): SseEvent | null => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  for (;;) {
    const { value, done } = await reader.read();
    buf += decoder.decode(value, { stream: !done });
    let m: RegExpExecArray | null;
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      const ev = parse(buf.slice(0, m.index));
      buf = buf.slice(m.index + m[0].length);
      if (ev) yield ev;
    }
    if (done) break;
  }
  const last = parse(buf);
  if (last) yield last;
}

function url(cfg: AiConfig, path: string): string {
  return cfg.endpoint.trim().replace(/\/+$/, '') + path;
}

function openaiRequest(cfg: AiConfig, req: ChatRequest): RequestInit & { url: string } {
  const messages: unknown[] = [{ role: 'system', content: req.system }];
  for (const m of req.messages) {
    if (m.role === 'tool') messages.push({ role: 'tool', tool_call_id: m.id, content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length) {
      const r = m.replay as CompatReplay | undefined;
      messages.push({
        role: 'assistant',
        content: r?.content ?? (m.content || null),
        ...(r?.reasoning_details ? { reasoning_details: r.reasoning_details } : {}),
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' }, ...(c.extra ? { extra_content: c.extra } : {}) })),
      });
    } else messages.push({ role: m.role, content: m.content });
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey.trim()) headers.authorization = `Bearer ${cfg.apiKey.trim()}`;
  return {
    url: url(cfg, '/chat/completions'),
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model.trim(),
      stream: true,
      messages,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: t })) } : {}),
      // OpenRouter otherwise drops the tools silently where no provider of the model takes them.
      ...(req.tools?.length && /^https:\/\/openrouter\.ai\//i.test(cfg.endpoint.trim()) ? { provider: { require_parameters: true } } : {}),
    }),
  };
}

// OpenAI's own API takes tools from its reasoning models only on /responses; /chat/completions
// answers 400. With `store: false` nothing stays on OpenAI's servers, so a reply's reasoning
// items are its `replay`, sent back before its text and calls.
export const isOpenaiApi = (cfg: AiConfig) => cfg.provider === 'openai' && /^https:\/\/([\w-]+\.)?api\.openai\.com(\/|$)/i.test(cfg.endpoint.trim());

function responsesRequest(cfg: AiConfig, req: ChatRequest): RequestInit & { url: string } {
  const input: unknown[] = [];
  for (const m of req.messages) {
    if (m.role === 'tool') input.push({ type: 'function_call_output', call_id: m.id, output: m.content });
    else {
      const calls = m.role === 'assistant' ? m.toolCalls ?? [] : [];
      if (m.role === 'assistant' && Array.isArray(m.replay)) input.push(...m.replay);
      if (m.content) input.push({ role: m.role, content: m.content });
      for (const c of calls) input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.args || '{}' });
    }
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey.trim()) headers.authorization = `Bearer ${cfg.apiKey.trim()}`;
  return {
    url: url(cfg, '/responses'),
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model.trim(),
      stream: true,
      store: false,
      instructions: req.system,
      input,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', ...t })) } : {}),
    }),
  };
}

async function readResponses(body: ReadableStream<Uint8Array>, onText: (t: string) => void): Promise<ChatResult> {
  let text = '';
  const calls: ToolCall[] = [];
  const reasoning: unknown[] = [];
  for await (const ev of sseEvents(body)) {
    const json = JSON.parse(ev.data);
    if (json.type === 'response.output_text.delta' && json.delta) { text += json.delta; onText(json.delta); }
    else if (json.type === 'response.output_item.done' && json.item?.type === 'reasoning') reasoning.push(json.item);
    else if (json.type === 'response.output_item.done' && json.item?.type === 'function_call') {
      calls.push({ id: json.item.call_id, name: json.item.name, args: json.item.arguments ?? '' });
    } else if (json.type === 'error') throw new AiError('http', 0, json.message ?? json.error?.message ?? 'error');
    else if (json.type === 'response.failed') throw new AiError('http', 0, json.response?.error?.message ?? 'failed');
    else if (json.type === 'response.completed' || json.type === 'response.incomplete') break;
  }
  return { text, toolCalls: calls, ...(calls.length && reasoning.length ? { replay: reasoning } : {}) };
}

/** Ollama's own default port: its /v1 ignores a context size, so its native API is used. */
export const isOllama = (cfg: AiConfig) => cfg.provider === 'openai' && /^https?:\/\/[^/]+:11434(\/|$)/i.test(cfg.endpoint.trim());

// Ollama's native /api/chat: the OpenAI message shape, arguments as objects, and the
// context window as `num_ctx`, which it would otherwise cut the prompt to silently.
function ollamaRequest(cfg: AiConfig, req: ChatRequest): RequestInit & { url: string } {
  const messages: unknown[] = [{ role: 'system', content: req.system }];
  // A result names its tool; the ids are ours and repeat from round to round.
  const names = new Map<string, string>();
  for (const m of req.messages) {
    if (m.role === 'tool') messages.push({ role: 'tool', tool_name: names.get(m.id) ?? '', content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const c of m.toolCalls) names.set(c.id, c.name);
      const thinking = (m.replay as { thinking?: string } | undefined)?.thinking;
      messages.push({ role: 'assistant', content: m.content, ...(thinking ? { thinking } : {}), tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: parseArgs(c.args) } })) });
    } else messages.push({ role: m.role, content: m.content });
  }
  return {
    url: cfg.endpoint.trim().replace(/\/+$/, '').replace(/\/v1$/, '') + '/api/chat',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model.trim(),
      stream: true,
      messages,
      options: { num_ctx: cfg.contextTokens },
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: t })) } : {}),
    }),
  };
}

async function readOllama(body: ReadableStream<Uint8Array>, onText: (t: string) => void): Promise<ChatResult> {
  let text = '';
  let thinking = '';
  const calls: ToolCall[] = [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (let done = false; !done;) {
    const chunk = await reader.read();
    done = chunk.done;
    buf += decoder.decode(chunk.value, { stream: !done });
    const lines = buf.split('\n');
    buf = done ? '' : lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const json = JSON.parse(line);
      if (json.error) throw new AiError('http', 0, String(json.error));
      const msg = json.message;
      if (typeof msg?.thinking === 'string') thinking += msg.thinking;
      if (typeof msg?.content === 'string' && msg.content) { text += msg.content; onText(msg.content); }
      for (const tc of msg?.tool_calls ?? []) {
        const a = tc.function?.arguments;
        calls.push({ id: `call_${calls.length}`, name: tc.function?.name ?? '', args: typeof a === 'string' ? a : JSON.stringify(a ?? {}) });
      }
    }
  }
  return { text, toolCalls: calls, ...(calls.length && thinking ? { replay: { thinking } } : {}) };
}

type AnthropicBlock = Record<string, unknown>;

function anthropicRequest(cfg: AiConfig, req: ChatRequest): RequestInit & { url: string } {
  const messages: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = [];
  // Consecutive turns of one role are merged: tool results are user turns, and the API
  // wants the roles to alternate.
  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last?.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const m of req.messages) {
    if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.id, content: m.content }]);
    else if (m.role === 'user') push('user', [{ type: 'text', text: m.content }]);
    else if (Array.isArray(m.replay)) push('assistant', m.replay as AnthropicBlock[]);
    else {
      push('assistant', [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...(m.toolCalls ?? []).map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: parseArgs(c.args) })),
      ]);
    }
  }
  return {
    url: url(cfg, '/messages'),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Behind an installation's proxy the browser has no key; the proxy sets it.
      ...(cfg.apiKey.trim() ? { 'x-api-key': cfg.apiKey.trim() } : {}),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model.trim(),
      // Thinking, on by default since Claude 5, is paid out of the same budget.
      max_tokens: 32000,
      stream: true,
      system: req.system,
      messages,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
    }),
  };
}

export function parseArgs(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

async function readOpenai(body: ReadableStream<Uint8Array>, onText: (t: string) => void): Promise<ChatResult> {
  let text = '';
  let thinking = '';
  let chunked = false;
  const calls: ToolCall[] = [];
  // OpenRouter's reasoning, fragments of one item sharing an index; it goes back unchanged.
  const details: Record<string, unknown>[] = [];
  for await (const ev of sseEvents(body)) {
    if (ev.data === '[DONE]') break;
    const json = JSON.parse(ev.data);
    if (json.error) throw new AiError('http', 0, json.error.message ?? String(json.error));
    const delta = json.choices?.[0]?.delta;
    // Mistral's reasoning models stream content as chunks, thinking ones among them.
    if (Array.isArray(delta?.content)) {
      chunked = true;
      for (const c of delta.content) if (c?.type === 'thinking') for (const t of c.thinking ?? []) thinking += t?.text ?? '';
    }
    for (const d of delta?.reasoning_details ?? []) {
      const same = typeof d.index === 'number' ? details.find((x) => x.index === d.index && x.type === d.type) : undefined;
      if (!same) { details.push({ ...d }); continue; }
      for (const k of ['text', 'summary', 'data'] as const) if (typeof d[k] === 'string') same[k] = String(same[k] ?? '') + d[k];
      for (const k of ['signature', 'id', 'format'] as const) if (d[k] != null) same[k] = d[k];
    }
    const part = Array.isArray(delta?.content) ? delta.content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c.text ?? '').join('') : delta?.content;
    if (typeof part === 'string' && part) { text += part; onText(part); }
    for (const tc of delta?.tool_calls ?? []) {
      // Fragments of one call share an index; a server that sends no index sends whole calls.
      const i = typeof tc.index === 'number' ? tc.index : calls.length;
      const slot = (calls[i] ??= { id: '', name: '', args: '' });
      if (tc.id) slot.id = tc.id;
      if (tc.extra_content) slot.extra = tc.extra_content;
      if (tc.function?.name) slot.name ||= tc.function.name;
      const a = tc.function?.arguments;
      if (a) slot.args += typeof a === 'string' ? a : JSON.stringify(a);
    }
  }
  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  const replay: CompatReplay = {
    ...(chunked && thinking ? { content: [{ type: 'thinking', thinking: [{ type: 'text', text: thinking }] }, ...(text ? [{ type: 'text', text }] : [])] } : {}),
    ...(details.length ? { reasoning_details: details } : {}),
  };
  return { text, toolCalls, ...(toolCalls.length && Object.keys(replay).length ? { replay } : {}) };
}

async function readAnthropic(body: ReadableStream<Uint8Array>, onText: (t: string) => void): Promise<ChatResult> {
  let text = '';
  const calls = new Map<number, ToolCall>();
  // Every block in order, thinking with its signature, for the rest of the turn.
  const blocks = new Map<number, AnthropicBlock>();
  for await (const ev of sseEvents(body)) {
    const json = JSON.parse(ev.data);
    if (json.type === 'error') throw new AiError('http', 0, json.error?.message ?? 'error');
    if (json.type === 'content_block_start') {
      const cb = json.content_block ?? {};
      blocks.set(json.index, cb.type === 'text' ? { type: 'text', text: '' } : cb.type === 'thinking' ? { type: 'thinking', thinking: cb.thinking ?? '', signature: cb.signature ?? '' } : { ...cb });
      if (cb.type === 'tool_use') calls.set(json.index, { id: cb.id, name: cb.name, args: '' });
    } else if (json.type === 'content_block_delta') {
      const block = blocks.get(json.index);
      if (json.delta?.type === 'text_delta') {
        text += json.delta.text; onText(json.delta.text);
        if (block) block.text += json.delta.text;
      } else if (json.delta?.type === 'thinking_delta' && block) block.thinking += json.delta.thinking;
      else if (json.delta?.type === 'signature_delta' && block) block.signature += json.delta.signature;
      else if (json.delta?.type === 'input_json_delta') {
        const call = calls.get(json.index);
        if (call) call.args += json.delta.partial_json;
      }
    } else if (json.type === 'message_delta') {
      // Cut off, a tool call's arguments would run as {}; a refusal would read as an empty answer.
      const stop = json.delta?.stop_reason;
      if (stop === 'max_tokens' || stop === 'refusal') throw new AiError('http', 0, `stop_reason: ${stop}`);
    } else if (json.type === 'message_stop') break;
  }
  const toolCalls = [...calls.values()];
  // An empty text block, sent back, is a 400.
  const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).filter(([, b]) => b.type !== 'text' || b.text)
    .map(([i, b]) => (b.type === 'tool_use' ? { ...b, input: parseArgs(calls.get(i)?.args ?? '') } : b));
  const thought = ordered.some((b) => b.type === 'thinking' || b.type === 'redacted_thinking');
  return { text, toolCalls, ...(toolCalls.length && thought ? { replay: ordered } : {}) };
}

async function httpError(res: Response): Promise<AiError> {
  let detail = '';
  try {
    const body = await res.text();
    try {
      // Gemini wraps its error in an array.
      const json = [JSON.parse(body)].flat()[0];
      detail = json?.error?.message ?? (typeof json?.error === 'string' ? json.error : '');
    } catch { detail = body.slice(0, 300); }
  } catch { /* the body is only a detail */ }
  const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 404 ? 'notFound' : res.status === 429 ? 'rate' : 'http';
  return new AiError(kind, res.status, detail);
}

/**
 * One model reply, its text streamed to `onText` as it arrives. Throws AiError, or the
 * fetch's AbortError when `signal` fires.
 */
export async function streamChat(cfg: AiConfig, req: ChatRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const ollama = isOllama(cfg);
  const responses = isOpenaiApi(cfg);
  const build = cfg.provider === 'anthropic' ? anthropicRequest : ollama ? ollamaRequest : responses ? responsesRequest : openaiRequest;
  const { url: target, ...init } = build(cfg, req);
  let res: Response;
  try {
    res = await fetch(target, { ...init, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiError('network', 0, String(e));
  }
  if (!res.ok) {
    const err = await httpError(res);
    // Replayed reasoning is only rebuilt from documented formats; refused, the turn goes on without it.
    if (res.status === 400 && req.messages.some((m) => m.role === 'assistant' && m.replay)) {
      return streamChat(cfg, { ...req, messages: req.messages.map((m) => (m.role === 'assistant' ? { ...m, replay: undefined } : m)) }, onText, signal);
    }
    // Some local models take no tools at all; ask again without them. A turn that already
    // ran tools proves they are supported, so its 400 is a real error.
    if (res.status === 400 && req.tools?.length && !req.messages.some((m) => m.role === 'tool') && /tool|function/i.test(err.message)) {
      return streamChat(cfg, { ...req, tools: undefined }, onText, signal);
    }
    throw err;
  }
  if (!res.body) throw new AiError('http', res.status, 'empty response');
  return cfg.provider === 'anthropic' ? readAnthropic(res.body, onText) : ollama ? readOllama(res.body, onText) : responses ? readResponses(res.body, onText) : readOpenai(res.body, onText);
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** A failed request as the user reads it. */
export function aiErrorText(e: unknown, m: Messages['ai']['errors'], endpoint: string): string {
  if (!(e instanceof AiError)) return String(e instanceof Error ? e.message : e);
  if (e.kind === 'network') {
    const local = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(endpoint.trim());
    return local ? m.networkLocal(typeof location === 'undefined' ? '*' : location.origin) : m.network;
  }
  if (e.kind === 'http') return m.http(e.status, e.message);
  return m[e.kind];
}
