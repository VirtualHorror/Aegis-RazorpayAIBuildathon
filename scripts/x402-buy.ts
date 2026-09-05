import { createHmac } from 'node:crypto';

const productId = process.argv[2];
if (!productId || productId.startsWith('--')) throw new Error('usage: pnpm x402:buy <productId> [--replay] [--amount N] [--payer id]');
const replay = process.argv.includes('--replay');
const amountFlag = process.argv.indexOf('--amount');
const payerFlag = process.argv.indexOf('--payer');
const payer = payerFlag >= 0 ? `agent:${process.argv[payerFlag + 1]}` : 'agent:demo';
const api = process.env.API_URL ?? 'http://localhost:4000';
const secret = process.env.X402_SIM_SECRET ?? 'x402_local_dev_secret_change_me';
const first = await fetch(`${api}/x402/products/${encodeURIComponent(productId)}/spec`);
const challenge = await first.json() as { accepts?: Array<{ nonce?: string; maxAmountRequired?: string }> };
console.log(JSON.stringify({ status: first.status, body: challenge }, null, 2));
if (first.status !== 402 || !challenge.accepts?.[0]?.nonce) process.exit(1);
const nonce = challenge.accepts[0].nonce;
const accepted = challenge.accepts[0];
const amount = amountFlag >= 0 ? process.argv[amountFlag + 1] : accepted.maxAmountRequired;
const issuedAt = new Date().toISOString();
const payTo = process.env.X402_PAY_TO ?? 'merchant:aegis-demo';
const signing = [nonce, amount, 'INR', payTo, payer, issuedAt].join('|');
const signature = createHmac('sha256', secret).update(signing).digest('hex');
const header = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'aegis-sim', payload: { nonce, amount, asset: 'INR', payTo, payer, issuedAt, signature } })).toString('base64');
const paid = await fetch(`${api}/x402/products/${encodeURIComponent(productId)}/spec`, { headers: { 'X-PAYMENT': header } });
console.log(JSON.stringify({ status: paid.status, body: await paid.json(), paymentResponse: paid.headers.get('X-PAYMENT-RESPONSE') }, null, 2));
if (replay) {
  const replayed = await fetch(`${api}/x402/products/${encodeURIComponent(productId)}/spec`, { headers: { 'X-PAYMENT': header } });
  console.log(JSON.stringify({ status: replayed.status, body: await replayed.json() }, null, 2));
}
