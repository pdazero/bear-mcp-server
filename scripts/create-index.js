#!/usr/bin/env node

import { loadConfig } from '../src/config.js';
import { setLogLevel, createLogger } from '../src/utils/logger.js';
import { openDatabase, closeDatabase } from '../src/db/connection.js';
import { getAllNotesForIndexing } from '../src/db/queries.js';
import { createProvider } from '../src/rag/embeddings.js';
import { IndexManager } from '../src/rag/index-manager.js';

const log = createLogger('indexer');

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  log.info('Starting vector index creation...');

  // Connect to database
  openDatabase(config.bearDbPath);
  log.info('Database connected');

  // Initialize embedding provider
  const provider = await createProvider(config);
  await provider.healthCheck();
  log.info('Embedding provider ready');

  // Fetch all notes
  const notes = getAllNotesForIndexing();
  log.info(`Found ${notes.length} notes to index`);

  // Create index
  const indexManager = new IndexManager(config.dataDir);
  indexManager.initEmpty(config.embedding.dimensions);

  let indexed = 0;
  let errors = 0;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const text = `${note.title || ''}\n${note.content || ''}`.trim();
    if (!text) continue;

    try {
      const vector = await provider.embed(text);
      indexManager.addPoint(note.id, vector);
      indexed++;
    } catch (error) {
      log.warn(`Failed to embed note ${note.id}: ${error.message}`);
      errors++;
    }

    if ((i + 1) % 100 === 0 || i === notes.length - 1) {
      log.info(`Progress: ${i + 1}/${notes.length} (indexed: ${indexed}, errors: ${errors})`);
    }
  }

  // Save
  indexManager.save(config.embedding);
  log.info(`Indexing complete. ${indexed} notes indexed, ${errors} errors.`);

  // Cleanup
  await provider.dispose();
  closeDatabase();
}

main().catch(error => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
