const lockChains = new WeakMap();
const busyKeys = new WeakMap();

export function isJobBusy(runtime, key) {
  return Boolean(busyKeys.get(runtime)?.has(key));
}

export function withJobLock(runtime, key, work) {
  let chains = lockChains.get(runtime);
  if (!chains) {
    chains = new Map();
    lockChains.set(runtime, chains);
  }
  let busy = busyKeys.get(runtime);
  if (!busy) {
    busy = new Set();
    busyKeys.set(runtime, busy);
  }
  const previous = chains.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => {
    busy.add(key);
    return work();
  }).finally(() => { busy.delete(key); });
  chains.set(key, current);
  return current.finally(() => {
    if (chains.get(key) === current) chains.delete(key);
  });
}
