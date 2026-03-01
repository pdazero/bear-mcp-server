import { getDatabase } from './connection.js';
import { TABLES, COLUMNS, CORE_DATA_EPOCH_OFFSET, coreDataToISO } from './schema.js';

// Prepared statement cache (lazily initialized per database instance)
const stmtCache = new Map();

function stmt(key, sql) {
  if (!stmtCache.has(key)) {
    stmtCache.set(key, getDatabase().prepare(sql));
  }
  return stmtCache.get(key);
}

export function clearStatementCache() {
  stmtCache.clear();
}

// -- Tag queries --

const TAGS_FOR_NOTE_SQL = `
  SELECT ZT.${COLUMNS.TAG_TITLE} AS tag_name
  FROM ${TABLES.NOTE_TAG_JOIN} J
  JOIN ${TABLES.TAG} ZT ON ZT.${COLUMNS.TAG_PK} = J.${COLUMNS.JOIN_TAG_FK}
  JOIN ${TABLES.NOTE} ZN ON ZN.${COLUMNS.NOTE_PK} = J.${COLUMNS.JOIN_NOTE_FK}
  WHERE ZN.${COLUMNS.NOTE_UUID} = ?
`;

export function getTagsForNote(uuid) {
  const rows = stmt('tagsForNote', TAGS_FOR_NOTE_SQL).all(uuid);
  return rows.map(r => r.tag_name);
}

export function getAllTags() {
  const rows = stmt('allTagsWithCounts', `
    SELECT ZT.${COLUMNS.TAG_TITLE} AS name, COUNT(J.${COLUMNS.JOIN_NOTE_FK}) AS note_count
    FROM ${TABLES.TAG} ZT
    LEFT JOIN ${TABLES.NOTE_TAG_JOIN} J ON J.${COLUMNS.JOIN_TAG_FK} = ZT.${COLUMNS.TAG_PK}
    LEFT JOIN ${TABLES.NOTE} ZN ON ZN.${COLUMNS.NOTE_PK} = J.${COLUMNS.JOIN_NOTE_FK}
      AND ZN.${COLUMNS.NOTE_TRASHED} = 0
    GROUP BY ZT.${COLUMNS.TAG_PK}
    ORDER BY name
  `).all();
  return rows;
}

// -- Note columns --

const NOTE_COLUMNS = `
  ${COLUMNS.NOTE_UUID} AS id,
  ${COLUMNS.NOTE_TITLE} AS title,
  ${COLUMNS.NOTE_TEXT} AS content,
  ${COLUMNS.NOTE_SUBTITLE} AS subtitle,
  ${COLUMNS.NOTE_CREATION_DATE} AS creation_date,
  ${COLUMNS.NOTE_MODIFICATION_DATE} AS modification_date,
  ${COLUMNS.NOTE_PINNED} AS pinned,
  ${COLUMNS.NOTE_TRASHED} AS is_trashed,
  ${COLUMNS.NOTE_ARCHIVED} AS is_archived,
  ${COLUMNS.NOTE_HAS_FILES} AS has_files,
  ${COLUMNS.NOTE_HAS_IMAGES} AS has_images,
  ${COLUMNS.NOTE_TODO_COMPLETED} AS completed_todos,
  ${COLUMNS.NOTE_TODO_INCOMPLETED} AS pending_todos,
  ${COLUMNS.NOTE_ENCRYPTED} AS is_encrypted
`;

// Summary columns (no content) for list results
const NOTE_SUMMARY_COLUMNS = `
  ${COLUMNS.NOTE_UUID} AS id,
  ${COLUMNS.NOTE_TITLE} AS title,
  ${COLUMNS.NOTE_SUBTITLE} AS subtitle,
  ${COLUMNS.NOTE_CREATION_DATE} AS creation_date,
  ${COLUMNS.NOTE_MODIFICATION_DATE} AS modification_date,
  ${COLUMNS.NOTE_PINNED} AS pinned
`;

function enrichNote(note) {
  if (!note) return null;
  note.creation_date = coreDataToISO(note.creation_date);
  note.modification_date = coreDataToISO(note.modification_date);
  note.tags = getTagsForNote(note.id);
  note.pinned = !!note.pinned;
  if ('is_trashed' in note) note.is_trashed = !!note.is_trashed;
  if ('is_archived' in note) note.is_archived = !!note.is_archived;
  if ('has_files' in note) note.has_files = !!note.has_files;
  if ('has_images' in note) note.has_images = !!note.has_images;
  if ('is_encrypted' in note) note.is_encrypted = !!note.is_encrypted;
  return note;
}

function enrichSummary(note) {
  if (!note) return null;
  note.creation_date = coreDataToISO(note.creation_date);
  note.modification_date = coreDataToISO(note.modification_date);
  note.pinned = !!note.pinned;
  note.tags = getTagsForNote(note.id);
  return note;
}

// -- Single note queries --

export function getNoteById(id) {
  const note = stmt('noteById', `
    SELECT ${NOTE_COLUMNS}
    FROM ${TABLES.NOTE}
    WHERE ${COLUMNS.NOTE_UUID} = ? AND ${COLUMNS.NOTE_TRASHED} = 0
  `).get(id);

  if (!note) throw new Error('Note not found');
  return enrichNote(note);
}

export function getNoteByTitle(title) {
  const note = stmt('noteByTitle', `
    SELECT ${NOTE_COLUMNS}
    FROM ${TABLES.NOTE}
    WHERE ${COLUMNS.NOTE_TITLE} = ? AND ${COLUMNS.NOTE_TRASHED} = 0
    ORDER BY ${COLUMNS.NOTE_MODIFICATION_DATE} DESC
    LIMIT 1
  `).get(title);

  if (!note) throw new Error('Note not found');
  return enrichNote(note);
}

// -- Search --

export function searchNotesByKeyword(query, limit = 20, { tag, sortBy = 'modified', excludeTrashed = true } = {}) {
  const pattern = `%${query}%`;
  const trashedFilter = excludeTrashed ? `AND N.${COLUMNS.NOTE_TRASHED} = 0` : '';

  let orderClause;
  switch (sortBy) {
    case 'created':
      orderClause = `N.${COLUMNS.NOTE_CREATION_DATE} DESC`;
      break;
    case 'modified':
    default:
      orderClause = `N.${COLUMNS.NOTE_MODIFICATION_DATE} DESC`;
      break;
  }

  if (tag) {
    const notes = getDatabase().prepare(`
      SELECT ${NOTE_SUMMARY_COLUMNS.replace(/\b(${COLUMNS.NOTE_UUID}|${COLUMNS.NOTE_TITLE}|${COLUMNS.NOTE_SUBTITLE}|${COLUMNS.NOTE_CREATION_DATE}|${COLUMNS.NOTE_MODIFICATION_DATE}|${COLUMNS.NOTE_PINNED})\b/g, 'N.$1')}
      FROM ${TABLES.NOTE} N
      JOIN ${TABLES.NOTE_TAG_JOIN} J ON J.${COLUMNS.JOIN_NOTE_FK} = N.${COLUMNS.NOTE_PK}
      JOIN ${TABLES.TAG} T ON T.${COLUMNS.TAG_PK} = J.${COLUMNS.JOIN_TAG_FK}
      WHERE T.${COLUMNS.TAG_TITLE} = ?
        AND (N.${COLUMNS.NOTE_TITLE} LIKE ? OR N.${COLUMNS.NOTE_TEXT} LIKE ?)
        ${trashedFilter}
      ORDER BY ${orderClause.replace(/\bN\./, 'N.')}
      LIMIT ?
    `).all(tag, pattern, pattern, limit);
    return notes.map(enrichSummary);
  }

  const notes = stmt(`keywordSearch_${sortBy}_${excludeTrashed}`, `
    SELECT ${NOTE_SUMMARY_COLUMNS}
    FROM ${TABLES.NOTE} N
    WHERE (N.${COLUMNS.NOTE_TITLE} LIKE ? OR N.${COLUMNS.NOTE_TEXT} LIKE ?)
      ${trashedFilter}
    ORDER BY ${orderClause}
    LIMIT ?
  `).all(pattern, pattern, limit);
  return notes.map(enrichSummary);
}

// -- Notes by tag --

export function getNotesForTag(tagName, limit = 50) {
  const notes = stmt('notesForTag', `
    SELECT
      N.${COLUMNS.NOTE_UUID} AS id,
      N.${COLUMNS.NOTE_TITLE} AS title,
      N.${COLUMNS.NOTE_SUBTITLE} AS subtitle,
      N.${COLUMNS.NOTE_CREATION_DATE} AS creation_date,
      N.${COLUMNS.NOTE_MODIFICATION_DATE} AS modification_date,
      N.${COLUMNS.NOTE_PINNED} AS pinned
    FROM ${TABLES.NOTE} N
    JOIN ${TABLES.NOTE_TAG_JOIN} J ON J.${COLUMNS.JOIN_NOTE_FK} = N.${COLUMNS.NOTE_PK}
    JOIN ${TABLES.TAG} T ON T.${COLUMNS.TAG_PK} = J.${COLUMNS.JOIN_TAG_FK}
    WHERE T.${COLUMNS.TAG_TITLE} = ? AND N.${COLUMNS.NOTE_TRASHED} = 0
    ORDER BY N.${COLUMNS.NOTE_MODIFICATION_DATE} DESC
    LIMIT ?
  `).all(tagName, limit);
  return notes.map(enrichSummary);
}

// -- Untagged notes --

export function getUntaggedNotes(limit = 50) {
  const notes = stmt('untaggedNotes', `
    SELECT ${NOTE_SUMMARY_COLUMNS}
    FROM ${TABLES.NOTE} N
    WHERE N.${COLUMNS.NOTE_TRASHED} = 0
      AND N.${COLUMNS.NOTE_PK} NOT IN (
        SELECT J.${COLUMNS.JOIN_NOTE_FK} FROM ${TABLES.NOTE_TAG_JOIN} J
      )
    ORDER BY N.${COLUMNS.NOTE_MODIFICATION_DATE} DESC
    LIMIT ?
  `).all(limit);
  return notes.map(enrichSummary);
}

// -- Todo notes --

export function getTodoNotes(search, limit = 50) {
  if (search) {
    const pattern = `%${search}%`;
    const notes = stmt('todoNotesSearch', `
      SELECT
        ${COLUMNS.NOTE_UUID} AS id,
        ${COLUMNS.NOTE_TITLE} AS title,
        ${COLUMNS.NOTE_SUBTITLE} AS subtitle,
        ${COLUMNS.NOTE_MODIFICATION_DATE} AS modification_date,
        ${COLUMNS.NOTE_PINNED} AS pinned,
        ${COLUMNS.NOTE_TODO_COMPLETED} AS completed_todos,
        ${COLUMNS.NOTE_TODO_INCOMPLETED} AS pending_todos
      FROM ${TABLES.NOTE}
      WHERE ${COLUMNS.NOTE_TRASHED} = 0
        AND (${COLUMNS.NOTE_TODO_COMPLETED} > 0 OR ${COLUMNS.NOTE_TODO_INCOMPLETED} > 0)
        AND (${COLUMNS.NOTE_TITLE} LIKE ? OR ${COLUMNS.NOTE_TEXT} LIKE ?)
      ORDER BY ${COLUMNS.NOTE_MODIFICATION_DATE} DESC
      LIMIT ?
    `).all(pattern, pattern, limit);
    return notes.map(n => {
      n.modification_date = coreDataToISO(n.modification_date);
      n.pinned = !!n.pinned;
      n.tags = getTagsForNote(n.id);
      return n;
    });
  }

  const notes = stmt('todoNotes', `
    SELECT
      ${COLUMNS.NOTE_UUID} AS id,
      ${COLUMNS.NOTE_TITLE} AS title,
      ${COLUMNS.NOTE_SUBTITLE} AS subtitle,
      ${COLUMNS.NOTE_MODIFICATION_DATE} AS modification_date,
      ${COLUMNS.NOTE_PINNED} AS pinned,
      ${COLUMNS.NOTE_TODO_COMPLETED} AS completed_todos,
      ${COLUMNS.NOTE_TODO_INCOMPLETED} AS pending_todos
    FROM ${TABLES.NOTE}
    WHERE ${COLUMNS.NOTE_TRASHED} = 0
      AND (${COLUMNS.NOTE_TODO_COMPLETED} > 0 OR ${COLUMNS.NOTE_TODO_INCOMPLETED} > 0)
    ORDER BY ${COLUMNS.NOTE_MODIFICATION_DATE} DESC
    LIMIT ?
  `).all(limit);
  return notes.map(n => {
    n.modification_date = coreDataToISO(n.modification_date);
    n.pinned = !!n.pinned;
    n.tags = getTagsForNote(n.id);
    return n;
  });
}

// -- Today's notes --

export function getTodayNotes(search) {
  // Today's start in Core Data timestamp
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const coreDataToday = (todayStart.getTime() / 1000) - CORE_DATA_EPOCH_OFFSET;

  if (search) {
    const pattern = `%${search}%`;
    const notes = getDatabase().prepare(`
      SELECT ${NOTE_SUMMARY_COLUMNS}
      FROM ${TABLES.NOTE} N
      WHERE N.${COLUMNS.NOTE_TRASHED} = 0
        AND N.${COLUMNS.NOTE_MODIFICATION_DATE} >= ?
        AND (N.${COLUMNS.NOTE_TITLE} LIKE ? OR N.${COLUMNS.NOTE_TEXT} LIKE ?)
      ORDER BY N.${COLUMNS.NOTE_MODIFICATION_DATE} DESC
    `).all(coreDataToday, pattern, pattern);
    return notes.map(enrichSummary);
  }

  const notes = getDatabase().prepare(`
    SELECT ${NOTE_SUMMARY_COLUMNS}
    FROM ${TABLES.NOTE} N
    WHERE N.${COLUMNS.NOTE_TRASHED} = 0
      AND N.${COLUMNS.NOTE_MODIFICATION_DATE} >= ?
    ORDER BY N.${COLUMNS.NOTE_MODIFICATION_DATE} DESC
  `).all(coreDataToday);
  return notes.map(enrichSummary);
}

// -- Backlinks --

export function getBacklinks(id, title) {
  // If id is given, resolve the title first
  let noteTitle = title;
  if (id && !title) {
    const note = stmt('noteTitleById', `
      SELECT ${COLUMNS.NOTE_TITLE} AS title
      FROM ${TABLES.NOTE}
      WHERE ${COLUMNS.NOTE_UUID} = ?
    `).get(id);
    if (!note) throw new Error('Note not found');
    noteTitle = note.title;
  }
  if (!noteTitle) throw new Error('Either id or title is required');

  // Search for [[title]] wiki-links in other notes
  const pattern = `%[[${noteTitle}]]%`;
  const notes = stmt('backlinks', `
    SELECT
      ${COLUMNS.NOTE_UUID} AS id,
      ${COLUMNS.NOTE_TITLE} AS title,
      ${COLUMNS.NOTE_SUBTITLE} AS subtitle,
      ${COLUMNS.NOTE_MODIFICATION_DATE} AS modification_date
    FROM ${TABLES.NOTE}
    WHERE ${COLUMNS.NOTE_TRASHED} = 0
      AND ${COLUMNS.NOTE_TEXT} LIKE ?
      AND ${COLUMNS.NOTE_TITLE} != ?
    ORDER BY ${COLUMNS.NOTE_MODIFICATION_DATE} DESC
  `).all(pattern, noteTitle);

  return notes.map(n => {
    n.modification_date = coreDataToISO(n.modification_date);
    return n;
  });
}

// -- Database stats --

export function getDbStats(indexManager) {
  const totalNotes = stmt('countNotes', `
    SELECT COUNT(*) AS count FROM ${TABLES.NOTE} WHERE ${COLUMNS.NOTE_TRASHED} = 0
  `).get().count;

  const trashedNotes = stmt('countTrashed', `
    SELECT COUNT(*) AS count FROM ${TABLES.NOTE} WHERE ${COLUMNS.NOTE_TRASHED} = 1
  `).get().count;

  const archivedNotes = stmt('countArchived', `
    SELECT COUNT(*) AS count FROM ${TABLES.NOTE} WHERE ${COLUMNS.NOTE_ARCHIVED} = 1 AND ${COLUMNS.NOTE_TRASHED} = 0
  `).get().count;

  const totalTags = stmt('countTags', `
    SELECT COUNT(*) AS count FROM ${TABLES.TAG}
  `).get().count;

  const notesWithFiles = stmt('countFiles', `
    SELECT COUNT(*) AS count FROM ${TABLES.NOTE}
    WHERE ${COLUMNS.NOTE_HAS_FILES} = 1 AND ${COLUMNS.NOTE_TRASHED} = 0
  `).get().count;

  const stats = {
    total_notes: totalNotes,
    trashed_notes: trashedNotes,
    archived_notes: archivedNotes,
    total_tags: totalTags,
    notes_with_files: notesWithFiles,
  };

  if (indexManager) {
    stats.index_status = {
      indexed_notes: indexManager.size,
      is_loaded: indexManager.isLoaded,
    };
  }

  return stats;
}

// -- Bulk queries for indexing --

export function getNotesByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const notes = getDatabase().prepare(`
    SELECT ${NOTE_COLUMNS}
    FROM ${TABLES.NOTE}
    WHERE ${COLUMNS.NOTE_UUID} IN (${placeholders}) AND ${COLUMNS.NOTE_TRASHED} = 0
    ORDER BY ${COLUMNS.NOTE_MODIFICATION_DATE} DESC
  `).all(...ids);

  return notes.map(enrichNote);
}

export function getAllNotesForIndexing() {
  return stmt('allNotes', `
    SELECT
      ${COLUMNS.NOTE_UUID} AS id,
      ${COLUMNS.NOTE_TITLE} AS title,
      ${COLUMNS.NOTE_TEXT} AS content
    FROM ${TABLES.NOTE}
    WHERE ${COLUMNS.NOTE_TRASHED} = 0 AND ${COLUMNS.NOTE_ENCRYPTED} = 0
  `).all();
}

// Notes modified after a Core Data timestamp, excluding trashed & encrypted
export function getModifiedNotesForIndexing(sinceTimestamp) {
  return getDatabase().prepare(`
    SELECT
      ${COLUMNS.NOTE_UUID} AS id,
      ${COLUMNS.NOTE_TITLE} AS title,
      ${COLUMNS.NOTE_TEXT} AS content,
      ${COLUMNS.NOTE_MODIFICATION_DATE} AS modification_date
    FROM ${TABLES.NOTE}
    WHERE ${COLUMNS.NOTE_MODIFICATION_DATE} > ?
      AND ${COLUMNS.NOTE_TRASHED} = 0
      AND ${COLUMNS.NOTE_ENCRYPTED} = 0
    ORDER BY ${COLUMNS.NOTE_MODIFICATION_DATE} ASC
  `).all(sinceTimestamp);
}

// Given a list of UUIDs, return those that are now trashed
export function getTrashedNoteIds(uuids) {
  if (!uuids.length) return [];

  const results = [];
  // Batch in chunks of 500 to avoid SQLite parameter limit
  for (let i = 0; i < uuids.length; i += 500) {
    const chunk = uuids.slice(i, i + 500);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = getDatabase().prepare(`
      SELECT ${COLUMNS.NOTE_UUID} AS id
      FROM ${TABLES.NOTE}
      WHERE ${COLUMNS.NOTE_UUID} IN (${placeholders})
        AND ${COLUMNS.NOTE_TRASHED} = 1
    `).all(...chunk);
    results.push(...rows.map(r => r.id));
  }
  return results;
}
