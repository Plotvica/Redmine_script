const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const searchDirs = ["server.js", "src", "public"].map((item) => path.join(rootDir, item));
const files = searchDirs.flatMap(collectJavaScriptFiles);
const failed = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    failed.push(file);
  }
}

if (failed.length) {
  console.error(`JS syntax failed in ${failed.length} file(s).`);
  process.exit(1);
}

console.log(`Checked ${files.length} JS files.`);

function collectJavaScriptFiles(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return targetPath.endsWith(".js") ? [targetPath] : [];
  }

  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      return collectJavaScriptFiles(entryPath);
    }
    return entry.name.endsWith(".js") ? [entryPath] : [];
  });
}
