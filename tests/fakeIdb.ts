// A two-call IndexedDB in memory — what openDb/idbRequest (storage/idb.ts) ask for.
export function fakeIndexedDb() {
  const data = new Map<number, unknown>();
  const req = (result: unknown) => {
    const r: Record<string, unknown> = { result };
    queueMicrotask(() => (r.onsuccess as (() => void) | undefined)?.());
    return r;
  };
  const store = {
    put: (v: unknown, k: number) => { data.set(k, v); return req(undefined); },
    get: (k: number) => req(data.get(k)),
    getAllKeys: () => req([...data.keys()]),
    delete: (k: number) => { data.delete(k); return req(undefined); },
  };
  const db = { transaction: () => ({ objectStore: () => store }), createObjectStore: () => {}, close: () => {} };
  return {
    data,
    open: () => {
      const r: Record<string, unknown> = { result: db };
      queueMicrotask(() => {
        (r.onupgradeneeded as (() => void) | undefined)?.();
        (r.onsuccess as (() => void) | undefined)?.();
      });
      return r;
    },
  };
}
