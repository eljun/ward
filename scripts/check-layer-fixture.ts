import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const fixturePath = join(process.cwd(), "apps", "runtime", "src", "__layer_violation.fixture.ts");

try {
  writeFileSync(fixturePath, "import '../../cli/src/main.ts';\n", "utf8");
  const result = spawnSync("bun", ["run", "lint:layers"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) {
    process.stderr.write("Expected dependency-cruiser to reject the seeded layer violation.\n");
    process.exit(1);
  }

  if (!output.includes("runtime-must-not-import-cli")) {
    process.stderr.write(output);
    process.stderr.write("\nLayer violation failed, but not for the expected rule.\n");
    process.exit(1);
  }

  process.stdout.write("Seeded layer violation rejected as expected.\n");
} finally {
  try {
    unlinkSync(fixturePath);
  } catch {
    // Ignore cleanup failures for missing fixture.
  }
}
