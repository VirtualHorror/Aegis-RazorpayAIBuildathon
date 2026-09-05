import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmJsonRequest,
  type LlmJsonResult,
} from './client';

export interface AnthropicLlmClientOptions {
  apiKey?: string;
  model?: string;
  modelFast?: string;
  baseURL?: string;
  timeoutMs?: number;
  /** Injectable SDK instance for unit tests; production callers omit this. */
  client?: Anthropic;
}

/**
 * Anthropic JSON adapter.
 * Intent: use Anthropic's parse helper for structured output, then validate once more at our provider boundary.
 * Flow: build model request -> parse response -> reject refusals/null/invalid data -> return auditable metadata.
 */
export class AnthropicLlmClient implements LlmClient {
  readonly provider = 'anthropic';
  readonly model: string;
  readonly modelFast: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicLlmClientOptions = {}) {
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
    this.modelFast = options.modelFast ?? process.env.ANTHROPIC_MODEL_FAST ?? this.model;
    if (options.client) {
      this.client = options.client;
    } else if (options.apiKey !== undefined || options.baseURL !== undefined || options.timeoutMs !== undefined) {
      this.client = new Anthropic({
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      });
    } else {
      // The official SDK resolves ANTHROPIC_API_KEY itself when no constructor options are supplied.
      this.client = new Anthropic();
    }
  }

  async completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const started = Date.now();
    const model = req.tier === 'fast' ? this.modelFast : this.model;
    try {
      const response = await this.client.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 2048,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: zodOutputFormat(req.schema) },
      });

      if (response.stop_reason === 'refusal' || response.parsed_output === null || response.parsed_output === undefined) {
        throw new LlmUnavailableError('anthropic_unparsable');
      }

      const parsed = req.schema.safeParse(response.parsed_output);
      if (!parsed.success) {
        throw new LlmUnavailableError('anthropic_unparsable', { cause: parsed.error });
      }

      const raw = contentText(response.content) || JSON.stringify(parsed.data);
      return {
        data: parsed.data,
        provider: this.provider,
        model,
        latencyMs: Date.now() - started,
        tokensIn: response.usage?.input_tokens ?? 0,
        tokensOut: response.usage?.output_tokens ?? 0,
        raw,
      };
    } catch (error) {
      if (error instanceof LlmUnavailableError) throw error;
      throw toUnavailable(error);
    }
  }
}

function contentText(content: Anthropic.Message['content'] | undefined): string {
  if (!content) return '';
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function toUnavailable(error: unknown): LlmUnavailableError {
  const className = error instanceof Error ? error.constructor.name : 'UnknownError';
  const detail = error instanceof Error ? error.message : String(error);
  const status = providerStatus(error);
  const serverMarker = status !== undefined && status >= 500 ? ' 5xx' : '';
  // Include the SDK class name so resilience can identify RateLimit/Connection/5xx failures.
  return new LlmUnavailableError(`anthropic_${className}${serverMarker}: ${detail}`, { cause: error });
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === 'number' ? status : undefined;
}

export { AnthropicLlmClient as AnthropicClient };
export { AnthropicLlmClient as AnthropicAdapter };

export function createAnthropicClient(options: AnthropicLlmClientOptions = {}): AnthropicLlmClient {
  return new AnthropicLlmClient(options);
}
