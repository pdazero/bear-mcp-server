#!/usr/bin/env node

import { loadConfig } from '../src/config.js';
import { setLogLevel, createLogger } from '../src/utils/logger.js';
import { openDatabase, closeDatabase } from '../src/db/connection.js';
import { getAllNotesForIndexing } from '../src/db/queries.js';
import { createProvider } from '../src/rag/embeddings.js';
import { IndexManager } from '../src/rag/index-manager.js';

const log = createLogger('indexer');

const CHECKPOINT_INTERVAL = 200;

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

  // Try to resume from existing index
  const indexManager = new IndexManager(config.dataDir);
  const resumed = indexManager.load(config.embedding);

  let skipped = 0;
  if (resumed) {
    log.info(`Resuming from existing index with ${indexManager.size} vectors`);
  } else {
    indexManager.initEmpty(config.embedding.dimensions);
  }

  let indexed = 0;
  let empty = 0;
  let errors = 0;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];

    // Skip already-indexed notes when resuming
    if (resumed && indexManager.hasPoint(note.id)) {
      skipped++;
      continue;
    }

    const text = `${note.title || ''}\n${note.content || ''}`.trim();
    if (!text) {
      empty++;
      continue;
    }

    try {
      const vector = await provider.embed(text);
      indexManager.addPoint(note.id, vector);
      indexed++;
    } catch (error) {
      log.warn(`Failed to embed note ${note.id}: ${error.message}`);
      errors++;
    }

    // Checkpoint save
    if (indexed > 0 && indexed % CHECKPOINT_INTERVAL === 0) {
      indexManager.save(config.embedding);
      log.info(`Checkpoint saved at ${indexed} new notes indexed`);
    }

    const processed = skipped + indexed + errors + empty;
    if (processed % 100 === 0 || i === notes.length - 1) {
      log.info(`Progress: ${processed}/${notes.length} (new: ${indexed}, skipped: ${skipped}, empty: ${empty}, errors: ${errors})`);
    }
  }

  // Final save
  indexManager.save(config.embedding);
  log.info(`Indexing complete. ${indexed} new notes indexed, ${skipped} skipped, ${errors} errors. Total: ${indexManager.size} vectors.`);

  // Cleanup
  await provider.dispose();
  closeDatabase();
}

main().catch(error => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
