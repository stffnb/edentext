'use client';
// AGPL-3.0-only with an additional term under section 7(b): see NOTICE.md.
// <EdenText>: the editor as a React component. Props are the options and the on…
// handlers; a ref reaches the methods. Written without JSX, so it needs no build step.
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EdenTextFrame } from './index.js';

const SETTINGS = ['user', 'locale', 'theme', 'chrome', 'name', 'accent', 'ai'];

export const EdenText = forwardRef(function EdenText(props, ref) {
  const { url, onReady, onDirty, onSaveRequest, onWarning, onError, ...rest } = props;
  const settings = {};
  const attrs = {};
  for (const [k, v] of Object.entries(rest)) {
    if (SETTINGS.includes(k)) { if (v !== undefined) settings[k] = v; } else attrs[k] = v;
  }
  const key = JSON.stringify(settings);
  const box = useRef(null);
  const frame = useRef(null);
  const latest = useRef({});
  latest.current = { settings, key, onReady, onDirty, onSaveRequest, onWarning, onError };

  // One iframe per url. Strict Mode's second mount builds a fresh one after the first is gone.
  useEffect(() => {
    const ed = new EdenTextFrame(box.current, { url, ...latest.current.settings });
    ed.sent = latest.current.key;
    frame.current = ed;
    const live = () => frame.current === ed;
    ed.on('dirty', (m) => live() && latest.current.onDirty?.(m.dirty));
    ed.on('saveRequest', () => live() && latest.current.onSaveRequest?.());
    ed.on('warning', (m) => live() && latest.current.onWarning?.(m.warnings));
    ed.ready.then(() => live() && latest.current.onReady?.(ed), (err) => live() && latest.current.onError?.(err));
    return () => {
      if (live()) frame.current = null;
      ed.destroy();
    };
  }, [url]);

  // Changed options after the start go as configure.
  useEffect(() => {
    const ed = frame.current;
    if (!ed || ed.sent === key) return;
    ed.sent = key;
    ed.ready.then(() => frame.current === ed && ed.configure(latest.current.settings), () => {});
  }, [key]);

  useImperativeHandle(ref, () => {
    const need = () => {
      if (!frame.current) throw new Error('<EdenText> is not mounted');
      return frame.current;
    };
    return {
      get ready() { return need().ready; },
      get version() { return frame.current?.version; },
      configure: (s) => need().configure(s),
      load: (data, name) => need().load(data, name),
      newDocument: (name) => need().newDocument(name),
      export: (format) => need().export(format),
      markSaved: () => need().markSaved(),
    };
  }, []);

  return createElement('div', { style: { height: '100%' }, ...attrs, ref: box });
});
