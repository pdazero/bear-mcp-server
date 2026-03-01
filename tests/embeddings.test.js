import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddingProvider, createProvider } from '../src/rag/embeddings.js';

describe('EmbeddingProvider', () => {
  it('base class throws on unimplemented methods', async () => {
    const p = new EmbeddingProvider({ name: 'test', dimensions: 128 });
    await assert.rejects(() => p.initialize(), /Not implemented/);
    await assert.rejects(() => p.embed('text'), /Not implemented/);
    await assert.rejects(() => p.healthCheck(), /Not implemented/);
  });

  it('base class has default embedBatch that calls embed', async () => {
    const p = new EmbeddingProvider({ name: 'test', dimensions: 128 });
    // embedBatch calls embed, which throws
    await assert.rejects(() => p.embedBatch(['a', 'b']), /Not implemented/);
  });

  it('dispose is a no-op by default', async () => {
    const p = new EmbeddingProvider({ name: 'test', dimensions: 128 });
    await p.dispose(); // should not throw
  });
});

describe('createProvider', () => {
  it('throws on unknown provider', async () => {
    await assert.rejects(
      () => createProvider({ embedding: { provider: 'unknown', model: 'x', dimensions: 128 } }),
      /Unknown embedding provider/
    );
  });

  // Note: actual provider creation tests require dependencies to be installed
  // and/or external services running. Those are integration tests.
});
