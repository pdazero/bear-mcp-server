import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IndexManager } from '../src/rag/index-manager.js';

describe('IndexManager', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-idx-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const dims = 4;
  const embeddingConfig = { provider: 'test', model: 'test', dimensions: dims };

  function randomVector() {
    const v = Array.from({ length: dims }, () => Math.random());
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map(x => x / norm);
  }

  it('initializes empty index', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    assert.ok(mgr.isLoaded);
    assert.equal(mgr.size, 0);
  });

  it('adds and searches points', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);

    const v1 = randomVector();
    const v2 = randomVector();
    mgr.addPoint('uuid-1', v1);
    mgr.addPoint('uuid-2', v2);

    assert.equal(mgr.size, 2);

    const results = mgr.search(v1, 2);
    assert.ok(results.length > 0);
    assert.equal(results[0].noteUuid, 'uuid-1');
    assert.ok(results[0].similarity > 0.9); // near-perfect match
  });

  it('saves and loads index', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);

    const v1 = [1, 0, 0, 0];
    mgr.addPoint('uuid-1', v1);
    mgr.save(embeddingConfig);

    // Load into a new manager
    const mgr2 = new IndexManager(tmpDir);
    const loaded = mgr2.load(embeddingConfig);
    assert.ok(loaded);
    assert.equal(mgr2.size, 1);

    const results = mgr2.search(v1, 1);
    assert.equal(results[0].noteUuid, 'uuid-1');
  });

  it('detects dimension mismatch on load', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    mgr.addPoint('uuid-1', randomVector());
    mgr.save(embeddingConfig);

    const mgr2 = new IndexManager(tmpDir);
    const loaded = mgr2.load({ ...embeddingConfig, dimensions: 768 });
    assert.equal(loaded, false);
  });

  it('handles mark-delete on duplicate UUID', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);

    mgr.addPoint('uuid-1', [1, 0, 0, 0]);
    mgr.addPoint('uuid-1', [0, 1, 0, 0]); // update

    assert.equal(mgr.size, 1);

    const results = mgr.search([0, 1, 0, 0], 1);
    assert.equal(results[0].noteUuid, 'uuid-1');
    assert.ok(results[0].similarity > 0.9);
  });

  it('returns empty array when searching empty index', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    const results = mgr.search(randomVector(), 5);
    assert.deepEqual(results, []);
  });

  it('returns false when no index files exist', () => {
    const mgr = new IndexManager(tmpDir);
    const loaded = mgr.load(embeddingConfig);
    assert.equal(loaded, false);
  });
});
