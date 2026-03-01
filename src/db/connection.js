import Database from 'better-sqlite3';
import { createLogger } from '../utils/logger.js';

const log = createLogger('db');

let db = null;

export function openDatabase(dbPath) {
  if (db) return db;

  log.info('Opening database:', dbPath);
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  log.info('Database connected');
  return db;
}

export function getDatabase() {
  if (!db) throw new Error('Database not opened. Call openDatabase() first.');
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    log.info('Database closed');
  }
}
