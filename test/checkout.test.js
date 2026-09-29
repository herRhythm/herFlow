import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openStore } from '../server/store.js';
import { createPaystack } from '../server/paystack.js';
import { catalog, validateOrder } from '../assets/catalog.js';

const customer = { kit: 'menarche', fullName: 'Janet Wanjiru', email: 'janet@example.com', phone: '0712 345 678', address: 'Nairobi, Test Street, Building 1' };
const secret = 'sk_test_example';
const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t, overrides = {}) {
  const store = overrides.store || openStore(':memory:');
  const requests = [];
  let verifyData = {};
  const provider = {
    async initialize(input) { requests.push(input); return { reference: input.reference, authorization_url: 'https://checkout.paystack.com/example' }; },
    async verify(reference) { return { reference, amount: 680000, currency: 'KES', domain: 'test', status: 'success', customer: { email: customer.email }, ...verifyData }; },
    ...overrides.provider
  };
  const app = createApp({ store, provider, secret, root, origin: 'http://localhost:3000', ...overrides });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => { await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (path, options) => {
    const res = await fetch(base + path, options);
    const text = await res.text();
    return { status: res.status, body: res.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
  };
  const order = (key = randomUUID(), data = customer, headers = {}) => call('/api/orders', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', 'Idempotency-Key': key, ...headers }, body: JSON.stringify(data) });
  const status = key => call('/api/orders/status', { headers: { Authorization: 'Bearer ' + key } });
  const webhook = (data, signature) => {
    const body = JSON.stringify({ event: 'charge.success', data });
    return call('/api/payments/webhook', { method: 'POST', headers: { 'x-paystack-signature': signature ?? createHmac('sha512', secret).update(body).digest('hex') }, body });
  };
  return { store, requests, call, order, status, webhook, setVerify: data => { verifyData = data; } };
}

test('catalog uses product-page prices; validates and normalizes input', () => {
  assert.deepEqual(catalog.map(kit => kit.amount), [680000, 680000, 650000]);
  for (const phone of ['0712 345 678', '254712345678', '+254712345678', '0112345678']) assert.equal(Object.keys(validateOrder({ ...customer, phone }).errors).length, 0);
  assert.equal(validateOrder(customer).order.phone, '+254712345678');
  const invalid = validateOrder({ kit: 'free', fullName: ' ', email: 'no', phone: '123', address: ' ' });
  assert.deepEqual(Object.keys(invalid.errors), ['kit', 'fullName', 'email', 'phone', 'address']);
});

test('unconfigured server fails closed without storing an order or leaking secrets', async t => {
  const f = await fixture(t, { secret: '' });
  assert.equal((await f.call('/api/checkout')).body.enabled, false);
  assert.equal((await f.order()).status, 503);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  for (const path of ['/.env', '/server/app.js', '/data/orders.sqlite', '/.git/config', '/dev/v5/checkout.html']) assert.equal((await f.call(path)).status, 404);
});

test('server owns amount and validates fields, origin and key', async t => {
  const f = await fixture(t);
  assert.equal((await f.order(randomUUID(), { ...customer, email: 'bad' })).status, 422);
  assert.equal((await f.order(randomUUID(), customer, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.order('invalid')).status, 400);
  for (const kit of catalog) {
    const r = await f.order(randomUUID(), { ...customer, kit: kit.id, amount: 1, currency: 'USD', status: 'paid' });
    assert.equal(r.status, 200);
    assert.equal(r.body.amount, kit.amount);
    assert.equal(r.body.status, 'pending');
    assert.equal(f.requests.at(-1).amount, kit.amount);
    assert.deepEqual(f.requests.at(-1).channels, ['card', 'mobile_money']);
  }
});

test('concurrent double submit and changed payload do not create duplicate payments', async t => {
  const f = await fixture(t);
  const key = randomUUID();
  const results = await Promise.all([f.order(key), f.order(key), f.order(key)]);
  assert.equal(new Set(results.map(result => result.body.reference)).size, 1);
  assert.equal(f.requests.length, 1);
  assert.equal((await f.order(key, { ...customer, kit: 'rising-moon-opt-out' })).status, 409);
});

test('receipt requires bearer key; URL parameters never confirm payment', async t => {
  const f = await fixture(t);
  const key = randomUUID();
  await f.order(key);
  assert.equal((await f.call('/api/orders/status?status=success')).status, 401);
  assert.equal((await f.status(randomUUID())).status, 404);
  f.setVerify({ status: 'pending' });
  assert.equal((await f.status(key)).body.status, 'pending');
  f.setVerify({ status: 'abandoned' });
  assert.equal((await f.status(key)).body.status, 'pending');
  f.setVerify({ status: 'failed' });
  assert.equal((await f.status(key)).body.status, 'failed');
  f.setVerify({ status: 'success' });
  const paid = await f.status(key);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.customer, undefined);
  assert.equal(paid.body.paymentUrl, null);
  f.setVerify({ status: 'failed' });
  assert.equal((await f.status(key)).body.status, 'paid');
});

test('amount, currency, reference, environment and customer mismatches never mark paid', async t => {
  const f = await fixture(t);
  const key = randomUUID();
  const result = await f.order(key);
  for (const mismatch of [{ amount: 1 }, { currency: 'USD' }, { reference: 'other' }, { domain: 'live' }, { customer: { email: 'other@example.com' } }]) {
    f.setVerify(mismatch);
    assert.equal((await f.status(key)).status, 502);
    assert.equal(f.store.byReference(result.body.reference).status, 'pending');
  }
});

test('signed webhook records success once and rejects forged/mismatched events', async t => {
  const f = await fixture(t);
  const r = await f.order();
  const data = { reference: r.body.reference, amount: 680000, currency: 'KES', domain: 'test', status: 'success', customer: { email: customer.email } };
  assert.equal((await f.webhook(data, '0'.repeat(128))).status, 401);
  assert.equal((await f.webhook({ ...data, amount: 1 })).status, 502);
  assert.equal((await f.webhook(data)).status, 200);
  const paidAt = f.store.byReference(data.reference).paid_at;
  assert.equal((await f.webhook(data)).status, 200);
  assert.equal(f.store.byReference(data.reference).paid_at, paidAt);
  assert.equal(f.store.byReference(data.reference).status, 'paid');
});

test('timeout can retry the stored order after reload, using the same reference', async t => {
  let fail = true;
  const references = [];
  const f = await fixture(t, { provider: {
    async initialize(input) {
      references.push(input.reference);
      if (fail) throw new Error('timeout');
      return { reference: input.reference, authorization_url: 'https://checkout.paystack.com/retry' };
    },
    async verify() { throw new Error('network'); }
  } });
  const key = randomUUID();
  const initial = await f.order(key);
  assert.equal(initial.status, 502);
  assert.ok(initial.body.order.reference);
  assert.equal((await f.status(key)).body.order.reference, initial.body.order.reference);
  fail = false;
  const retry = await f.call('/api/orders/retry', { method: 'POST', headers: { Origin: 'http://localhost:3000', Authorization: 'Bearer ' + key } });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.reference, initial.body.order.reference);
  assert.equal(new Set(references).size, 1);
});

test('provider redirect must be Paystack HTTPS', async t => {
  for (const paymentUrl of ['https://evil.example', 'http://checkout.paystack.com', 'https://checkout.paystack.com.evil.example', 'https://user:password@checkout.paystack.com']) {
    const f = await fixture(t, { provider: { initialize: async input => ({ reference: input.reference, authorization_url: paymentUrl }) } });
    assert.equal((await f.order()).status, 502);
  }
});

test('order data and paid state survive reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'herrhythm-'));
  try {
    const path = join(dir, 'orders.sqlite');
    let store = openStore(path);
    store.insert({ key_hash: 'hash', reference: 'reference', fingerprint: 'fingerprint', kit: 'menarche', amount: 680000, customer: JSON.stringify(customer) });
    store.setStatus('reference', 'paid');
    store.close();
    store = openStore(path);
    assert.equal(store.byReference('reference').status, 'paid');
    assert.equal(JSON.parse(store.byReference('reference').customer).address, customer.address);
    store.close();
  } finally { rmSync(dir, { recursive: true }); }
});

test('Paystack adapter sends secret only to provider, uses timeout and rejects errors', async () => {
  const calls = [];
  const provider = createPaystack(secret, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ status: true, data: { reference: 'r' } }) };
  });
  await provider.initialize({ amount: 680000 });
  await provider.verify('r');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + secret);
  assert.equal(calls[0].url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(calls[1].url, 'https://api.paystack.co/transaction/verify/r');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  const bad = createPaystack(secret, async () => ({ ok: false, json: async () => ({ message: 'sensitive provider error' }) }));
  await assert.rejects(bad.verify('r'), /Payment provider unavailable/);
});
