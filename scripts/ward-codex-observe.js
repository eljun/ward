#!/usr/bin/env node
/**
 * ward-codex-observe.js — stdin observer wrapper for Codex event streams.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const script = path.join(__dirname, "ward_codex_observe.py");
const args = process.argv.slice(2);
const result = spawnSync("python3", [script, ...args], { stdio: "inherit" });

if (result.error) {
  console.error("\nWARD: ward_codex_observe.py failed. Make sure Python 3.9+ is installed.");
  console.error(`Run manually: python3 "${script}"\n`);
  process.exit(1);
}

process.exit(result.status ?? 0);
