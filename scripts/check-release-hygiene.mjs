import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

function isForbiddenTracked(path) {
  if (path === ".env") return true;
  if (/(^|\/)\.env\.(?!example$)[^/]+$/i.test(path)) return true;
  if (/(^|\/)node_modules\//i.test(path)) return true;
  if (/(^|\/)\.DS_Store$/i.test(path)) return true;
  if (/\.(sqlite|sqlite3|db|wal|shm)$/i.test(path)) return true;
  if (/^data\/exports\//i.test(path)) return true;
  if (/(^|\/)[^/]*(?:backup|\.bak(?:$|\.)|\.old(?:$|\.)|\.before-[^/]+$)/i.test(path)) return true;
  return false;
}

const bad = tracked.filter(isForbiddenTracked);

const examplePath = ".env.example";
const exampleProblems = [];
if (fs.existsSync(examplePath)) {
  const sensitive = /(TOKEN|SECRET|PASSWORD|COOKIE|API_KEY|BEARER)/i;
  const lines = fs.readFileSync(examplePath, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].trim();
    if (!raw || raw.startsWith("#") || !raw.includes("=")) continue;
    const eq = raw.indexOf("=");
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (sensitive.test(key) && value !== "") {
      exampleProblems.push(`${examplePath}:${index + 1} ${key} must be empty in the example file`);
    }
  }
}

if (bad.length || exampleProblems.length) {
  console.error("Release hygiene FAIL.");
  if (bad.length) {
    console.error("Remove these tracked runtime/private/backup artifacts from Git tracking:");
    for (const path of bad) console.error(` - ${path}`);
  }
  if (exampleProblems.length) {
    console.error("Sanitize .env.example:");
    for (const problem of exampleProblems) console.error(` - ${problem}`);
  }
  process.exit(2);
}

console.log("MCP release hygiene PASS: .env.example placeholders allowed; secrets/runtime DBs/exports/backups/debris are not tracked.");
