import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IndexManager } from '../src/rag/index-manager.js';
import { AutoIndexer } from '../src/indexer/auto-indexer.js';
import { loadConfig } from '../src/config.js';

// -- IndexManager extensions --

describe('IndexManager - removePoint & indexedUuids', () => {
  let tmpDir;
  const dims = 4;
  const embeddingConfig = { provider: 'test', model: 'test', dimensions: dims };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-idx-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removePoint removes UUID from maps and mark-deletes', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    mgr.addPoint('uuid-1', [1, 0, 0, 0]);
    mgr.addPoint('uuid-2', [0, 1, 0, 0]);

    assert.equal(mgr.size, 2);
    const removed = mgr.removePoint('uuid-1');
    assert.equal(removed, true);
    assert.equal(mgr.size, 1);

    // uuid-1 should not appear in search results
    const results = mgr.search([1, 0, 0, 0], 2);
    const uuids = results.map(r => r.noteUuid);
    assert.ok(!uuids.includes('uuid-1'));
  });

  it('removePoint returns false for unknown UUID', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    const removed = mgr.removePoint('nonexistent');
    assert.equal(removed, false);
  });

  it('indexedUuids returns all indexed UUIDs', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    mgr.addPoint('uuid-a', [1, 0, 0, 0]);
    mgr.addPoint('uuid-b', [0, 1, 0, 0]);
    mgr.addPoint('uuid-c', [0, 0, 1, 0]);

    const uuids = mgr.indexedUuids;
    assert.equal(uuids.length, 3);
    assert.ok(uuids.includes('uuid-a'));
    assert.ok(uuids.includes('uuid-b'));
    assert.ok(uuids.includes('uuid-c'));
  });

  it('indexedUuids reflects removals', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    mgr.addPoint('uuid-a', [1, 0, 0, 0]);
    mgr.addPoint('uuid-b', [0, 1, 0, 0]);
    mgr.removePoint('uuid-a');

    const uuids = mgr.indexedUuids;
    assert.equal(uuids.length, 1);
    assert.ok(uuids.includes('uuid-b'));
  });

  it('lastIndexedTimestamp persists through save/load cycle', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    mgr.addPoint('uuid-1', [1, 0, 0, 0]);
    mgr.save(embeddingConfig, { lastIndexedTimestamp: 12345.678 });

    const mgr2 = new IndexManager(tmpDir);
    mgr2.load(embeddingConfig);
    assert.equal(mgr2.lastIndexedTimestamp, 12345.678);
  });

  it('lastIndexedTimestamp defaults to null when not saved', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    mgr.addPoint('uuid-1', [1, 0, 0, 0]);
    mgr.save(embeddingConfig);

    const mgr2 = new IndexManager(tmpDir);
    mgr2.load(embeddingConfig);
    assert.equal(mgr2.lastIndexedTimestamp, null);
  });
});

// -- Config --

describe('config - autoIndex', () => {
  const savedEnv = {};
  const envKeys = [
    'EMBEDDING_PRESET', 'EMBEDDING_PROVIDER', 'EMBEDDING_MODEL',
    'EMBEDDING_DIMENSIONS', 'EMBEDDING_BACKEND', 'EMBEDDING_BASE_URL',
    'EMBEDDING_API_KEY', 'EMBEDDING_INSTRUCTION_PREFIX',
    'BEAR_DATABASE_PATH', 'DATA_DIR', 'LOG_LEVEL',
    'AUTO_INDEX_ENABLED', 'AUTO_INDEX_INTERVAL_SECONDS',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('auto-index defaults to disabled with 300s interval', () => {
    const config = loadConfig();
    assert.equal(config.autoIndex.enabled, false);
    assert.equal(config.autoIndex.intervalSeconds, 300);
  });

  it('auto-index config from env vars', () => {
    process.env.AUTO_INDEX_ENABLED = 'true';
    process.env.AUTO_INDEX_INTERVAL_SECONDS = '60';
    const config = loadConfig();
    assert.equal(config.autoIndex.enabled, true);
    assert.equal(config.autoIndex.intervalSeconds, 60);
  });

  it('autoIndex config is frozen', () => {
    const config = loadConfig();
    assert.throws(() => { config.autoIndex.enabled = true; }, TypeError);
  });
});

// -- AutoIndexer sync logic --

describe('AutoIndexer', () => {
  function createMocks({ modifiedNotes = [], trashedIds = [], embedFn } = {}) {
    const db = {
      getModifiedNotesForIndexing: (since) => modifiedNotes.filter(n => n.modification_date > since),
      getTrashedNoteIds: (uuids) => trashedIds.filter(id => uuids.includes(id)),
    };

    const provider = {
      embed: embedFn || (async (text) => [1, 0, 0, 0]),
    };

    const addedPoints = [];
    const removedPoints = [];
    let savedTimestamp = null;
    let _lastIndexedTimestamp = 0;

    const indexManager = {
      get lastIndexedTimestamp() { return _lastIndexedTimestamp; },
      set lastIndexedTimestamp(v) { _lastIndexedTimestamp = v; },
      get indexedUuids() { return addedPoints.filter(p => !removedPoints.includes(p.uuid)).map(p => p.uuid); },
      get isLoaded() { return true; },
      addPoint(uuid, vector) { addedPoints.push({ uuid, vector }); },
      removePoint(uuid) {
        if (!this.indexedUuids.includes(uuid)) return false;
        removedPoints.push(uuid);
        return true;
      },
      save(embeddingConfig, opts = {}) {
        if (opts.lastIndexedTimestamp !== undefined) {
          _lastIndexedTimestamp = opts.lastIndexedTimestamp;
        }
        savedTimestamp = _lastIndexedTimestamp;
      },
    };

    const config = {
      autoIndex: { enabled: true, intervalSeconds: 60 },
      embedding: { provider: 'test', model: 'test', dimensions: 4 },
    };

    return { db, provider, indexManager, config, addedPoints, removedPoints, getSavedTimestamp: () => savedTimestamp };
  }

  it('sync indexes new notes returned by query', async () => {
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'note-1', title: 'Test', content: 'Hello', modification_date: 100 },
        { id: 'note-2', title: 'Test 2', content: 'World', modification_date: 200 },
      ],
    });

    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    assert.equal(mocks.addedPoints.length, 2);
    assert.equal(mocks.addedPoints[0].uuid, 'note-1');
    assert.equal(mocks.addedPoints[1].uuid, 'note-2');
  });

  it('sync updates existing notes (addPoint handles mark-delete)', async () => {
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'note-1', title: 'Updated', content: 'New content', modification_date: 300 },
      ],
    });
    // Pre-populate as if note-1 was already indexed
    mocks.indexManager.addPoint('note-1', [0, 1, 0, 0]);

    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    // addPoint should have been called again for note-1
    const note1Points = mocks.addedPoints.filter(p => p.uuid === 'note-1');
    assert.equal(note1Points.length, 2); // original + update
  });

  it('sync removes trashed notes from index', async () => {
    const mocks = createMocks({
      trashedIds: ['note-trash'],
    });
    // Pre-populate indexed note
    mocks.indexManager.addPoint('note-trash', [1, 0, 0, 0]);

    const indexer = new AutoIndexer(mocks);
    // Force trash check on this cycle (cycle 5 = multiple of TRASH_CHECK_INTERVAL)
    indexer.syncCycle = 4; // next sync will be cycle 5
    await indexer.sync();

    assert.ok(mocks.removedPoints.includes('note-trash'));
    const status = indexer.getStatus();
    assert.equal(status.notesRemoved, 1);
  });

  it('sync advances lastIndexedTimestamp to max modification_date', async () => {
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'note-1', title: 'A', content: 'a', modification_date: 100 },
        { id: 'note-2', title: 'B', content: 'b', modification_date: 250 },
        { id: 'note-3', title: 'C', content: 'c', modification_date: 200 },
      ],
    });

    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    assert.equal(mocks.indexManager.lastIndexedTimestamp, 250);
  });

  it('sync handles empty results gracefully', async () => {
    const mocks = createMocks({ modifiedNotes: [] });
    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    const status = indexer.getStatus();
    assert.equal(status.notesIndexed, 0);
    assert.equal(status.notesRemoved, 0);
    assert.equal(status.errors, 0);
    assert.ok(status.lastSync instanceof Date);
  });

  it('sync continues past individual embedding errors', async () => {
    let callCount = 0;
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'note-ok-1', title: 'OK', content: 'fine', modification_date: 100 },
        { id: 'note-fail', title: 'Fail', content: 'bad', modification_date: 200 },
        { id: 'note-ok-2', title: 'OK2', content: 'also fine', modification_date: 300 },
      ],
      embedFn: async (text) => {
        callCount++;
        if (text.includes('Fail')) throw new Error('Embedding service down');
        return [1, 0, 0, 0];
      },
    });

    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    assert.equal(callCount, 3); // all three attempted
    assert.equal(mocks.addedPoints.length, 2); // only 2 succeeded
    const status = indexer.getStatus();
    assert.equal(status.notesIndexed, 2);
    assert.equal(status.errors, 1);
    // Timestamp should still advance past the failed note
    assert.equal(mocks.indexManager.lastIndexedTimestamp, 300);
  });

  it('start() and stop() manage the polling interval', async () => {
    const mocks = createMocks();
    const indexer = new AutoIndexer(mocks);

    indexer.start();
    assert.equal(indexer.getStatus().running, true);
    assert.ok(indexer.intervalId !== null);

    indexer.stop();
    assert.equal(indexer.getStatus().running, false);
    assert.equal(indexer.intervalId, null);
  });

  it('start() is idempotent', () => {
    const mocks = createMocks();
    const indexer = new AutoIndexer(mocks);

    indexer.start();
    const firstInterval = indexer.intervalId;
    indexer.start(); // should not create a second interval
    assert.equal(indexer.intervalId, firstInterval);

    indexer.stop();
  });

  it('getStatus returns expected shape', async () => {
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'n1', title: 'X', content: 'x', modification_date: 50 },
      ],
    });
    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    const status = indexer.getStatus();
    assert.equal(typeof status.running, 'boolean');
    assert.ok(status.lastSync instanceof Date);
    assert.equal(status.notesIndexed, 1);
    assert.equal(status.notesRemoved, 0);
    assert.equal(status.errors, 0);
    assert.equal(typeof status.syncCycle, 'number');
  });
});

// -- Query tests (with real DB, skipped if unavailable) --

describe('db queries - incremental indexing', {
  skip: (() => {
    const dbPath = process.env.BEAR_DATABASE_PATH || path.join(
      os.homedir(),
      'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite'
    );
    return !fs.existsSync(dbPath) && 'Bear database not found';
  })(),
}, () => {
  let queries;

  beforeEach(async () => {
    const connModule = await import('../src/db/connection.js');
    const dbPath = process.env.BEAR_DATABASE_PATH || path.join(
      os.homedir(),
      'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite'
    );
    connModule.openDatabase(dbPath);
    queries = await import('../src/db/queries.js');
  });

  afterEach(async () => {
    const { closeDatabase } = await import('../src/db/connection.js');
    closeDatabase();
    queries.clearStatementCache();
  });

  it('getModifiedNotesForIndexing returns notes modified after timestamp', () => {
    // Using 0 should return all non-trashed, non-encrypted notes
    const notes = queries.getModifiedNotesForIndexing(0);
    assert.ok(Array.isArray(notes));
    assert.ok(notes.length > 0);
    assert.ok(notes[0].id);
    assert.ok('title' in notes[0]);
    assert.ok('content' in notes[0]);
    assert.ok('modification_date' in notes[0]);
    // Should be ordered ASC
    if (notes.length > 1) {
      assert.ok(notes[0].modification_date <= notes[1].modification_date);
    }
  });

  it('getModifiedNotesForIndexing returns empty for future timestamp', () => {
    // Core Data timestamp far in the future
    const notes = queries.getModifiedNotesForIndexing(999999999);
    assert.ok(Array.isArray(notes));
    assert.equal(notes.length, 0);
  });

  it('getTrashedNoteIds returns trashed subset of given UUIDs', () => {
    // With no UUIDs, should return empty
    const result = queries.getTrashedNoteIds([]);
    assert.deepEqual(result, []);

    // With fake UUIDs, should return empty
    const result2 = queries.getTrashedNoteIds(['nonexistent-1', 'nonexistent-2']);
    assert.deepEqual(result2, []);
  });
});
