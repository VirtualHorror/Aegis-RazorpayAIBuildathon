import OpenAI from 'openai';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmJsonRequest,
  type LlmJsonResult,
} from './client';

export interface OpenAILlmClientOptions {
  apiKey?: string;
  /** `baseURL` is preferred; `apiBase` is retained for the .env name used by the proxy. */
  baseURL?: string;
  apiBase?: string;
  model?: string;
  modelFast?: string;
  timeoutMs?: number;
  /** Injectable SDK instance for unit tests; production callers omit this. */
  client?: OpenAI;
}

interface CompletionLike {
  choices?: ReadonlyArray<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
  } | null;
}

interface ParsedJson<T> {
  readonly ok: true;
  readonly data: T;
  readonly raw: string;
}

interface InvalidJson {
  readonly ok: false;
  readonly reason: string;
}

/**
 * OpenAI-compatible JSON adapter.
 * Intent: request JSON mode where available, tolerate proxies that reject response_format, and never return data
 *         before the caller's zod schema accepts it (C-A2).
 * Flow: structured request -> optional proxy compatibility retry -> balanced-object extraction -> one schema repair.
 */
export class OpenAILlmClient implements LlmClient {
  readonly provider = 'openai';
  readonly model: string;
  readonly modelFast: string;
  private readonly client: OpenAI;

  constructor(options: OpenAILlmClientOptions = {}) {
    this.model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.6';
    this.modelFast = options.modelFast ?? process.env.OPENAI_MODEL_FAST ?? this.model;
    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
      const baseURL = options.baseURL ?? options.apiBase ?? process.env.OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE;
      this.client = new OpenAI({
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(baseURL === undefined ? {} : { baseURL }),
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      });
    }
  }

  async completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const started = Date.now();
    const model = req.tier === 'fast' ? this.modelFast : this.model;
    const system = `${req.system}\nRespond with a single JSON object only.`;
    let includeResponseFormat = true;
    let response: CompletionLike;

    try {
      response = await this.request(model, system, req.user, req.maxTokens, includeResponseFormat);
    } catch (error) {
      if (!isResponseFormatRejection(error)) throw toUnavailable(error);
      // Some OpenAI-compatible proxies implement JSON mode but reject the response_format parameter itself.
      includeResponseFormat = false;
      try {
        response = await this.request(model, system, req.user, req.maxTokens, includeResponseFormat);
      } catch (retryError) {
        throw toUnavailable(retryError);
      }
    }

    let parsed = parseResponse(response, req.schema);
    if (!parsed.ok) {
      const repairUser = `${req.user}\n\nThe previous response failed validation: ${parsed.reason}. Return one JSON object that matches the schema exactly.`;
      try {
        response = await this.request(model, system, repairUser, req.maxTokens, includeResponseFormat);
      } catch (repairError) {
        throw toUnavailable(repairError);
      }
      parsed = parseResponse(response, req.schema);
      if (!parsed.ok) {
        throw new LlmUnavailableError('openai_invalid_json', { cause: new Error(parsed.reason) });
      }
    }

    return {
      data: parsed.data,
      provider: this.provider,
      model,
      latencyMs: Date.now() - started,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      raw: parsed.raw,
    };
  }

  private async request(
    model: string,
    system: string,
    user: string,
    maxTokens: number | undefined,
    includeResponseFormat: boolean,
  ): Promise<CompletionLike> {
    const params = {
      model,
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
      ],
      ...(includeResponseFormat ? { response_format: { type: 'json_object' as const } } : {}),
      max_completion_tokens: maxTokens ?? 2048,
    };
    return this.client.chat.completions.create(params);
  }
}

function completionText(response: CompletionLike): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part === 'object' && part !== null && 'text' in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('');
}

function parseResponse<T>(response: CompletionLike, schema: LlmJsonRequest<T>['schema']): ParsedJson<T> | InvalidJson {
  const raw = completionText(response);
  const objectText = firstJsonObject(raw);
  if (objectText === null) return { ok: false, reason: 'response did not contain a JSON object' };

  let value: unknown;
  try {
    value = JSON.parse(objectText) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `invalid JSON: ${detail}` };
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: `zod validation failed: ${parsed.error.message}` };
  return { ok: true, data: parsed.data, raw };
}

/** Extract the first balanced object, allowing nested objects and braces inside JSON strings. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function isResponseFormatRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown; error?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  if (status !== 400) return false;
  const message = [
    typeof candidate.message === 'string' ? candidate.message : '',
    typeof candidate.error === 'string' ? candidate.error : '',
  ].join(' ');
  return message.toLowerCase().includes('response_format');
}

function toUnavailable(error: unknown): LlmUnavailableError {
  if (error instanceof LlmUnavailableError) return error;
  const className = error instanceof Error ? error.constructor.name : 'UnknownError';
  const detail = error instanceof Error ? error.message : String(error);
  const status = providerStatus(error);
  const serverMarker = status !== undefined && status >= 500 ? ' 5xx' : '';
  // Include the SDK class name so resilience can identify RateLimit/Connection/5xx failures.
  return new LlmUnavailableError(`openai_${className}${serverMarker}: ${detail}`, { cause: error });
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === 'number' ? status : undefined;
}

export { OpenAILlmClient as OpenAIClient };
export { OpenAILlmClient as OpenAIAdapter };

export function createOpenAIClient(options: OpenAILlmClientOptions = {}): OpenAILlmClient {
  return new OpenAILlmClient(options);
}
