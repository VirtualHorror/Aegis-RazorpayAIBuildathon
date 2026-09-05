import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { Config } from '../config';
import type { EventBus } from '../bus/event-bus';
import { listPayments } from '../db/repos/x402';
import { x402Middleware } from './middleware';

export interface X402RouteOptions { readonly db: pg.Pool; readonly config: Config; readonly bus: EventBus }
const ProductParams = z.object({ id: z.string().min(1) });
const OrderBody = z.object({ product_id: z.string().min(1), qty: z.number().int().min(1).max(5).default(1) });

export const x402Routes: FastifyPluginAsync<X402RouteOptions> = async (app, options) => {
  app.get('/x402/catalog', async () => {
    const result = await options.db.query(`SELECT id, name, description, category, price_paise, currency FROM products WHERE active=true AND agent_purchasable=true ORDER BY id`);
    return { items: result.rows };
  });
  app.get('/x402/products/:id/spec', { preHandler: x402Middleware({ ...options, priceFor: async (request) => productPrice(options.db, request.params, 1) }) }, async (request, reply) => {
    const item = await getProduct(options.db, request.params);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return { id: item.id, name: item.name, description: item.description, pricePaise: item.price_paise, currency: item.currency };
  });
  app.post('/x402/orders', { preHandler: x402Middleware({ ...options, priceFor: async (request) => { const body = OrderBody.parse(request.body ?? {}); return productPrice(options.db, { id: body.product_id }, body.qty); } }) }, async (request, reply) => {
    const body = OrderBody.parse(request.body ?? {});
    const item = await getProduct(options.db, { id: body.product_id });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    const id = `x402_${randomUUID()}`;
    const result = await options.db.query(`INSERT INTO orders (id, amount_paise, currency, status, items, notes) VALUES ($1,$2,$3,'created',$4::jsonb,$5::jsonb) RETURNING id, amount_paise, currency, status`, [id, Number(item.price_paise) * body.qty, item.currency, JSON.stringify([{ product_id: item.id, qty: body.qty }]), JSON.stringify({ channel: 'x402' })]);
    return reply.send({ order: result.rows[0] });
  });
  app.get('/api/v1/x402/payments', async () => ({ items: await listPayments(options.db) }));
};

async function getProduct(db: pg.Pool, params: unknown): Promise<{ id: string; name: string; description: string; price_paise: number; currency: string } | null> {
  const { id } = ProductParams.parse(params);
  const result = await db.query<{ id: string; name: string; description: string; price_paise: string; currency: string }>(`SELECT id,name,description,price_paise,currency FROM products WHERE id=$1 AND active=true AND agent_purchasable=true`, [id]);
  const row = result.rows[0];
  return row ? { ...row, price_paise: Number(row.price_paise) } : null;
}
async function productPrice(db: pg.Pool, params: unknown, qty: number) {
  const row = await getProduct(db, params);
  if (!row) throw new Error('product_not_found');
  const amountPaise = row.price_paise * qty;
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new Error('product_price_invalid');
  return { amountPaise, description: row.name };
}
