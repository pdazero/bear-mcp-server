import { createLogger } from '../utils/logger.js';

const log = createLogger('auto-index');

const TRASH_CHECK_INTERVAL = 5; // Check trashed notes every Nth sync cycle

export class AutoIndexer {
  constructor({ db, provider, indexManager, config }) {
    this.db = db;
    this.provider = provider;
    this.indexManager = indexManager;
    this.config = config;
    this.intervalId = null;
    this.running = false;
    this.syncCycle = 0;
    this.lastSync = null;
    this.notesIndexed = 0;
    this.notesRemoved = 0;
    this.errors = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;

    const intervalMs = this.config.autoIndex.intervalSeconds * 1000;
    log.info(`Auto-indexer started (interval: ${this.config.autoIndex.intervalSeconds}s)`);

    // Run initial sync, then start polling
    this.sync().catch(err => log.error('Initial sync failed:', err.message));

    this.intervalId = setInterval(() => {
      this.sync().catch(err => log.error('Sync failed:', err.message));
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    log.info('Auto-indexer stopped');
  }

  async sync() {
    const lastTimestamp = this.indexManager.lastIndexedTimestamp || 0;
    let indexed = 0;
    let removed = 0;
    let errors = 0;

    // 1. Get new/modified notes
    const modifiedNotes = this.db.getModifiedNotesForIndexing(lastTimestamp);
    let maxTimestamp = lastTimestamp;

    // 2. Embed and index each note
    for (const note of modifiedNotes) {
      try {
        const text = `${note.title || ''}\n${note.content || ''}`;
        const vector = await this.provider.embed(text);
        this.indexManager.addPoint(note.id, vector);
        indexed++;

        if (note.modification_date > maxTimestamp) {
          maxTimestamp = note.modification_date;
        }
      } catch (err) {
        log.warn(`Failed to embed note ${note.id}: ${err.message}`);
        errors++;
        // Still advance timestamp past this note if it has a later date
        if (note.modification_date > maxTimestamp) {
          maxTimestamp = note.modification_date;
        }
      }
    }

    // 3. Periodically check for trashed notes
    this.syncCycle++;
    if (this.syncCycle % TRASH_CHECK_INTERVAL === 0) {
      const allUuids = this.indexManager.indexedUuids;
      if (allUuids.length > 0) {
        const trashedIds = this.db.getTrashedNoteIds(allUuids);
        for (const uuid of trashedIds) {
          this.indexManager.removePoint(uuid);
          removed++;
        }
      }
    }

    // 4. Save if there were changes
    if (indexed > 0 || removed > 0) {
      this.indexManager.save(this.config.embedding, { lastIndexedTimestamp: maxTimestamp });
    } else if (maxTimestamp > lastTimestamp) {
      // Timestamp advanced (e.g., all notes errored but we still advance)
      this.indexManager.save(this.config.embedding, { lastIndexedTimestamp: maxTimestamp });
    }

    this.lastSync = new Date();
    this.notesIndexed += indexed;
    this.notesRemoved += removed;
    this.errors += errors;

    if (indexed > 0 || removed > 0 || errors > 0) {
      log.info(`Sync complete: ${indexed} indexed, ${removed} removed, ${errors} errors`);
    }
  }

  getStatus() {
    return {
      running: this.running,
      lastSync: this.lastSync,
      notesIndexed: this.notesIndexed,
      notesRemoved: this.notesRemoved,
      errors: this.errors,
      syncCycle: this.syncCycle,
    };
  }
}
