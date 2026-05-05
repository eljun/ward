import {
  McpPolicyDecisionSchema,
  McpPolicyPreviewRequestSchema,
  McpToolClassificationSchema,
  type McpCapabilityProfile,
  type McpPolicyDecision,
  type McpPolicyPreviewRequest,
  type McpServerConfig,
  type McpToolClass,
  type McpToolClassification
} from "@ward/core";
import { getEffectiveMcpConfig } from "./mcp.ts";

type HeuristicRule = {
  tool_class: McpToolClass;
  patterns: RegExp[];
};

type EvaluateMcpPolicyInput = {
  tool_name: string;
  tool_class?: McpToolClass;
  autonomy_level: "strict" | "standard" | "lenient";
  allowed_tools?: string[];
  capability_profiles?: McpCapabilityProfile[];
  ci_green?: boolean;
  server_config?: McpServerConfig;
};

type CapabilityProfileExpansion = {
  profile: McpCapabilityProfile;
  allowed_tools: string[];
};

const HEURISTIC_RULES: HeuristicRule[] = [
  {
    tool_class: "privileged",
    patterns: [
      /(^|[._:-])(payment|payments|billing|charge|payout|invoice|transfer)([._:-]|$)/,
      /(^|[._:-])(buy|purchase|subscribe)([._:-]|$)/,
      /(^|[._:-])(prod|production)([._:-]).*(deploy|release)/
    ]
  },
  {
    tool_class: "destructive",
    patterns: [
      /(^|[._:-])(delete|destroy|drop|truncate|purge|wipe|erase)([._:-]|$)/,
      /(^|[._:-])(force[-_]?push|merge|rollback|archive)([._:-]|$)/,
      /(database|db|table|bucket)[._:-](delete|drop|truncate|purge)/
    ]
  },
  {
    tool_class: "write",
    patterns: [
      /(^|[._:-])(create|update|edit|write|patch|put|post|send|publish|comment|insert|upsert|commit|push|open|set)([._:-]|$)/,
      /(issues|pulls|prs|messages|files|wiki)[._:-](add|new|create|update|write)/
    ]
  },
  {
    tool_class: "read",
    patterns: [
      /(^|[._:-])(get|list|read|search|find|fetch|query|inspect|describe|status|show)([._:-]|$)/
    ]
  }
];

const CAPABILITY_PROFILE_EXPANSIONS: Record<McpCapabilityProfile, CapabilityProfileExpansion> = {
  browser_qa: {
    profile: "browser_qa",
    allowed_tools: [
      "browser.*",
      "browser_*",
      "playwright.*",
      "playwright_*"
    ]
  },
  repo_hosting: {
    profile: "repo_hosting",
    allowed_tools: [
      "github.*",
      "github_*",
      "gitlab.*",
      "gitlab_*",
      "repos.*",
      "issues.*",
      "pulls.*",
      "prs.*"
    ]
  },
  deployment: {
    profile: "deployment",
    allowed_tools: [
      "deployment.*",
      "deployments.*",
      "vercel.*",
      "vercel_*",
      "netlify.*"
    ]
  },
  database: {
    profile: "database",
    allowed_tools: [
      "database.*",
      "db.*",
      "postgres.*",
      "supabase.*",
      "sql.*"
    ]
  }
};

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(toolName: string, pattern: string): boolean {
  return pattern.includes("*")
    ? wildcardToRegex(pattern).test(toolName)
    : pattern.toLowerCase() === toolName.toLowerCase();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function dedupeProfiles(values: McpCapabilityProfile[]): McpCapabilityProfile[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function overrideClass(toolName: string, config?: McpServerConfig): { tool_class: McpToolClass; pattern: string } | null {
  if (!config) {
    return null;
  }
  const exact = config.ward_tool_class_overrides[toolName];
  if (exact) {
    return { tool_class: exact, pattern: toolName };
  }
  for (const [pattern, toolClass] of Object.entries(config.ward_tool_class_overrides)) {
    if (matchesPattern(toolName, pattern)) {
      return { tool_class: toolClass, pattern };
    }
  }
  return null;
}

export function classifyMcpTool(input: {
  tool_name: string;
  tool_class?: McpToolClass;
  server_config?: McpServerConfig;
}): McpToolClassification {
  const override = overrideClass(input.tool_name, input.server_config);
  if (override) {
    return McpToolClassificationSchema.parse({
      tool_name: input.tool_name,
      tool_class: override.tool_class,
      source: "override",
      matched_pattern: override.pattern
    });
  }

  if (input.tool_class) {
    return McpToolClassificationSchema.parse({
      tool_name: input.tool_name,
      tool_class: input.tool_class,
      source: "explicit",
      matched_pattern: null
    });
  }

  const normalized = input.tool_name.toLowerCase();
  for (const rule of HEURISTIC_RULES) {
    const matched = rule.patterns.find((pattern) => pattern.test(normalized));
    if (matched) {
      return McpToolClassificationSchema.parse({
        tool_name: input.tool_name,
        tool_class: rule.tool_class,
        source: "heuristic",
        matched_pattern: String(matched)
      });
    }
  }

  return McpToolClassificationSchema.parse({
    tool_name: input.tool_name,
    tool_class: "read",
    source: "default",
    matched_pattern: null
  });
}

export function expandMcpCapabilityProfiles(profiles: McpCapabilityProfile[]): {
  profiles: McpCapabilityProfile[];
  allowed_tools: string[];
} {
  const normalized = dedupeProfiles(profiles);
  return {
    profiles: normalized,
    allowed_tools: dedupe(normalized.flatMap((profile) => CAPABILITY_PROFILE_EXPANSIONS[profile].allowed_tools))
  };
}

function autonomyAllows(toolClass: McpToolClass, autonomyLevel: "strict" | "standard" | "lenient", ciGreen: boolean): string | null {
  if (toolClass === "read") {
    return null;
  }
  if (autonomyLevel === "strict") {
    return `Autonomy strict only permits read tools; ${toolClass} requires approval.`;
  }
  if (autonomyLevel === "standard") {
    return toolClass === "write"
      ? null
      : `Autonomy standard permits read/write tools; ${toolClass} requires approval.`;
  }
  if (toolClass === "privileged") {
    return "Autonomy lenient still requires approval for privileged tools.";
  }
  if (toolClass === "destructive" && !ciGreen) {
    return "Autonomy lenient requires CI green before destructive tools can run automatically.";
  }
  return null;
}

export function evaluateMcpPolicy(input: EvaluateMcpPolicyInput): McpPolicyDecision {
  const profiles = dedupeProfiles([
    ...(input.server_config?.ward_capability_profiles ?? []),
    ...(input.capability_profiles ?? [])
  ]);
  const profileExpansion = expandMcpCapabilityProfiles(profiles);
  const effectiveAllowedTools = input.allowed_tools
    ? dedupe([...input.allowed_tools, ...profileExpansion.allowed_tools])
    : profileExpansion.allowed_tools;
  const classification = classifyMcpTool({
    tool_name: input.tool_name,
    tool_class: input.tool_class,
    server_config: input.server_config
  });
  const reasons: string[] = [];

  if (input.server_config && !input.server_config.ward_tool_scopes.includes(classification.tool_class)) {
    reasons.push(`Tool class ${classification.tool_class} is not enabled for this MCP server.`);
  }

  if (effectiveAllowedTools.length > 0 && !effectiveAllowedTools.some((pattern) => matchesPattern(input.tool_name, pattern))) {
    reasons.push("Tool is not in the session allowlist or requested capability profile.");
  }

  const autonomyDenial = autonomyAllows(classification.tool_class, input.autonomy_level, Boolean(input.ci_green));
  if (autonomyDenial) {
    reasons.push(autonomyDenial);
  }

  const denialReason = reasons[0] ?? null;
  return McpPolicyDecisionSchema.parse({
    tool_name: input.tool_name,
    tool_class: classification.tool_class,
    class_source: classification.source,
    matched_pattern: classification.matched_pattern,
    autonomy_level: input.autonomy_level,
    ci_green: Boolean(input.ci_green),
    allowed_tools: effectiveAllowedTools,
    capability_profiles: profiles,
    allowed: reasons.length === 0,
    reasons,
    denial_reason: denialReason,
    synthetic_result: denialReason
      ? {
          type: "tool_not_allowed",
          tool_name: input.tool_name,
          reason: denialReason
        }
      : null,
    denial_payload: denialReason
      ? {
          tool_name: input.tool_name,
          tool_class: classification.tool_class,
          autonomy_level: input.autonomy_level,
          reason: denialReason,
          allowed_tools: effectiveAllowedTools,
          capability_profiles: profiles
        }
      : null
  });
}

export async function previewMcpPolicy(input: McpPolicyPreviewRequest): Promise<McpPolicyDecision> {
  const parsed = McpPolicyPreviewRequestSchema.parse(input);
  let serverConfig: McpServerConfig | undefined;
  if (parsed.server_id) {
    const effective = await getEffectiveMcpConfig(parsed.workspace, { includeRepo: true, redact: false });
    const server = effective.servers.find((item) => item.id === parsed.server_id);
    if (!server) {
      throw new Error("MCP server not found");
    }
    serverConfig = server.config;
  }
  return evaluateMcpPolicy({
    tool_name: parsed.tool_name,
    tool_class: parsed.tool_class,
    autonomy_level: parsed.autonomy_level,
    allowed_tools: parsed.allowed_tools,
    capability_profiles: parsed.capability_profiles,
    ci_green: parsed.ci_green,
    server_config: serverConfig
  });
}
