import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { catalog, validateOrder } from '../assets/catalog.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export function safePaymentUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com' && !url.username && !url.password && !url.port; } catch { return false; }
}

export function createApp({ store, provider, secret = '', origin, root, mode = 'test' }) {
  const enabled = /^sk_(test|live)_[A-Za-z0-9]+$/.test(secret);
  const inFlight = new Map();
  const limits = new Map();
  const publicOrder = row => ({ reference: row.reference, kit: row.kit, amount: row.amount, currency: 'KES', status: row.status, paymentUrl: row.status === 'pending' ? row.payment_url : null });

  async function initialize(row, key) {
    if (row.status !== 'pending' || row.payment_url) return row;
    if (!inFlight.has(row.key_hash)) {
      const task = (async () => {
        const customer = JSON.parse(row.customer);
        const result = await provider.initialize({ email: customer.email, amount: row.amount, currency: 'KES', reference: row.reference, channels: ['card', 'mobile_money'], callback_url: origin + '/checkout.html?order=' + key, metadata: { order_reference: row.reference, kit: row.kit } });
        if (result.reference !== row.reference || !safePaymentUrl(result.authorization_url)) throw failure(502, 'Invalid payment response. Check order status before retrying.');
        store.setUrl(row.reference, result.authorization_url);
        return store.byKey(row.key_hash);
      })();
      inFlight.set(row.key_hash, task);
    }
    try { return await inFlight.get(row.key_hash); }
    catch { throw failure(502, 'Payment could not be opened. Check status or retry this same order.', { order: publicOrder(store.byKey(row.key_hash)) }); }
    finally { inFlight.delete(row.key_hash); }
  }

  function reconcile(row, data) {
    if (data.reference !== row.reference || data.amount !== row.amount || data.currency !== 'KES' || data.domain !== mode || data.customer?.email?.toLowerCase() !== JSON.parse(row.customer).email) {
      throw failure(502, 'Payment details could not be verified. Contact support with your order reference.');
    }
    if (data.status === 'success') store.setStatus(row.reference, 'paid');
    // Abandoned/ongoing transactions may still settle; never invite a duplicate payment.
    else if (data.status === 'failed') store.setStatus(row.reference, 'failed');
    return store.byReference(row.reference);
  }

  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) throw failure(413, 'Request is too large.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function parse(raw) {
    try { return JSON.parse(raw); } catch { throw failure(400, 'Send valid JSON.'); }
  }
  function rateLimit(req) {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    // Do not trust client-supplied X-Forwarded-For. Apply per-client limits at the TLS proxy too.
    const key = req.socket.remoteAddress;
    const entry = limits.get(key) || { count: 0, until: now + 60000 };
    limits.set(key, entry);
    if (++entry.count > 60) throw failure(429, 'Too many requests. Please wait a minute and try again.');
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/api/payments/webhook' && req.method === 'POST') {
        if (!enabled) throw failure(503, 'Payments are not configured.');
        const raw = await body(req);
        const signature = req.headers['x-paystack-signature'];
        const expected = createHmac('sha512', secret).update(raw).digest();
        if (typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw failure(401, 'Invalid signature.');
        const event = parse(raw);
        if (event.event === 'charge.success') {
          const row = store.byReference(event.data?.reference || '');
          if (row) reconcile(row, event.data);
        }
        return send(200, { received: true });
      }
      if (url.pathname.startsWith('/api/')) {
        rateLimit(req);
        if (url.pathname === '/api/checkout' && req.method === 'GET') return send(200, { enabled, mode, catalog });
        if (!enabled) throw failure(503, 'Online payment is not available yet. Please contact HerRhythm to order.');
        if (url.pathname === '/api/orders' && req.method === 'POST') {
          if (req.headers.origin !== origin) throw failure(403, 'Please order from the HerRhythm checkout page.');
          if (!req.headers['content-type']?.startsWith('application/json')) throw failure(415, 'Send JSON.');
          const key = req.headers['idempotency-key'];
          if (!keyPattern.test(key || '')) throw failure(400, 'Invalid order key.');
          const { order, errors } = validateOrder(parse(await body(req)));
          if (Object.keys(errors).length) throw failure(422, 'Check the highlighted fields.', { errors });
          const keyHash = hash(key);
          const fingerprint = hash(JSON.stringify(order));
          let row = store.byKey(keyHash);
          if (row && row.fingerprint !== fingerprint) throw failure(409, 'An order already exists for this attempt. Check its status before starting again.');
          if (!row) {
            const kit = catalog.find(item => item.id === order.kit);
            store.insert({ key_hash: keyHash, reference: 'hr-' + randomUUID(), fingerprint, kit: kit.id, amount: kit.amount, customer: JSON.stringify(order) });
            row = store.byKey(keyHash);
          }
          return send(200, publicOrder(await initialize(row, key)));
        }
        if ((url.pathname === '/api/orders/status' && req.method === 'GET') || (url.pathname === '/api/orders/retry' && req.method === 'POST')) {
          const key = req.headers.authorization?.replace(/^Bearer /, '');
          if (!keyPattern.test(key || '')) throw failure(401, 'Order access key is missing.');
          let row = store.byKey(hash(key));
          if (!row) throw failure(404, 'Order not found.');
          if (req.method === 'POST') {
            if (req.headers.origin !== origin) throw failure(403, 'Please retry from the checkout page.');
            return send(200, publicOrder(await initialize(row, key)));
          }
          if (row.status !== 'paid') {
            try { row = reconcile(row, await provider.verify(row.reference)); }
            catch { throw failure(502, 'Payment status could not be verified. Check again or contact support.', { order: publicOrder(row) }); }
          }
          return send(200, publicOrder(row));
        }
        throw failure(404, 'Not found.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, 'Method not allowed.');
      const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      // Explicit public roots; never serve server code, databases, .env, Git, or dev snapshots.
      if (!/^\/[a-z0-9-]+\.html$/.test(path) && !/^\/(assets|images|files)\/[a-zA-Z0-9_./ -]+$/.test(path)) throw failure(404, 'Not found.');
      if (path.split('/').some(part => part.startsWith('.')) || !types[extname(path)]) throw failure(404, 'Not found.');
      let content;
      try { content = await readFile(resolve(root, '.' + path)); } catch { throw failure(404, 'Not found.'); }
      res.writeHead(200, { 'Content-Type': types[extname(path)] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      // Do not log provider responses, credentials, URLs containing receipt keys, or customer data.
      if (!error.status) console.error('Checkout request failed:', error.name);
      send(error.status || 502, { message: error.status ? error.message : 'Payment service could not be reached. Check order status before trying again.', ...error.extra });
    }
  });
  server.requestTimeout = 20000;
  return server;
}
