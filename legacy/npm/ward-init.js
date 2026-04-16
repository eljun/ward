#!/usr/bin/env node
/**
 * ward-init.js — register the current project in ~/.ward/config.json
 */

const { spawnSync } = require("child_process");
const path = require("path");

// The real init_project.py lives under the repo's scripts/ directory.
// __dirname here is legacy/npm/, so back up two levels.
const initScript = path.join(__dirname, "..", "..", "scripts", "init_project.py");

const args = process.argv.slice(2); // pass through any extra flags
const result = spawnSync("python3", [initScript, ...args], { stdio: "inherit" });

if (result.error) {
  console.error("\nWARD: init_project.py failed. Make sure Python 3.9+ is installed.");
  console.error(`Run manually: python3 "${initScript}"\n`);
  process.exit(1);
}

process.exit(result.status ?? 0);
