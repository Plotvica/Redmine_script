const fs = require("node:fs/promises");
const path = require("node:path");

const FILE_NAME = "dashboards.json";

function getStorePath(rootDir) {
  return path.join(rootDir, "data", FILE_NAME);
}

async function readDashboards(rootDir) {
  const storePath = getStorePath(rootDir);

  try {
    const content = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(content);
    return {
      dashboards: Array.isArray(parsed.dashboards) ? parsed.dashboards : [],
      updatedAt: parsed.updatedAt || null,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { dashboards: [], updatedAt: null };
    }
    throw error;
  }
}

async function writeDashboards(rootDir, dashboards) {
  const storePath = getStorePath(rootDir);
  const payload = {
    updatedAt: new Date().toISOString(),
    dashboards: Array.isArray(dashboards) ? dashboards : [],
  };

  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

module.exports = { readDashboards, writeDashboards };
