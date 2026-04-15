#!/usr/bin/env node
/**
 * postinstall.js — run WARD bootstrap after npm install
 */

const { execSync } = require("child_process");
const path = require("path");

const bootstrapScript = path.join(__dirname, "bootstrap.py");

try {
  execSync(`python3 "${bootstrapScript}"`, { stdio: "inherit" });
} catch (err) {
  console.error(
    "\nWARD: bootstrap.py failed. Make sure Python 3.9+ is installed."
  );
  console.error(
    `Run manually: python3 "${bootstrapScript}"\n`
  );
  // Don't exit non-zero — a failed bootstrap shouldn't block the npm install
}
