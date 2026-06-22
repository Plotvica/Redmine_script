const fs = require("node:fs/promises");
const path = require("node:path");

const FILE_NAME = "agile-memberships.json";
const MEMBERSHIP_FRESH_MS = 30 * 60 * 1000;
const MAX_BACKGROUND_REFRESH = 100;
const STORE_FLUSH_DELAY_MS = 250;
const stores = new Map();
const inFlightByIssue = new Map();
let flushTimer = null;

async function getAgileSprintIds({ rootDir, redmine, issues, concurrency = 6 }) {
  const store = await loadStore(rootDir);
  const missing = [];
  const stale = [];
  const now = Date.now();

  for (const issue of issues || []) {
    const issueId = Number(issue.id);
    const entry = store.memberships[String(issueId)];
    if (!entry) {
      missing.push(issueId);
    } else if (now - Date.parse(entry.checkedAt || 0) > MEMBERSHIP_FRESH_MS) {
      stale.push(issueId);
    }
  }

  if (missing.length) {
    await refreshMemberships({ rootDir, redmine, issueIds: missing, concurrency });
    await flushStore(rootDir);
  }

  if (stale.length) {
    refreshMemberships({
      rootDir,
      redmine,
      issueIds: stale.slice(0, MAX_BACKGROUND_REFRESH),
      concurrency,
    }).catch(() => {});
  }

  return new Map((issues || []).map((issue) => {
    const issueId = Number(issue.id);
    return [issueId, normalizeSprintId(store.memberships[String(issueId)]?.sprintId)];
  }));
}

async function primeAgileSprintIds(rootDir, issueIds, sprintId) {
  const store = await loadStore(rootDir);
  const checkedAt = new Date().toISOString();
  for (const issueId of issueIds || []) {
    store.memberships[String(Number(issueId))] = {
      sprintId: normalizeSprintId(sprintId),
      checkedAt,
    };
  }
  await flushStore(rootDir);
}

async function refreshMemberships({ rootDir, redmine, issueIds, concurrency }) {
  const uniqueIds = [...new Set((issueIds || []).map(Number).filter(Number.isFinite))];
  await mapWithConcurrency(uniqueIds, concurrency, async (issueId) => {
    const key = String(issueId);
    let promise = inFlightByIssue.get(key);
    if (!promise) {
      promise = redmine.get(`/issues/${encodeURIComponent(issueId)}/agile_data.json`)
        .then(async (response) => {
          const store = await loadStore(rootDir);
          store.memberships[key] = {
            sprintId: normalizeSprintId(response.agile_data?.agile_sprint_id),
            checkedAt: new Date().toISOString(),
          };
        })
        .finally(() => inFlightByIssue.delete(key));
      inFlightByIssue.set(key, promise);
    }
    await promise;
  });
  scheduleFlush(rootDir);
}

async function loadStore(rootDir) {
  const storePath = getStorePath(rootDir);
  if (stores.has(storePath)) {
    return stores.get(storePath);
  }

  let parsed = { updatedAt: null, memberships: {} };
  try {
    parsed = JSON.parse(await fs.readFile(storePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const store = {
    updatedAt: parsed.updatedAt || null,
    memberships: parsed.memberships && typeof parsed.memberships === "object"
      ? parsed.memberships
      : {},
  };
  stores.set(storePath, store);
  return store;
}

function scheduleFlush(rootDir) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushStore(rootDir).catch(() => {});
  }, STORE_FLUSH_DELAY_MS);
}

async function flushStore(rootDir) {
  const store = await loadStore(rootDir);
  store.updatedAt = new Date().toISOString();
  const storePath = getStorePath(rootDir);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getStorePath(rootDir) {
  return path.join(rootDir, "data", FILE_NAME);
}

function normalizeSprintId(value) {
  return value === undefined || value === null || value === "" ? "" : String(value);
}

async function mapWithConcurrency(items, limit, callback) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

module.exports = {
  getAgileSprintIds,
  primeAgileSprintIds,
};
