import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { estimateTokens, truncateToTokens, generateSnippet } from '../src/utils/text-budget.js';
import { kmeans } from '../src/rag/kmeans.js';
import { IndexManager } from '../src/rag/index-manager.js';
import {
  extractTopTerms,
  adaptiveThreshold,
  chunkByHeaders,
  semanticSearch,
  findRelated,
  retrieveForRAG,
  discoverPatterns,
} from '../src/rag/semantic-search.js';

// ========== Token utilities ==========

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
  });

  it('returns reasonable estimates', () => {
    const tokens = estimateTokens('Hello world, this is a test.');
    assert.ok(tokens > 0);
    assert.ok(tokens < 20);
  });

  it('respects custom charsPerToken', () => {
    const text = 'abcdefghij'; // 10 chars
    assert.equal(estimateTokens(text, 5), 2);
    assert.equal(estimateTokens(text, 10), 1);
  });
});

describe('truncateToTokens', () => {
  it('returns full text when within budget', () => {
    const text = 'short text';
    assert.equal(truncateToTokens(text, 100), text);
  });

  it('truncates at newline boundary', () => {
    const text = 'line one\nline two\nline three\nline four';
    const result = truncateToTokens(text, 5, 3); // 15 chars budget
    assert.ok(result.length <= 15);
    assert.ok(!result.endsWith('\n'));
    assert.ok(result.includes('line one'));
  });

  it('returns empty for null input', () => {
    assert.equal(truncateToTokens(null, 100), '');
  });
});

describe('generateSnippet', () => {
  it('returns empty for null/empty input', () => {
    assert.equal(generateSnippet(''), '');
    assert.equal(generateSnippet(null), '');
  });

  it('strips markdown headers', () => {
    const content = '# Title\nSome body text here.';
    const snippet = generateSnippet(content);
    assert.ok(!snippet.includes('# Title'));
    assert.ok(snippet.includes('Some body text'));
  });

  it('truncates long content with ellipsis', () => {
    const long = 'a'.repeat(300);
    const snippet = generateSnippet(long, 100);
    assert.ok(snippet.length <= 104); // 100 + '...'
    assert.ok(snippet.endsWith('...'));
  });

  it('returns short content as-is', () => {
    const text = 'Just a short note.';
    assert.equal(generateSnippet(text), text);
  });
});

// ========== K-means ==========

describe('kmeans', () => {
  it('clusters clearly separable vectors', () => {
    const vectors = [
      // Cluster A: near [1,0]
      [1, 0.1], [1, 0.2], [0.9, 0],
      // Cluster B: near [0,1]
      [0.1, 1], [0.2, 1], [0, 0.9],
    ];
    const { assignments } = kmeans(vectors, 2);
    assert.equal(assignments.length, 6);
    // First 3 should be same cluster, last 3 same cluster
    assert.equal(assignments[0], assignments[1]);
    assert.equal(assignments[1], assignments[2]);
    assert.equal(assignments[3], assignments[4]);
    assert.equal(assignments[4], assignments[5]);
    assert.notEqual(assignments[0], assignments[3]);
  });

  it('handles empty input', () => {
    const { assignments, centroids } = kmeans([], 3);
    assert.deepEqual(assignments, []);
    assert.deepEqual(centroids, []);
  });

  it('handles k >= n', () => {
    const vectors = [[1, 0], [0, 1]];
    const { assignments } = kmeans(vectors, 5);
    assert.equal(assignments.length, 2);
  });

  it('handles k = 1', () => {
    const vectors = [[1, 0], [0, 1], [1, 1]];
    const { assignments } = kmeans(vectors, 1);
    assert.ok(assignments.every(a => a === 0));
  });

  it('converges within max iterations', () => {
    const vectors = Array.from({ length: 20 }, (_, i) => [
      i < 10 ? 1 + Math.random() * 0.1 : -1 + Math.random() * 0.1,
      i < 10 ? 1 + Math.random() * 0.1 : -1 + Math.random() * 0.1,
    ]);
    const { assignments } = kmeans(vectors, 2, 10);
    assert.equal(assignments.length, 20);
  });
});

// ========== IndexManager extensions ==========

describe('IndexManager vector access', () => {
  let tmpDir;
  const dims = 4;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-idx-adv-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getVector returns vector for known UUID', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    const v = [1, 0, 0, 0];
    mgr.addPoint('uuid-a', v);

    const result = mgr.getVector('uuid-a');
    assert.ok(result);
    assert.equal(result.length, dims);
    // Should be close to original (may have floating point differences)
    assert.ok(Math.abs(result[0] - 1) < 0.01);
  });

  it('getVector returns null for unknown UUID', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    assert.equal(mgr.getVector('nonexistent'), null);
  });

  it('getAllVectors returns all indexed vectors', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    mgr.addPoint('uuid-1', [1, 0, 0, 0]);
    mgr.addPoint('uuid-2', [0, 1, 0, 0]);
    mgr.addPoint('uuid-3', [0, 0, 1, 0]);

    const all = mgr.getAllVectors();
    assert.equal(all.length, 3);
    const uuids = new Set(all.map(v => v.uuid));
    assert.ok(uuids.has('uuid-1'));
    assert.ok(uuids.has('uuid-2'));
    assert.ok(uuids.has('uuid-3'));
  });

  it('getAllVectors excludes removed points', () => {
    const mgr = new IndexManager(tmpDir);
    mgr.initEmpty(dims);
    mgr.addPoint('uuid-1', [1, 0, 0, 0]);
    mgr.addPoint('uuid-2', [0, 1, 0, 0]);
    mgr.removePoint('uuid-1');

    const all = mgr.getAllVectors();
    assert.equal(all.length, 1);
    assert.equal(all[0].uuid, 'uuid-2');
  });
});

// ========== Helpers ==========

describe('extractTopTerms', () => {
  it('extracts frequent terms from titles', () => {
    const titles = [
      'JavaScript Best Practices',
      'JavaScript Testing Guide',
      'JavaScript Performance Tips',
    ];
    const terms = extractTopTerms(titles);
    assert.ok(terms.includes('javascript'));
    assert.ok(terms.length <= 5);
  });

  it('excludes stop words', () => {
    const titles = ['The art of the deal', 'A guide to the best'];
    const terms = extractTopTerms(titles);
    assert.ok(!terms.includes('the'));
    assert.ok(!terms.includes('a'));
    assert.ok(!terms.includes('to'));
  });
});

describe('adaptiveThreshold', () => {
  it('returns requestedMin when results are empty', () => {
    assert.equal(adaptiveThreshold([], 0.3), 0.3);
  });

  it('raises threshold based on median', () => {
    const results = [
      { similarity: 0.9 },
      { similarity: 0.8 },
      { similarity: 0.7 },
      { similarity: 0.2 },
      { similarity: 0.1 },
    ];
    const threshold = adaptiveThreshold(results, 0.1);
    assert.ok(threshold >= 0.1);
  });

  it('never goes below requestedMin', () => {
    const results = [{ similarity: 0.05 }, { similarity: 0.03 }];
    const threshold = adaptiveThreshold(results, 0.3);
    assert.ok(threshold >= 0.3);
  });
});

describe('chunkByHeaders', () => {
  it('splits at ## headers', () => {
    const section1 = '## Section 1\n' + 'Content one. '.repeat(30);
    const section2 = '## Section 2\n' + 'Content two. '.repeat(30);
    const content = section1 + '\n' + section2;
    const chunks = chunkByHeaders(content, 50);
    assert.ok(chunks.length >= 2, `Expected >=2 chunks, got ${chunks.length}`);
    assert.ok(chunks[0].includes('Section 1'));
  });

  it('handles content without headers', () => {
    const content = 'Just plain text without any headers at all.';
    const chunks = chunkByHeaders(content);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], content);
  });

  it('merges small sections', () => {
    const content = '## A\nHi\n## B\nBye';
    const chunks = chunkByHeaders(content, 1000);
    // Both sections fit in one chunk
    assert.equal(chunks.length, 1);
  });

  it('returns array with content for empty-ish input', () => {
    assert.deepEqual(chunkByHeaders(''), []);
    assert.deepEqual(chunkByHeaders(null), []);
  });
});

// ========== Enhanced semantic search (mocks) ==========

function createMockProvider(embedFn) {
  return { embed: embedFn || (async () => [1, 0, 0, 0]) };
}

function createMockIndexManager(searchResults, vectors = {}) {
  return {
    search: () => searchResults,
    getVector: (uuid) => vectors[uuid] || null,
    getAllVectors: () => Object.entries(vectors).map(([uuid, vector]) => ({ uuid, vector })),
  };
}

function createMockDb(notes = [], tagUuids = new Set()) {
  const noteMap = new Map(notes.map(n => [n.id, n]));
  return {
    getNotesByIds: (ids) => ids.map(id => noteMap.get(id)).filter(Boolean),
    getNoteById: (id) => {
      const n = noteMap.get(id);
      if (!n) throw new Error('Note not found');
      return n;
    },
    getNoteByTitle: (title) => {
      const n = notes.find(x => x.title === title);
      if (!n) throw new Error('Note not found');
      return n;
    },
    searchNotesByKeyword: (query, limit) => notes.slice(0, limit),
    getNoteUuidsByTag: () => tagUuids,
  };
}

describe('semanticSearch (enhanced)', () => {
  it('respects minSimilarity', async () => {
    const searchResults = [
      { noteUuid: 'a', similarity: 0.9 },
      { noteUuid: 'b', similarity: 0.5 },
      { noteUuid: 'c', similarity: 0.1 },
    ];
    const notes = [
      { id: 'a', title: 'Note A', content: 'Content A', tags: [] },
      { id: 'b', title: 'Note B', content: 'Content B', tags: [] },
      { id: 'c', title: 'Note C', content: 'Content C', tags: [] },
    ];
    const provider = createMockProvider();
    const indexManager = createMockIndexManager(searchResults);
    const db = createMockDb(notes);

    const results = await semanticSearch(provider, indexManager, db, 'test', {
      minSimilarity: 0.4,
    });
    assert.ok(results.every(n => n.score >= 0.4));
  });

  it('applies tagFilter', async () => {
    const searchResults = [
      { noteUuid: 'a', similarity: 0.9 },
      { noteUuid: 'b', similarity: 0.8 },
    ];
    const notes = [
      { id: 'a', title: 'Note A', content: 'Content A', tags: ['work'] },
      { id: 'b', title: 'Note B', content: 'Content B', tags: ['personal'] },
    ];
    const provider = createMockProvider();
    const indexManager = createMockIndexManager(searchResults);
    const db = createMockDb(notes);

    const results = await semanticSearch(provider, indexManager, db, 'test', {
      tagFilter: 'work',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'a');
  });

  it('returns empty array when no results', async () => {
    const provider = createMockProvider();
    const indexManager = createMockIndexManager([]);
    const db = createMockDb([]);

    const results = await semanticSearch(provider, indexManager, db, 'test');
    assert.deepEqual(results, []);
  });
});

describe('findRelated', () => {
  it('excludes the source note', async () => {
    const searchResults = [
      { noteUuid: 'source', similarity: 1.0 },
      { noteUuid: 'related-1', similarity: 0.8 },
      { noteUuid: 'related-2', similarity: 0.6 },
    ];
    const notes = [
      { id: 'source', title: 'Source', content: 'Source content', tags: ['tag1'] },
      { id: 'related-1', title: 'Related 1', content: 'Related content 1', tags: ['tag1', 'tag2'] },
      { id: 'related-2', title: 'Related 2', content: 'Related content 2', tags: ['tag3'] },
    ];
    const vectors = { source: [1, 0, 0, 0] };
    const provider = createMockProvider();
    const indexManager = createMockIndexManager(searchResults, vectors);
    const db = createMockDb(notes);

    const related = await findRelated(provider, indexManager, db, {
      id: 'source', limit: 5,
    });
    assert.ok(related.every(r => r.id !== 'source'));
    assert.equal(related.length, 2);
  });

  it('computes shared tags', async () => {
    const searchResults = [
      { noteUuid: 'source', similarity: 1.0 },
      { noteUuid: 'related', similarity: 0.8 },
    ];
    const notes = [
      { id: 'source', title: 'Source', content: 'Content', tags: ['shared', 'unique-a'] },
      { id: 'related', title: 'Related', content: 'Content', tags: ['shared', 'unique-b'] },
    ];
    const vectors = { source: [1, 0, 0, 0] };
    const provider = createMockProvider();
    const indexManager = createMockIndexManager(searchResults, vectors);
    const db = createMockDb(notes);

    const related = await findRelated(provider, indexManager, db, { id: 'source' });
    assert.deepEqual(related[0].shared_tags, ['shared']);
  });

  it('throws when note not indexed', async () => {
    const provider = createMockProvider();
    const indexManager = createMockIndexManager([], {});
    const db = createMockDb([{ id: 'x', title: 'X', content: '', tags: [] }]);

    await assert.rejects(
      () => findRelated(provider, indexManager, db, { id: 'x' }),
      /not indexed/
    );
  });
});

describe('retrieveForRAG (enhanced)', () => {
  it('respects maxTokens budget', async () => {
    const searchResults = [
      { noteUuid: 'a', similarity: 0.9 },
      { noteUuid: 'b', similarity: 0.8 },
    ];
    const longContent = 'word '.repeat(500); // ~2500 chars ≈ 714 tokens
    const notes = [
      { id: 'a', title: 'Note A', content: longContent, tags: ['test'], modification_date: '2024-01-01', score: 0.9 },
      { id: 'b', title: 'Note B', content: longContent, tags: ['test'], modification_date: '2024-01-02', score: 0.8 },
    ];
    const provider = createMockProvider();
    const indexManager = createMockIndexManager(searchResults);
    const db = createMockDb(notes);

    const result = await retrieveForRAG(provider, indexManager, db, 'test', {
      maxTokens: 300,
    });
    assert.ok(result.context_text);
    assert.ok(result.sources.length >= 1);
    // Context should be constrained (not contain full content of both notes)
    assert.ok(estimateTokens(result.context_text) < 1000);
  });

  it('includes metadata when requested', async () => {
    const searchResults = [{ noteUuid: 'a', similarity: 0.9 }];
    const notes = [
      { id: 'a', title: 'Note A', content: 'Body text', tags: ['dev'], modification_date: '2024-01-01', score: 0.9 },
    ];
    const provider = createMockProvider();
    const indexManager = createMockIndexManager(searchResults);
    const db = createMockDb(notes);

    const withMeta = await retrieveForRAG(provider, indexManager, db, 'test', {
      includeMetadata: true,
    });
    assert.ok(withMeta.context_text.includes('**ID:**'));
    assert.ok(withMeta.context_text.includes('**Tags:**'));

    const withoutMeta = await retrieveForRAG(provider, indexManager, db, 'test', {
      includeMetadata: false,
    });
    assert.ok(!withoutMeta.context_text.includes('**ID:**'));
  });

  it('returns structured result with sources', async () => {
    const searchResults = [{ noteUuid: 'a', similarity: 0.9 }];
    const notes = [
      { id: 'a', title: 'Note A', content: 'Body', tags: [], score: 0.9 },
    ];
    const provider = createMockProvider();
    const indexManager = createMockIndexManager(searchResults);
    const db = createMockDb(notes);

    const result = await retrieveForRAG(provider, indexManager, db, 'test');
    assert.ok(result.context_text);
    assert.ok(Array.isArray(result.sources));
    assert.equal(result.sources[0].id, 'a');
    assert.equal(typeof result.total_notes_searched, 'number');
  });
});

describe('discoverPatterns', () => {
  it('returns correct cluster structure', () => {
    const vectors = {
      'a': [1, 0], 'b': [1, 0.1], 'c': [0.9, 0],
      'd': [0, 1], 'e': [0.1, 1], 'f': [0, 0.9],
    };
    const notes = [
      { id: 'a', title: 'JavaScript Guide', content: 'JS content', tags: [] },
      { id: 'b', title: 'JavaScript Tips', content: 'JS tips', tags: [] },
      { id: 'c', title: 'JavaScript Patterns', content: 'JS patterns', tags: [] },
      { id: 'd', title: 'Python Tutorial', content: 'Py content', tags: [] },
      { id: 'e', title: 'Python Guide', content: 'Py guide', tags: [] },
      { id: 'f', title: 'Python Tips', content: 'Py tips', tags: [] },
    ];
    const indexManager = createMockIndexManager([], vectors);
    const db = createMockDb(notes);

    // discoverPatterns is async but our mock db is sync-safe
    return discoverPatterns(indexManager, db, { numClusters: 2 }).then(result => {
      assert.ok(result.clusters);
      assert.ok(result.clusters.length <= 2);
      assert.equal(result.total_notes, 6);
      for (const cluster of result.clusters) {
        assert.ok(cluster.size > 0);
        assert.ok(Array.isArray(cluster.top_terms));
        assert.ok(Array.isArray(cluster.representative_notes));
      }
    });
  });

  it('handles empty vectors', () => {
    const indexManager = createMockIndexManager([], {});
    const db = createMockDb([]);
    return discoverPatterns(indexManager, db).then(result => {
      assert.deepEqual(result.clusters, []);
    });
  });
});
