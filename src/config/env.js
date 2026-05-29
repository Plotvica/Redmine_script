const fs = require("node:fs");
const path = require("node:path");

function loadConfig(rootDir) {
  loadEnv(path.join(rootDir, ".env"));

  const redmineUrl = normalizeBaseUrl(process.env.REDMINE_URL || "");
  const apiKey = process.env.REDMINE_API_KEY || "";
  const redmine = {
    url: redmineUrl,
    safeUrl: redactUrl(redmineUrl),
    apiKey,
    pageLimit: clampNumber(process.env.REDMINE_PAGE_LIMIT || process.env.REDMINE_ISSUE_PAGE_LIMIT, 25, 100, 100),
    metadataSampleLimit: clampNumber(process.env.REDMINE_METADATA_SAMPLE_LIMIT, 25, 1000, 100),
    manualCustomFields: loadManualCustomFields(rootDir),
  };

  const issues = validateRedmineConfig(redmine);

  return {
    port: clampNumber(process.env.PORT, 1024, 65535, 4173),
    redmine,
    issues,
    isConfigured: issues.length === 0,
  };
}

function loadManualCustomFields(rootDir) {
  const filePath = path.join(rootDir, "redmine-fields.json");
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const fields = Array.isArray(parsed) ? parsed : parsed.customFields;
    return Array.isArray(fields) ? fields.map(normalizeManualField).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeManualField(field) {
  const id = String(field.id || "").replace(/^cf_/, "");
  if (!id || !field.name) {
    return null;
  }

  return {
    id,
    key: `cf_${id}`,
    name: String(field.name),
    format: field.format || field.field_format || "string",
    isFilter: field.isFilter !== false,
    multiple: Boolean(field.multiple),
    possibleValues: Array.isArray(field.possibleValues)
      ? field.possibleValues.map((value) => (
          typeof value === "string" ? { value, label: value } : value
        ))
      : [],
  };
}

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const env = fs.readFileSync(envPath, "utf8");

  for (const rawLine of env.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function validateRedmineConfig(redmine) {
  const issues = [];

  if (!redmine.url) {
    issues.push("REDMINE_URL is missing.");
  } else if (!isHttpUrl(redmine.url)) {
    issues.push("REDMINE_URL must start with http:// or https://.");
  }

  if (!redmine.apiKey) {
    issues.push("REDMINE_API_KEY is missing.");
  } else if (/put-your-api-key|example|placeholder/i.test(redmine.apiKey)) {
    issues.push("REDMINE_API_KEY still looks like a placeholder.");
  } else if (redmine.apiKey.length < 20) {
    issues.push("REDMINE_API_KEY looks too short for a Redmine API key.");
  }

  return issues;
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function redactUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(number)));
}

module.exports = { loadConfig };
