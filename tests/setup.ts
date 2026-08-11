// Node 26 ships its own `localStorage` global, undefined unless the process gets
// --localstorage-file, and it shadows the one jsdom installs. Modules that read
// storage at import time then throw before a single test runs.
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true });
}
