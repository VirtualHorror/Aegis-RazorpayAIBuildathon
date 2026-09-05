# Flow — how execution travels through Aegis

> One section per flow. Each step names the file and function so a reader can follow the code.
> Status markers: **[live]** exists in the repo · **[planned Tn]** to be built in checklist task n. Codex flips markers when a task lands.

## F1. Boot [live — Tasks 1–4]

1. `apps/api/src/server.ts` `main()` → `dotenv` loads `<repo>/.env` (path from `src/db/paths.ts`) → `loadConfig()` from `src/config.ts` (zod-validated env; exits with a readable error on a missing/invalid variable).
2. `createPools(config)` in `src/db/pool.ts` → two `pg.Pool`s (`rw`, `readonly`). Pools are lazy; no connection is made until first query.
3. `buildApp({ config, db, probeDb })` in `src/app.ts` → registers `@fastify/cors` (dashboard origin only), `@fastify/rate-limit` (600/min), UUID request ids, the error handler (`normalizeError` → `{ error, details?, request_id }`), the 404 handler, and routes (`/health`, live `/api/v1/system`, plus the encapsulated `/webhooks/razorpay` ingress; x402 and stream later). `probeDb` is injected so tests simulate an unreachable database.
   3a. `migrationStatus(pools.rw, MIGRATIONS_DIR)`: the numbered `0001_init`, `0002_readonly_grants`, and `0003_projection_guards` migrations are checked for pending files and checksum drift; pending migrations → exit 1 (unless `AEGIS_ALLOW_PENDING_MIGRATIONS=true`), while an unreachable database → warn and continue degraded.
4. `app.listen({ port: config.API_PORT, host: '0.0.0.0' })`.
5. `[live]` after listen: `startWorker({ pools, logger, handlers, concurrency })` spins `WORKER_CONCURRENCY` loops and the stale-lock sweeper (F3) unless `AEGIS_WORKER_ENABLED=false`.
6. On `SIGINT`/`SIGTERM`: stop accepting, drain worker loops (finish current job, max 10 s), `pools.end()`, exit 0.

`GET /health` (`src/routes/health.ts`): runs `SELECT 1` on the rw pool with a 1 s timeout; responds `200 {"status":"ok","db":"ok"}` or `200 {"status":"degraded","db":"unavailable","error":"…"}` — the API stays up when the DB is down so the dashboard can show the outage.

Migration commands (`src/db/migrate-cli.ts`) apply each SQL file in version order inside its own transaction, record its SHA-256 checksum in `schema_migrations`, and expose `up`, `down`, `status`, plus the documented `--status` shorthand. `0002_readonly_grants` emits a PostgreSQL warning and records as applied when the optional `aegis_readonly` role is absent; when present it grants only the non-PII customer/payment columns. `0003_projection_guards` adds the event-time precedence columns used by the Task 4 projections.

## F2. Webhook ingress [live]

```
POST /webhooks/razorpay
  src/ingress/razorpay-webhook.ts  handleRazorpayWebhook(req, reply, options)
   ├─ req.rawBody                       (custom content-type parser keeps raw bytes; src/ingress/raw-body.ts)
   ├─ verifySignature(raw, headers['x-razorpay-signature'], config.RAZORPAY_WEBHOOK_SECRET)   src/ingress/signature.ts
   │     HMAC-SHA256 hex → Buffer compare with crypto.timingSafeEqual; length mismatch → false
   ├─ invalid → reconcile(... status='ignored') → 401 {"error":"invalid_signature"}       (still persisted: status='ignored', signature_valid=false)
   │     keyed 'unverified:' + sha256(raw), NOT the caller's x-razorpay-event-id — an unsigned request must never
   │     take the key a genuine delivery will use, or Razorpay's real event answers 'duplicate' and is lost (D-031, B-004)
   ├─ eventId = signatureValid ? (headers['x-razorpay-event-id'] ?? 'sha256:' + sha256(raw)) : 'unverified:' + sha256(raw)
   ├─ parsed = RazorpayWebhookSchema.safeParse(JSON.parse(raw))                          packages/shared/src/razorpay/webhook.ts
   ├─ reconcile(pools.rw, { eventId, eventType, payload, sha256, signatureValid })       src/ingress/reconciler.ts
   │     BEGIN
   │       INSERT INTO webhook_events … ON CONFLICT (event_id) DO UPDATE SET duplicate_count = duplicate_count + 1, last_duplicate_at = now()
   │         RETURNING (xmax = 0) AS inserted
   │       IF inserted AND signatureValid AND status != 'ignored' AND eventType IN KNOWN_EVENT_TYPES: INSERT INTO jobs(kind='process_event', payload={eventId}, dedupe_key='process_event:'+eventId)
   │       IF inserted AND signatureValid AND status != 'ignored' AND eventType NOT IN KNOWN_EVENT_TYPES: UPDATE webhook_events SET status='ignored'
   │     COMMIT
   ├─ onEvent({eventId,eventType,status,...}) hook (noop until the T8 bus)                  src/ingress/index.ts
   └─ 200 {"status":"accepted"|"duplicate","event_id":…}
```
Race: two identical deliveries at the same instant → one `INSERT` wins, the other blocks on the unique index and lands in `DO UPDATE` → exactly one job. Tested with `Promise.all` of 20 concurrent posts (T3 integration test).

## F3. Worker + orchestrator [live — Task 4; planned T8]

```
src/worker/job-runner.ts  runLoop(workerId)
  loop:
    job = claimJob(workerId)         UPDATE jobs … WHERE id = (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *
    none → sleep(pollIntervalMs)
    dispatch(job):
      'process_event'    → processEventHandler(job, { db, logger, workerId })     src/worker/process-event.ts
      'dunning_retry'    → modules.subscription_salvager.runScheduledRetry(...)     [T10]
      'negotiation_expiry' → modules.b2b_negotiator.expireOffer(...)               [T11]
      'compliance_scan'  → compliance.scanner.run(...)                             [T16]
    ok  → UPDATE jobs SET status='succeeded'
    err → attempts < max ? status='queued', run_at = now() + backoff(attempts) : status='dead_letter'; webhook_events.status mirrors it
  sweeper (every 30 s): UPDATE jobs SET status='queued', locked_by=NULL, locked_at=NULL WHERE status='running' AND locked_at < now() - interval '2 minutes'
```

`processEventHandler` locks and re-reads the event row, requires persisted `signature_valid = true` before parsing or projecting, then runs the projection and `processed` update in the same transaction. An invalid-signature queue row is left `ignored` and cannot mutate any entity table (D-034).

Lock order inside a projection transaction (C-C3, D-035) — the entity's own row first, then toward the foreign-key root, so two workers can never form a cycle:

```
disputes ─▶ payments ─▶ orders ─▶ customers
                 subscriptions ─▶ customers
                      invoices ─▶ customers
```

`projectPayment` therefore takes the `orders` row (`lockOrder`) *before* upserting the customer, and only creates a missing order (`createOrder`) afterwards, because `orders.customer_id` is itself a foreign key. Getting this backwards deadlocked a concurrent `order.paid` (B-006).

`EventOrchestrator.handle(eventId)` (planned T8; Task 4's process handler currently stops after projection):
1. `loadEvent` → `RazorpayWebhookSchema.parse(payload)`; mark `webhook_events.status='processing'`.
2. `route = ROUTES[event.event_type]` (`src/orchestrator/routing.ts`); missing → `ignored`.
3. `withTransaction(rw, async (tx) => { entity = await projections[route.entity].apply(tx, payload) })` — projections do `SELECT … FOR UPDATE` then apply the precedence rule (`packages/shared/src/domain/precedence.ts`) and upsert. **Transaction ends here** (C-A6).
4. `if (route.diagnose) diagnosis = await diagnostician.diagnose({ event, payload, entity })` (F4). Never inside a transaction.
5. `config = await loadGuardrailConfig(rw)` (`src/db/repos/guardrails.ts`, live since T2; throws `GuardrailConfigError` when a seeded key is missing or malformed); `ctx = { event, payload, entity, diagnosis, config, now, logger }`.
6. `for m of modules.filter(m => m.handles.includes(type) && m.canHandle(ctx))`:
   - `proposal = await m.propose(ctx)`; `null` → log "no action" with reason.
   - `guard = m.guard(proposal, ctx)`; plus orchestrator-level rules: kill switch, cooldown, quiet hours, daily budget (`src/guardrails/rules.ts`).
   - `status = !guard.pass ? 'blocked' : (proposal.requiresApproval || -proposal.moneyImpactPaise > config.auto_approve_limit_paise) ? 'pending_approval' : 'approved'`.
   - `INSERT INTO actions … ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`; conflict → skip (already proposed).
   - `if status === 'approved'` → `executeAction(action, ctx)` (F6 step 3).
   - `bus.publish('action.<status>', …)`.
7. `webhook_events.status='processed'`; audit row `actor='worker:<id>'`.

## F4. Diagnosis [planned T7; LLM provider prerequisites live in T6]

Task 6 supplies the provider boundary used by this flow: `src/llm/factory.ts` resolves `auto` once at boot, `src/llm/resilient.ts` applies timeout/retry/breaker and request-scoped development chaos, and `src/llm/mask.ts` removes PII before prompts are built. `GET /api/v1/system` exposes only `{ provider, model, modelFast }`. Anthropic coverage is SDK-mocked on this machine because `ANTHROPIC_API_KEY` is unavailable; the adapter remains available when configured.

```
src/diagnosis/diagnostician.ts  diagnose(input)
  hints  = deriveHints(payload, entity)              src/diagnosis/hints.ts   (pure: is_international, error_step, error_reason, method, amount_band, locale)
  prompt = prompts.diagnose_payment_failure.build({ hints, payloadMasked: maskPii(payload) })   src/llm/prompts/diagnose-payment-failure.ts
  try  { out = await llm.completeJson({ purpose, system, user, schema: DiagnosisSchema }) }
  catch (LlmUnavailableError) { out = ruleBasedDiagnosis(hints); degraded = true }   src/diagnosis/fallback.ts
  final = crossCheck(out.data, hints)                 src/diagnosis/cross-check.ts   (may override root_cause/strategy; records why)
  INSERT INTO diagnoses (…)  → return Diagnosis
```

## F5. Action modules [planned T9–T12]

Every module lives in `src/modules/<name>/index.ts` and follows `propose → guard → execute`:

- **checkout_recovery** (T9): `payment.failed` with `diagnosis.strategy ∈ {RETRY_LINK_LOCALIZED, RETRY_ALTERNATE_METHOD, CART_RECOVERY_NUDGE}` → `templates.ts` picks template by `customer.locale` → `payload` = WhatsApp template JSON with a deterministic retry link `rzp.io/l/aegis-<shortid>` → guards: opted_out, cooldown, quiet hours, max 1 retry link per payment → execute: insert `outbound_messages` (`simulated_sent`), schedule nothing.
- **subscription_salvager** (T10): `subscription.pending|halted` → `state.ts` transition table → proposal `dunning_retry` (step n) with WhatsApp payload + `scheduleFollowUp` job `dunning_retry` at `dunning_schedule_hours[n]` → guards: `retry_count < max_dunning_retries`, cooldown, quiet hours → on `subscription.charged|activated` → `salvage_state='recovered'` + ledger `recovered_revenue`.
- **b2b_negotiator** (T11): `invoice.expired` (amount ≥ ₹50,000) → `pricing.ts` computes `offerPaise = max(floor, amount·(1 − pct_round[n]))` with `pct_round=[5,10,15]` capped by `max_discount_pct` → LLM drafts the message text only (`draft_negotiation_message`), numbers injected by code → guards: floor, max pct, rounds, daily budget → `requiresApproval = true` when discount > auto_approve limit → execute: outbound message + `negotiation_state='offer_sent'` + `negotiation_expiry` job (72 h). Counter-offers arrive via the simulator as `invoice.updated` notes (`counter_paise`).
- **chargeback_evidence** (T12): `payment.dispute.created` → `assemble.ts` collects payment, order, customer, delivery proof (from `orders.notes.delivery`), prior messages, refund policy → LLM writes `narrative` → `evidence_packets.review_status='requires_human_review'` → `actions.status='pending_approval'` → human approves (F6) → `submitted` (simulated).

## F6. Human approval [planned T13]

1. `GET /api/v1/approvals` lists `actions WHERE status='pending_approval'` + `evidence_packets WHERE review_status='requires_human_review'`.
2. `POST /api/v1/actions/:id/decision {decision:'approve'|'reject', note, actor}` → `withTransaction`: `SELECT … FOR UPDATE`, assert status, update, `audit_log` row.
3. `approve` → `executeAction(action)` → module `execute()` → persist `result`, `outbound_messages`, `ledger_entries`; status `executed|failed`; `bus.publish`.
4. Evidence: `POST /api/v1/evidence/:disputeId/decision` same pattern; approve → `submitted` (simulated), audit row.

## F7. x402 gateway [planned T14]

```
GET /x402/products/:id/spec   (routes.ts, wrapped by x402Middleware(priceFn))
  no X-PAYMENT → issue challenge: INSERT x402_payments(status='challenged', nonce, expires_at=now()+60s) → 402 + body {x402Version:1, accepts:[…], error}
  X-PAYMENT    → decode base64 JSON → facilitator.verify(payload):
                   nonce exists & status='challenged' & not expired; amount >= required; signature = HMAC(X402_SIM_SECRET, canonical string); payer daily cap; kill switch
                 fail → UPDATE status='rejected', reject_reason → 402 {error: reason}
                 ok   → BEGIN; SELECT … FOR UPDATE (nonce); UPDATE status='settled'; INSERT ledger_entries(x402_revenue); COMMIT
                        → 200 resource + header X-PAYMENT-RESPONSE (base64 {success, txId, settledAt, network:'aegis-sim'})
  replay (same nonce) → row is 'settled' → 402 {error:'nonce_already_settled'} + audit_log
```

## F8. Ask Aegis (Text-to-SQL + forecast) [planned T15]

```
POST /api/v1/ask {question}
  src/nlq/service.ts  ask(question)
   ├─ intent = classify(question)  (deterministic regex: /forecast|predict|next \d+ days/ → 'forecast' else 'query')
   ├─ query:   sql = llm.completeJson(text_to_sql, {schemaDoc})           src/nlq/schema-doc.ts (no PII columns)
   │           v = validate(sql)                                         src/nlq/validator.ts (pgsql-ast-parser: single SELECT, allowlist tables, denylist fns)
   │           !v.ok → INSERT nl_queries(validated=false) → 200 {sql, error}
   │           rows = readonly.query(`SET LOCAL statement_timeout='5000ms'; SELECT * FROM (${sql}) q LIMIT 200`)
   │           summary = llm.completeJson(summarize_query_result) (fallback: row count sentence)
   ├─ forecast: spec = llm.completeJson(nl_to_forecast_spec) → {metric, window_days, horizon_days} (fallback: defaults)
   │           series = deterministic SQL template per metric (src/nlq/metrics.ts)
   │           result = forecast(series, horizon)                         src/nlq/forecast.ts (OLS slope + 7-day MA, unit tested)
   └─ INSERT nl_queries(...) → 200 {kind, sql, rows | series+forecast, summary, degraded}
```

## F9. Compliance scan [planned T16]

`POST /api/v1/compliance/scan` → enqueue `compliance_scan` job → `scanner.run()`: for each active product: `keywordHits = prescreen(description)` → `assessment = llm.completeJson(classify_compliance)` (fast tier) → `verifyEvidenceSpan(assessment, description)` (must be a verbatim substring; else `status='needs_review'`) → upsert `compliance_flags` → run row updated → `bus.publish('compliance.flag')`.

## F10. Live updates [planned T8 + T17]

`EventBus` (Node `EventEmitter`) → `GET /api/v1/stream` writes `event: <name>\ndata: <json>\n\n`, heartbeat every 15 s, `Last-Event-ID` ignored (bus is not storage). Web: `useEventStream()` hook (`apps/web/src/lib/sse.ts`) with reconnect + backoff; pages merge SSE rows into SWR caches.

## F11. Simulator and demo [live — Task 5; planned T23]

`pnpm sim <scenario> [--dupes N --burst N --seed S --api URL --chaos llm_down]` → `scripts/simulate.ts` imports the canonical builders from `packages/shared/src/sim/` → builds the 14 exact scenario names from Checklist §5 (with `all` and `burst` entry points) → serializes each envelope once, signs those exact bytes with the configured Razorpay secret, and POSTs to `/webhooks/razorpay`. `--dupes N` re-POSTs the same body and headers N additional times; `--burst N` creates N distinct seeded events concurrently; `--burst N --contend` aims them all at one order and one customer instead. The result table includes scenario, HTTP code, ingress status, latency, totals for accepted / duplicate / rejected / ignored / rate_limited, and latency p50/p95 over the delivered (non-throttled) requests. The driver fails closed rather than print evidence it cannot vouch for: every original delivery must reach its scenario's terminal state (D-043), `unknown_event` must be persisted as ignored with no job, and `bad_signature` must be quarantined under `unverified:<sha256(raw)>`. A 429 is reported as `rate_limited`, never rejected. Burst runs also check that every accepted job reaches `succeeded` at `max(attempts)=1` and print `contended=true|false` beside it — a distinct-event burst shares no rows, so that number only carries a lock-order claim under `--contend` (D-042, B-007). The dev-only `POST /api/v1/sim/run` route reuses the same builders, is never mounted in production (C-D5), and caps one request at 2,000 deliveries. `pnpm demo` runs the storyboard used in the video (planned T23).
