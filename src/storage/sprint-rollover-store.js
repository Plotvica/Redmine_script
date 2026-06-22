const fs = require("node:fs/promises");
const path = require("node:path");

const FILE_NAME = "sprint-rollovers.json";
let writeChain = Promise.resolve();

function getStorePath(rootDir) {
  return path.join(rootDir, "data", FILE_NAME);
}

async function readSprintRollovers(rootDir) {
  try {
    const content = await fs.readFile(getStorePath(rootDir), "utf8");
    const parsed = JSON.parse(content);
    return {
      updatedAt: parsed.updatedAt || null,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { updatedAt: null, events: [] };
    }
    throw error;
  }
}

async function appendSprintRollover(rootDir, event) {
  return queueWrite(async () => {
    const current = await readSprintRollovers(rootDir);
    const normalized = normalizeEvent(event);
    const duplicate = current.events.some((item) => item.id === normalized.id);
    const events = duplicate ? current.events : [...current.events, normalized];
    return writeSprintRollovers(rootDir, events);
  });
}

async function writeSprintRollovers(rootDir, events) {
  const storePath = getStorePath(rootDir);
  const payload = {
    updatedAt: new Date().toISOString(),
    events: Array.isArray(events) ? events.map(normalizeEvent) : [],
  };

  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function normalizeEvent(event = {}) {
  const movedAt = event.movedAt || new Date().toISOString();
  const issueIds = [...new Set((event.issueIds || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  return {
    id: String(event.id || `${event.projectId}:${event.sourceSprintId}:${event.targetSprintId}:${movedAt}`),
    movedAt,
    projectId: String(event.projectId || ""),
    sourceSprintId: String(event.sourceSprintId || ""),
    sourceSprintName: String(event.sourceSprintName || ""),
    targetSprintId: String(event.targetSprintId || ""),
    targetSprintName: String(event.targetSprintName || ""),
    customFields: normalizeCustomFields(event.customFields),
    issueIds,
  };
}

function normalizeCustomFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, fieldValue]) => /^cf_\d+$/.test(key) && fieldValue !== "")
      .map(([key, fieldValue]) => [key, String(fieldValue)]),
  );
}

function queueWrite(write) {
  const next = writeChain.then(write, write);
  writeChain = next.catch(() => {});
  return next;
}

module.exports = {
  appendSprintRollover,
  readSprintRollovers,
  writeSprintRollovers,
};
