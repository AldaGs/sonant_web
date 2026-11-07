// Tiny IndexedDB key/value store. One project slot: the video, the editable doc, uploaded fonts.
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('text-animator', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => (db.close(), resolve(req.result as T));
    t.onerror = t.onabort = () => (db.close(), reject(t.error));
  });
}

export const get = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key)).catch(() => undefined);
export const set = (key: string, value: unknown) => tx<void>('readwrite', (s) => s.put(value, key));
export const keys = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[]);
export const del =(key: string) => tx<void>('readwrite', (s) => s.delete(key)).catch(() => {});
