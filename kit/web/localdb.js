// A device's copy of an app's data, in IndexedDB: a few small promise helpers, no library.
// Each store is keyed by `id`, except `meta` by `key`. Without IndexedDB (some private
// windows) it falls back to memory, so the app still works until the page is closed.

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

// stores: the names, e.g. ['tasks', 'lists', 'outbox', 'meta']. Adding one later needs a higher version.
export async function openLocal(name, stores, version = 1) {
  let db;
  try {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      for (const store of stores) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: store === 'meta' ? 'key' : 'id' });
      }
    };
    db = await done(request);
  } catch (err) {
    console.warn('No IndexedDB, the data is kept in memory only:', err);
    return memoryLocal(stores);
  }
  // Another tab with a newer version wants to upgrade: step aside
  db.onversionchange = () => db.close();

  function write(store, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      fn(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    all: (store) => done(db.transaction(store).objectStore(store).getAll()),
    get: (store, key) => done(db.transaction(store).objectStore(store).get(key)),
    // values: one object or a list; plain data only (no Vue proxies, see plain())
    put: (store, values) => write(store, (s) => [values].flat().forEach((v) => s.put(v))),
    remove: (store, keys) => write(store, (s) => [keys].flat().forEach((k) => s.delete(k))),
    close: () => db.close(),
  };
}

function memoryLocal(stores) {
  const data = Object.fromEntries(stores.map((s) => [s, new Map()]));
  return {
    all: async (s) => [...data[s].values()],
    get: async (s, k) => data[s].get(k),
    put: async (s, v) => [v].flat().forEach((x) => data[s].set(x.id ?? x.key, x)),
    remove: async (s, k) => [k].flat().forEach((x) => data[s].delete(x)),
    close() {},
  };
}

// Deletes a device's copy for good (on logout). Waits until it's gone, or gives up quietly
// if another tab still holds it open (it goes once that tab closes).
export function deleteLocal(name) {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// A copy without Vue's proxies, fit for IndexedDB
export const plain = (value) => JSON.parse(JSON.stringify(value));
