import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
import { getDb, MY_HYMNS_CATEGORY } from './db';
import {
  HANGAR_CORRECTIONS_URL, HangarDeps, HangarSettings, fetchProposalVerdicts, sendProposals,
} from './hangar';

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
  // „categorie|număr" -> amprenta textului pe care i l-am trimis noi prin corectură.
  // Fără asta, corectura noastră arată exact ca o modificare făcută de el și ne-o
  // trimite înapoi ca propunere (s-a întâmplat: 10 din 106 propuneri erau ale noastre).
  otaApplied?: Record<string, string>;
  // corectură oficială nepusă, pentru că imnul e modificat de biserică
  pendingOfficial?: Record<string, PendingOfficial>;
  // textul bisericii, înlocuit de o corectură marcată drept „textul oficial era greșit"
  forceReplaced?: Record<string, ReplacedText>;
  // hash-ul propunerii -> ce s-a hotărât cu ea și ce a ales utilizatorul mai departe
  decisions?: Record<string, StoredDecision>;
}

export interface ContribDeps extends HangarDeps {
  seedDbPath: string;
  getSettings: () => ContribSettings;
  patchSettings: (patch: Partial<ContribSettings>) => void;
}

interface SectionRow { type: 'strofa' | 'refren'; text: string }
export interface PendingOfficial { seq: number; title: string; sections: SectionRow[]; ts: string }
export interface ReplacedText { title: string; sections: SectionRow[]; at: string }
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

// NU se schimbă formula: e cheia de idempotență pe server, iar tot istoricul de
// propuneri e cheiat pe ea. O modificare ar redepune tot ce a fost deja judecat.
function contentHash(action: string, c: HymnContent): string {
  const data = JSON.stringify({ action, title: nfc(c.title), sections: c.sections.map(s => ({ t: s.type, x: nfc(s.text) })) });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Amprenta TEXTULUI, fără acțiune — aceeași formulă cu `text_hash` din feed-ul de
 * corecturi. Cu ea știm dacă ce are omul local e exact ce i-am trimis noi.
 */
function textHash(c: HymnContent): string {
  const data = JSON.stringify({
    title: nfc(c.title),
    sections: c.sections.map(s => ({ t: s.type, x: nfc(s.text) })),
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Amprentele textului din baza livrată cu aplicația, pe „categorie|număr".
 *
 * E referința față de care spunem dacă biserica a umblat la un imn. Se citește doar
 * când chiar avem corecturi de aplicat, deci nu la fiecare pornire.
 */
function seedTextHashes(seedDbPath: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(seedDbPath)) return out;
  const seed = new Database(seedDbPath, { readonly: true });
  try {
    const cats = new Map<number, string>(
      (seed.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[])
        .map(c => [c.id, c.name]));
    for (const h of seed.prepare('SELECT id, number, title, category_id FROM hymns WHERE category_id IS NOT NULL').all() as
      { id: number; number: string; title: string; category_id: number }[]) {
      const cat = cats.get(h.category_id);
      if (!cat) continue;
      const sections = seed.prepare(
        'SELECT type, text FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index'
      ).all(h.id) as SectionRow[];
      out.set(`${cat}|${normalizeHymnNumber(h.number)}`, textHash({ title: h.title, sections }));
    }
  } finally {
    seed.close();
  }
  return out;
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
  // Imn NOU, nu corectură la unul de-al nostru: se pune doar dacă numărul e liber.
  // La o corectură știm ce înlocuim; la o intrare nouă, numărul poate ține la ei
  // orice — inclusiv un imn propriu. Bate `force`.
  only_if_absent?: boolean;
  onlyIfAbsent?: boolean;
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
  // Ce text devine „oficial" la el, ca să nu-l luăm mai târziu drept modificare a lui.
  const officialNow: Record<string, string> = { ...(settings.otaApplied ?? {}) };
  // Corecturi pe care NU le-am aplicat, pentru că imnul e al lui — le ține ca să le
  // poată vedea și adopta când vrea.
  const official: Record<string, PendingOfficial> = { ...(settings.pendingOfficial ?? {}) };
  // Variante ale lui pe care le-am înlocuit forțat, ca să le poată pune la loc.
  const replaced: Record<string, ReplacedText> = { ...(settings.forceReplaced ?? {}) };
  // Amprentele bazei livrate cu aplicația — referința pentru „a umblat la imn?".
  const seedHashes = seedTextHashes(deps.seedDbPath);
  const tx = db.transaction(() => {
    for (const entry of fresh) {
      // Colecția lipsește? O facem. Până acum intrarea era sărită în tăcere, iar
      // seq-ul mergea înainte — deci o colecție nouă publicată de autori s-ar fi
      // pierdut pentru totdeauna la oricine n-o avea deja.
      let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(entry.category) as { id: number } | undefined;
      if (!cat) {
        const nume = String(entry.category).trim();
        if (!nume || nume.length > 60) { skipped++; continue; }
        db.prepare('INSERT OR IGNORE INTO categories (name, is_builtin) VALUES (?, 1)').run(nume);
        cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(nume) as { id: number } | undefined;
        if (!cat) { skipped++; continue; }
        deps.log(`[OTA] colecție nouă creată: „${nume}"`);
      }
      const number = normalizeHymnNumber(String(entry.number));
      const key = `${entry.category}|${number}`;
      const ts = entry.ts || new Date().toISOString();
      // Sfârșiturile de rând vin uneori în stil Windows, pentru că așa le-a scris
      // biserica de la care a plecat propunerea. Le aducem la forma din baza noastră
      // ÎNAINTE de orice: și textul salvat, și amprenta se calculează pe același
      // șir. Altfel imnul intra cu „\r\n", amprenta se reținea pe „\r\n", iar la
      // următoarea corectură textul din bază n-ar mai fi semănat cu ce reținuserăm
      // — l-am fi luat drept modificare a bisericii și n-am mai fi trimis nimic.
      const sections = entry.sections
        .filter(s => s && (s.type === 'strofa' || s.type === 'refren') && s.text)
        .map(s => ({ type: s.type, text: s.text.replace(/\r\n?/g, '\n') }));
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

      // Intrare nouă pe un număr deja ocupat: nu atingem nimic, nici măcar cu
      // `force`. Ce e acolo e un ALT imn, nu o versiune mai veche a aceluiași —
      // îl reținem deoparte, ca omul să vadă despre ce e vorba și să aleagă el.
      if ((entry.only_if_absent || entry.onlyIfAbsent) === true) {
        official[key] = { seq: entry.seq, title: entry.title, sections, ts };
        skipped++;
        continue;
      }

      // A umblat biserica la imnul ăsta?
      //
      // NU după data ultimei atingeri — aia era o loterie: cine își adaptase imnul
      // acum doi ani îl pierdea, cine îl atinsese din greșeală săptămâna trecută îl
      // păstra, fără ca cineva să fi hotărât ceva. Ci după TEXT: comparăm ce are cu
      // ce i-am dat noi ultima oară (corectura precedentă, dacă a fost, altfel baza
      // livrată cu aplicația).
      //
      // Dacă nu avem NICIO referință pentru numărul ăsta — nici în baza livrată, nici
      // dintr-o corectură de-a noastră — atunci ce e acolo nu vine de la noi, deci e
      // al lui. Înainte îl socoteam „neatins" și îl suprascriam: exact așa ar fi
      // dispărut imnul propriu al unei biserici la prima intrare nouă publicată
      // într-o colecție pe care noi n-o livrasem încă.
      const localHash = textHash({ title: user.title, sections: userSections });
      const referinta = officialNow[key] ?? seedHashes.get(key);
      const alLui = referinta === undefined || localHash !== referinta;

      if (alLui && !entry.force) {
        // Varianta lui rămâne. Dar nu o îngropăm: reținem textul oficial, ca să-l
        // poată vedea și adopta oricând. Fără asta, corectura ar fi pierdută pentru
        // el pentru totdeauna — seq-ul merge înainte oricum.
        official[key] = { seq: entry.seq, title: entry.title, sections, ts };
        skipped++;
        continue;
      }

      if (alLui && entry.force) {
        // Îi înlocuim varianta pentru că textul oficial era greșit. Îi păstrăm textul
        // și îi spunem — nimic nu dispare în tăcere.
        replaced[key] = {
          title: user.title,
          sections: userSections.map(s => ({ type: s.type, text: s.text })),
          at: new Date().toISOString(),
        };
      }

      db.prepare('UPDATE hymns SET title = ?, search_text = ?, updated_at = ? WHERE id = ?')
        .run(entry.title, searchText, ts, user.id);
      db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?').run(user.id);
      sections.forEach((s, i) => db.prepare(
        'INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(user.id, i, s.type, s.text, ts));
      officialNow[key] = textHash({ title: entry.title, sections });
      delete official[key];   // varianta oficială a ajuns la el, n-o mai ținem deoparte
      applied++;
    }
  });
  tx();

  // Salvăm DUPĂ ce tranzacția a trecut: o cădere la jumătate lasă seq-ul vechi,
  // deci corecturile se reiau, în loc să fie sărite pentru totdeauna.
  deps.patchSettings({
    correctionsLastSeq: fresh[fresh.length - 1].seq,
    correctionsLastCheckAt: new Date().toISOString(),
    otaApplied: officialNow,
    pendingOfficial: official,
    forceReplaced: replaced,
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
    const otaApplied = deps.getSettings().otaApplied ?? {};
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

      // Un imn fără categorie nu poate fi comparat cu nimic oficial, deci ar pleca
      // mereu ca „imn nou". Așa am primit 100 de propuneri de la o singură instalare
      // care își importase singură toată cartea. Nu-l trimitem.
      if (!catName) continue;

      const esteAlLui = catName === MY_HYMNS_CATEGORY;
      const seedContent = seedMap.get(`${catName}|${number}`);

      let action: Candidate['action'];
      let before: HymnContent | null;
      if (esteAlLui) {
        // „Imnurile mele": tot ce scrie acolo e al lui și pleacă spre autori — știe asta,
        // scrie în capul colecției. Nu are corespondent oficial, deci n-are „înainte".
        action = 'adaugat';
        before = null;
      } else if (seedContent) {
        if (sameContent(content, seedContent)) continue;   // identic cu baza oficială
        // Sau e chiar corectura pe care i-am trimis-o noi: atunci nu e modificarea lui.
        if (otaApplied[`${catName}|${number}`] === textHash(content)) continue;
        action = 'modificat';
        before = seedContent;
      } else {
        // Într-o colecție oficială, dar inexistent în seed: e un imn oficial mai nou
        // decât installerul lui, sau unul pe care l-a adăugat el acolo. În ambele
        // cazuri, locul propunerilor e „Imnurile mele" — aici nu inventăm.
        continue;
      }

      // carantină: cea mai NOUĂ atingere trebuie să fie mai veche de 7 zile.
      // ('' = atingere veche, dinainte de v1.3.0 — considerată trecută de carantină)
      const newest = [h.updated_at || '', h.created_at || '', ...sections.map(s => s.updated_at || '')]
        .reduce((a, b) => (a > b ? a : b), '');
      if (newest !== '' && newest > cutoff) continue;

      const key = `${catName}|${number}`;
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

// ═════════════════════════════════════════════════════════════════════════════
// Ce s-a hotărât cu propunerile lui
//
// Până acum aplicația trimitea și uita: omul nu afla niciodată dacă a intrat sau nu
// corectura lui, iar dacă noi o refuzam el rămânea tăcut cu varianta lui, pentru
// totdeauna. Acum întrebăm hub-ul, iar el alege ce se întâmplă mai departe.
// ═════════════════════════════════════════════════════════════════════════════

export interface PendingDecision {
  hash: string;
  key: string;                 // „categorie|număr" al imnului local
  category: string;
  number: string;
  title: string;
  status: 'accepted' | 'rejected';
  note: string;                // motivul scris de autori
  /** La un imn propriu acceptat: unde a intrat oficial. */
  publishedAs?: { category: string; number: string };
  /** `corectura` = modificare la un imn oficial; `imn` = imn din „Imnurile mele". */
  fel: 'corectura' | 'imn';
  /** Copia lui era identică cu textul oficial, așa că am șters-o singuri. Nu mai e
   *  nimic de ales — doar de citit. */
  autoCleaned?: boolean;
}

interface StoredDecision extends PendingDecision {
  resolved?: 'pastrat' | 'revenit' | 'sters';
}

/** Imnul dintr-o colecție, cu textul lui, gata de comparat. */
function hymnByKey(db: ReturnType<typeof getDb>, category: string, number: string):
  { id: number; continut: HymnContent } | null {
  const h = db.prepare(`SELECT h.id, h.title FROM hymns h JOIN categories c ON c.id = h.category_id
    WHERE c.name = ? AND h.number = ? LIMIT 1`).get(category, number) as
    { id: number; title: string } | undefined;
  if (!h) return null;
  const sections = db.prepare('SELECT type, text FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index')
    .all(h.id) as SectionRow[];
  return { id: h.id, continut: { title: h.title, sections } };
}

/** Aduce verdictele pentru tot ce am trimis și nu e încă rezolvat de utilizator. */
export async function refreshProposalDecisions(deps: ContribDeps): Promise<number> {
  const s = deps.getSettings();
  const sent = s.contribSentHashes ?? {};
  const known: Record<string, StoredDecision> = { ...(s.decisions ?? {}) };

  const deIntrebat = Object.values(sent).filter(h => !known[h] || !known[h].resolved);
  if (deIntrebat.length === 0) return 0;

  const verdicte = await fetchProposalVerdicts(deps, deIntrebat);
  if (!verdicte) return 0;   // offline — reîncercăm

  // De la hash înapoi la imnul local, ca să știm ce-i arătăm omului.
  const keyByHash = new Map(Object.entries(sent).map(([k, h]) => [h, k]));
  const db = getDb();
  let noi = 0;

  for (const v of verdicte) {
    if (v.status !== 'accepted' && v.status !== 'rejected') continue;
    if (known[v.hash]?.resolved) continue;
    const key = keyByHash.get(v.hash);
    if (!key) continue;
    const [category, number] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
    const row = db.prepare(`SELECT h.title FROM hymns h JOIN categories c ON c.id = h.category_id
      WHERE c.name = ? AND h.number = ? LIMIT 1`).get(category, number) as { title: string } | undefined;
    // Imnul a dispărut local (l-a șters chiar el) — nu mai e nimic de întrebat.
    if (!row) continue;

    const inainte = known[v.hash];
    known[v.hash] = {
      hash: v.hash, key, category, number, title: row.title,
      status: v.status, note: v.note ?? '',
      fel: category === MY_HYMNS_CATEGORY ? 'imn' : 'corectura',
      ...(v.category && v.number ? { publishedAs: { category: v.category, number: v.number } } : {}),
    };

    // Imnul lui a intrat oficial. Dacă textul oficial ajuns la el e IDENTIC cu ce are
    // în „Imnurile mele", întrebarea „ștergi copia?" e degeaba — sunt același lucru.
    // Ștergem copia și doar îl anunțăm. Când textele diferă, întrebarea rămâne: între
    // trimitere și publicare noi umblăm des la text, iar o ștergere tăcută i-ar
    // schimba imnul fără să vadă cu ce.
    const publicat = known[v.hash].publishedAs;
    if (v.status === 'accepted' && publicat && category === MY_HYMNS_CATEGORY) {
      const lui = hymnByKey(db, category, number);
      const oficial = hymnByKey(db, publicat.category, normalizeHymnNumber(publicat.number));
      if (lui && oficial && lui.id !== oficial.id
        && textHash(lui.continut) === textHash(oficial.continut)) {
        db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?').run(lui.id);
        db.prepare('DELETE FROM hymns WHERE id = ?').run(lui.id);
        known[v.hash].autoCleaned = true;
        deps.log(`[Contrib] copia din „${MY_HYMNS_CATEGORY}" era identică cu ${publicat.category} ${publicat.number} — am șters-o`);
      }
    }
    if (!inainte) noi++;
  }

  deps.patchSettings({ decisions: known });
  if (noi > 0) deps.log(`[Contrib] ${noi} verdicte noi de la autori`);
  return noi;
}

/**
 * Starea imnurilor despre care avem ceva de spus. Doar astea — o comparație a
 * întregii baze la fiecare randare ar fi degeaba: pentru restul imnurilor nu există
 * nimic de comunicat.
 */
export interface HymnState {
  key: string;
  category: string;
  number: string;
  /**
   * `oficial-nou` — biserica are varianta ei, iar noi am publicat între timp una
   *   oficială pe care n-am aplicat-o peste a ei.
   * `inlocuit`    — i-am înlocuit varianta printr-o corectură marcată „textul
   *   oficial era greșit"; îi putem pune la loc textul.
   */
  fel: 'oficial-nou' | 'inlocuit';
  titlu: string;
  cand: string;
}

export function listHymnStates(deps: ContribDeps): HymnState[] {
  const s = deps.getSettings();
  const out: HymnState[] = [];
  const desparte = (key: string) => ({
    category: key.slice(0, key.lastIndexOf('|')),
    number: key.slice(key.lastIndexOf('|') + 1),
  });
  for (const [key, v] of Object.entries(s.pendingOfficial ?? {})) {
    out.push({ key, ...desparte(key), fel: 'oficial-nou', titlu: v.title, cand: v.ts });
  }
  for (const [key, v] of Object.entries(s.forceReplaced ?? {})) {
    out.push({ key, ...desparte(key), fel: 'inlocuit', titlu: v.title, cand: v.at });
  }
  return out;
}

/**
 * Trece imnul pe varianta oficială pe care o țineam deoparte (sau, la unul înlocuit
 * forțat, pune la loc varianta bisericii). Ambele sunt reversibile: textul celălalt
 * rămâne păstrat până când omul alege definitiv.
 */
export function applyHymnState(
  deps: ContribDeps, key: string, alegere: 'adopta-oficial' | 'pastreaza-al-meu' | 'pune-la-loc-al-meu',
): { ok: boolean; error?: string } {
  const s = deps.getSettings();
  const pending = { ...(s.pendingOfficial ?? {}) };
  const replaced = { ...(s.forceReplaced ?? {}) };
  const otaApplied = { ...(s.otaApplied ?? {}) };
  const category = key.slice(0, key.lastIndexOf('|'));
  const number = key.slice(key.lastIndexOf('|') + 1);

  const db = getDb();
  const row = db.prepare(`SELECT h.id FROM hymns h JOIN categories c ON c.id = h.category_id
    WHERE c.name = ? AND h.number = ? LIMIT 1`).get(category, number) as { id: number } | undefined;

  const scrie = (titlu: string, sections: SectionRow[], ts: string) => {
    if (!row) return false;
    const searchText = normalizeSearchText(`${number} ${titlu} ${sections.map(x => x.text).join(' ')}`);
    const tx = db.transaction(() => {
      db.prepare('UPDATE hymns SET title = ?, search_text = ?, updated_at = ? WHERE id = ?')
        .run(titlu, searchText, ts, row.id);
      db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?').run(row.id);
      sections.forEach((x, i) => db.prepare(
        'INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at) VALUES (?,?,?,?,?)'
      ).run(row.id, i, x.type, x.text, ts));
    });
    tx();
    return true;
  };

  if (alegere === 'adopta-oficial') {
    const v = pending[key];
    if (!v) return { ok: false, error: 'Nu mai există o variantă oficială de pus.' };
    if (!scrie(v.title, v.sections, v.ts)) return { ok: false, error: 'Imnul nu mai există.' };
    otaApplied[key] = textHash({ title: v.title, sections: v.sections });
    delete pending[key];
  } else if (alegere === 'pune-la-loc-al-meu') {
    const v = replaced[key];
    if (!v) return { ok: false, error: 'Nu mai există varianta ta păstrată.' };
    if (!scrie(v.title, v.sections, new Date().toISOString())) return { ok: false, error: 'Imnul nu mai există.' };
    delete replaced[key];
  } else {
    // Rămâne varianta lui. Nu-l mai întrebăm despre corectura asta.
    delete pending[key];
    delete replaced[key];
  }

  deps.patchSettings({ pendingOfficial: pending, forceReplaced: replaced, otaApplied });
  deps.log(`[Contrib] ${category} #${number}: ${alegere}`);
  return { ok: true };
}

/** Ce așteaptă un răspuns din partea utilizatorului. */
export function listPendingDecisions(deps: ContribDeps): PendingDecision[] {
  const all = deps.getSettings().decisions ?? {};
  return Object.values(all)
    .filter(d => !d.resolved)
    // Un imn acceptat cere o alegere doar dacă mai are copia locală; o corectură
    // respinsă, doar dacă omul chiar are altceva decât varianta oficială.
    .map(d => {
      const copie: PendingDecision & { resolved?: string } = { ...d };
      delete copie.resolved;
      return copie as PendingDecision;
    });
}

/**
 * Aplică alegerea omului.
 *
 * • `pastrat`  — nu atingem nimic; doar nu-l mai întrebăm despre asta.
 * • `revenit`  — punem la loc varianta oficială din baza livrată cu aplicația și
 *                ștergem urma editării lui, ca de-acum să primească normal
 *                corecturile la imnul ăsta.
 * • `sters`    — ștergem copia lui locală (imnul a intrat oficial în colecție).
 */
export function resolveDecision(
  deps: ContribDeps, hash: string, alegere: 'pastrat' | 'revenit' | 'sters',
): { ok: boolean; error?: string } {
  const all: Record<string, StoredDecision> = { ...(deps.getSettings().decisions ?? {}) };
  const d = all[hash];
  if (!d) return { ok: false, error: 'Decizia nu mai există.' };

  const db = getDb();
  const row = db.prepare(`SELECT h.id FROM hymns h JOIN categories c ON c.id = h.category_id
    WHERE c.name = ? AND h.number = ? LIMIT 1`).get(d.category, d.number) as { id: number } | undefined;

  if (alegere === 'sters') {
    if (row) db.prepare('DELETE FROM hymns WHERE id = ?').run(row.id);   // secțiunile pleacă în cascadă
  } else if (alegere === 'revenit') {
    if (!fs.existsSync(deps.seedDbPath)) return { ok: false, error: 'Nu găsesc baza oficială.' };
    const seed = new Database(deps.seedDbPath, { readonly: true });
    try {
      const oficial = seed.prepare(`SELECT h.id, h.title, h.search_text FROM hymns h
        JOIN categories c ON c.id = h.category_id WHERE c.name = ? AND h.number = ? LIMIT 1`)
        .get(d.category, d.number) as { id: number; title: string; search_text: string } | undefined;
      if (!oficial || !row) return { ok: false, error: 'Imnul nu mai există în baza oficială.' };
      const sections = seed.prepare(
        'SELECT order_index, type, text FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index'
      ).all(oficial.id) as { order_index: number; type: string; text: string }[];
      const tx = db.transaction(() => {
        // updated_at gol = „neatins de utilizator", deci corecturile viitoare intră
        // fără să mai fie nevoie să întrebăm pe nimeni.
        db.prepare('UPDATE hymns SET title = ?, search_text = ?, updated_at = ? WHERE id = ?')
          .run(oficial.title, oficial.search_text, '', row.id);
        db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?').run(row.id);
        for (const s of sections) {
          db.prepare('INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at) VALUES (?,?,?,?,?)')
            .run(row.id, s.order_index, s.type, s.text, '');
        }
      });
      tx();
    } finally {
      seed.close();
    }
  }

  all[hash] = { ...d, resolved: alegere };
  // Scoatem imnul din lista „trimise", ca o eventuală editare viitoare să plece din nou.
  const sent = { ...(deps.getSettings().contribSentHashes ?? {}) };
  if (alegere !== 'pastrat') delete sent[d.key];
  deps.patchSettings({ decisions: all, contribSentHashes: sent });
  deps.log(`[Contrib] decizie „${alegere}" pentru ${d.category} #${d.number}`);
  return { ok: true };
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
