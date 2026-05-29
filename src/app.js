const http = require("node:http");
const { URL } = require("node:url");

const { loadConfig } = require("./config/env");
const { createRedmineClient } = require("./redmine/client");
const { buildDashboard } = require("./redmine/dashboard-service");
const { buildMetadata } = require("./redmine/metadata-service");
const { serveStatic } = require("./http/static");
const { sendJson } = require("./http/respond");
const { readDashboards, writeDashboards } = require("./storage/dashboard-store");

function createApp({ rootDir }) {
  const config = loadConfig(rootDir);
  const redmine = createRedmineClient(config.redmine);

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host}`);

      if (requestUrl.pathname.startsWith("/api/")) {
        await handleApi({ req, requestUrl, res, config, redmine, rootDir });
        return;
      }

      serveStatic({ rootDir, pathname: requestUrl.pathname, res });
    } catch (error) {
      console.error(error);
      sendJson(res, error.status || 500, {
        error: "internal_error",
        message: "Unexpected server error.",
        detail: error.message,
      });
    }
  });

  return { server, config };
}

async function handleApi({ req, requestUrl, res, config, redmine, rootDir }) {
  if (requestUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      configured: config.isConfigured,
      redmineUrl: config.redmine.safeUrl,
      configIssues: config.issues,
    });
    return;
  }

  ensureRedmineConfigured(config);

  if (requestUrl.pathname === "/api/saved-dashboards") {
    if (req.method === "GET") {
      sendJson(res, 200, await readDashboards(rootDir));
      return;
    }

    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await writeDashboards(rootDir, body.dashboards));
      return;
    }
  }

  if (requestUrl.pathname === "/api/projects") {
    const projects = await redmine.fetchPaginated("/projects.json", {}, "projects", config.redmine.pageLimit);
    projects.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    sendJson(res, 200, { projects });
    return;
  }

  if (requestUrl.pathname === "/api/metadata") {
    const projectId = requestUrl.searchParams.get("project_id") || "";
    const metadata = await buildMetadata({ redmine, config, projectId });
    sendJson(res, 200, metadata);
    return;
  }

  if (requestUrl.pathname === "/api/dashboard") {
    const filters = parseDashboardFilters(requestUrl.searchParams);
    const dashboard = await buildDashboard({ config, redmine, filters });
    sendJson(res, 200, dashboard);
    return;
  }

  sendJson(res, 404, { error: "not_found", message: "Unknown API route." });
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseDashboardFilters(searchParams) {
  const customFields = {};

  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith("cf_") && value) {
      customFields[key] = value;
    }
  }

  return {
    projectId: searchParams.get("project_id") || "",
    periodMode: searchParams.get("period_mode") || "last_days",
    days: clampNumber(searchParams.get("days"), 1, 3650, 30),
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
    versionId: searchParams.get("version_id") || "",
    sprintId: searchParams.get("sprint_id") || "",
    assigneeId: searchParams.get("assignee_id") || "",
    timeUserIds: parseList(searchParams.get("time_user_ids")),
    authorId: searchParams.get("author_id") || "",
    trackerId: searchParams.get("tracker_id") || "",
    trackerIds: parseList(searchParams.get("tracker_ids")),
    timeSource: searchParams.get("time_source") || "",
    statusId: searchParams.has("status_id") ? searchParams.get("status_id") : "open",
    priorityId: searchParams.get("priority_id") || "",
    customFields,
  };
}

function ensureRedmineConfigured(config) {
  if (config.isConfigured) {
    return;
  }

  const error = new Error(config.issues.join(" ") || "Set REDMINE_URL and REDMINE_API_KEY in .env first.");
  error.status = 400;
  throw error;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(number)));
}

module.exports = { createApp };
