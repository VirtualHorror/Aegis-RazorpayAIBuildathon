import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX, LLM_KEY_HEADER, parseSandbox, sandboxHeaders, serializeSandbox, validateSandbox, type SandboxSettings } from "./sandbox";

const live: SandboxSettings = { mode: "live", accountId: "acc_LiveDemo1", webhookSecret: "whsec_tenant_secret", llmKey: "sk-proj-tenant-0123456789" };

describe("sandbox settings", () => {
  it("round-trips through localStorage JSON and falls back to demo mode for anything unreadable", () => {
    expect(parseSandbox(serializeSandbox(live))).toEqual(live);
    expect(parseSandbox(null)).toEqual(DEFAULT_SANDBOX);
    expect(parseSandbox("{not json")).toEqual(DEFAULT_SANDBOX);
    expect(parseSandbox(JSON.stringify({ mode: "hacked", accountId: 7 }))).toEqual(DEFAULT_SANDBOX);
    expect(parseSandbox(JSON.stringify({ mode: "live" }))).toEqual({ ...DEFAULT_SANDBOX, mode: "live" });
  });

  it("attaches the model key header only in live mode and only when a key is present", () => {
    expect(LLM_KEY_HEADER).toBe("x-aegis-llm-key");
    expect(sandboxHeaders(live)).toEqual({ [LLM_KEY_HEADER]: live.llmKey });
    expect(sandboxHeaders({ ...live, mode: "demo" })).toEqual({});
    expect(sandboxHeaders({ ...live, llmKey: "" })).toEqual({});
    expect(sandboxHeaders({ ...live, llmKey: "   " })).toEqual({});
    expect(sandboxHeaders(DEFAULT_SANDBOX)).toEqual({});
  });

  it("validates the live-mode fields the way the API will", () => {
    expect(validateSandbox(live)).toEqual({});
    expect(validateSandbox({ ...live, mode: "demo", accountId: "", webhookSecret: "", llmKey: "" })).toEqual({});
    expect(validateSandbox({ ...live, accountId: "acc x" })).toMatchObject({ accountId: expect.stringMatching(/letters, digits/i) });
    expect(validateSandbox({ ...live, accountId: "" })).toMatchObject({ accountId: expect.stringMatching(/required/i) });
    expect(validateSandbox({ ...live, webhookSecret: "short" })).toMatchObject({ webhookSecret: expect.stringMatching(/at least 8/i) });
    expect(validateSandbox({ ...live, webhookSecret: "has a space here" })).toMatchObject({ webhookSecret: expect.stringMatching(/spaces/i) });
    expect(validateSandbox({ ...live, llmKey: "sk-short" })).toMatchObject({ llmKey: expect.stringMatching(/at least 20/i) });
    // The model key is optional: a merchant may bring only their Razorpay account and keep the deployment's model.
    expect(validateSandbox({ ...live, llmKey: "" })).toEqual({});
  });
});
