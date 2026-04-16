#!/usr/bin/env node
/**
 * postinstall.js — legacy npm install entrypoint for WARD.
 *
 * WARD is primarily distributed as a Claude Code plugin (see ../../README.md).
 * This script is kept only for environments that cannot use the plugin system.
 * It seeds ~/.ward/ and installs legacy slash commands into ~/.claude/commands/
 * with ${CLAUDE_PLUGIN_ROOT} rewritten to the npm install path.
 */

const { spawnSync } = require("child_process");
const path = require("path");

// The real bootstrap.py lives under the repo's scripts/ directory.
// __dirname here is legacy/npm/, so back up two levels.
const bootstrapScript = path.join(__dirname, "..", "..", "scripts", "bootstrap.py");

console.warn(
  "\nWARD npm install is the legacy fallback path. The recommended install is:\n" +
  "  /plugin marketplace add eljun/ward\n" +
  "  /plugin install ward@ward-plugins\n"
);

const result = spawnSync(
  "python3",
  [bootstrapScript, "--legacy-commands"],
  { stdio: "inherit" }
);

if (result.error || result.status !== 0) {
  console.error(
    "\nWARD: bootstrap.py failed. Make sure Python 3.9+ is installed."
  );
  console.error(`Run manually: python3 "${bootstrapScript}" --legacy-commands\n`);
}
