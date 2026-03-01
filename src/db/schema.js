// Bear Notes Core Data schema constants
// Single file to update if Bear changes its database schema

export const TABLES = {
  NOTE: 'ZSFNOTE',
  TAG: 'ZSFNOTETAG',
  NOTE_TAG_JOIN: 'Z_5TAGS',
};

export const COLUMNS = {
  // ZSFNOTE
  NOTE_PK: 'Z_PK',
  NOTE_UUID: 'ZUNIQUEIDENTIFIER',
  NOTE_TITLE: 'ZTITLE',
  NOTE_TEXT: 'ZTEXT',
  NOTE_SUBTITLE: 'ZSUBTITLE',
  NOTE_CREATION_DATE: 'ZCREATIONDATE',
  NOTE_MODIFICATION_DATE: 'ZMODIFICATIONDATE',
  NOTE_TRASHED: 'ZTRASHED',
  NOTE_PINNED: 'ZPINNED',
  NOTE_ARCHIVED: 'ZARCHIVED',
  NOTE_ENCRYPTED: 'ZENCRYPTED',
  NOTE_HAS_IMAGES: 'ZHASIMAGES',
  NOTE_HAS_FILES: 'ZHASFILES',
  NOTE_LOCKED: 'ZLOCKED',
  NOTE_TODO_COMPLETED: 'ZTODOCOMPLETED',
  NOTE_TODO_INCOMPLETED: 'ZTODOINCOMPLETED',

  // ZSFNOTETAG
  TAG_PK: 'Z_PK',
  TAG_TITLE: 'ZTITLE',

  // Z_5TAGS junction
  JOIN_NOTE_FK: 'Z_5NOTES',
  JOIN_TAG_FK: 'Z_13TAGS',
};

// Apple Core Data epoch: 2001-01-01T00:00:00Z in Unix seconds
export const CORE_DATA_EPOCH_OFFSET = 978307200;

export function coreDataToISO(coreDataTimestamp) {
  if (coreDataTimestamp == null) return null;
  return new Date((coreDataTimestamp + CORE_DATA_EPOCH_OFFSET) * 1000).toISOString();
}
