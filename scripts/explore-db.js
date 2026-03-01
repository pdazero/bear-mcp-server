#!/usr/bin/env node

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const defaultDBPath = path.join(
  os.homedir(),
  'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite'
);

const dbPath = process.env.BEAR_DATABASE_PATH || defaultDBPath;
console.log(`Examining Bear database at: ${dbPath}`);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
console.log('Connected to Bear Notes database');

try {
  // List all tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log('\n--- All Tables ---');
  tables.forEach(t => console.log(t.name));

  // Junction tables
  const junctionTables = tables.filter(t => t.name.startsWith('Z_') && !t.name.includes('FTS'));
  console.log('\n--- Junction Tables (Z_*) ---');
  junctionTables.forEach(t => console.log(t.name));

  // Tag-related tables schema
  const tagTables = tables.filter(t =>
    t.name.toLowerCase().includes('tag') || t.name.startsWith('Z_')
  );
  console.log('\n--- Tag-Related Table Schemas ---');
  for (const t of tagTables) {
    const schema = db.prepare(`PRAGMA table_info(${t.name})`).all();
    console.log(`\n${t.name}:`);
    schema.forEach(col => console.log(`  ${col.name} (${col.type})`));
  }

  // Note count
  const noteCount = db.prepare('SELECT COUNT(*) AS count FROM ZSFNOTE WHERE ZTRASHED = 0').get();
  console.log(`\n--- Notes: ${noteCount.count} ---`);

  // Tag count
  const tagCount = db.prepare('SELECT COUNT(*) AS count FROM ZSFNOTETAG').get();
  console.log(`--- Tags: ${tagCount.count} ---`);

  // Test the tag query
  const sampleNote = db.prepare('SELECT ZUNIQUEIDENTIFIER AS id FROM ZSFNOTE LIMIT 1').get();
  if (sampleNote) {
    console.log(`\n--- Testing tag query for note: ${sampleNote.id} ---`);
    const tags = db.prepare(`
      SELECT ZT.ZTITLE AS tag_name
      FROM Z_5TAGS J
      JOIN ZSFNOTETAG ZT ON ZT.Z_PK = J.Z_13TAGS
      JOIN ZSFNOTE ZN ON ZN.Z_PK = J.Z_5NOTES
      WHERE ZN.ZUNIQUEIDENTIFIER = ?
    `).all(sampleNote.id);
    console.log('Tags:', tags.map(t => t.tag_name));
  }
} finally {
  db.close();
  console.log('\nDatabase closed.');
}
