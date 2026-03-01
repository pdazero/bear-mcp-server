import { createLogger } from '../utils/logger.js';

const log = createLogger('search');

const DEFAULT_MIN_SIMILARITY = 0.1;

export async function semanticSearch(provider, indexManager, db, query, limit = 10) {
  const queryVector = await provider.embed(query);
  const results = indexManager.search(queryVector, limit);

  if (results.length === 0) return [];

  const filtered = results.filter(r => r.similarity >= DEFAULT_MIN_SIMILARITY);
  if (filtered.length === 0) return [];

  const ids = filtered.map(r => r.noteUuid);
  const notes = db.getNotesByIds(ids);

  // Merge similarity scores into notes
  const scoreMap = new Map(filtered.map(r => [r.noteUuid, r.similarity]));
  for (const note of notes) {
    note.score = scoreMap.get(note.id) || 0;
  }

  return notes.sort((a, b) => b.score - a.score);
}

export async function retrieveForRAG(provider, indexManager, db, query, limit = 5) {
  try {
    const notes = await semanticSearch(provider, indexManager, db, query, limit);
    return notes.map(note => ({
      id: note.id,
      title: note.title,
      content: note.content,
      tags: note.tags,
      score: note.score,
    }));
  } catch (error) {
    log.warn('Semantic search failed for RAG, falling back to keyword:', error.message);
    const notes = db.searchNotesByKeyword(query, limit);
    return notes.map(note => ({
      id: note.id,
      title: note.title,
      content: note.content,
      tags: note.tags,
    }));
  }
}
