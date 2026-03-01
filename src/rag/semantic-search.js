import { createLogger } from '../utils/logger.js';
import { estimateTokens, truncateToTokens, generateSnippet } from '../utils/text-budget.js';
import { kmeans } from './kmeans.js';

const log = createLogger('search');

const DEFAULT_MIN_SIMILARITY = 0.1;

// -- Helpers --

const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'it', 'as', 'be', 'was', 'are', 'that',
  'this', 'from', 'not', 'has', 'have', 'had', 'will', 'can', 'do',
  'if', 'my', 'your', 'we', 'they', 'its', 'no', 'so', 'up', 'out',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'o',
  'que', 'es', 'por', 'con', 'para', 'se', 'su', 'al', 'lo', 'como',
  'no', 'más', 'pero', 'sus', 'le', 'ya', 'fue', 'son', 'está',
]);

export function extractTopTerms(titles, count = 5) {
  const freq = new Map();
  for (const title of titles) {
    const words = title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/);
    for (const w of words) {
      if (w.length < 2 || STOP_WORDS.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([term]) => term);
}

export function adaptiveThreshold(results, requestedMin) {
  if (results.length === 0) return requestedMin;
  const sorted = results.map(r => r.similarity).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.max(requestedMin, median * 0.6);
}

export function chunkByHeaders(content, maxTokensPerChunk = 1000) {
  if (!content) return [];

  // Split at ## or ### headers
  const sections = content.split(/(?=^#{2,3}\s)/m);
  const chunks = [];
  let current = '';

  for (const section of sections) {
    const combined = current ? current + '\n' + section : section;
    if (estimateTokens(combined) <= maxTokensPerChunk) {
      current = combined;
    } else {
      if (current) chunks.push(current.trim());
      // If single section exceeds budget, truncate it
      if (estimateTokens(section) > maxTokensPerChunk) {
        current = truncateToTokens(section, maxTokensPerChunk);
      } else {
        current = section;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.length > 0 ? chunks : [content.trim()];
}

// -- Core functions --

export async function semanticSearch(provider, indexManager, db, query, {
  limit = 10,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  tagFilter = null,
} = {}) {
  const queryVector = await provider.embed(query);

  // Over-fetch when filtering by tag since results will be pruned
  const fetchLimit = tagFilter ? limit * 3 : limit;
  const results = indexManager.search(queryVector, fetchLimit);

  if (results.length === 0) return [];

  // Apply adaptive threshold
  const threshold = adaptiveThreshold(results, minSimilarity);
  let filtered = results.filter(r => r.similarity >= threshold);
  if (filtered.length === 0) return [];

  const ids = filtered.map(r => r.noteUuid);
  const notes = db.getNotesByIds(ids);

  // Merge similarity scores
  const scoreMap = new Map(filtered.map(r => [r.noteUuid, r.similarity]));
  for (const note of notes) {
    note.score = scoreMap.get(note.id) || 0;
  }

  // Apply tag filter post-retrieval
  if (tagFilter) {
    const tagLower = tagFilter.toLowerCase();
    const tagFiltered = notes.filter(n =>
      n.tags && n.tags.some(t => t.toLowerCase() === tagLower)
    );
    return tagFiltered.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  return notes.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function findRelated(provider, indexManager, db, { id, title, limit = 10, minSimilarity = 0.4 }) {
  // Resolve UUID
  let uuid = id;
  if (!uuid && title) {
    const note = db.getNoteByTitle(title);
    uuid = note.id;
  }
  if (!uuid) throw new Error('Either id or title is required');

  // Get source note's vector
  const sourceVector = indexManager.getVector(uuid);
  if (!sourceVector) throw new Error('Note not indexed — run indexing first');

  // Search with the source vector
  const results = indexManager.search(sourceVector, limit + 1); // +1 to account for self

  // Exclude the source note and apply threshold
  const filtered = results
    .filter(r => r.noteUuid !== uuid && r.similarity >= minSimilarity);

  if (filtered.length === 0) return [];

  const ids = filtered.map(r => r.noteUuid);
  const notes = db.getNotesByIds(ids);

  // Get source note tags for shared_tags computation
  const sourceNote = db.getNoteById(uuid);
  const sourceTags = new Set(sourceNote.tags || []);

  const scoreMap = new Map(filtered.map(r => [r.noteUuid, r.similarity]));
  return notes
    .map(note => ({
      id: note.id,
      title: note.title,
      similarity_score: scoreMap.get(note.id) || 0,
      shared_tags: (note.tags || []).filter(t => sourceTags.has(t)),
      snippet: generateSnippet(note.content),
    }))
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, limit);
}

export async function retrieveForRAG(provider, indexManager, db, query, {
  limit = 5,
  maxTokens = 4000,
  includeMetadata = true,
} = {}) {
  try {
    const notes = await semanticSearch(provider, indexManager, db, query, { limit });

    if (notes.length === 0) {
      return _keywordFallback(db, query, limit, maxTokens, includeMetadata);
    }

    return _buildRAGContext(notes, maxTokens, includeMetadata);
  } catch (error) {
    log.warn('Semantic search failed for RAG, falling back to keyword:', error.message);
    return _keywordFallback(db, query, limit, maxTokens, includeMetadata);
  }
}

function _buildRAGContext(notes, maxTokens, includeMetadata) {
  const sources = [];
  const parts = [];
  let budgetRemaining = maxTokens;

  for (const note of notes) {
    if (budgetRemaining <= 0) break;

    const content = note.content || '';
    let noteText;

    // For long notes, chunk by headers and pick the best portion
    if (estimateTokens(content) > budgetRemaining) {
      const chunks = chunkByHeaders(content, budgetRemaining);
      noteText = chunks[0] || truncateToTokens(content, budgetRemaining);
    } else {
      noteText = content;
    }

    const header = includeMetadata
      ? `## ${note.title}\n**ID:** ${note.id} | **Tags:** ${(note.tags || []).join(', ') || 'none'} | **Modified:** ${note.modification_date || 'unknown'}\n**Similarity:** ${(note.score || 0).toFixed(3)}\n`
      : `## ${note.title}\n`;

    const section = header + '\n' + noteText;
    const sectionTokens = estimateTokens(section);

    parts.push(section);
    budgetRemaining -= sectionTokens;

    sources.push({
      id: note.id,
      title: note.title,
      similarity: note.score || 0,
      snippet: generateSnippet(note.content),
    });
  }

  return {
    context_text: parts.join('\n\n---\n\n'),
    sources,
    total_notes_searched: notes.length,
  };
}

function _keywordFallback(db, query, limit, maxTokens, includeMetadata) {
  const notes = db.searchNotesByKeyword(query, limit);
  // Assign a zero score for keyword results
  for (const note of notes) {
    note.score = 0;
    // Keyword results may lack full content, fetch if needed
    if (!note.content) {
      try {
        const full = db.getNoteById(note.id);
        note.content = full.content;
        note.tags = full.tags;
        note.modification_date = full.modification_date;
      } catch { /* skip */ }
    }
  }
  return _buildRAGContext(notes, maxTokens, includeMetadata);
}

export async function discoverPatterns(indexManager, db, { numClusters = 8, tagFilter = null } = {}) {
  let vectors = indexManager.getAllVectors();

  // Filter by tag if requested
  if (tagFilter) {
    const tagUuids = db.getNoteUuidsByTag(tagFilter);
    vectors = vectors.filter(v => tagUuids.has(v.uuid));
  }

  if (vectors.length === 0) return { clusters: [] };

  const actualK = Math.min(numClusters, vectors.length);
  const { assignments } = kmeans(vectors.map(v => v.vector), actualK);

  // Group by cluster
  const clusterMap = new Map();
  for (let i = 0; i < assignments.length; i++) {
    const cluster = assignments[i];
    if (!clusterMap.has(cluster)) clusterMap.set(cluster, []);
    clusterMap.get(cluster).push(vectors[i].uuid);
  }

  // Build cluster summaries
  const clusters = [];
  for (const [clusterId, uuids] of clusterMap) {
    const representativeIds = uuids.slice(0, 5);
    const notes = db.getNotesByIds(representativeIds);
    const titles = notes.map(n => n.title);

    clusters.push({
      cluster_id: clusterId,
      size: uuids.length,
      top_terms: extractTopTerms(titles),
      representative_notes: notes.map(n => ({
        id: n.id,
        title: n.title,
        snippet: generateSnippet(n.content),
      })),
    });
  }

  // Sort by cluster size descending
  clusters.sort((a, b) => b.size - a.size);
  return { clusters, total_notes: vectors.length };
}
