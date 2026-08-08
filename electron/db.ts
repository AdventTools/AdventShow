import { app } from 'electron';
import { createRequire } from 'module';
import fs from 'fs';
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
    // Diacritic-insensitive SQL helper used by hymn + Bible search: nrm(col) LIKE ?.
    // MUST be registered here, on the single shared connection, so every prepared
    // statement that calls nrm() can resolve it. (Regression in v1.2.4: nrm() was
    // used in SQL but never registered → "no such function: nrm" broke all search.)
    _db.function('nrm', { deterministic: true }, (value: unknown) => normalizeSearchText(String(value ?? '')));
  }
  return _db;
}

// ── Predefined categories (locked) ───────────────────────────────────────────

/**
 * Colecțiile care există la toată lumea. Ultimele două au reguli speciale:
 *
 * • „Imnuri Speciale" e colecția OFICIALĂ de imnuri care nu sunt în cărțile de mai
 *   sus. Numerele din ea le dă autorul, la acceptarea unei propuneri, și nu se
 *   refolosesc niciodată — o corectură se aplică după perechea (colecție, număr),
 *   deci un număr reciclat ar înlocui tăcut un imn cu altul.
 * • „Imnurile mele" e a utilizatorului. Nimic de la noi nu ajunge acolo, deci nimic
 *   nu i se suprascrie vreodată.
 */
const BUILTIN_CATEGORIES = [
  'Imnuri Creștine',
  'Licurici',
  'Exploratori',
  'Companioni',
  'Tineret',
  'Amicus',
  'Imnuri Speciale',
  'Imnurile mele',
];

/** Colecția în care utilizatorul își ține imnurile proprii. */
export const MY_HYMNS_CATEGORY = 'Imnurile mele';
/** Colecția oficială de imnuri din afara cărților; numerotată doar de autori. */
export const SPECIAL_HYMNS_CATEGORY = 'Imnuri Speciale';

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

  // Migration: add updated_at to hymn_sections for tracking modifications
  try {
    db.exec("ALTER TABLE hymn_sections ADD COLUMN updated_at TEXT DEFAULT ''");
  } catch {
    // Column already exists — fine
  }

  // Migration: add updated_at to hymns for tracking modifications
  try {
    db.exec("ALTER TABLE hymns ADD COLUMN updated_at TEXT DEFAULT ''");
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

  migrateCedillaToCommaBelow(db);
  migrateHymn664Variants(db);
  migrateOwnHymnsOutOfSpecial(db);
  recoverHymnsWithoutCategory(db);
}

/**
 * Importul din Setări chema `importPresentations` fără categorie, așa că imnul intra
 * în baza de date cu `category_id NULL`: exista, dar nu apărea în nicio listă și nici
 * la „Toate". Importul s-a mutat lângă butonul „+" și trimite mereu o categorie, dar
 * imnurile deja rătăcite trebuie scoase la lumină. Le aducem în „Imnurile mele".
 *
 * Rulează la fiecare pornire — nu are stare de reținut: dacă nu e nimic orfan, nu face
 * nimic. Așa prinde și un import făcut cu o versiune veche instalată în paralel.
 */
function recoverHymnsWithoutCategory(db: ReturnType<typeof getDb>) {
  const orfane = db.prepare('SELECT COUNT(*) AS n FROM hymns WHERE category_id IS NULL').get() as { n: number };
  if (!orfane.n) return;

  const mine = db.prepare('SELECT id FROM categories WHERE name = ?').get(MY_HYMNS_CATEGORY) as
    { id: number } | undefined;
  if (!mine) return;

  db.prepare('UPDATE hymns SET category_id = ? WHERE category_id IS NULL').run(mine.id);
  console.log(`[migrare] ${orfane.n} imnuri fără categorie mutate în „${MY_HYMNS_CATEGORY}"`);
}

/**
 * „Imnuri Speciale" devine colecție oficială, numerotată de autori. Până acum era o
 * categorie goală în care unii utilizatori și-au pus imnurile proprii — iar la prima
 * sincronizare cu seed-ul nou, un imn oficial cu același număr le-ar fi înlocuit
 * tăcut imnul (potrivirea se face după `(categorie, număr)`). Le mutăm în „Imnurile
 * mele", unde nu scriem niciodată nimic.
 *
 * Se face O SINGURĂ DATĂ, înainte ca vreun imn oficial să ajungă în colecție: tot ce
 * găsim acolo la momentul migrării e, prin definiție, al utilizatorului.
 * Idempotentă prin `PRAGMA user_version`.
 */
const OWN_HYMNS_MIGRATION_VERSION = 2;
function migrateOwnHymnsOutOfSpecial(db: ReturnType<typeof getDb>) {
  const current = Number(db.pragma('user_version', { simple: true })) || 0;
  if (current >= OWN_HYMNS_MIGRATION_VERSION) return;

  const special = db.prepare('SELECT id FROM categories WHERE name = ?').get(SPECIAL_HYMNS_CATEGORY) as
    { id: number } | undefined;
  const mine = db.prepare('SELECT id FROM categories WHERE name = ?').get(MY_HYMNS_CATEGORY) as
    { id: number } | undefined;

  const tx = db.transaction(() => {
    if (special && mine) {
      const moved = db.prepare('UPDATE hymns SET category_id = ? WHERE category_id = ?')
        .run(mine.id, special.id).changes as number;
      if (moved > 0) {
        console.log(`[migrare] ${moved} imnuri proprii mutate din „${SPECIAL_HYMNS_CATEGORY}" în „${MY_HYMNS_CATEGORY}"`);
      }
    }
    db.pragma(`user_version = ${OWN_HYMNS_MIGRATION_VERSION}`);
  });
  tx();
}

// Imnul 664 «Ți-aducem, Doamne-acești copii» are în carte două variante: A (la singular,
// pentru un singur copil) și B (la plural). Bazele de până acum aveau doar varianta B, la
// numărul simplu «664». Seed-ul le ține de-acum ca imnuri separate — «664a» și «664b» — așa
// că renumerotăm varianta veche în 664b; altfel sincronizarea cu seed-ul ar insera un al
// doilea exemplar al variantei B, lăsând un duplicat în lista utilizatorului.
// Idempotentă: dacă există deja un 664b, nu face nimic.
function migrateHymn664Variants(db: any) {
  const category = db
    .prepare("SELECT id FROM categories WHERE name = 'Imnuri Creștine'")
    .get() as { id: number } | undefined;
  if (!category) return;

  const already = db
    .prepare('SELECT id FROM hymns WHERE category_id = ? AND number = ? LIMIT 1')
    .get(category.id, '664b');
  if (already) return;

  db.prepare(`
    UPDATE hymns
    SET number = '664b'
    WHERE category_id = ?
      AND TRIM(number) IN ('664', '0664')
      AND (title LIKE 'B.%' OR title LIKE '%aducem%')
  `).run(category.id);
}

// Normalizează diacriticele vechi cu sedilă (ş/Ş/ţ/Ţ, moștenite din fonturile
// de dinainte de Unicode) la formele moderne cu virgulă dedesubt (ș/Ș/ț/Ț), cerute
// de Academia Română — în imnuri, secțiuni, categorii ȘI toată Biblia. Rulează o
// singură dată per bază (guard pe PRAGMA user_version), inclusiv pe DB-urile
// existente ale utilizatorilor la prima pornire după update. Rescrie DOAR textul,
// niciodată updated_at — așa search_text (oricum fără diacritice) rămâne valid, iar
// logica pe timestamp din syncSeedContent nu e afectată. char(N) evită scrierea de
// caractere non-ASCII în sursă: ş=351 Ş=350 ţ=355 Ţ=354 → ș=537 Ș=536 ț=539 Ț=538.
const CEDILLA_MIGRATION_VERSION = 1;
function migrateCedillaToCommaBelow(db: any) {
  const current = Number(db.pragma('user_version', { simple: true })) || 0;
  if (current >= CEDILLA_MIGRATION_VERSION) return;

  const toCommaBelow = (col: string) =>
    `replace(replace(replace(replace(${col}, char(351), char(537)), ` +
    `char(350), char(536)), char(355), char(539)), char(354), char(538))`;

  const tables: [string, string][] = [
    ['hymn_sections', 'text'],
    ['hymns', 'title'],
    ['categories', 'name'],
    ['bible_verses', 'text'],
    ['bible_books', 'name'],
    ['bible_books', 'abbreviation'],
  ];

  const tx = db.transaction(() => {
    for (const [table, col] of tables) {
      // Tabelele Bibliei pot lipsi pe DB-uri foarte vechi — sărim tăcut.
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      if (!exists) continue;
      db.prepare(`UPDATE ${table} SET ${col} = ${toCommaBelow(col)} WHERE ${col} IS NOT NULL`).run();
    }
    db.pragma(`user_version = ${CEDILLA_MIGRATION_VERSION}`);
  });
  tx();
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
        WHERE h.category_id = ? AND (h.number LIKE ? OR h.title LIKE ? OR nrm(h.title) LIKE ?)
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
      WHERE h.number LIKE ? OR h.title LIKE ? OR nrm(h.title) LIKE ?
      GROUP BY h.id
      ORDER BY CAST(h.number AS INTEGER)
      LIMIT 50
    `)
    .all(originalPattern, originalPattern, normalizedPattern);
}

export function getAllHymnsWithSnippets(categoryId?: number) {
  const snippetSubquery = `
    (SELECT GROUP_CONCAT(s.text, ' ') FROM hymn_sections s
     WHERE s.hymn_id = h.id AND s.type = 'strofa'
     ORDER BY s.order_index) AS snippet
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
    (SELECT GROUP_CONCAT(s.text, ' ') FROM hymn_sections s
     WHERE s.hymn_id = h.id AND s.type = 'strofa'
     ORDER BY s.order_index) AS snippet
  `;
  if (categoryId !== undefined) {
    return getDb()
      .prepare(`
        SELECT DISTINCT h.id, h.number, h.title, h.category_id,
               (SELECT COUNT(*) FROM hymn_sections sec2 WHERE sec2.hymn_id = h.id) AS section_count,
               ${snippetSubquery}
        FROM hymns h
        INNER JOIN hymn_sections sec ON sec.hymn_id = h.id
        WHERE h.category_id = ? AND (sec.text LIKE ? OR nrm(sec.text) LIKE ?)
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
      WHERE sec.text LIKE ? OR nrm(sec.text) LIKE ?
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
    // updated_at protejează modificările utilizatorului de suprascrieri la syncSeedContent()
    const now = new Date().toISOString();
    db.prepare('UPDATE hymns SET number = ?, title = ?, search_text = ?, updated_at = ? WHERE id = ?')
      .run(number, title, searchText, now, id);

    db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?').run(id);
    const insertSection = db.prepare(`
      INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at)
      VALUES (@hymnId, @order_index, @type, @text, @updated_at)
    `);
    sections.forEach((section, index) => {
      insertSection.run({ hymnId: id, order_index: index, type: section.type, text: section.text, updated_at: now });
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
  const now = new Date().toISOString();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM hymn_sections WHERE hymn_id = ?')
    .get(hymnId) as { m: number };
  return db
    .prepare('INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(hymnId, maxOrder.m + 1, type, text, now);
}

export function updateSection(id: number, type: 'strofa' | 'refren', text: string) {
  const now = new Date().toISOString();
  return getDb()
    .prepare('UPDATE hymn_sections SET type = @type, text = @text, updated_at = @updated_at WHERE id = @id')
    .run({ id, type, text, updated_at: now });
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
      text TEXT NOT NULL,
      search_text TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_bible_verses_book_chapter
      ON bible_verses(book_id, chapter);
  `);

  // Migration: add search_text column if missing and populate it
  migrateBibleSearchText(db);
}

function migrateBibleSearchText(db: any) {
  const cols = db.prepare("PRAGMA table_info('bible_verses')").all() as { name: string }[];
  const hasSearchText = cols.some((c: { name: string }) => c.name === 'search_text');
  if (!hasSearchText) {
    db.exec("ALTER TABLE bible_verses ADD COLUMN search_text TEXT NOT NULL DEFAULT ''");
  }
  // Populate search_text for rows that haven't been normalized yet
  const empty = db.prepare("SELECT count(*) as cnt FROM bible_verses WHERE search_text = '' AND text != ''").get() as { cnt: number };
  if (empty.cnt > 0) {
    console.log(`[Bible] Populating search_text for ${empty.cnt} verses...`);
    const rows = db.prepare("SELECT id, text FROM bible_verses WHERE search_text = '' AND text != ''").all() as { id: number; text: string }[];
    const update = db.prepare("UPDATE bible_verses SET search_text = ? WHERE id = ?");
    const tx = db.transaction(() => {
      for (const row of rows) {
        update.run(normalizeSearchText(row.text), row.id);
      }
    });
    tx();
    console.log(`[Bible] search_text populated for ${rows.length} verses`);
  }
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

export function searchBible(query: string, bookId?: number, chapter?: number) {
  const normalizedPattern = `%${normalizeSearchText(query)}%`;
  const originalPattern = `%${query}%`;

  let whereClause = '(bv.search_text LIKE ? OR bv.text LIKE ?)';
  const params: any[] = [normalizedPattern, originalPattern];

  if (bookId !== undefined) {
    whereClause += ' AND bv.book_id = ?';
    params.push(bookId);
  }
  if (chapter !== undefined) {
    whereClause += ' AND bv.chapter = ?';
    params.push(chapter);
  }

  return getDb()
    .prepare(`
      SELECT bv.book_id, bv.chapter, bv.verse, bv.text,
             bb.name as book_name, bb.abbreviation
      FROM bible_verses bv
      JOIN bible_books bb ON bb.id = bv.book_id
      WHERE ${whereClause}
      ORDER BY bv.book_id, bv.chapter, bv.verse
    `)
    .all(...params);
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
    if (!row || row.cnt === 0) return false;
    const verseRow = getDb()
      .prepare('SELECT count(*) as cnt FROM bible_verses')
      .get() as { cnt: number } | undefined;
    return !!(verseRow && verseRow.cnt > 0);
  } catch {
    return false;
  }
}

// ── Bible auto-seeding from cornilescu.json ──────────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  "Geneza": "Gen", "Exodul": "Exod", "Leviticul": "Lev",
  "Numeri": "Num", "Deuteronomul": "Deut", "Iosua": "Ios",
  "Judecători": "Jud", "Rut": "Rut", "1 Samuel": "1Sam",
  "2 Samuel": "2Sam", "1 Împărați": "1Imp", "2 Împărați": "2Imp",
  "1 Cronici": "1Cron", "2 Cronici": "2Cron", "Ezra": "Ezra",
  "Neemia": "Neem", "Estera": "Est", "Iov": "Iov",
  "Psalmii": "Ps", "Proverbe": "Prov", "Eclesiastul": "Ecl",
  "Cântarea Cântărilor": "Cânt", "Isaia": "Is", "Ieremia": "Ier",
  "Plângerile lui Ieremia": "Plâng", "Ezechiel": "Ez",
  "Daniel": "Dan", "Osea": "Os", "Ioel": "Ioel",
  "Amos": "Amos", "Obadia": "Ob", "Iona": "Iona",
  "Mica": "Mica", "Naum": "Naum", "Habacuc": "Hab",
  "Țefania": "Tef", "Hagai": "Hag", "Zaharia": "Zah",
  "Maleahi": "Mal", "Matei": "Mat", "Marcu": "Marc",
  "Luca": "Luca", "Ioan": "Ioan", "Faptele Apostolilor": "Fapte",
  "Romani": "Rom", "1 Corinteni": "1Cor", "2 Corinteni": "2Cor",
  "Galateni": "Gal", "Efeseni": "Ef", "Filipeni": "Fil",
  "Coloseni": "Col", "1 Tesaloniceni": "1Tes", "2 Tesaloniceni": "2Tes",
  "1 Timotei": "1Tim", "2 Timotei": "2Tim", "Titus": "Tit",
  "Filimon": "Flm", "Evrei": "Evr", "Iacov": "Iac",
  "1 Petru": "1Pet", "2 Petru": "2Pet", "1 Ioan": "1Ioan",
  "2 Ioan": "2Ioan", "3 Ioan": "3Ioan", "Iuda": "Iuda",
  "Apocalipsa": "Apoc",
};

export function seedBibleFromJson() {
  // Check if Bible data already exists
  if (hasBibleData()) return;

  // Find cornilescu.json in various locations
  const candidatePaths = [
    path.join(process.resourcesPath ?? '', 'cornilescu.json'),
    path.join(app.getAppPath(), 'scripts', 'cornilescu.json'),
    path.join(app.getAppPath(), '..', 'scripts', 'cornilescu.json'),
    path.join(process.env['APP_ROOT'] ?? '', 'scripts', 'cornilescu.json'),
  ];

  let jsonPath: string | null = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) { jsonPath = p; break; }
  }

  if (!jsonPath) {
    console.warn('[Bible] cornilescu.json not found, skipping seed');
    return;
  }

  console.log('[Bible] Seeding from', jsonPath);
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(raw);
    const books: any[] = data.books;
    if (!books || !books.length) return;

    const db = getDb();
    const insertBook = db.prepare(
      'INSERT OR REPLACE INTO bible_books (id, name, abbreviation, testament, book_order, chapter_count) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertVerse = db.prepare(
      'INSERT INTO bible_verses (book_id, chapter, verse, text, search_text) VALUES (?, ?, ?, ?, ?)'
    );

    const tx = db.transaction(() => {
      let totalVerses = 0;
      for (const book of books) {
        const nr = book.nr;
        const name = book.name;
        const abbr = ABBREVIATIONS[name] ?? name.substring(0, 4);
        const testament = nr <= 39 ? 'VT' : 'NT';
        const chapters = book.chapters ?? [];
        insertBook.run(nr, name, abbr, testament, nr, chapters.length);

        for (const ch of chapters) {
          for (const v of (ch.verses ?? [])) {
            const text = (v.text ?? '').trim();
            insertVerse.run(nr, ch.chapter, v.verse, text, normalizeSearchText(text));
            totalVerses++;
          }
        }
      }
      console.log(`[Bible] Seeded ${books.length} books, ${totalVerses} verses`);
    });
    tx();
  } catch (err) {
    console.error('[Bible] Seed failed:', err);
  }
}

/**
 * Sync corrections from the seed (bundled) DB to the user's DB.
 * Only updates sections where the seed's updated_at is newer than the user's.
 * This ensures our corrections (e.g., fixing hymn 562) reach existing users,
 * while preserving any user modifications that are more recent.
 */
export function syncSeedCorrections(seedDbPath: string) {
  if (!fs.existsSync(seedDbPath)) return;

  try {
    const userDb = getDb();
    const seedDb = new Database(seedDbPath, { readonly: true });

    // Check if seed DB has updated_at column
    const seedCols = seedDb.pragma('table_info(hymn_sections)') as { name: string }[];
    if (!seedCols.some(c => c.name === 'updated_at')) {
      seedDb.close();
      return; // Seed DB doesn't have timestamps yet, nothing to sync
    }

    // Get all seed sections that have an updated_at timestamp
    const seedSections = seedDb.prepare(`
      SELECT hs.id, hs.hymn_id, hs.order_index, hs.type, hs.text, hs.updated_at
      FROM hymn_sections hs
      WHERE hs.updated_at IS NOT NULL AND hs.updated_at != ''
    `).all() as { id: number; hymn_id: number; order_index: number; type: string; text: string; updated_at: string }[];

    if (seedSections.length === 0) {
      seedDb.close();
      return;
    }

    // Guard: matching by hymn_id alone is unsafe — in user DBs cu imnuri proprii,
    // id-urile pot să NU corespundă cu cele din seed. Confirmăm că imnul userului
    // de la acel id e ACELAȘI imn (același număr + aceeași categorie, după nume).
    const getSeedHymnIdentity = seedDb.prepare(`
      SELECT h.number, c.name AS category_name
      FROM hymns h LEFT JOIN categories c ON c.id = h.category_id
      WHERE h.id = ?
    `);
    const getUserHymnIdentity = userDb.prepare(`
      SELECT h.number, c.name AS category_name
      FROM hymns h LEFT JOIN categories c ON c.id = h.category_id
      WHERE h.id = ?
    `);
    const hymnIdentityOk = new Map<number, boolean>();
    const isSameHymn = (hymnId: number): boolean => {
      const cached = hymnIdentityOk.get(hymnId);
      if (cached !== undefined) return cached;
      const seedHymn = getSeedHymnIdentity.get(hymnId) as { number: string; category_name: string | null } | undefined;
      const userHymn = getUserHymnIdentity.get(hymnId) as { number: string; category_name: string | null } | undefined;
      const ok = !!seedHymn && !!userHymn &&
        normalizeHymnNumber(seedHymn.number ?? '') === normalizeHymnNumber(userHymn.number ?? '') &&
        (seedHymn.category_name ?? '') === (userHymn.category_name ?? '');
      hymnIdentityOk.set(hymnId, ok);
      return ok;
    };

    const getUserSection = userDb.prepare(`
      SELECT id, text, updated_at FROM hymn_sections WHERE hymn_id = ? AND order_index = ?
    `);
    const updateUserSection = userDb.prepare(`
      UPDATE hymn_sections SET text = ?, type = ?, updated_at = ? WHERE id = ?
    `);

    let updated = 0;
    const tx = userDb.transaction(() => {
      for (const seed of seedSections) {
        if (!isSameHymn(seed.hymn_id)) continue;
        const user = getUserSection.get(seed.hymn_id, seed.order_index) as { id: number; text: string; updated_at: string } | undefined;
        if (!user) continue;

        // Only update if seed is newer (or user has no timestamp)
        const userTs = user.updated_at || '';
        if (seed.updated_at > userTs) {
          updateUserSection.run(seed.text, seed.type, seed.updated_at, user.id);
          updated++;
        }
      }
    });
    tx();

    if (updated > 0) {
      console.log(`[DB Sync] Updated ${updated} sections from seed DB`);
    }

    seedDb.close();
  } catch (err) {
    console.error('[DB Sync] Failed:', err);
  }
}

/**
 * Sync NEW content from the seed (bundled) DB to the user's DB:
 *  - categories missing from the user DB (matched by name) are created;
 *  - hymns missing from the user DB (matched by category name + number) are inserted
 *    with their sections — this is how existing users receive newly added collections
 *    (e.g. Licurici / Companioni / Tineret / Amicus added in the seed);
 *  - hymns that exist in both get their content replaced when the seed's updated_at
 *    is >= every timestamp the user has on that hymn (hymn + sections). User edits
 *    made in the app stamp updated_at, so anything the user touched later is preserved.
 * Idempotent — safe to run at every startup.
 */
export function syncSeedContent(seedDbPath: string) {
  if (!fs.existsSync(seedDbPath)) return;

  try {
    const userDb = getDb();
    const seedDb = new Database(seedDbPath, { readonly: true });

    // Seed DBs older than this feature have no updated_at on hymns — nothing to do.
    const seedHymnCols = seedDb.pragma('table_info(hymns)') as { name: string }[];
    if (!seedHymnCols.some(c => c.name === 'updated_at')) {
      seedDb.close();
      return;
    }

    // ── Categories: create the ones missing locally (matched by name) ────────
    const seedCategories = seedDb.prepare('SELECT id, name, is_builtin FROM categories').all() as
      { id: number; name: string; is_builtin: number }[];
    const categoryIdMap = new Map<number, number>(); // seed id -> user id
    let createdCategories = 0;
    for (const seedCat of seedCategories) {
      const local = userDb.prepare('SELECT id FROM categories WHERE name = ?').get(seedCat.name) as
        { id: number } | undefined;
      if (local) {
        categoryIdMap.set(seedCat.id, local.id);
      } else {
        const result = userDb
          .prepare('INSERT INTO categories (name, is_builtin) VALUES (?, ?)')
          .run(seedCat.name, seedCat.is_builtin);
        categoryIdMap.set(seedCat.id, Number(result.lastInsertRowid));
        createdCategories++;
      }
    }

    // ── Hymns: insert the missing, refresh the stale ──────────────────────────
    const seedHymns = seedDb.prepare(`
      SELECT id, number, title, search_text, category_id, created_at, updated_at
      FROM hymns WHERE category_id IS NOT NULL
    `).all() as { id: number; number: string; title: string; search_text: string;
                  category_id: number; created_at: string; updated_at: string }[];
    const getSeedSections = seedDb.prepare(
      'SELECT order_index, type, text, updated_at FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index'
    );

    const seedCatNameById = new Map(seedCategories.map(c => [c.id, c.name]));
    const getUserHymn = userDb.prepare(
      'SELECT id, updated_at FROM hymns WHERE category_id = ? AND number = ? LIMIT 1'
    );
    // DB-urile foarte vechi (dinainte de categorii) au imnurile cu category_id NULL —
    // pentru „Imnuri Creștine" le potrivim după număr și le adoptăm în categorie,
    // altfel sync-ul le-ar duplica.
    const getUserHymnNullCategory = userDb.prepare(
      'SELECT id, updated_at FROM hymns WHERE category_id IS NULL AND number = ? LIMIT 1'
    );
    const adoptHymnIntoCategory = userDb.prepare(
      'UPDATE hymns SET category_id = ? WHERE id = ?'
    );
    const getUserSections = userDb.prepare(
      'SELECT type, text, updated_at FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index'
    );
    const insertHymn = userDb.prepare(`
      INSERT INTO hymns (number, title, search_text, category_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertSection = userDb.prepare(`
      INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const updateHymnRow = userDb.prepare(
      'UPDATE hymns SET title = ?, search_text = ?, updated_at = ? WHERE id = ?'
    );
    const deleteSections = userDb.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?');

    let inserted = 0;
    let refreshed = 0;
    let adopted = 0;
    const tx = userDb.transaction(() => {
      for (const seedHymn of seedHymns) {
        const userCatId = categoryIdMap.get(seedHymn.category_id);
        if (userCatId == null) continue;
        const number = normalizeHymnNumber(seedHymn.number ?? '');
        const seedSections = getSeedSections.all(seedHymn.id) as
          { order_index: number; type: 'strofa' | 'refren'; text: string; updated_at: string }[];
        if (seedSections.length === 0) continue;

        let userHymn = getUserHymn.get(userCatId, number) as
          { id: number; updated_at: string } | undefined;
        if (!userHymn && seedCatNameById.get(seedHymn.category_id) === 'Imnuri Creștine') {
          userHymn = getUserHymnNullCategory.get(number) as
            { id: number; updated_at: string } | undefined;
          if (userHymn) {
            adoptHymnIntoCategory.run(userCatId, userHymn.id);
            adopted++;
          }
        }

        if (!userHymn) {
          const result = insertHymn.run(
            number, seedHymn.title, seedHymn.search_text, userCatId,
            seedHymn.created_at ?? '', seedHymn.updated_at ?? ''
          );
          const hymnId = Number(result.lastInsertRowid);
          for (const s of seedSections) {
            insertSection.run(hymnId, s.order_index, s.type, s.text, s.updated_at ?? '');
          }
          inserted++;
          continue;
        }

        // Existing hymn: refresh only if the seed is at least as new as everything
        // the user has on it (untouched hymns have updated_at = '').
        const seedTs = seedHymn.updated_at || '';
        if (!seedTs) continue;
        // deja sincronizat la acest seed — sărim comparația de conținut
        if ((userHymn.updated_at || '') === seedTs) continue;
        const userSections = getUserSections.all(userHymn.id) as
          { type: string; text: string; updated_at: string }[];
        const userNewest = [userHymn.updated_at || '', ...userSections.map(s => s.updated_at || '')]
          .reduce((a, b) => (a > b ? a : b), '');
        if (userNewest > seedTs) continue;

        const sameContent =
          userSections.length === seedSections.length &&
          userSections.every((s, i) =>
            s.type === seedSections[i].type && s.text.trim() === seedSections[i].text.trim());
        const sameTitle = (userDb.prepare('SELECT title FROM hymns WHERE id = ?')
          .get(userHymn.id) as { title: string }).title === seedHymn.title;
        if (sameContent && sameTitle) continue;

        updateHymnRow.run(seedHymn.title, seedHymn.search_text, seedTs, userHymn.id);
        if (!sameContent) {
          deleteSections.run(userHymn.id);
          for (const s of seedSections) {
            insertSection.run(userHymn.id, s.order_index, s.type, s.text, s.updated_at ?? '');
          }
        }
        refreshed++;
      }
    });
    tx();

    if (createdCategories > 0 || inserted > 0 || refreshed > 0 || adopted > 0) {
      console.log(`[DB Sync] Seed content: +${createdCategories} categorii, +${inserted} imnuri noi, ${refreshed} imnuri actualizate, ${adopted} adoptate în categorie`);
    }

    seedDb.close();
  } catch (err) {
    console.error('[DB Sync] syncSeedContent failed:', err);
  }
}
