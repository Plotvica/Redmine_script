function createTtlCache({ ttlMs, maxEntries = 100 }) {
  const entries = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.promise) {
      return entry.promise;
    }

    if (Date.now() - entry.createdAt <= ttlMs) {
      return entry.data;
    }

    entries.delete(key);
    return undefined;
  }

  async function getOrSet(key, load) {
    const cached = get(key);
    if (cached !== undefined) {
      return cached;
    }

    const promise = Promise.resolve()
      .then(load)
      .then((data) => {
        entries.set(key, { createdAt: Date.now(), data });
        prune();
        return data;
      })
      .catch((error) => {
        entries.delete(key);
        throw error;
      });

    entries.set(key, { createdAt: Date.now(), promise });
    prune();
    return promise;
  }

  function set(key, data) {
    entries.set(key, { createdAt: Date.now(), data });
    prune();
    return data;
  }

  function clear() {
    entries.clear();
  }

  function prune() {
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  return { clear, get, getOrSet, set };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }

  return JSON.stringify(value);
}

function stableSearchParamsKey(searchParams) {
  return [...searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

module.exports = { createTtlCache, stableSearchParamsKey, stableStringify };
