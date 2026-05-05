#!/usr/bin/env bun
import { WARD_VERSION } from "@ward/core";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
};

const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ?? "ok";

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
