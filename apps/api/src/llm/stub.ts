import {
  fixtureForPurpose,
  type StubFixture,
} from './stub-fixtures';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmJsonRequest,
  type LlmJsonResult,
  type LlmPurpose,
} from './client';

export interface StubLlmClientOptions {
  /** Override fixture selection in tests without bypassing request-schema validation. */
  fixtureFor?: (purpose: LlmPurpose, user: string) => StubFixture;
  model?: string;
  modelFast?: string;
  latencyMs?: number;
}

/**
 * Deterministic, keyless LLM implementation used by local demos and tests.
 * Intent: the no-key path must exercise the same zod boundary as real providers, so schema drift cannot hide in tests.
 * Flow: choose a fixture from purpose/input -> safeParse with the caller's schema -> return validated JSON metadata.
 */
export class StubLlmClient implements LlmClient {
  readonly provider = 'stub';
  readonly model: string;
  readonly modelFast: string;
  private readonly fixtureFor: (purpose: LlmPurpose, user: string) => StubFixture;
  private readonly latencyMs: number;

  constructor(options: StubLlmClientOptions = {}) {
    this.model = options.model ?? 'fixture-v1';
    this.modelFast = options.modelFast ?? this.model;
    this.fixtureFor = options.fixtureFor ?? fixtureForPurpose;
    this.latencyMs = options.latencyMs ?? 5;
  }

  async completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const fixture = this.fixtureFor(req.purpose, req.user);
    const parsed = req.schema.safeParse(fixture);
    if (!parsed.success) {
      throw new LlmUnavailableError(`stub_invalid_fixture: ${parsed.error.message}`, { cause: parsed.error });
    }

    const data = parsed.data;
    return {
      data,
      provider: this.provider,
      model: req.tier === 'fast' ? this.modelFast : this.model,
      latencyMs: this.latencyMs,
      tokensIn: 0,
      tokensOut: 0,
      raw: JSON.stringify(data),
    };
  }
}

/** Short aliases make the adapter convenient to construct while retaining the explicit provider name. */
export { StubLlmClient as StubClient };
export { StubLlmClient as StubAdapter };

export function createStubClient(options: StubLlmClientOptions = {}): StubLlmClient {
  return new StubLlmClient(options);
}
