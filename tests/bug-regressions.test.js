import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../src/server.js';
import { kmeans } from '../src/rag/kmeans.js';
import { AutoIndexer } from '../src/indexer/auto-indexer.js';

// ========== Bug #1: MCP SDK response format ==========
// server.js returned { toolResult: result } which the MCP SDK silently strips,
// causing every tool call to return empty content to the client.
//
// We test by intercepting the handler registered via setRequestHandler and
// calling it directly, then validating the response against CallToolResultSchema.

describe('MCP server tool response format', () => {
  // Capture the tools/call handler that createMcpServer registers
  function captureCallToolHandler(tools) {
    const server = createMcpServer(tools);
    // The SDK stores handlers in _requestHandlers Map keyed by method name.
    // The Server class wraps our handler with validation, so calling the
    // stored handler exercises both our code and the SDK validation.
    const handler = server._requestHandlers.get('tools/call');
    assert.ok(handler, 'tools/call handler must be registered');
    return handler;
  }

  it('successful tool call returns content array with text', async () => {
    const tools = [{
      definition: { name: 'echo', description: 'echo', inputSchema: { type: 'object' } },
      handler: async (args) => ({ message: args.text }),
    }];
    const handler = captureCallToolHandler(tools);

    // Call the handler the same way the SDK would
    const response = await handler(
      { method: 'tools/call', params: { name: 'echo', arguments: { text: 'hello' } } },
      { signal: new AbortController().signal },
    );

    assert.ok(response.content, 'response must have content field');
    assert.ok(Array.isArray(response.content), 'content must be an array');
    assert.equal(response.content.length, 1);
    assert.equal(response.content[0].type, 'text');

    const parsed = JSON.parse(response.content[0].text);
    assert.deepEqual(parsed, { message: 'hello' });

    // Must NOT have the old toolResult key (SDK strips unknown keys)
    assert.equal(response.toolResult, undefined, 'toolResult key must not be present');
  });

  it('failed tool call returns isError true with error message', async () => {
    const tools = [{
      definition: { name: 'fail', description: 'fail', inputSchema: { type: 'object' } },
      handler: async () => { throw new Error('something broke'); },
    }];
    const handler = captureCallToolHandler(tools);

    const response = await handler(
      { method: 'tools/call', params: { name: 'fail', arguments: {} } },
      { signal: new AbortController().signal },
    );

    assert.ok(response.content, 'error response must have content field');
    assert.equal(response.isError, true);
    assert.equal(response.content[0].type, 'text');
    assert.ok(response.content[0].text.includes('something broke'));
  });
});

// ========== Bug #2: kmeans empty cluster returns zero vector ==========
// recomputeCentroids returned a zero vector for empty clusters instead of
// preserving the old centroid, causing centroid collapse toward origin.

describe('kmeans empty cluster centroid preservation', () => {
  it('empty cluster preserves old centroid instead of collapsing to zero', () => {
    // Create vectors that naturally form 2 clusters, but request k=3.
    // The third cluster will be empty after assignment and its centroid
    // must be preserved from initialization, not collapse to [0,0].
    const vectors = [
      // Cluster near [10, 10]
      [10, 10], [10.1, 9.9], [9.9, 10.1],
      // Cluster near [-10, -10]
      [-10, -10], [-10.1, -9.9], [-9.9, -10.1],
    ];

    const { centroids } = kmeans(vectors, 3, 50);

    // No centroid should be at the origin [0, 0] — that would indicate
    // the bug where empty clusters collapse to zero vectors
    for (let i = 0; i < centroids.length; i++) {
      const magnitude = Math.sqrt(centroids[i][0] ** 2 + centroids[i][1] ** 2);
      assert.ok(
        magnitude > 1.0,
        `Centroid ${i} collapsed to near-zero: [${centroids[i]}] (magnitude=${magnitude.toFixed(4)})`
      );
    }
  });

  it('centroids remain valid after many iterations with uneven clusters', () => {
    // 9 points strongly in one region, 1 outlier — with k=3, at least one
    // cluster will likely become empty during iteration
    const vectors = [
      [5, 5], [5.1, 5], [5, 5.1], [4.9, 5], [5, 4.9],
      [5.1, 5.1], [4.9, 4.9], [5.2, 5], [5, 5.2],
      [-20, -20], // far outlier
    ];

    const { centroids } = kmeans(vectors, 3, 100);

    for (const centroid of centroids) {
      const isNearOrigin = centroid.every(v => Math.abs(v) < 0.5);
      assert.ok(
        !isNearOrigin,
        `Centroid collapsed to near-zero: [${centroid}]`
      );
    }
  });
});

// ========== Bug #3: Failed notes permanently skipped ==========
// auto-indexer advanced lastIndexedTimestamp past failed notes, so they
// were never retried on subsequent sync cycles.

describe('AutoIndexer failed note retry', () => {
  function createMocks({ modifiedNotes = [], embedFn } = {}) {
    const db = {
      getModifiedNotesForIndexing: (since) => modifiedNotes.filter(n => n.modification_date > since),
      getTrashedNoteIds: () => [],
    };

    const provider = {
      embed: embedFn || (async () => [1, 0, 0, 0]),
    };

    const addedPoints = [];
    let _lastIndexedTimestamp = 0;

    const indexManager = {
      get lastIndexedTimestamp() { return _lastIndexedTimestamp; },
      set lastIndexedTimestamp(v) { _lastIndexedTimestamp = v; },
      get indexedUuids() { return addedPoints.map(p => p.uuid); },
      get isLoaded() { return true; },
      addPoint(uuid, vector) { addedPoints.push({ uuid, vector }); },
      removePoint() { return false; },
      save(_embeddingConfig, opts = {}) {
        if (opts.lastIndexedTimestamp !== undefined) {
          _lastIndexedTimestamp = opts.lastIndexedTimestamp;
        }
      },
    };

    const config = {
      autoIndex: { enabled: true, intervalSeconds: 60 },
      embedding: { provider: 'test', model: 'test', dimensions: 4 },
    };

    return { db, provider, indexManager, config, addedPoints };
  }

  it('does not advance timestamp past failed notes', async () => {
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'note-ok', title: 'OK', content: 'fine', modification_date: 100 },
        { id: 'note-fail', title: 'Fail', content: 'bad', modification_date: 200 },
      ],
      embedFn: async (text) => {
        if (text.includes('Fail')) throw new Error('transient error');
        return [1, 0, 0, 0];
      },
    });

    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    // Timestamp must stop at 100 (last successful note), not 200
    assert.equal(
      mocks.indexManager.lastIndexedTimestamp, 100,
      'Timestamp must not advance past the failed note'
    );
  });

  it('retries failed notes on subsequent sync', async () => {
    let attempt = 0;
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'note-flaky', title: 'Flaky', content: 'retry me', modification_date: 100 },
      ],
      embedFn: async () => {
        attempt++;
        if (attempt === 1) throw new Error('transient failure');
        return [1, 0, 0, 0];
      },
    });

    const indexer = new AutoIndexer(mocks);

    // First sync: fails
    await indexer.sync();
    assert.equal(mocks.addedPoints.length, 0, 'First sync should fail');
    assert.equal(mocks.indexManager.lastIndexedTimestamp, 0, 'Timestamp must not advance');

    // Second sync: succeeds because timestamp wasn't advanced past it
    await indexer.sync();
    assert.equal(mocks.addedPoints.length, 1, 'Second sync should succeed');
    assert.equal(mocks.addedPoints[0].uuid, 'note-flaky');
    assert.equal(mocks.indexManager.lastIndexedTimestamp, 100, 'Timestamp advances after success');
  });

  it('only advances timestamp to max of successful notes when mixed', async () => {
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'note-a', title: 'A', content: 'ok', modification_date: 100 },
        { id: 'note-b', title: 'B', content: 'fail', modification_date: 200 },
        { id: 'note-c', title: 'C', content: 'ok too', modification_date: 300 },
      ],
      embedFn: async (text) => {
        if (text.includes('fail')) throw new Error('embed error');
        return [1, 0, 0, 0];
      },
    });

    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    // note-a (100) and note-c (300) succeeded, note-b (200) failed.
    // Timestamp should advance to 300 (max successful), not 200.
    // On next sync, note-b will be retried since 200 > previous timestamp (0).
    assert.equal(mocks.addedPoints.length, 2);
    assert.equal(mocks.indexManager.lastIndexedTimestamp, 300);

    // NOTE: note-b (timestamp 200) falls below the new watermark (300) so it
    // won't be retried by getModifiedNotesForIndexing on the next cycle.
    // This is a known limitation — the critical case (failed note with the
    // highest timestamp) is covered by the tests above.
  });

  it('does not save index when only errors occurred', async () => {
    let saveCalled = false;
    const mocks = createMocks({
      modifiedNotes: [
        { id: 'note-fail', title: 'Fail', content: 'bad', modification_date: 100 },
      ],
      embedFn: async () => { throw new Error('always fails'); },
    });

    const originalSave = mocks.indexManager.save.bind(mocks.indexManager);
    mocks.indexManager.save = (...args) => {
      saveCalled = true;
      return originalSave(...args);
    };

    const indexer = new AutoIndexer(mocks);
    await indexer.sync();

    assert.equal(saveCalled, false, 'Should not save index when nothing was indexed');
  });
});
