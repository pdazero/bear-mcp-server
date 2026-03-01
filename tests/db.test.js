import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

const defaultDBPath = path.join(
  os.homedir(),
  'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite'
);

const dbPath = process.env.BEAR_DATABASE_PATH || defaultDBPath;
const dbExists = fs.existsSync(dbPath);

describe('db queries', { skip: !dbExists && 'Bear database not found' }, () => {
  let queries;

  before(async () => {
    const { openDatabase } = await import('../src/db/connection.js');
    openDatabase(dbPath);
    queries = await import('../src/db/queries.js');
  });

  after(async () => {
    const { closeDatabase } = await import('../src/db/connection.js');
    closeDatabase();
    queries.clearStatementCache();
  });

  // -- Existing tests (updated for Phase 2 signatures) --

  it('getAllTags returns objects with name and note_count', () => {
    const tags = queries.getAllTags();
    assert.ok(Array.isArray(tags));
    assert.ok(tags.length > 0);
    assert.ok(typeof tags[0].name === 'string');
    assert.ok(typeof tags[0].note_count === 'number');
  });

  it('searchNotesByKeyword returns enriched notes', () => {
    const notes = queries.searchNotesByKeyword('the', 3);
    assert.ok(Array.isArray(notes));
    assert.ok(notes.length > 0);
    const note = notes[0];
    assert.ok(note.id);
    assert.ok(note.title !== undefined);
    assert.ok(note.creation_date === null || note.creation_date.includes('T'));
    assert.ok(Array.isArray(note.tags));
    assert.equal(typeof note.pinned, 'boolean');
  });

  it('searchNotesByKeyword supports sort_by created', () => {
    const notes = queries.searchNotesByKeyword('the', 3, { sortBy: 'created' });
    assert.ok(notes.length > 0);
  });

  it('getNoteById returns a note with full metadata', () => {
    const notes = queries.searchNotesByKeyword('the', 1);
    const note = queries.getNoteById(notes[0].id);
    assert.ok(note.id);
    assert.ok(Array.isArray(note.tags));
    assert.ok(note.creation_date === null || note.creation_date.includes('T'));
    assert.equal(typeof note.pinned, 'boolean');
    assert.equal(typeof note.is_trashed, 'boolean');
    assert.equal(typeof note.has_files, 'boolean');
  });

  it('getNoteById throws for missing note', () => {
    assert.throws(() => queries.getNoteById('nonexistent-uuid'), /not found/i);
  });

  it('getNotesByIds returns matching notes', () => {
    const keyword = queries.searchNotesByKeyword('the', 3);
    const ids = keyword.map(n => n.id);
    const notes = queries.getNotesByIds(ids);
    assert.ok(notes.length > 0);
    assert.ok(notes.length <= ids.length);
  });

  it('getAllNotesForIndexing returns raw notes', () => {
    const notes = queries.getAllNotesForIndexing();
    assert.ok(notes.length > 0);
    assert.ok(notes[0].id);
    assert.ok('title' in notes[0]);
    assert.ok('content' in notes[0]);
  });

  // -- Phase 2 new tests --

  it('getNoteByTitle returns a note', () => {
    const keyword = queries.searchNotesByKeyword('the', 1);
    const note = queries.getNoteByTitle(keyword[0].title);
    assert.ok(note.id);
    assert.ok(note.content !== undefined);
  });

  it('getNoteByTitle throws for missing title', () => {
    assert.throws(() => queries.getNoteByTitle('_____nonexistent_title_____'), /not found/i);
  });

  it('getNotesForTag returns notes for a known tag', () => {
    const tags = queries.getAllTags();
    const tagWithNotes = tags.find(t => t.note_count > 0);
    assert.ok(tagWithNotes, 'Expected at least one tag with notes');
    const notes = queries.getNotesForTag(tagWithNotes.name, 5);
    assert.ok(Array.isArray(notes));
    assert.ok(notes.length > 0);
    assert.ok(notes[0].id);
    assert.equal(typeof notes[0].pinned, 'boolean');
  });

  it('getUntaggedNotes returns notes without tags', () => {
    const notes = queries.getUntaggedNotes(5);
    assert.ok(Array.isArray(notes));
    // Each untagged note should have empty tags array
    for (const note of notes) {
      assert.deepEqual(note.tags, []);
    }
  });

  it('getTodoNotes returns notes with todo counts', () => {
    const notes = queries.getTodoNotes(undefined, 5);
    assert.ok(Array.isArray(notes));
    if (notes.length > 0) {
      const note = notes[0];
      assert.ok(typeof note.completed_todos === 'number');
      assert.ok(typeof note.pending_todos === 'number');
      assert.ok(note.completed_todos > 0 || note.pending_todos > 0);
    }
  });

  it('getTodayNotes returns array', () => {
    const notes = queries.getTodayNotes();
    assert.ok(Array.isArray(notes));
    // May or may not have results depending on actual activity today
  });

  it('getBacklinks returns notes linking to a given title', () => {
    // Use a note title that likely exists; backlinks may be empty
    const keyword = queries.searchNotesByKeyword('the', 1);
    const notes = queries.getBacklinks(keyword[0].id);
    assert.ok(Array.isArray(notes));
  });

  it('getBacklinks throws without id or title', () => {
    assert.throws(() => queries.getBacklinks(undefined, undefined), /required/i);
  });

  it('getDbStats returns database statistics', () => {
    const stats = queries.getDbStats(null);
    assert.ok(typeof stats.total_notes === 'number');
    assert.ok(stats.total_notes > 0);
    assert.ok(typeof stats.trashed_notes === 'number');
    assert.ok(typeof stats.archived_notes === 'number');
    assert.ok(typeof stats.total_tags === 'number');
    assert.ok(typeof stats.notes_with_files === 'number');
    assert.equal(stats.index_status, undefined); // no indexManager passed
  });

  it('getDbStats includes index_status when indexManager provided', () => {
    const mockIndexManager = { size: 100, isLoaded: true };
    const stats = queries.getDbStats(mockIndexManager);
    assert.ok(stats.index_status);
    assert.equal(stats.index_status.indexed_notes, 100);
    assert.equal(stats.index_status.is_loaded, true);
  });
});
