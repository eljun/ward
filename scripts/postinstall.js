#!/usr/bin/env node
/**
 * postinstall.js — run WARD bootstrap after npm install
 */

const { spawnSync } = require("child_process");
const path = require("path");

const bootstrapScript = path.join(__dirname, "bootstrap.py");

// Use spawnSync instead of execSync to avoid spawning sh — execSync uses
// "sh -c ..." internally, which fails when sh is not in the sudo PATH.
const result = spawnSync("python3", [bootstrapScript], { stdio: "inherit" });

if (result.error || result.status !== 0) {
  console.error(
    "\nWARD: bootstrap.py failed. Make sure Python 3.9+ is installed."
  );
  console.error(`Run manually: python3 "${bootstrapScript}"\n`);
  // Don't exit non-zero — a failed bootstrap shouldn't block the npm install
}
