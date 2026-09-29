// Local operator tool. Requires private access to the production order database.
import { resolve } from 'node:path';
import { openStore } from './store.js';
const store = openStore(resolve(process.env.ORDER_DB_PATH || './data/orders.sqlite'));
try {
  const [command, reference] = process.argv.slice(2);
  if (command === 'list') {
    console.log(JSON.stringify(store.db.prepare("SELECT reference,kit,amount,customer,paid_at FROM orders WHERE status = 'paid' AND fulfilled_at IS NULL ORDER BY paid_at").all().map(row => ({ ...row, customer: JSON.parse(row.customer) })), null, 2));
  } else if (command === 'fulfilled' && reference) {
    const result = store.db.prepare("UPDATE orders SET fulfilled_at = CURRENT_TIMESTAMP WHERE reference = ? AND status = 'paid' AND fulfilled_at IS NULL").run(reference);
    console.log(result.changes ? 'Order marked fulfilled.' : 'No unfulfilled paid order matched.');
  } else {
    console.error('Usage: node --env-file-if-exists=.env server/orders.js list | fulfilled <reference>');
    process.exitCode = 1;
  }
} finally { store.close(); }
