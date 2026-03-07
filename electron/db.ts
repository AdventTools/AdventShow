import { app } from 'electron';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// @ts-ignore
if (typeof global.__filename === 'undefined') {
  // @ts-ignore
  global.__filename = fileURLToPath(import.meta.url);
}
// @ts-ignore
if (typeof global.__dirname === 'undefined') {
  // @ts-ignore
  global.__dirname = path.dirname(fileURLToPath(import.meta.url));
}

let _db: any = null;

function normalizeHymnNumber(number: string): string {
  const trimmed = String(number ?? '').trim();
  if (/^\d+$/.test(trimmed)) {
    return String(parseInt(trimmed, 10)).padStart(3, '0');
  }
  return trimmed;
}

export function getDb() {
  if (!_db) {
    const dbPath = path.join(app.getPath('userData'), 'hymns.db');
    _db = new Database(dbPath);
  }
  return _db;
}

// ── Predefined categories (locked) ───────────────────────────────────────────

const BUILTIN_CATEGORIES = [
  'Imnuri Creștine',
  'Licurici',
  'Exploratori',
  'Companioni',
  'Tineret',
];

export function initDB() {
  const db = getDb();
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_builtin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS hymns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT,
      title TEXT,
      search_text TEXT,
      category_id INTEGER REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS hymn_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hymn_id INTEGER NOT NULL REFERENCES hymns(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('strofa', 'refren')),
      text TEXT NOT NULL
    );
  `);

  // Migration: add category_id to existing hymns table if missing
  try {
    db.exec('ALTER TABLE hymns ADD COLUMN category_id INTEGER REFERENCES categories(id)');
  } catch {
    // Column already exists — fine
  }

  // Migration: drop UNIQUE on number (if present from old schema)
  // We allow duplicate numbers across categories, so only enforce uniqueness per category.
  // (SQLite doesn't support DROP CONSTRAINT, so we handle via app logic)

  // Seed built-in categories
  const insertBuiltin = db.prepare(
    'INSERT OR IGNORE INTO categories (name, is_builtin) VALUES (?, 1)'
  );
  for (const name of BUILTIN_CATEGORIES) {
    insertBuiltin.run(name);
  }

  // Normalize purely numeric hymn numbers to 3-digit format (e.g. 1 -> 001).
  db.prepare(`
    UPDATE hymns
    SET number = printf('%03d', CAST(number AS INTEGER))
    WHERE number IS NOT NULL
      AND TRIM(number) <> ''
      AND TRIM(number) NOT GLOB '*[^0-9]*'
  `).run();
}

// ── Category queries ──────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  is_builtin: number;
  hymn_count?: number;
}

export function getCategories(): Category[] {
  return getDb()
    .prepare(`
      SELECT c.id, c.name, c.is_builtin,
             COUNT(h.id) AS hymn_count
      FROM categories c
      LEFT JOIN hymns h ON h.category_id = c.id
      GROUP BY c.id
      ORDER BY c.is_builtin DESC, c.name
    `)
    .all();
}

export function createCategory(name: string): Category {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO categories (name, is_builtin) VALUES (?, 0)')
    .run(name);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
}

export function updateCategory(id: number, name: string) {
  return getDb()
    .prepare('UPDATE categories SET name = ? WHERE id = ? AND is_builtin = 0')
    .run(name, id);
}

export function deleteCategory(id: number) {
  // Cascades: set hymns.category_id = NULL for hymns in this category
  const db = getDb();
  db.exec('PRAGMA foreign_keys = ON;');
  const tx = db.transaction(() => {
    db.prepare('UPDATE hymns SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ? AND is_builtin = 0').run(id);
  });
  tx();
}

// ── Hymn queries ──────────────────────────────────────────────────────────────

export function getAllHymns(categoryId?: number) {
  if (categoryId !== undefined) {
    return getDb()
      .prepare(`
        SELECT h.id, h.number, h.title, h.category_id,
               COUNT(s.id) AS section_count
        FROM hymns h
        LEFT JOIN hymn_sections s ON s.hymn_id = h.id
        WHERE h.category_id = ?
        GROUP BY h.id
        ORDER BY CAST(h.number AS INTEGER)
      `)
      .all(categoryId);
  }
  return getDb()
    .prepare(`
      SELECT h.id, h.number, h.title, h.category_id,
             COUNT(s.id) AS section_count
      FROM hymns h
      LEFT JOIN hymn_sections s ON s.hymn_id = h.id
      GROUP BY h.id
      ORDER BY CAST(h.number AS INTEGER)
    `)
    .all();
}

export function getHymnByNumber(number: string) {
  const normalized = normalizeHymnNumber(number);
  return getDb()
    .prepare('SELECT id, number, title, category_id FROM hymns WHERE number = ?')
    .get(normalized);
}

export function searchHymns(query: string, categoryId?: number) {
  const searchPattern = `%${query}%`;
  if (categoryId !== undefined) {
    return getDb()
      .prepare(`
        SELECT h.id, h.number, h.title, h.category_id,
               COUNT(s.id) AS section_count
        FROM hymns h
        LEFT JOIN hymn_sections s ON s.hymn_id = h.id
        WHERE h.category_id = ? AND (h.number LIKE ? OR h.title LIKE ? OR h.search_text LIKE ?)
        GROUP BY h.id
        ORDER BY CAST(h.number AS INTEGER)
        LIMIT 50
      `)
      .all(categoryId, searchPattern, searchPattern, searchPattern);
  }
  return getDb()
    .prepare(`
      SELECT h.id, h.number, h.title, h.category_id,
             COUNT(s.id) AS section_count
      FROM hymns h
      LEFT JOIN hymn_sections s ON s.hymn_id = h.id
      WHERE h.number LIKE ? OR h.title LIKE ? OR h.search_text LIKE ?
      GROUP BY h.id
      ORDER BY CAST(h.number AS INTEGER)
      LIMIT 50
    `)
    .all(searchPattern, searchPattern, searchPattern);
}

export function getHymnWithSections(hymnId: number) {
  const db = getDb();
  const hymn = db.prepare('SELECT * FROM hymns WHERE id = ?').get(hymnId);
  if (!hymn) return null;
  const sections = db
    .prepare('SELECT * FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index')
    .all(hymnId);
  return { ...hymn, sections };
}

export function updateHymn(id: number, number: string, title: string) {
  return getDb()
    .prepare('UPDATE hymns SET number = @number, title = @title WHERE id = @id')
    .run({ id, number: normalizeHymnNumber(number), title });
}

export function deleteHymn(id: number) {
  return getDb().prepare('DELETE FROM hymns WHERE id = ?').run(id);
}

export function clearAllData() {
  const db = getDb();
  db.exec('PRAGMA foreign_keys = ON;');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM hymn_sections').run();
    db.prepare('DELETE FROM hymns').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('hymns','hymn_sections')").run();
  });
  tx();
}

// ── Section queries ───────────────────────────────────────────────────────────

export function addSection(hymnId: number, type: 'strofa' | 'refren', text: string) {
  const db = getDb();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM hymn_sections WHERE hymn_id = ?')
    .get(hymnId) as { m: number };
  return db
    .prepare('INSERT INTO hymn_sections (hymn_id, order_index, type, text) VALUES (?, ?, ?, ?)')
    .run(hymnId, maxOrder.m + 1, type, text);
}

export function updateSection(id: number, type: 'strofa' | 'refren', text: string) {
  return getDb()
    .prepare('UPDATE hymn_sections SET type = @type, text = @text WHERE id = @id')
    .run({ id, type, text });
}

export function deleteSection(id: number) {
  return getDb().prepare('DELETE FROM hymn_sections WHERE id = ?').run(id);
}

export function reorderSections(sections: { id: number; order_index: number }[]) {
  const stmt = getDb().prepare(
    'UPDATE hymn_sections SET order_index = @order_index WHERE id = @id'
  );
  const tx = getDb().transaction((rows: { id: number; order_index: number }[]) => {
    for (const row of rows) stmt.run(row);
  });
  tx(sections);
}

// ── Bulk insert for import ────────────────────────────────────────────────────

export interface HymnImportData {
  number: string;
  title: string;
  searchText: string;
  categoryId?: number;
  sections: { type: 'strofa' | 'refren'; text: string }[];
}

export function bulkInsertHymns(hymns: HymnImportData[]) {
  const db = getDb();

  const insertHymn = db.prepare(`
    INSERT OR REPLACE INTO hymns (number, title, search_text, category_id)
    VALUES (@number, @title, @searchText, @categoryId)
  `);

  const insertSection = db.prepare(`
    INSERT INTO hymn_sections (hymn_id, order_index, type, text)
    VALUES (@hymnId, @order_index, @type, @text)
  `);

  const deleteOldSections = db.prepare(`
    DELETE FROM hymn_sections WHERE hymn_id = ?
  `);

  const tx = db.transaction((rows: HymnImportData[]) => {
    for (const hymn of rows) {
      const result = insertHymn.run({
        number: normalizeHymnNumber(hymn.number),
        title: hymn.title,
        searchText: hymn.searchText,
        categoryId: hymn.categoryId ?? null,
      });
      const hymnId = result.lastInsertRowid;
      deleteOldSections.run(hymnId);
      hymn.sections.forEach((section, i) => {
        insertSection.run({
          hymnId,
          order_index: i,
          type: section.type,
          text: section.text,
        });
      });
    }
  });

  tx(hymns);
}
