/**
 * OpenAI-compatible chat completion client.
 *
 * Targets local Ollama (default port 11434) and any other server that
 * implements the OpenAI `/v1/chat/completions` shape. v1 supports
 * streaming and non-streaming completions; no tool calling.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionRequest = {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Ollama-specific: how long to keep the model loaded in VRAM. e.g. "60m", "-1" for forever. */
  keep_alive?: string | number;
  /** Ollama-specific: disable chain-of-thought on thinking models. Forwarded as `think` in the body. */
  think?: boolean;
  /** Free-form extra body fields merged into the request (Ollama options.*). */
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export class OpenAiCompatibleError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "OpenAiCompatibleError";
    this.status = status;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number | undefined): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      const onAbort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
  }
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs} ms.`)), timeoutMs);
    cleanups.push(() => clearTimeout(timer));
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const fn of cleanups) fn();
    }
  };
}

/**
 * Non-streaming chat completion. Returns the full assistant text.
 */
export async function chatCompletion(request: ChatCompletionRequest): Promise<{ text: string }> {
  const { signal, cleanup } = withTimeout(request.signal, request.timeoutMs ?? 60000);
  try {
    const response = await fetch(joinUrl(request.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        keep_alive: request.keep_alive,
        think: request.think,
        ...(request.extra ?? {}),
        stream: false
      }),
      signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new OpenAiCompatibleError(
        `Chat completion failed (${response.status}): ${detail.slice(0, 240) || response.statusText}`,
        response.status
      );
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return { text: typeof text === "string" ? text : String(text) };
  } finally {
    cleanup();
  }
}

/**
 * Streaming chat completion. Yields delta chunks as the model generates.
 */
export async function* streamChatCompletion(request: ChatCompletionRequest): AsyncGenerator<ChatStreamEvent, void, void> {
  const { signal, cleanup } = withTimeout(request.signal, request.timeoutMs ?? 120000);
  let response: Response;
  try {
    response = await fetch(joinUrl(request.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        keep_alive: request.keep_alive,
        think: request.think,
        ...(request.extra ?? {}),
        stream: true
      }),
      signal
    });
  } catch (err) {
    cleanup();
    yield { type: "error", message: (err as Error).message };
    return;
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    cleanup();
    yield {
      type: "error",
      message: `Chat completion stream failed (${response.status}): ${detail.slice(0, 240) || response.statusText}`
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let lineEnd = buffer.indexOf("\n");
      while (lineEnd >= 0) {
        const rawLine = buffer.slice(0, lineEnd).replace(/\r$/, "");
        buffer = buffer.slice(lineEnd + 1);
        lineEnd = buffer.indexOf("\n");

        if (!rawLine.startsWith("data:")) continue;
        const payload = rawLine.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          yield { type: "done" };
          cleanup();
          return;
        }
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            yield { type: "delta", text: delta };
          }
        } catch {
          // Skip malformed chunks rather than aborting the stream.
        }
      }
    }
  } catch (err) {
    cleanup();
    yield { type: "error", message: (err as Error).message };
    return;
  }

  cleanup();
  yield { type: "done" };
}

/**
 * Ollama native chat API — significantly faster than the OpenAI-compat
 * `/v1/chat/completions` endpoint (the compat layer can be 8-10x slower
 * because it appears not to honor keep_alive across calls). When the
 * server is Ollama (default port 11434), prefer this path.
 */
function deriveNativeBase(baseUrl: string): string {
  // Map e.g. "http://127.0.0.1:11434/v1" -> "http://127.0.0.1:11434"
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function buildOllamaBody(request: ChatCompletionRequest, stream: boolean): string {
  const options: Record<string, unknown> = {};
  if (typeof request.temperature === "number") options.temperature = request.temperature;
  if (typeof request.max_tokens === "number") options.num_predict = request.max_tokens;
  return JSON.stringify({
    model: request.model,
    messages: request.messages,
    stream,
    keep_alive: request.keep_alive,
    think: request.think,
    options,
    ...(request.extra ?? {})
  });
}

export async function ollamaChat(request: ChatCompletionRequest): Promise<{ text: string }> {
  const { signal, cleanup } = withTimeout(request.signal, request.timeoutMs ?? 60000);
  try {
    const response = await fetch(`${deriveNativeBase(request.baseUrl)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildOllamaBody(request, false),
      signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new OpenAiCompatibleError(
        `Ollama chat failed (${response.status}): ${detail.slice(0, 240) || response.statusText}`,
        response.status
      );
    }
    const data = await response.json();
    const text = data?.message?.content ?? "";
    return { text: typeof text === "string" ? text : String(text) };
  } finally {
    cleanup();
  }
}

export async function* streamOllamaChat(request: ChatCompletionRequest): AsyncGenerator<ChatStreamEvent, void, void> {
  const { signal, cleanup } = withTimeout(request.signal, request.timeoutMs ?? 120000);
  let response: Response;
  try {
    response = await fetch(`${deriveNativeBase(request.baseUrl)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildOllamaBody(request, true),
      signal
    });
  } catch (err) {
    cleanup();
    yield { type: "error", message: (err as Error).message };
    return;
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    cleanup();
    yield {
      type: "error",
      message: `Ollama chat stream failed (${response.status}): ${detail.slice(0, 240) || response.statusText}`
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let lineEnd = buffer.indexOf("\n");
      while (lineEnd >= 0) {
        const rawLine = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        lineEnd = buffer.indexOf("\n");
        if (!rawLine) continue;
        try {
          const parsed = JSON.parse(rawLine);
          const chunk = parsed?.message?.content;
          if (typeof chunk === "string" && chunk.length > 0) {
            yield { type: "delta", text: chunk };
          }
          if (parsed?.done === true) {
            yield { type: "done" };
            cleanup();
            return;
          }
        } catch {
          // Skip malformed lines.
        }
      }
    }
  } catch (err) {
    cleanup();
    yield { type: "error", message: (err as Error).message };
    return;
  }

  cleanup();
  yield { type: "done" };
}

/**
 * Probe an OpenAI-compatible server (e.g. Ollama) for reachability and
 * optional model presence. Hits `/api/tags` first (Ollama-native, lighter)
 * and falls back to `/v1/models`.
 */
export async function probeOpenAiCompatible(
  baseUrl: string,
  expectedModel?: string,
  timeoutMs = 3000
): Promise<{
  reachable: boolean;
  model_present: boolean;
  latency_ms: number | null;
  models: string[];
  error: string | null;
}> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Probe timed out after ${timeoutMs} ms.`)), timeoutMs);
  const ollamaTagsUrl = baseUrl.replace(/\/v1\/?$/, "/api/tags");
  const v1ModelsUrl = joinUrl(baseUrl, "/models");

  async function tryFetch(url: string): Promise<Response | null> {
    try {
      return await fetch(url, { signal: controller.signal });
    } catch {
      return null;
    }
  }

  try {
    let response = await tryFetch(ollamaTagsUrl);
    if (!response || !response.ok) {
      response = await tryFetch(v1ModelsUrl);
    }
    if (!response || !response.ok) {
      return {
        reachable: false,
        model_present: false,
        latency_ms: null,
        models: [],
        error: response ? `${response.status} ${response.statusText}` : "Server unreachable."
      };
    }
    const data = await response.json().catch(() => null);
    const models: string[] = [];
    if (data?.models && Array.isArray(data.models)) {
      // Ollama: { models: [{ name, model, size, ... }] }
      for (const entry of data.models) {
        const name = (entry?.name ?? entry?.model) as string | undefined;
        if (typeof name === "string") models.push(name);
      }
    } else if (data?.data && Array.isArray(data.data)) {
      // OpenAI: { data: [{ id }] }
      for (const entry of data.data) {
        if (typeof entry?.id === "string") models.push(entry.id);
      }
    }
    return {
      reachable: true,
      model_present: expectedModel ? models.includes(expectedModel) : false,
      latency_ms: Date.now() - startedAt,
      models,
      error: null
    };
  } catch (err) {
    return {
      reachable: false,
      model_present: false,
      latency_ms: null,
      models: [],
      error: (err as Error).message
    };
  } finally {
    clearTimeout(timer);
  }
}
