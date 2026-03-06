import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class FileClientsStore {
  constructor(dataDir) {
    this._dir = path.join(dataDir, 'auth');
    this._filePath = path.join(this._dir, 'clients.json');
    this._clients = new Map();
    this._load();
  }

  getClient(clientId) {
    return this._clients.get(clientId);
  }

  registerClient(clientInfo) {
    const clientId = crypto.randomUUID();
    const client = {
      ...clientInfo,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this._clients.set(clientId, client);
    this._save();
    return client;
  }

  _load() {
    try {
      const data = fs.readFileSync(this._filePath, 'utf-8');
      const entries = JSON.parse(data);
      for (const client of entries) {
        this._clients.set(client.client_id, client);
      }
    } catch {
      // File doesn't exist or is invalid — start with empty store
    }
  }

  _save() {
    fs.mkdirSync(this._dir, { recursive: true });
    fs.writeFileSync(this._filePath, JSON.stringify([...this._clients.values()], null, 2));
  }
}
