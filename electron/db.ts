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

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hasLegacyGlobalNumberUnique(db: any): boolean {
  const indexes = db.prepare("PRAGMA index_list('hymns')").all() as {
    name: string;
    unique: number;
  }[];

  for (const index of indexes) {
    if (!index.unique) continue;
    const quotedName = index.name.replace(/'/g, "''");
    const cols = db.prepare(`PRAGMA index_info('${quotedName}')`).all() as { name: string }[];
    if (cols.length === 1 && cols[0]?.name === 'number') {
      return true;
    }
  }
  return false;
}

function migrateLegacyHymnsNumberConstraint(db: any) {
  if (!hasLegacyGlobalNumberUnique(db)) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE hymns_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT,
        title TEXT,
        search_text TEXT,
        category_id INTEGER REFERENCES categories(id)
      );

      INSERT INTO hymns_migrated (id, number, title, search_text, category_id)
      SELECT id, number, title, search_text, category_id
      FROM hymns;

      DROP TABLE hymns;
      ALTER TABLE hymns_migrated RENAME TO hymns;
    `);
  });

  try {
    tx();
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
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
  'Imnuri Speciale',
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

  // Migration: add created_at column
  try {
    db.exec("ALTER TABLE hymns ADD COLUMN created_at TEXT DEFAULT ''");
  } catch {
    // Column already exists — fine
  }

  // Migration: drop UNIQUE on number (if present from old schema)
  // We allow duplicate numbers across categories, so only enforce uniqueness per category.
  migrateLegacyHymnsNumberConstraint(db);

  // Seed built-in categories
  const insertBuiltin = db.prepare(
    'INSERT OR IGNORE INTO categories (name, is_builtin) VALUES (?, 1)'
  );
  for (const name of BUILTIN_CATEGORIES) {
    insertBuiltin.run(name);
  }

  // Create Bible tables (if not present yet)
  initBibleTables();

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
  const normalizedPattern = `%${normalizeSearchText(query)}%`;
  const originalPattern = `%${query}%`;
  if (categoryId !== undefined) {
    return getDb()
      .prepare(`
        SELECT h.id, h.number, h.title, h.category_id,
               COUNT(s.id) AS section_count
        FROM hymns h
        LEFT JOIN hymn_sections s ON s.hymn_id = h.id
        WHERE h.category_id = ? AND (h.number LIKE ? OR h.title LIKE ? OR LOWER(h.title) LIKE ?)
        GROUP BY h.id
        ORDER BY CAST(h.number AS INTEGER)
        LIMIT 50
      `)
      .all(categoryId, originalPattern, originalPattern, normalizedPattern);
  }
  return getDb()
    .prepare(`
      SELECT h.id, h.number, h.title, h.category_id,
             COUNT(s.id) AS section_count
      FROM hymns h
      LEFT JOIN hymn_sections s ON s.hymn_id = h.id
      WHERE h.number LIKE ? OR h.title LIKE ? OR LOWER(h.title) LIKE ?
      GROUP BY h.id
      ORDER BY CAST(h.number AS INTEGER)
      LIMIT 50
    `)
    .all(originalPattern, originalPattern, normalizedPattern);
}

export function getAllHymnsWithSnippets(categoryId?: number) {
  const snippetSubquery = `
    (SELECT s.text FROM hymn_sections s
     WHERE s.hymn_id = h.id AND s.type = 'strofa'
     ORDER BY s.order_index LIMIT 1) AS snippet
  `;
  if (categoryId !== undefined) {
    return getDb()
      .prepare(`
        SELECT h.id, h.number, h.title, h.category_id,
               COUNT(sec.id) AS section_count,
               ${snippetSubquery}
        FROM hymns h
        LEFT JOIN hymn_sections sec ON sec.hymn_id = h.id
        WHERE h.category_id = ?
        GROUP BY h.id
        ORDER BY CAST(h.number AS INTEGER)
      `)
      .all(categoryId);
  }
  return getDb()
    .prepare(`
      SELECT h.id, h.number, h.title, h.category_id,
             COUNT(sec.id) AS section_count,
             ${snippetSubquery}
      FROM hymns h
      LEFT JOIN hymn_sections sec ON sec.hymn_id = h.id
      GROUP BY h.id
      ORDER BY CAST(h.number AS INTEGER)
    `)
    .all();
}

export function searchHymnsContent(query: string, categoryId?: number) {
  const normalizedPattern = `%${normalizeSearchText(query)}%`;
  const originalPattern = `%${query}%`;
  const snippetSubquery = `
    (SELECT s.text FROM hymn_sections s
     WHERE s.hymn_id = h.id AND s.type = 'strofa'
     ORDER BY s.order_index LIMIT 1) AS snippet
  `;
  if (categoryId !== undefined) {
    return getDb()
      .prepare(`
        SELECT DISTINCT h.id, h.number, h.title, h.category_id,
               (SELECT COUNT(*) FROM hymn_sections sec2 WHERE sec2.hymn_id = h.id) AS section_count,
               ${snippetSubquery}
        FROM hymns h
        INNER JOIN hymn_sections sec ON sec.hymn_id = h.id
        WHERE h.category_id = ? AND (sec.text LIKE ? OR h.search_text LIKE ?)
        ORDER BY CAST(h.number AS INTEGER)
        LIMIT 50
      `)
      .all(categoryId, originalPattern, normalizedPattern);
  }
  return getDb()
    .prepare(`
      SELECT DISTINCT h.id, h.number, h.title, h.category_id,
             (SELECT COUNT(*) FROM hymn_sections sec2 WHERE sec2.hymn_id = h.id) AS section_count,
             ${snippetSubquery}
      FROM hymns h
      INNER JOIN hymn_sections sec ON sec.hymn_id = h.id
      WHERE sec.text LIKE ? OR h.search_text LIKE ?
      ORDER BY CAST(h.number AS INTEGER)
      LIMIT 50
    `)
    .all(originalPattern, normalizedPattern);
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

export function updateHymnCategory(id: number, categoryId?: number) {
  const db = getDb();
  const hymn = db
    .prepare('SELECT id, number FROM hymns WHERE id = ?')
    .get(id) as { id: number; number: string } | undefined;
  if (!hymn) {
    throw new Error('Imnul selectat nu mai există.');
  }

  const nextCategoryId = categoryId ?? null;
  const duplicate = nextCategoryId == null
    ? db
      .prepare('SELECT id FROM hymns WHERE number = ? AND category_id IS NULL AND id <> ? LIMIT 1')
      .get(hymn.number, id)
    : db
      .prepare('SELECT id FROM hymns WHERE number = ? AND category_id = ? AND id <> ? LIMIT 1')
      .get(hymn.number, nextCategoryId, id);
  if (duplicate) {
    throw new Error(`Există deja un imn cu numărul ${hymn.number} în categoria selectată.`);
  }

  return db
    .prepare('UPDATE hymns SET category_id = ? WHERE id = ?')
    .run(nextCategoryId, id);
}

export function deleteHymn(id: number) {
  return getDb().prepare('DELETE FROM hymns WHERE id = ?').run(id);
}

export interface HymnSectionInput {
  type: 'strofa' | 'refren';
  text: string;
}

export interface CreateHymnInput {
  number: string;
  title: string;
  categoryId?: number;
  sections: HymnSectionInput[];
}

export interface BackupSummary {
  categories: number;
  hymns: number;
  sections: number;
}

export interface HymnsDbBackup {
  version: 1;
  exported_at: string;
  categories: { id: number; name: string; is_builtin: number }[];
  hymns: {
    id: number;
    number: string | null;
    title: string | null;
    search_text: string | null;
    category_id: number | null;
  }[];
  hymn_sections: {
    id: number;
    hymn_id: number;
    order_index: number;
    type: 'strofa' | 'refren';
    text: string;
  }[];
}

export function createHymnWithSections(input: CreateHymnInput): number {
  const db = getDb();
  const tx = db.transaction((payload: CreateHymnInput) => {
    const number = normalizeHymnNumber(payload.number);
    const title = payload.title.trim();
    const sections = payload.sections
      .map(section => ({ type: section.type, text: section.text.trim() }))
      .filter(section => section.text.length > 0);

    if (!number) throw new Error('Numărul imnului este obligatoriu.');
    if (!title) throw new Error('Titlul imnului este obligatoriu.');
    if (sections.length === 0) throw new Error('Adaugă cel puțin o secțiune cu text.');

    const categoryId = payload.categoryId ?? null;
    const duplicate = categoryId == null
      ? db.prepare('SELECT id FROM hymns WHERE number = ? AND category_id IS NULL LIMIT 1').get(number)
      : db.prepare('SELECT id FROM hymns WHERE number = ? AND category_id = ? LIMIT 1').get(number, categoryId);
    if (duplicate) {
      throw new Error(`Există deja un imn cu numărul ${number} în categoria selectată.`);
    }

    const searchText = normalizeSearchText(`${number} ${title} ${sections.map(s => s.text).join(' ')}`);
    let hymnResult: { lastInsertRowid: number | bigint };
    try {
      hymnResult = db
        .prepare('INSERT INTO hymns (number, title, search_text, category_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(number, title, searchText, categoryId, new Date().toISOString());
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed: hymns.number')) {
        throw new Error('Schema bazei de date este veche (număr global unic). Repornește aplicația pentru migrare automată și încearcă din nou.');
      }
      throw err;
    }

    const hymnId = Number(hymnResult.lastInsertRowid);
    const insertSection = db.prepare(`
      INSERT INTO hymn_sections (hymn_id, order_index, type, text)
      VALUES (@hymnId, @order_index, @type, @text)
    `);

    sections.forEach((section, index) => {
      insertSection.run({
        hymnId,
        order_index: index,
        type: section.type,
        text: section.text,
      });
    });

    return hymnId;
  });

  return tx(input);
}

export function updateHymnWithSections(id: number, input: { number: string; title: string; sections: HymnSectionInput[] }) {
  const db = getDb();
  const tx = db.transaction(() => {
    const number = normalizeHymnNumber(input.number);
    const title = input.title.trim();
    const sections = input.sections
      .map(s => ({ type: s.type, text: s.text.trim() }))
      .filter(s => s.text.length > 0);

    if (!number) throw new Error('Numărul imnului este obligatoriu.');
    if (!title) throw new Error('Titlul imnului este obligatoriu.');
    if (sections.length === 0) throw new Error('Adaugă cel puțin o secțiune cu text.');

    const searchText = normalizeSearchText(`${number} ${title} ${sections.map(s => s.text).join(' ')}`);
    db.prepare('UPDATE hymns SET number = ?, title = ?, search_text = ? WHERE id = ?')
      .run(number, title, searchText, id);

    db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?').run(id);
    const insertSection = db.prepare(`
      INSERT INTO hymn_sections (hymn_id, order_index, type, text)
      VALUES (@hymnId, @order_index, @type, @text)
    `);
    sections.forEach((section, index) => {
      insertSection.run({ hymnId: id, order_index: index, type: section.type, text: section.text });
    });
  });
  tx();
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

export function exportJsonBackup(): HymnsDbBackup {
  const db = getDb();
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    categories: db
      .prepare('SELECT id, name, is_builtin FROM categories ORDER BY id')
      .all(),
    hymns: db
      .prepare('SELECT id, number, title, search_text, category_id FROM hymns ORDER BY id')
      .all(),
    hymn_sections: db
      .prepare('SELECT id, hymn_id, order_index, type, text FROM hymn_sections ORDER BY hymn_id, order_index, id')
      .all(),
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} este invalid.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} trebuie să fie text.`);
  return value;
}

function asNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, label);
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} trebuie să fie număr.`);
  }
  return Math.trunc(value);
}

function asNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return asNumber(value, label);
}

export function importJsonBackup(data: unknown): BackupSummary {
  const root = asObject(data, 'Backup');
  const rawCategories = root.categories;
  const rawHymns = root.hymns;
  const rawSections = root.hymn_sections;

  if (!Array.isArray(rawCategories) || !Array.isArray(rawHymns) || !Array.isArray(rawSections)) {
    throw new Error('Backup JSON invalid: lipsesc colecțiile categories/hymns/hymn_sections.');
  }

  const categories = rawCategories.map((item, index) => {
    const row = asObject(item, `Categorie #${index + 1}`);
    const isBuiltin = asNumber(row.is_builtin, `Categorie #${index + 1} is_builtin`);
    if (isBuiltin !== 0 && isBuiltin !== 1) {
      throw new Error(`Categorie #${index + 1} is_builtin trebuie să fie 0 sau 1.`);
    }
    return {
      id: asNumber(row.id, `Categorie #${index + 1} id`),
      name: asString(row.name, `Categorie #${index + 1} name`),
      is_builtin: isBuiltin,
    };
  });

  const hymns = rawHymns.map((item, index) => {
    const row = asObject(item, `Imn #${index + 1}`);
    return {
      id: asNumber(row.id, `Imn #${index + 1} id`),
      number: asNullableString(row.number, `Imn #${index + 1} number`),
      title: asNullableString(row.title, `Imn #${index + 1} title`),
      search_text: asNullableString(row.search_text, `Imn #${index + 1} search_text`),
      category_id: asNullableNumber(row.category_id, `Imn #${index + 1} category_id`),
    };
  });

  const sections = rawSections.map((item, index) => {
    const row = asObject(item, `Secțiune #${index + 1}`);
    const type = asString(row.type, `Secțiune #${index + 1} type`);
    if (type !== 'strofa' && type !== 'refren') {
      throw new Error(`Secțiune #${index + 1} type trebuie să fie "strofa" sau "refren".`);
    }
    return {
      id: asNumber(row.id, `Secțiune #${index + 1} id`),
      hymn_id: asNumber(row.hymn_id, `Secțiune #${index + 1} hymn_id`),
      order_index: asNumber(row.order_index, `Secțiune #${index + 1} order_index`),
      type,
      text: asString(row.text, `Secțiune #${index + 1} text`),
    };
  });

  const categoryIds = new Set(categories.map(row => row.id));
  for (const hymn of hymns) {
    if (hymn.category_id != null && !categoryIds.has(hymn.category_id)) {
      throw new Error(`Imnul ${hymn.id} referă o categorie inexistentă (${hymn.category_id}).`);
    }
  }

  const hymnIds = new Set(hymns.map(row => row.id));
  for (const section of sections) {
    if (!hymnIds.has(section.hymn_id)) {
      throw new Error(`Secțiunea ${section.id} referă un imn inexistent (${section.hymn_id}).`);
    }
  }

  const db = getDb();
  db.exec('PRAGMA foreign_keys = ON;');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM hymn_sections').run();
    db.prepare('DELETE FROM hymns').run();
    db.prepare('DELETE FROM categories').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('categories','hymns','hymn_sections')").run();

    const insertCategory = db.prepare(`
      INSERT INTO categories (id, name, is_builtin)
      VALUES (@id, @name, @is_builtin)
    `);
    for (const category of categories) {
      insertCategory.run(category);
    }

    const insertHymn = db.prepare(`
      INSERT INTO hymns (id, number, title, search_text, category_id)
      VALUES (@id, @number, @title, @search_text, @category_id)
    `);
    for (const hymn of hymns) {
      insertHymn.run({
        id: hymn.id,
        number: hymn.number == null ? null : normalizeHymnNumber(hymn.number),
        title: hymn.title,
        search_text: hymn.search_text,
        category_id: hymn.category_id,
      });
    }

    const insertSection = db.prepare(`
      INSERT INTO hymn_sections (id, hymn_id, order_index, type, text)
      VALUES (@id, @hymn_id, @order_index, @type, @text)
    `);
    for (const section of sections) {
      insertSection.run(section);
    }

    const insertSeq = db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)');
    if (categories.length > 0) insertSeq.run('categories', Math.max(...categories.map(row => row.id)));
    if (hymns.length > 0) insertSeq.run('hymns', Math.max(...hymns.map(row => row.id)));
    if (sections.length > 0) insertSeq.run('hymn_sections', Math.max(...sections.map(row => row.id)));
  });

  tx();
  return {
    categories: categories.length,
    hymns: hymns.length,
    sections: sections.length,
  };
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

// ── Bible tables ──────────────────────────────────────────────────────────────

export function initBibleTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS bible_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      abbreviation TEXT NOT NULL,
      testament TEXT NOT NULL CHECK(testament IN ('VT', 'NT')),
      book_order INTEGER NOT NULL,
      chapter_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bible_verses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES bible_books(id),
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bible_verses_book_chapter
      ON bible_verses(book_id, chapter);
  `);
}

// ── Bible queries ─────────────────────────────────────────────────────────────

export function getBibleBooks() {
  return getDb()
    .prepare('SELECT * FROM bible_books ORDER BY book_order')
    .all();
}

export function getBibleChapters(bookId: number): number[] {
  return getDb()
    .prepare('SELECT DISTINCT chapter FROM bible_verses WHERE book_id = ? ORDER BY chapter')
    .all(bookId)
    .map((r: any) => r.chapter);
}

export function getBibleVerses(bookId: number, chapter: number) {
  return getDb()
    .prepare('SELECT verse, text FROM bible_verses WHERE book_id = ? AND chapter = ? ORDER BY verse')
    .all(bookId, chapter);
}

export function searchBible(query: string, bookId?: number) {
  const pattern = `%${query}%`;
  if (bookId !== undefined) {
    return getDb()
      .prepare(`
        SELECT bv.book_id, bv.chapter, bv.verse, bv.text,
               bb.name as book_name, bb.abbreviation
        FROM bible_verses bv
        JOIN bible_books bb ON bb.id = bv.book_id
        WHERE bv.book_id = ? AND bv.text LIKE ?
        ORDER BY bv.book_id, bv.chapter, bv.verse
        LIMIT 100
      `)
      .all(bookId, pattern);
  }
  return getDb()
    .prepare(`
      SELECT bv.book_id, bv.chapter, bv.verse, bv.text,
             bb.name as book_name, bb.abbreviation
      FROM bible_verses bv
      JOIN bible_books bb ON bb.id = bv.book_id
      WHERE bv.text LIKE ?
      ORDER BY bv.book_id, bv.chapter, bv.verse
      LIMIT 100
    `)
    .all(pattern);
}

export function getBibleVerseRange(bookId: number, chapter: number, startVerse: number, endVerse: number) {
  return getDb()
    .prepare(`
      SELECT bv.verse, bv.text, bb.name as book_name, bb.abbreviation
      FROM bible_verses bv
      JOIN bible_books bb ON bb.id = bv.book_id
      WHERE bv.book_id = ? AND bv.chapter = ? AND bv.verse >= ? AND bv.verse <= ?
      ORDER BY bv.verse
    `)
    .all(bookId, chapter, startVerse, endVerse);
}

export function hasBibleData(): boolean {
  try {
    const row = getDb()
      .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='bible_books'")
      .get() as { cnt: number } | undefined;
    return !!(row && row.cnt > 0);
  } catch {
    return false;
  }
}
