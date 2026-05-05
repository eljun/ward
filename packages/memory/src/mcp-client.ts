import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  McpToolSummarySchema,
  WARD_VERSION,
  type McpToolSummary
} from "@ward/core";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type PendingRequest = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
};

export type ProbeStdioMcpServerInput = {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  timeout_ms?: number;
  stderr_log_path: string;
  redaction_values?: string[];
};

export type ProbeStdioMcpServerResult = {
  tools: McpToolSummary[];
  stderr_log_path: string;
};

export type CallStdioMcpToolInput = ProbeStdioMcpServerInput & {
  tool_name: string;
  arguments: unknown;
};

export type CallStdioMcpToolResult = {
  result: unknown;
  stderr_log_path: string;
};

const MCP_PROTOCOL_VERSION = "2024-11-05";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactText(value: string, redactionValues: string[]): string {
  return redactionValues
    .filter((item) => item.length >= 4)
    .reduce((next, secret) => next.replace(new RegExp(escapeRegex(secret), "g"), "[redacted]"), value);
}

function responseError(response: JsonRpcResponse): Error | null {
  if (!response.error) {
    return null;
  }
  return new Error(response.error.message ?? `MCP JSON-RPC error ${response.error.code ?? "unknown"}`);
}

function parseToolSummaries(result: unknown): McpToolSummary[] {
  const tools = typeof result === "object" && result !== null && "tools" in result
    ? (result as { tools?: unknown }).tools
    : [];
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools.map((tool) => {
    const item = typeof tool === "object" && tool !== null ? tool as Record<string, unknown> : {};
    return McpToolSummarySchema.parse({
      name: String(item.name ?? "unknown"),
      description: typeof item.description === "string" ? item.description : undefined,
      input_schema: item.inputSchema ?? item.input_schema
    });
  });
}

export async function probeStdioMcpServer(input: ProbeStdioMcpServerInput): Promise<ProbeStdioMcpServerResult> {
  await mkdir(dirname(input.stderr_log_path), { recursive: true, mode: 0o700 });
  await appendFile(input.stderr_log_path, `\n--- probe ${new Date().toISOString()} ---\n`, { encoding: "utf8" });

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const pending = new Map<number, PendingRequest>();
    const redactionValues = input.redaction_values ?? [];
    let nextId = 1;
    let stdoutBuffer = "";
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      pending.clear();
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const request of pending.values()) {
        request.reject(error);
      }
      cleanup();
      rejectPromise(error);
    };

    const finish = (result: ProbeStdioMcpServerResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      fail(new Error(`MCP stdio probe timed out after ${input.timeout_ms ?? 5000} ms`));
    }, input.timeout_ms ?? 5000);
    timer.unref?.();

    const request = (method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> => {
      const id = nextId;
      nextId += 1;
      const payload = { jsonrpc: "2.0", id, method, params };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) {
            pending.delete(id);
            reject(error);
          }
        });
      });
    };

    const notification = (method: string, params: Record<string, unknown> = {}): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    };

    const handleMessage = (line: string): void => {
      if (!line.trim()) {
        return;
      }
      let parsed: JsonRpcResponse;
      try {
        parsed = JSON.parse(line) as JsonRpcResponse;
      } catch {
        fail(new Error("MCP server wrote invalid JSON to stdout"));
        return;
      }
      if (typeof parsed.id !== "number") {
        return;
      }
      const waiting = pending.get(parsed.id);
      if (!waiting) {
        return;
      }
      pending.delete(parsed.id);
      waiting.resolve(parsed);
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      while (stdoutBuffer.includes("\n")) {
        const separator = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, separator);
        stdoutBuffer = stdoutBuffer.slice(separator + 1);
        handleMessage(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const redacted = redactText(String(chunk), redactionValues);
      void appendFile(input.stderr_log_path, redacted, { encoding: "utf8" }).catch(() => undefined);
    });

    child.on("error", (error) => {
      fail(error);
    });

    child.on("exit", (code, signal) => {
      if (!settled && pending.size > 0) {
        fail(new Error(`MCP server exited before probe completed (${signal ?? code ?? "unknown"})`));
      }
    });

    void (async () => {
      const initialize = await request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "ward",
          version: WARD_VERSION
        }
      });
      const initializeError = responseError(initialize);
      if (initializeError) {
        throw initializeError;
      }

      notification("notifications/initialized");

      const listed = await request("tools/list");
      const listError = responseError(listed);
      if (listError) {
        throw listError;
      }
      finish({
        tools: parseToolSummaries(listed.result),
        stderr_log_path: input.stderr_log_path
      });
    })().catch((error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export async function callStdioMcpTool(input: CallStdioMcpToolInput): Promise<CallStdioMcpToolResult> {
  await mkdir(dirname(input.stderr_log_path), { recursive: true, mode: 0o700 });
  await appendFile(input.stderr_log_path, `\n--- call ${new Date().toISOString()} ${input.tool_name} ---\n`, { encoding: "utf8" });

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const pending = new Map<number, PendingRequest>();
    const redactionValues = input.redaction_values ?? [];
    let nextId = 1;
    let stdoutBuffer = "";
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      pending.clear();
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const request of pending.values()) {
        request.reject(error);
      }
      cleanup();
      rejectPromise(error);
    };

    const finish = (result: CallStdioMcpToolResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      fail(new Error(`MCP stdio call timed out after ${input.timeout_ms ?? 5000} ms`));
    }, input.timeout_ms ?? 5000);
    timer.unref?.();

    const request = (method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> => {
      const id = nextId;
      nextId += 1;
      const payload = { jsonrpc: "2.0", id, method, params };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (error) {
            pending.delete(id);
            reject(error);
          }
        });
      });
    };

    const notification = (method: string, params: Record<string, unknown> = {}): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    };

    const handleMessage = (line: string): void => {
      if (!line.trim()) {
        return;
      }
      let parsed: JsonRpcResponse;
      try {
        parsed = JSON.parse(line) as JsonRpcResponse;
      } catch {
        fail(new Error("MCP server wrote invalid JSON to stdout"));
        return;
      }
      if (typeof parsed.id !== "number") {
        return;
      }
      const waiting = pending.get(parsed.id);
      if (!waiting) {
        return;
      }
      pending.delete(parsed.id);
      waiting.resolve(parsed);
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      while (stdoutBuffer.includes("\n")) {
        const separator = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, separator);
        stdoutBuffer = stdoutBuffer.slice(separator + 1);
        handleMessage(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const redacted = redactText(String(chunk), redactionValues);
      void appendFile(input.stderr_log_path, redacted, { encoding: "utf8" }).catch(() => undefined);
    });

    child.on("error", (error) => {
      fail(error);
    });

    child.on("exit", (code, signal) => {
      if (!settled && pending.size > 0) {
        fail(new Error(`MCP server exited before call completed (${signal ?? code ?? "unknown"})`));
      }
    });

    void (async () => {
      const initialize = await request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "ward",
          version: WARD_VERSION
        }
      });
      const initializeError = responseError(initialize);
      if (initializeError) {
        throw initializeError;
      }

      notification("notifications/initialized");

      const called = await request("tools/call", {
        name: input.tool_name,
        arguments: input.arguments
      });
      const callError = responseError(called);
      if (callError) {
        throw callError;
      }
      finish({
        result: called.result ?? null,
        stderr_log_path: input.stderr_log_path
      });
    })().catch((error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
