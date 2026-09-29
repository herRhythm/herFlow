import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS orders (
      key_hash TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL,
      fingerprint TEXT NOT NULL, kit TEXT NOT NULL, amount INTEGER NOT NULL,
      customer TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      payment_url TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT, fulfilled_at TEXT
    );`);
  return {
    db,
    byKey: key => db.prepare('SELECT * FROM orders WHERE key_hash = ?').get(key),
    byReference: ref => db.prepare('SELECT * FROM orders WHERE reference = ?').get(ref),
    insert: row => db.prepare('INSERT INTO orders (key_hash,reference,fingerprint,kit,amount,customer) VALUES (?,?,?,?,?,?)').run(row.key_hash,row.reference,row.fingerprint,row.kit,row.amount,row.customer),
    setUrl: (ref, url) => db.prepare('UPDATE orders SET payment_url = ? WHERE reference = ?').run(url, ref),
    setStatus: (ref, status) => db.prepare("UPDATE orders SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END WHERE reference = ? AND status != 'paid'").run(status, status, ref),
    close: () => db.close()
  };
}
