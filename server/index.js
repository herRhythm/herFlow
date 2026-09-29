import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { openStore } from './store.js';
import { createPaystack } from './paystack.js';

const secret = process.env.PAYSTACK_SECRET_KEY || '';
const origin = new URL(process.env.PUBLIC_ORIGIN || 'http://localhost:3000');
if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN must be an origin without a path or credentials');
if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('PUBLIC_ORIGIN requires HTTPS outside localhost');
if (secret && !/^sk_(test|live)_[A-Za-z0-9]+$/.test(secret)) throw new Error('Invalid PAYSTACK_SECRET_KEY configuration');
if (secret.startsWith('sk_live_') && origin.protocol !== 'https:') throw new Error('Live payments require HTTPS');
const root = fileURLToPath(new URL('../', import.meta.url));
const store = openStore(resolve(process.env.ORDER_DB_PATH || './data/orders.sqlite'));
const server = createApp({ store, provider: createPaystack(secret), secret, origin: origin.origin, root, mode: secret.startsWith('sk_live_') ? 'live' : 'test' });
server.listen(Number(process.env.PORT || 3000), () => console.log('HerRhythm checkout server listening; payments ' + (secret ? 'configured' : 'disabled')));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
