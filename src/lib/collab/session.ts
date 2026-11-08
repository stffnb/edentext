import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { attachYjsUndo, type YjsUndo } from '../editor/undoYjs';
import { openChannel, type ChannelStatus } from './channel';
import { keyBytes, newKey, sessionLink } from './key';

// A shared session: the Yjs doc behind the body (`undoYjs.ts`) goes over a sealed channel
// to the others in the room. Frames are one kind byte and its payload; the relay sees none
// of it. Edits leave and arrive in batches of 50 ms, always as a task of their own.

const ASK = 0;      // payload: a state vector; the others answer with what it lacks
const UPDATE = 1;   // payload: a Yjs update
const PRESENCE = 2; // payload: an awareness update (name, colour, cursor)
const BATCH_MS = 50;
const REMOTE = Symbol('remote');

export type SessionStatus =
  | 'connecting'   // no line to the relay yet
  | 'waiting'      // joined, but nobody with the document is there
  | 'live'
  | 'version'      // the others run another EdenText version
  | 'full'
  | 'unreachable'
  | 'invalid'      // the link's key is cut short or mistyped
  | 'closed';

export type Peer = { id: number; name: string; color: string };

export type SessionView = { status: SessionStatus; peers: Peer[]; link: string };

/** What the session needs from the app. */
export type SessionHost = {
  relay: string;
  /** The open document as a file: the start every joiner loads. */
  snapshot(): Promise<Uint8Array>;
  /** Loads a start file as the open document, unasked, under the starter's name for it. */
  load(bytes: Uint8Array, name: string): Promise<boolean>;
  /** The open document's name, which a joiner's copy takes. */
  name(): string;
  user(): { name: string; color: string };
  onChange(view: SessionView): void;
};

export type Session = {
  link: string;
  awareness: Awareness;
  leave(): void;
  /** Frames sent per kind, for the tests' idle check. */
  stats: { sent: number[] };
};

type Join = () => Promise<YjsUndo | 'version' | null>;

function frame(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = kind;
  out.set(payload, 1);
  return out;
}

function connect(key: string, host: SessionHost, ydoc: Y.Doc, bound: YjsUndo | null, join: Join | null): Session {
  const awareness = new Awareness(ydoc);
  const link = sessionLink(key);
  const stats = { sent: [0, 0, 0] };
  let status: SessionStatus = 'connecting';
  let peerCount = 1;
  let binding = bound;
  let joining = join;

  const peers = (): Peer[] => [...awareness.getStates()].filter(([id, s]) => id !== ydoc.clientID && s.user)
    .map(([id, s]) => ({ id, name: String(s.user.name ?? ''), color: String(s.user.color ?? '') }));
  const changed = () => host.onChange({ status, peers: peers(), link });
  const setStatus = (s: SessionStatus) => { if (status !== s) { status = s; changed(); } };

  const send = (kind: number, payload: Uint8Array) => { stats.sent[kind]++; channel.send(frame(kind, payload)); };
  const ask = () => send(ASK, Y.encodeStateVector(ydoc));
  const present = () => send(PRESENCE, encodeAwarenessUpdate(awareness, [ydoc.clientID]));

  // Outgoing: this client's own updates, merged per batch.
  let out: Uint8Array[] = [];
  let outTimer: ReturnType<typeof setTimeout> | undefined;
  const onUpdate = (u: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    out.push(u);
    outTimer ??= setTimeout(() => {
      outTimer = undefined;
      const merged = Y.mergeUpdates(out);
      out = [];
      send(UPDATE, merged);
    }, BATCH_MS);
  };
  ydoc.on('update', onUpdate);
  type Change = { added: number[]; updated: number[]; removed: number[] };
  const onPresence = ({ added, updated, removed }: Change, origin: unknown) => {
    if (origin === 'local') send(PRESENCE, encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
    changed();
  };
  awareness.on('update', onPresence);

  // Incoming updates gather for a batch and apply as one Yjs transaction. A joiner binds
  // the editor once the doc it received carries a start file.
  let inbox: Uint8Array[] = [];
  let inTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    inTimer = undefined;
    const merged = Y.mergeUpdates(inbox);
    inbox = [];
    Y.applyUpdate(ydoc, merged, REMOTE);
    if (joining && ydoc.getMap('meta').has('snapshot')) {
      const done = joining;
      joining = null;
      const got = await done();
      if (got === 'version') return setStatus('version');
      if (!got) return setStatus('closed');
      binding = got;
    }
    if (binding) setStatus('live');
  };

  const channel = openChannel({
    url: host.relay, key: keyBytes(key)!,
    onFrame(plain) {
      if (status === 'version') return;
      const kind = plain[0], payload = plain.subarray(1);
      if (kind === ASK) send(UPDATE, Y.encodeStateAsUpdate(ydoc, payload));
      else if (kind === UPDATE) { inbox.push(payload.slice()); inTimer ??= setTimeout(flush, BATCH_MS); }
      else if (kind === PRESENCE) applyAwarenessUpdate(awareness, payload, REMOTE);
    },
    onPeers(n) {
      // Someone came: ask for what they have and tell them who we are.
      if (n > peerCount) { ask(); present(); }
      peerCount = n;
      if (!binding && n <= 1 && status !== 'version') setStatus('waiting');
      changed();
    },
    onStatus(s: ChannelStatus) {
      if (s === 'open' || status === 'version') return;
      setStatus(s === 'closed' ? 'closed' : s);
    },
    onOpen() {
      ask();
      present();
      setStatus(binding ? 'live' : peerCount <= 1 ? 'waiting' : 'connecting');
    },
  });

  awareness.setLocalStateField('user', host.user());

  // Leaving tells the others at once; a closed tab drops out after awareness's timeout.
  const goodbye = () => {
    removeAwarenessStates(awareness, [ydoc.clientID], 'leave');
    send(PRESENCE, encodeAwarenessUpdate(awareness, [ydoc.clientID]));
  };
  addEventListener('pagehide', goodbye);

  return {
    link, awareness, stats,
    leave() {
      removeEventListener('pagehide', goodbye);
      clearTimeout(outTimer);
      clearTimeout(inTimer);
      goodbye();
      channel.close();
      awareness.off('update', onPresence);
      awareness.destroy();
      ydoc.off('update', onUpdate);
      binding?.detach();
      binding = null;
      status = 'closed';
      changed();
    },
  };
}

/** Shares the open document: its file goes along as the start, the body as the Yjs doc. */
export async function startSession(editor: Editor, host: SessionHost): Promise<Session> {
  const ydoc = new Y.Doc();
  const meta = ydoc.getMap('meta');
  meta.set('snapshot', await host.snapshot());
  meta.set('version', __APP_VERSION__);
  meta.set('name', host.name());
  return connect(newKey(), host, ydoc, attachYjsUndo(editor, ydoc), null);
}

/**
 * Joins the session of `key`: once someone in the room has sent the doc, its start file
 * is loaded, the body bound to the Yjs doc and every store changed since put into effect.
 */
export function joinSession(editor: Editor, key: string, host: SessionHost): Session {
  const ydoc = new Y.Doc();
  return connect(key, host, ydoc, null, async () => {
    const meta = ydoc.getMap('meta');
    if (meta.get('version') !== __APP_VERSION__) return 'version';
    if (!(await host.load(meta.get('snapshot') as Uint8Array, String(meta.get('name') ?? '')))) return null;
    const binding = attachYjsUndo(editor, ydoc);
    binding.applyState();
    return binding;
  });
}
