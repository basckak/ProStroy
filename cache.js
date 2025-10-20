const memoryCache = new Map();
const STORAGE_PREFIX = "prostroy.cache.";
const storage = (()=>{
  try{
    if (typeof window !== "undefined" && window.sessionStorage){
      return window.sessionStorage;
    }
  }catch(_){ /* ignore */ }
  return null;
})();

function now(){
  return Date.now();
}

function readStorage(key){
  if (!storage) return null;
  try{
    const stored = storage.getItem(STORAGE_PREFIX + key);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.expiry === "number" && parsed.expiry < now()){
      storage.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    return parsed;
  }catch(_){
    return null;
  }
}

function writeStorage(key, value, expiry){
  if (!storage) return;
  try{
    const payload = JSON.stringify({ value, expiry });
    storage.setItem(STORAGE_PREFIX + key, payload);
  }catch(_){ /* ignore quota/unsupported */ }
}

function removeStorage(key){
  if (!storage) return;
  try{ storage.removeItem(STORAGE_PREFIX + key); }catch(_){/* ignore */}
}

export function cachedFetch(key, loader, { ttlMs = 60000 } = {}){
  const current = memoryCache.get(key);
  const stamp = now();
  if (current && current.expiry > stamp){
    return current.promise;
  }

  const stored = readStorage(key);
  if (stored){
    const promise = Promise.resolve(stored.value);
    memoryCache.set(key, { promise, expiry: stored.expiry });
    return promise;
  }

  const promise = loader().then((value)=>{
    const expiry = now() + ttlMs;
    memoryCache.set(key, { promise: Promise.resolve(value), expiry });
    writeStorage(key, value, expiry);
    return value;
  }).catch((err)=>{
    memoryCache.delete(key);
    removeStorage(key);
    throw err;
  });

  memoryCache.set(key, { promise, expiry: stamp + ttlMs });
  return promise;
}

export function invalidateCache(key){
  memoryCache.delete(key);
  removeStorage(key);
}

export function invalidateCachePrefix(prefix){
  for (const cacheKey of Array.from(memoryCache.keys())){
    if (cacheKey.startsWith(prefix)) memoryCache.delete(cacheKey);
  }
  try{
    const prefixFull = STORAGE_PREFIX + prefix;
    const toDelete = [];
    if (storage){
      for (let i = 0; i < storage.length; i += 1){
        const storageKey = storage.key(i);
        if (storageKey && storageKey.startsWith(prefixFull)) toDelete.push(storageKey);
      }
    }
    toDelete.forEach((storageKey)=> storage?.removeItem(storageKey));
  }catch(_){/* ignore */}
}

export function primeCache(key, value, { ttlMs = 60000 } = {}){
  const expiry = now() + ttlMs;
  const promise = Promise.resolve(value);
  memoryCache.set(key, { promise, expiry });
  writeStorage(key, value, expiry);
}
