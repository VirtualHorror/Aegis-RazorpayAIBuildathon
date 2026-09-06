import { createHmac } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * Buy one catalog item as an AI agent would: take the 402 challenge, sign it, present X-PAYMENT.
 * Intent: this is the client half of the x402 flow and it must sign exactly what the server quoted. Guessing either
 *         the secret or the payee from this process's own environment made every purchase fail `bad_signature` as soon
 *         as `.env` differed from the `.env.example` placeholders it was falling back to (B-020).
 * Flow: load the repo `.env` -> request the challenge -> sign the quoted nonce/amount/payTo -> present -> optional replay.
 */
async function main(): Promise<void> {
  loadDotenv({ path: join(dirname(dirname(fileURLToPath(import.meta.url))), '.env'), quiet: true });
  const productId = process.argv[2];
  if (!productId || productId.startsWith('--')) throw new Error('usage: pnpm x402:buy <productId> [--replay] [--amount N] [--payer id]');
  const replay = process.argv.includes('--replay');
  const amountFlag = process.argv.indexOf('--amount');
  const payerFlag = process.argv.indexOf('--payer');
  const payer = payerFlag >= 0 ? `agent:${process.argv[payerFlag + 1]}` : 'agent:demo';
  const api = process.env.API_URL ?? 'http://localhost:4000';
  const secret = process.env.X402_SIM_SECRET ?? 'x402_local_dev_secret_change_me';
  const first = await fetch(`${api}/x402/products/${encodeURIComponent(productId)}/spec`);
  const challenge = await first.json() as { accepts?: Array<{ maxAmountRequired?: string; payTo?: string; extra?: { nonce?: string } }> };
  console.log(JSON.stringify({ status: first.status, body: challenge }, null, 2));
  if (first.status !== 402 || !challenge.accepts?.[0]?.extra?.nonce) {
    process.exitCode = 1;
    return;
  }
  const nonce = challenge.accepts[0].extra.nonce;
  const accepted = challenge.accepts[0];
  const amount = amountFlag >= 0 ? process.argv[amountFlag + 1] : accepted.maxAmountRequired;
  if (!amount) throw new Error('challenge did not include maxAmountRequired');
  const issuedAt = new Date().toISOString();
  // The challenge names the payee; signing anything else is the client disagreeing with the terms it was quoted.
  const payTo = accepted.payTo ?? process.env.X402_PAY_TO ?? 'merchant:aegis-demo';
  const signing = [nonce, amount, 'INR', payTo, payer, issuedAt].join('|');
  const signature = createHmac('sha256', secret).update(signing).digest('hex');
  const header = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'aegis-sim', payload: { nonce, amount, asset: 'INR', payTo, payer, issuedAt, signature } })).toString('base64');
  const paid = await fetch(`${api}/x402/products/${encodeURIComponent(productId)}/spec`, { headers: { 'X-PAYMENT': header } });
  console.log(JSON.stringify({ status: paid.status, body: await paid.json(), paymentResponse: paid.headers.get('X-PAYMENT-RESPONSE') }, null, 2));
  if (replay) {
    const replayed = await fetch(`${api}/x402/products/${encodeURIComponent(productId)}/spec`, { headers: { 'X-PAYMENT': header } });
    console.log(JSON.stringify({ status: replayed.status, body: await replayed.json() }, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
