/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "packages-must-not-import-apps",
      severity: "error",
      from: { path: "^packages/[^/]+/src" },
      to: { path: "^apps/" }
    },
    {
      name: "runtime-must-not-import-cli",
      severity: "error",
      from: { path: "^apps/runtime/src" },
      to: { path: "^apps/cli/src" }
    },
    {
      name: "cli-must-not-import-runtime",
      severity: "error",
      from: { path: "^apps/cli/src" },
      to: { path: "^apps/runtime/src" }
    },
    {
      name: "runtime-must-not-import-ui-source",
      severity: "error",
      from: { path: "^apps/runtime/src" },
      to: { path: "^apps/ui/src" }
    }
  ],
  options: {
    doNotFollow: {
      path: "node_modules"
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json"
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"]
    }
  }
};
