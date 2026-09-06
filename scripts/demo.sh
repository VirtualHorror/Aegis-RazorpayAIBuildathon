#!/usr/bin/env bash
# Aegis — demo storyboard (Checklist.md T23.1).
#
# Intent: drive the running system through one narrated end-to-end story in under three minutes, using only the
#         interfaces a merchant actually has (the signed webhook ingress, the x402 gateway, the REST control plane).
#         Nothing here writes to the database directly: if a number appears on screen, the system produced it.
# Flow:   preflight -> reset demo data -> start the long catalog scan -> failures and recoveries -> agentic commerce ->
#         retry attribution -> compliance findings -> metrics summary -> graceful degradation with the model down.
#
# Assumes `pnpm dev` is already running (API on :4000, dashboard on :3000). It starts no servers of its own.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

API_URL="${API_URL:-http://localhost:4000}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
DEMO_PAUSE="${DEMO_PAUSE:-2}"
DEMO_SCAN_WAIT="${DEMO_SCAN_WAIT:-20}"
DEMO_DRAIN_WAIT="${DEMO_DRAIN_WAIT:-60}"
# A fresh payer per run: the x402 per-payer daily cap is a real guardrail, and a demo should not trip it by accident.
DEMO_PAYER="${DEMO_PAYER:-demo-$(date +%H%M%S)}"
RUN_TAG="$(date +%H%M%S)"
DEMO_ORDER="order_demo_${RUN_TAG}"
DEMO_CUSTOMER="cus_demo_${RUN_TAG}"
DO_SEED=1
ALLOW_QUIET_HOURS="${DEMO_ALLOW_QUIET_HOURS:-0}"
QUIET_HOURS_WIDENED=0
STEP=0
TOTAL=13
STARTED_AT="$(date +%s)"

usage() {
  cat <<'USAGE'
usage: pnpm demo [--fast] [--no-seed]

  --fast      no pauses between steps (CI / re-runs)
  --no-seed   keep the current data instead of resetting the catalog and guardrails
  --allow-quiet-hours
              temporarily set quiet_hours_local to {start:0,end:0} through the public guardrail API so a
              recording made inside the customer's quiet window can still show a message being sent. The
              change is announced on screen, written to audit_log like any merchant edit, and restored on exit.

env: API_URL WEB_URL DEMO_PAUSE DEMO_SCAN_WAIT DEMO_DRAIN_WAIT DEMO_PAYER DEMO_ALLOW_QUIET_HOURS
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast) DEMO_PAUSE=0; DEMO_SCAN_WAIT=5 ;;
    --no-seed) DO_SEED=0 ;;
    --allow-quiet-hours) ALLOW_QUIET_HOURS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  B=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; R=$'\033[0m'
else
  B=''; DIM=''; CYAN=''; GREEN=''; YELLOW=''; RED=''; R=''
fi

elapsed() { printf '%d:%02d' $(( ($(date +%s) - STARTED_AT) / 60 )) $(( ($(date +%s) - STARTED_AT) % 60 )); }
rule() { printf '%s%s%s\n' "${DIM}" "────────────────────────────────────────────────────────────────────────" "${R}"; }
step() {
  STEP=$((STEP + 1))
  printf '\n'; rule
  printf '%s STEP %d/%d%s  %s[%s]%s  %s%s%s\n' "${CYAN}" "${STEP}" "${TOTAL}" "${R}" "${DIM}" "$(elapsed)" "${R}" "${B}" "$1" "${R}"
  [[ -n "${2:-}" ]] && printf ' %s%s%s\n' "${DIM}" "$2" "${R}"
  rule
}
note() { printf ' %s→%s %s\n' "${GREEN}" "${R}" "$1"; }
warn() { printf ' %s!%s %s\n' "${YELLOW}" "${R}" "$1"; }
fail() { printf ' %sx%s %s\n' "${RED}" "${R}" "$1" >&2; exit 1; }
show() { printf '%s $ %s%s\n' "${DIM}" "$*" "${R}"; }
beat() { [[ "${DEMO_PAUSE}" != "0" ]] && sleep "${DEMO_PAUSE}"; return 0; }

# Intent: the demo must not require a tool the repo does not already depend on, and Node is already a hard
#         prerequisite (engines: >=24). jq would be a new one, so everything JSON goes through Node.
# Flow: read stdin -> walk the dotted path -> print a scalar, compact JSON for an object, or nothing when absent.
json_path() {
  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let value;
      try { value = JSON.parse(raw); } catch { return; }
      for (const key of process.argv[1].split(".").filter(Boolean)) {
        if (value === null || value === undefined) break;
        value = value[key];
      }
      if (value === null || value === undefined) return;
      process.stdout.write(typeof value === "object" ? JSON.stringify(value) : String(value));
    });
  ' "$1"
}

json_pretty() {
  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try { process.stdout.write(JSON.stringify(JSON.parse(raw), null, 2) + "\n"); }
      catch { process.stdout.write(raw); }
    });
  '
}

api() { curl -sS -m 20 "${API_URL}$1"; }

# Intent: narrate what the system did, not what it was hoped to do. A guardrail that fires on the day's third offer is
#         the product working; asserting "this becomes pending_approval" and being wrong on stage is not. So the demo
#         reads the action back and reports its real status, reason and money impact.
# Flow: poll the actions list for the newest row of this kind -> print status/reason/impact -> never fail the demo on it.
report_action() {
  # The B2B offer is the slowest read-back: its module drafts wording with the model before the guardrails are even
  # evaluated, so it needs a longer budget than a packet the orchestrator assembles from database rows alone.
  local kind="$1" deadline=$(( $(date +%s) + ${2:-25} )) line=""
  while [[ $(date +%s) -lt ${deadline} ]]; do
    # Only this run's rows count. The newest action of a kind is usually the *previous* run's, and reporting that as
    # this step's outcome would put a stale status on screen — the one failure mode a live demo cannot survive.
    line="$(api "/api/v1/actions?limit=50" | node -e '
      let raw = "";
      process.stdin.on("data", (chunk) => { raw += chunk; });
      process.stdin.on("end", () => {
        let items = [];
        try { items = JSON.parse(raw).items ?? []; } catch { return; }
        const since = Number(process.argv[2]) * 1000;
        const row = items.find((entry) => entry.kind === process.argv[1] && Date.parse(entry.created_at) >= since);
        if (!row) return;
        const rupees = (Math.abs(Number(row.money_impact_paise ?? 0)) / 100).toFixed(2);
        const bound = row.reason ? ` · bound hit: ${row.reason}` : "";
        process.stdout.write(`${row.status} · money impact ₹${rupees}${bound}`);
      });
    ' "${kind}" "${STARTED_AT}")"
    [[ -n "${line}" ]] && break
    sleep 2
  done
  [[ -n "${line}" ]] && note "${kind}: ${line}" || warn "${kind}: no action from this run yet (the worker is still catching up)"
}

# Intent: the scoreboard has to include the story that was just told. `events.received` counts deliveries the worker
#         has accepted but not finished, so it is the queue depth the API already publishes — no direct DB access.
# Flow: poll the summary until nothing is outstanding, or give up after DEMO_DRAIN_WAIT and say the run is still settling.
wait_for_drain() {
  local deadline=$(( $(date +%s) + DEMO_DRAIN_WAIT )) outstanding
  while [[ $(date +%s) -lt ${deadline} ]]; do
    outstanding="$(api /api/v1/metrics/summary | json_path events.received)"
    [[ "${outstanding}" == "0" ]] && return 0
    sleep 2
  done
  warn "still ${outstanding:-?} event(s) in flight after ${DEMO_DRAIN_WAIT}s; the numbers below are a snapshot mid-run"
  return 0
}

put_quiet_hours() {
  curl -sS -m 10 -X PUT "${API_URL}/api/v1/guardrails/quiet_hours_local" \
    -H 'content-type: application/json' \
    -d "{\"value\":{\"start\":$1,\"end\":$2},\"actor\":\"demo-script\"}" >/dev/null
}

# Intent: --allow-quiet-hours must never be able to leave the merchant's messaging window open. The restore runs on
#         every exit path, including a failed step or Ctrl-C, and it goes through the same public route as the change.
# Flow: EXIT/INT trap -> only act if we widened the window -> put the seeded 21:00-08:00 bound back -> report it.
restore_quiet_hours() {
  [[ "${QUIET_HOURS_WIDENED}" == "1" ]] || return 0
  QUIET_HOURS_WIDENED=0
  put_quiet_hours 21 8 && printf '\n %s→%s quiet hours restored to 21:00–08:00 local\n' "${GREEN}" "${R}" \
    || printf '\n %s!%s could not restore quiet hours — set them back on /settings\n' "${YELLOW}" "${R}"
}
trap restore_quiet_hours EXIT INT TERM

# ---------------------------------------------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------------------------------------------
printf '\n%s  A E G I S %s — the agentic merchant OS for Razorpay\n' "${B}" "${R}"
printf '  %sdemo storyboard · api %s · dashboard %s%s\n' "${DIM}" "${API_URL}" "${WEB_URL}" "${R}"

HEALTH="$(api /health || true)"
[[ -n "${HEALTH}" ]] || fail "API is not answering on ${API_URL} — start it with 'pnpm dev' and re-run."
[[ "$(printf '%s' "${HEALTH}" | json_path status)" == "ok" ]] \
  || fail "API health is $(printf '%s' "${HEALTH}" | json_path status) (db: $(printf '%s' "${HEALTH}" | json_path db)) — bring PostgreSQL up first."
SYSTEM="$(api /api/v1/system || true)"
printf '  %shealth ok · provider %s · model %s · env %s%s\n' "${DIM}" \
  "$(printf '%s' "${SYSTEM}" | json_path provider)" "$(printf '%s' "${SYSTEM}" | json_path model)" \
  "$(printf '%s' "${SYSTEM}" | json_path env)" "${R}"
curl -sS -m 5 -o /dev/null "${WEB_URL}" 2>/dev/null \
  && printf '  %sdashboard reachable — open %s and watch it fill in live%s\n' "${DIM}" "${WEB_URL}" "${R}" \
  || warn "dashboard not reachable at ${WEB_URL}; the API steps below still run"
beat

# ---------------------------------------------------------------------------------------------------------------
# 1. Reset
# ---------------------------------------------------------------------------------------------------------------
step "Reset the demo data" "catalog, customers, invoices and the guardrail bounds go back to their seeded values"
if [[ "${DO_SEED}" == "1" ]]; then
  show "pnpm db:seed"
  pnpm db:seed
  note "guardrails back to defaults: auto-approve ceiling ₹2,000 · max discount 15% · quiet hours 21:00–08:00 local"
else
  warn "--no-seed: keeping the current data"
fi
if [[ "${ALLOW_QUIET_HOURS}" == "1" ]]; then
  put_quiet_hours 0 0
  QUIET_HOURS_WIDENED=1
  warn "--allow-quiet-hours: quiet_hours_local set to {start:0,end:0} for this run via PUT /api/v1/guardrails/quiet_hours_local"
  warn "this is a real, audited merchant edit — it is restored to 21:00–08:00 when the demo exits"
fi
beat

# ---------------------------------------------------------------------------------------------------------------
# 2. Compliance scan (long-running; started now, read at step 11)
# ---------------------------------------------------------------------------------------------------------------
step "Start the catalog compliance scan" "16 products, one model call each — the control plane answers 202 and works in the background"
show "curl -X POST ${API_URL}/api/v1/compliance/scan"
SCAN="$(curl -sS -m 20 -X POST "${API_URL}/api/v1/compliance/scan")"
SCAN_RUN="$(printf '%s' "${SCAN}" | json_path runId)"
[[ -n "${SCAN_RUN}" ]] || fail "compliance scan did not start: ${SCAN}"
note "run ${SCAN_RUN} queued — we come back to it at step 11 while the rest of the story runs"
beat

# ---------------------------------------------------------------------------------------------------------------
# 3. The 3DS decline (and three duplicate deliveries)
# ---------------------------------------------------------------------------------------------------------------
step "A cross-border 3DS decline arrives — four times" "Razorpay retries deliveries; only the first may do work"
show "pnpm sim payment_failed_3ds_intl --dupes 3"
pnpm sim payment_failed_3ds_intl --dupes 3
note "1 accepted + 3 duplicate: the idempotency key is the event id, and only a signed delivery may claim one (B-004)"
note "the diagnostician now runs: deterministic hints → model (bounded enum) → cross-check → recovery action"
beat

# ---------------------------------------------------------------------------------------------------------------
# 4. Cart drop-off
# ---------------------------------------------------------------------------------------------------------------
step "A UPI checkout is abandoned" "a different failure class, a different localised template — follow this customer to the end"
show "pnpm sim payment_failed_cart_dropoff --order ${DEMO_ORDER} --customer ${DEMO_CUSTOMER}"
pnpm sim payment_failed_cart_dropoff --order "${DEMO_ORDER}" --customer "${DEMO_CUSTOMER}"
note "pinned to ${DEMO_CUSTOMER} so step 10 can show recovered revenue credited against this exact action"
beat

# ---------------------------------------------------------------------------------------------------------------
# 5. Subscription halted
# ---------------------------------------------------------------------------------------------------------------
step "A subscription renewal halts" "the dunning state machine schedules retries at 24h / 72h / 168h and then stops"
show "pnpm sim subscription_halted"
pnpm sim subscription_halted
note "retry counts and the schedule are TypeScript, not a prompt — the model never picks a number (C-A1)"
beat

# ---------------------------------------------------------------------------------------------------------------
# 6. B2B invoice expires -> bounded discount -> human gate
# ---------------------------------------------------------------------------------------------------------------
step "A B2B invoice expires" "the negotiator drafts an offer; the money is computed in code and gated by a human"
show "pnpm sim invoice_expired_b2b"
pnpm sim invoice_expired_b2b
note "the discount is clamped to max_discount_pct and never breaches the invoice floor (C-B3)"
report_action discount_offer 45
note "read that back: above the ₹2,000 auto-approve ceiling an offer waits for a human; once the ₹50,000 daily discount"
note "budget is spent, the same offer is blocked outright. Both bounds are code, and both are shown as they happen."
beat

# ---------------------------------------------------------------------------------------------------------------
# 7. Dispute
# ---------------------------------------------------------------------------------------------------------------
step "A chargeback is opened" "Aegis assembles the evidence packet and stops"
show "pnpm sim dispute_created"
pnpm sim dispute_created
report_action evidence_packet
note "evidence is never auto-submitted; a human has to approve it on /approvals (C-B4)"
beat

# ---------------------------------------------------------------------------------------------------------------
# 8/9. x402 — selling to an AI buyer
# ---------------------------------------------------------------------------------------------------------------
step "An AI agent buys from the catalog over x402" "HTTP 402 challenge → signed payment → 200 with a settlement receipt"
show "pnpm x402:buy prod_001 --payer ${DEMO_PAYER}"
pnpm x402:buy prod_001 --payer "${DEMO_PAYER}"
note "402 carries a server-issued nonce; the 200 carries X-PAYMENT-RESPONSE and a ledger row (simulated facilitator, C-B7)"
beat

step "The same payment header is replayed" "the nonce is single-use"
show "pnpm x402:buy prod_001 --payer ${DEMO_PAYER} --replay"
pnpm x402:buy prod_001 --payer "${DEMO_PAYER}" --replay
note "the replay is refused with nonce_already_settled — no second charge, no second ledger row"
beat

# ---------------------------------------------------------------------------------------------------------------
# 10. The retry succeeds -> attribution
# ---------------------------------------------------------------------------------------------------------------
step "The customer retries and pays" "recovered revenue is credited only against an action that actually executed"
# Intent: attribution matches a capture to an executed recovery action within the window; firing the capture before the
#         worker has executed that action would prove nothing, so wait for the action first and say what we waited for.
# Flow: poll the actions list for an executed row on this run's customer -> report what happened -> deliver the capture.
ACTION_STATE=""
DEADLINE=$(( $(date +%s) + DEMO_DRAIN_WAIT ))
while [[ $(date +%s) -lt ${DEADLINE} ]]; do
  ACTION_STATE="$(api "/api/v1/actions?limit=100" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let items = [];
      try { items = JSON.parse(raw).items ?? []; } catch { return; }
      const mine = items.filter((row) => row.customer_id === process.argv[1]);
      const executed = mine.find((row) => row.status === "executed");
      if (executed) { process.stdout.write(`executed|${executed.kind}|${executed.expected_recovery_paise}`); return; }
      if (mine.length > 0) process.stdout.write(`${mine[0].status}|${mine[0].kind}|${mine[0].reason ?? ""}`);
    });
  ' "${DEMO_CUSTOMER}")"
  # A blocked or rejected action will never become executed, so waiting out the deadline only adds dead air.
  case "${ACTION_STATE}" in executed*|blocked*|rejected*) break ;; esac
  sleep 2
done
case "${ACTION_STATE}" in
  executed*)
    note "recovery action executed: $(printf '%s' "${ACTION_STATE}" | cut -d'|' -f2), expected recovery $(printf '%s' "${ACTION_STATE}" | cut -d'|' -f3) paise"
    ;;
  "")
    warn "no action for ${DEMO_CUSTOMER} yet after ${DEMO_DRAIN_WAIT}s — the capture below will have nothing to attribute to"
    ;;
  *)
    BLOCK_REASON="$(printf '%s' "${ACTION_STATE}" | cut -d'|' -f3)"
    warn "the recovery action is $(printf '%s' "${ACTION_STATE}" | cut -d'|' -f1): ${BLOCK_REASON}"
    warn "a blocked action is a guardrail doing its job — but nothing executed, so nothing can be attributed"
    [[ "${BLOCK_REASON}" == "quiet_hours_local" ]] && \
      warn "record between 08:00 and 21:00 in the customer's timezone, or re-run with --allow-quiet-hours, to see the message go out"
    ;;
esac
show "pnpm sim payment_captured_after_retry --order ${DEMO_ORDER} --customer ${DEMO_CUSTOMER}"
pnpm sim payment_captured_after_retry --order "${DEMO_ORDER}" --customer "${DEMO_CUSTOMER}"
note "the capture names the order the failure was on, so attribution can only credit the action that preceded it (B-019)"
beat

# ---------------------------------------------------------------------------------------------------------------
# 11. Compliance findings
# ---------------------------------------------------------------------------------------------------------------
step "What the compliance scan found" "keyword pre-screen → model rubric → the quoted span is verified against the copy"
DEADLINE=$(( $(date +%s) + DEMO_SCAN_WAIT ))
FLAGS='[]'
while [[ $(date +%s) -lt ${DEADLINE} ]]; do
  FLAGS="$(api "/api/v1/compliance/flags")"
  [[ "$(printf '%s' "${FLAGS}" | json_path length)" != "0" ]] && break
  sleep 2
done
show "curl ${API_URL}/api/v1/compliance/flags"
printf '%s' "${FLAGS}" | node -e '
  let raw = "";
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => {
    let rows = [];
    try { rows = JSON.parse(raw); } catch { return; }
    if (rows.length === 0) { console.log("  (no flags yet — the scan is still working through the catalog)"); return; }
    for (const row of rows.slice(0, 6)) {
      console.log(`  ${String(row.risk_level).padEnd(10)} ${String(row.category ?? "-").padEnd(22)} ${row.product_name}`);
      if (row.evidence_span) console.log(`             evidence: "${row.evidence_span}"`);
    }
    if (rows.length > 6) console.log(`  … and ${rows.length - 6} more`);
  });
'
note "every flag quotes a span that exists verbatim in the product copy; an unverifiable claim is downgraded, not shown"
beat

# ---------------------------------------------------------------------------------------------------------------
# 12. The numbers
# ---------------------------------------------------------------------------------------------------------------
step "The honest scoreboard" "every number reconciles to source rows — including the ones that look bad"
wait_for_drain
show "curl ${API_URL}/api/v1/metrics/summary"
api /api/v1/metrics/summary | json_pretty
note "degraded_rate and the human rejection rate are shown on purpose: a dashboard that cannot report its own failures is not evidence"
beat

# ---------------------------------------------------------------------------------------------------------------
# 13. Chaos: the model is down
# ---------------------------------------------------------------------------------------------------------------
step "The model goes down mid-stream" "the merchant keeps their recovery path; the system says it is degraded"
show "AEGIS_CHAOS=llm_down pnpm sim payment_failed_3ds_intl"
AEGIS_CHAOS=llm_down pnpm sim payment_failed_3ds_intl
note "the diagnosis falls back to deterministic rules with degraded=true recorded, and the action is still bounded and audited (C-A4)"

printf '\n'; rule
printf ' %sDemo complete in %s.%s  Open %s%s%s — Overview, Events, Actions, Approvals, Ask Aegis, Compliance, x402 Lab.\n' \
  "${B}" "$(elapsed)" "${R}" "${CYAN}" "${WEB_URL}" "${R}"
printf ' %sCompliance run %s may still be finishing; /compliance fills in live over SSE.%s\n' "${DIM}" "${SCAN_RUN}" "${R}"
rule
printf '\nMade with 💖 by Nabhanyu for Razorpay AI Buildathon\n\n'
