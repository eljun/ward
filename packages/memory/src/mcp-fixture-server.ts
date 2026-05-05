#!/usr/bin/env bun
import { WARD_VERSION } from "@ward/core";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
};

const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ?? "ok";
const failCall = process.argv.find((arg) => arg.startsWith("--fail-call="))?.slice("--fail-call=".length);

const tools = [
  {
    name: "fixture.read_context",
    description: "Read deterministic fixture context.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string" }
      }
    }
  },
  {
    name: "fixture.echo",
    description: "Echo a fixture payload.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" }
      }
    }
  }
];

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: number, value: unknown): void {
  write({ jsonrpc: "2.0", id, result: value });
}

function error(id: number, code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(request: JsonRpcRequest): void {
  if (mode === "timeout") {
    return;
  }
  if (mode === "invalid-json") {
    process.stdout.write("this is not json\n");
    return;
  }
  if (request.method === "notifications/initialized") {
    return;
  }
  if (typeof request.id !== "number") {
    return;
  }
  if (request.method === "initialize") {
    if (mode === "fail-initialize") {
      error(request.id, -32000, "fixture initialize failure");
      return;
    }
    result(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "ward-fixture-mcp",
        version: WARD_VERSION
      }
    });
    return;
  }
  if (request.method === "tools/list") {
    if (mode === "fail-tools") {
      error(request.id, -32000, "fixture tools/list failure");
      return;
    }
    process.stderr.write(`fixture listed ${tools.length} tools\n`);
    if (process.env.WARD_FIXTURE_TOKEN) {
      process.stderr.write(`fixture token ${process.env.WARD_FIXTURE_TOKEN}\n`);
    }
    result(request.id, { tools });
    return;
  }
  if (request.method === "tools/call") {
    const params = typeof request.params === "object" && request.params !== null
      ? request.params as { name?: unknown; arguments?: unknown }
      : {};
    const toolName = typeof params.name === "string" ? params.name : "unknown";
    if (mode === "fail-call" || failCall === toolName) {
      error(request.id, -32000, `fixture call failure for ${toolName}`);
      return;
    }
    if (toolName === "fixture.read_context" || toolName === "fixture.echo") {
      process.stderr.write(`fixture called ${toolName}\n`);
      if (process.env.WARD_FIXTURE_TOKEN) {
        process.stderr.write(`fixture token ${process.env.WARD_FIXTURE_TOKEN}\n`);
      }
      result(request.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              tool: toolName,
              arguments: params.arguments ?? {}
            })
          }
        ],
        structuredContent: {
          ok: true,
          tool: toolName,
          arguments: params.arguments ?? {}
        }
      });
      return;
    }
    error(request.id, -32602, `Unknown fixture tool: ${toolName}`);
    return;
  }
  error(request.id, -32601, `Unknown method: ${request.method ?? "unknown"}`);
}

let buffer = "";
const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) {
    break;
  }
  buffer += decoder.decode(value);
  while (buffer.includes("\n")) {
    const separator = buffer.indexOf("\n");
    const line = buffer.slice(0, separator).trim();
    buffer = buffer.slice(separator + 1);
    if (!line) {
      continue;
    }
    try {
      handle(JSON.parse(line) as JsonRpcRequest);
    } catch {
      process.stderr.write("fixture received invalid json\n");
    }
  }
}
