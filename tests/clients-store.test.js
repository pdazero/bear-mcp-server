import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileClientsStore } from '../src/auth/clients-store.js';

describe('FileClientsStore', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-clients-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getClient returns undefined for unknown client', () => {
    const store = new FileClientsStore(tmpDir);
    assert.equal(store.getClient('nonexistent'), undefined);
  });

  it('registerClient saves and allows retrieval', () => {
    const store = new FileClientsStore(tmpDir);
    const registered = store.registerClient({
      redirect_uris: ['http://localhost/callback'],
      client_name: 'Test Client',
    });

    assert.ok(registered.client_id);
    assert.ok(registered.client_id_issued_at);
    assert.equal(registered.client_name, 'Test Client');

    const retrieved = store.getClient(registered.client_id);
    assert.deepEqual(retrieved, registered);
  });

  it('persists clients to disk', () => {
    const store = new FileClientsStore(tmpDir);
    store.registerClient({
      redirect_uris: ['http://localhost/callback'],
    });

    const filePath = path.join(tmpDir, 'auth', 'clients.json');
    assert.ok(fs.existsSync(filePath), 'clients.json should exist');
  });

  it('loads clients from existing file on construction', () => {
    const store1 = new FileClientsStore(tmpDir);
    const registered = store1.registerClient({
      redirect_uris: ['http://localhost/callback'],
      client_name: 'Persistent',
    });

    // Create new instance from same dir
    const store2 = new FileClientsStore(tmpDir);
    const retrieved = store2.getClient(registered.client_id);
    assert.equal(retrieved.client_name, 'Persistent');
  });

  it('handles missing file gracefully', () => {
    const store = new FileClientsStore(path.join(tmpDir, 'nonexistent'));
    assert.equal(store.getClient('any'), undefined);
  });

  it('throws when exceeding MAX_CLIENTS limit', () => {
    const store = new FileClientsStore(tmpDir);
    for (let i = 0; i < FileClientsStore.MAX_CLIENTS; i++) {
      store.registerClient({ redirect_uris: ['http://localhost/callback'], client_name: `Client ${i}` });
    }
    assert.throws(
      () => store.registerClient({ redirect_uris: ['http://localhost/callback'], client_name: 'One too many' }),
      /Client registration limit reached/,
    );
  });
});
