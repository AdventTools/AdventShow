import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
import { getDb } from './db';
import { HANGAR_CORRECTIONS_URL, HangarDeps, HangarSettings, sendProposals } from './hangar';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// ═════════════════════════════════════════════════════════════════════════════
// Contribuții (utilizatori → AdventShow) + corecturi OTA (AdventShow → utilizatori)
//
// AMBELE rulează amânat, după ce fereastra e afișată (vezi main.ts) — niciodată
// în calea pornirii. Fără internet totul se sare instant; aplicația merge normal
// din baza locală.
//
// • Contribuții: modificările utilizatorului față de baza oficială (seed), aflate
//   în „carantină" de cel puțin 7 zile de la ultima editare, se trimit AUTOMAT
//   în hangar, ca propuneri de conținut. DOAR autorii decid manual ce se acceptă;
//   nimic nu se aplică programatic. (Până la v1.3.14 mergeau într-un formular
//   Google.) `hash`-ul fiecărei propuneri e cheia de idempotență PE SERVER:
//   aceeași corectură trimisă de a doua oară nu creează un rând nou, iar venită
//   de la altă biserică devine un vot în plus pe același rând. Formula lui NU se
//   schimbă — istoricul importat în hangar e cheiat pe ea.
// • Corecturi OTA: aplicația citește feed-ul publicat de autori din hangar și
//   aplică intrările noi (seq crescător). `force: true` suprascrie necondiționat;
//   altfel modificările proprii ale utilizatorului au prioritate.
// ═════════════════════════════════════════════════════════════════════════════

const QUARANTINE_DAYS = 7;
const MAX_HYMNS_PER_SUBMISSION = 20; // restul pleacă la verificarea următoare
const FETCH_TIMEOUT_MS = 4000;

interface ContribSettings extends HangarSettings {
  contribLastCheckAt?: string;
  contribSentHashes?: Record<string, string>;
  correctionsLastSeq?: number;
  correctionsLastCheckAt?: string;
}

export interface ContribDeps extends HangarDeps {
  seedDbPath: string;
  getSettings: () => ContribSettings;
  patchSettings: (patch: Partial<ContribSettings>) => void;
}

interface SectionRow { type: 'strofa' | 'refren'; text: string }
interface HymnContent { title: string; sections: SectionRow[] }

// ── Helpers (aceeași semantică precum db.ts) ─────────────────────────────────

function normalizeHymnNumber(number: string): string {
  const trimmed = String(number ?? '').trim();
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10)).padStart(3, '0');
  return trimmed;
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const nfc = (s: string) => (s || '').normalize('NFC').trim();

function sameContent(a: HymnContent, b: HymnContent): boolean {
  if (nfc(a.title) !== nfc(b.title)) return false;
  if (a.sections.length !== b.sections.length) return false;
  return a.sections.every((s, i) =>
    s.type === b.sections[i].type && nfc(s.text) === nfc(b.sections[i].text));
}

function contentHash(action: string, c: HymnContent): string {
  const data = JSON.stringify({ action, title: nfc(c.title), sections: c.sections.map(s => ({ t: s.type, x: nfc(s.text) })) });
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null; // offline / timeout — complet silențios
  } finally {
    clearTimeout(timer);
  }
}

const onceADay = (lastIso?: string) => {
  if (!lastIso) return true;
  const last = Date.parse(lastIso);
  return !Number.isFinite(last) || Date.now() - last > 22 * 3600 * 1000;
};

// ═════════════════════════════════════════════════════════════════════════════
// Corecturi OTA
// ═════════════════════════════════════════════════════════════════════════════

interface CorrectionEntry {
  seq: number;
  category: string;           // numele categoriei, ex. "Exploratori"
  number: string | number;    // numărul imnului
  title: string;
  sections: SectionRow[];
  force?: boolean;            // true = suprascrie indiferent de modificările userului
  ts?: string;                // ISO — momentul publicării
}

export async function applyOtaCorrections(deps: ContribDeps): Promise<void> {
  const settings = deps.getSettings();
  if (!onceADay(settings.correctionsLastCheckAt)) return;

  const res = await fetchWithTimeout(HANGAR_CORRECTIONS_URL);
  // Offline sau timeout: reîncercăm la următoarea pornire, fără să marcăm nimic.
  if (!res) return;
  // 404 = autorii n-au publicat încă nicio corectură. Nu e o eroare; marcăm
  // verificarea, altfel am bate la ușă la fiecare pornire.
  if (res.status === 404) {
    deps.patchSettings({ correctionsLastCheckAt: new Date().toISOString() });
    return;
  }
  if (!res.ok) return;

  let entries: CorrectionEntry[] = [];
  try {
    const feed = await res.json() as { entries?: CorrectionEntry[] };
    entries = Array.isArray(feed?.entries) ? feed.entries : [];
  } catch {
    return;
  }

  const lastSeq = settings.correctionsLastSeq ?? 0;
  const fresh = entries
    .filter(e => typeof e?.seq === 'number' && e.seq > lastSeq && e.category && e.number != null && Array.isArray(e.sections))
    .sort((a, b) => a.seq - b.seq);

  if (fresh.length === 0) {
    deps.patchSettings({ correctionsLastCheckAt: new Date().toISOString() });
    return;
  }

  const db = getDb();
  let applied = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const entry of fresh) {
      const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(entry.category) as { id: number } | undefined;
      if (!cat) { skipped++; continue; }
      const number = normalizeHymnNumber(String(entry.number));
      const ts = entry.ts || new Date().toISOString();
      const sections = entry.sections.filter(s => s && (s.type === 'strofa' || s.type === 'refren') && s.text);
      if (sections.length === 0) { skipped++; continue; }
      const searchText = normalizeSearchText(`${number} ${entry.title} ${sections.map(s => s.text).join(' ')}`);

      const user = db.prepare('SELECT id, title, updated_at FROM hymns WHERE category_id = ? AND number = ? LIMIT 1')
        .get(cat.id, number) as { id: number; title: string; updated_at: string } | undefined;

      if (!user) {
        // imn nou publicat prin feed
        const r = db.prepare(
          'INSERT INTO hymns (number, title, search_text, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(number, entry.title, searchText, cat.id, ts, ts);
        const hid = Number(r.lastInsertRowid);
        sections.forEach((s, i) => db.prepare(
          'INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(hid, i, s.type, s.text, ts));
        applied++;
        continue;
      }

      const userSections = db.prepare(
        'SELECT type, text, updated_at FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index'
      ).all(user.id) as { type: 'strofa' | 'refren'; text: string; updated_at: string }[];

      if (sameContent({ title: user.title, sections: userSections }, { title: entry.title, sections })) {
        skipped++;
        continue;
      }

      if (!entry.force) {
        // neforțat: modificările PROPRII ale utilizatorului (mai noi decât corectura) rămân
        const userNewest = [user.updated_at || '', ...userSections.map(s => s.updated_at || '')]
          .reduce((a, b) => (a > b ? a : b), '');
        if (userNewest > ts) { skipped++; continue; }
      }

      db.prepare('UPDATE hymns SET title = ?, search_text = ?, updated_at = ? WHERE id = ?')
        .run(entry.title, searchText, ts, user.id);
      db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?').run(user.id);
      sections.forEach((s, i) => db.prepare(
        'INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(user.id, i, s.type, s.text, ts));
      applied++;
    }
  });
  tx();

  // Salvăm DUPĂ ce tranzacția a trecut: o cădere la jumătate lasă seq-ul vechi,
  // deci corecturile se reiau, în loc să fie sărite pentru totdeauna.
  deps.patchSettings({
    correctionsLastSeq: fresh[fresh.length - 1].seq,
    correctionsLastCheckAt: new Date().toISOString(),
  });
  deps.log(`[OTA] corecturi: ${applied} aplicate, ${skipped} sărite (seq → ${fresh[fresh.length - 1].seq})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Contribuții
// ═════════════════════════════════════════════════════════════════════════════

interface Candidate {
  action: 'modificat' | 'adaugat';
  category: string | null;
  number: string;
  content: HymnContent;
  before: HymnContent | null;
  key: string;
  hash: string;
}

function collectCandidates(deps: ContribDeps): Candidate[] {
  if (!fs.existsSync(deps.seedDbPath)) return [];
  const db = getDb();
  const seed = new Database(deps.seedDbPath, { readonly: true });

  try {
    // harta seed: "categorie|număr" -> conținut canonic
    const seedCats = new Map<number, string>(
      (seed.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[])
        .map(c => [c.id, c.name]));
    const seedMap = new Map<string, HymnContent>();
    for (const h of seed.prepare('SELECT id, number, title, category_id FROM hymns WHERE category_id IS NOT NULL').all() as
      { id: number; number: string; title: string; category_id: number }[]) {
      const catName = seedCats.get(h.category_id);
      if (!catName) continue;
      const sections = seed.prepare(
        'SELECT type, text FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index'
      ).all(h.id) as SectionRow[];
      seedMap.set(`${catName}|${normalizeHymnNumber(h.number)}`, { title: h.title, sections });
    }

    const userCats = new Map<number, string>(
      (db.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[])
        .map(c => [c.id, c.name]));

    const cutoff = new Date(Date.now() - QUARANTINE_DAYS * 24 * 3600 * 1000).toISOString();
    const out: Candidate[] = [];

    for (const h of db.prepare('SELECT id, number, title, category_id, created_at, updated_at FROM hymns').all() as
      { id: number; number: string; title: string; category_id: number | null; created_at: string; updated_at: string }[]) {
      const sections = db.prepare(
        'SELECT type, text, updated_at FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index'
      ).all(h.id) as { type: 'strofa' | 'refren'; text: string; updated_at: string }[];
      if (sections.length === 0) continue;

      const catName = h.category_id != null ? (userCats.get(h.category_id) ?? null) : null;
      const number = normalizeHymnNumber(h.number);
      const content: HymnContent = { title: h.title, sections: sections.map(s => ({ type: s.type, text: s.text })) };
      const seedContent = catName ? seedMap.get(`${catName}|${number}`) : undefined;

      let action: Candidate['action'];
      let before: HymnContent | null;
      if (seedContent) {
        if (sameContent(content, seedContent)) continue; // identic cu baza oficială
        action = 'modificat';
        before = seedContent;
      } else {
        action = 'adaugat';
        before = null;
      }

      // carantină: cea mai NOUĂ atingere trebuie să fie mai veche de 7 zile.
      // ('' = atingere veche, dinainte de v1.3.0 — considerată trecută de carantină)
      const newest = [h.updated_at || '', h.created_at || '', ...sections.map(s => s.updated_at || '')]
        .reduce((a, b) => (a > b ? a : b), '');
      if (newest !== '' && newest > cutoff) continue;

      const key = `${catName ?? '(fără categorie)'}|${number}`;
      out.push({ action, category: catName, number, content, before, key, hash: contentHash(action, content) });
    }
    return out;
  } finally {
    seed.close();
  }
}

// Rezumatul text „înainte / după" nu se mai construiește aici: hangar primește
// `before` și conținutul nou și desenează singur diferența, cu cuvintele schimbate
// marcate și strofele neatinse pliate — mai bine decât orice text plat.

export async function maybeSendContributions(deps: ContribDeps): Promise<void> {
  const settings = deps.getSettings();
  if (!onceADay(settings.contribLastCheckAt)) return;

  const sentHashes = settings.contribSentHashes ?? {};
  const all = collectCandidates(deps);
  const fresh = all.filter(c => sentHashes[c.key] !== c.hash).slice(0, MAX_HYMNS_PER_SUBMISSION);

  if (fresh.length === 0) {
    deps.patchSettings({ contribLastCheckAt: new Date().toISOString() });
    return;
  }

  // Câte un element per imn, fiecare cu hash-ul lui: serverul le judecă separat,
  // le dedupe și le numără voturile.
  const res = await sendProposals(deps, 'hymn', fresh.map(c => ({
    action: c.action,
    category: c.category,
    number: c.number,
    title: c.content.title,
    sections: c.content.sections,
    before: c.before,
    hash: c.hash,
  })));

  if (!res) {
    // Offline sau refuz: NU marcăm nimic ca trimis, ca să reîncercăm mâine.
    deps.patchSettings({ contribLastCheckAt: new Date().toISOString() });
    return;
  }

  // Lista locală de hash-uri rămâne, dar acum doar ca să nu mai batem drumul
  // degeaba — protecția reală împotriva duplicatelor e pe server.
  const newHashes = { ...sentHashes };
  for (const c of fresh) newHashes[c.key] = c.hash;
  deps.patchSettings({
    contribSentHashes: newHashes,
    contribLastCheckAt: new Date().toISOString(),
  });
  deps.log(`[Contrib] trimise ${fresh.length} propuneri: ${res.stored} noi,`
    + ` ${res.duplicates} deja cunoscute (carantină ${QUARANTINE_DAYS} zile)`);
}

// numărul de modificări aflate în așteptare (pentru afișare în Setări)
export function getContributionStatus(deps: ContribDeps): { pending: number; sent: number } {
  try {
    const settings = deps.getSettings();
    const sentHashes = settings.contribSentHashes ?? {};
    const all = collectCandidates(deps);
    const pending = all.filter(c => sentHashes[c.key] !== c.hash).length;
    return { pending, sent: Object.keys(sentHashes).length };
  } catch {
    return { pending: 0, sent: 0 };
  }
}
