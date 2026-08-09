#!/usr/bin/env node
/**
 * Aduce în baza LIVRATĂ cu aplicația (public/hymns.db) tot ce ai publicat în hangar.
 *
 * De ce există: o corectură publicată ajunge OTA la instalările existente, dar cine
 * instalează aplicația mâine primește baza din installer. Dacă baza aia nu ține pasul,
 * omul nou primește textul vechi și abia apoi îl corectează feed-ul — sau nu-l
 * corectează deloc, dacă `seq`-ul e deja depășit. Sincronizarea se face automat la
 * fiecare release; nu întreabă nimic și nu cere să-și amintească nimeni de ea.
 *
 * Se oprește cu eroare — deci oprește și release-ul — doar când chiar e ceva de
 * lămurit: feed-ul nu se poate lua, o intrare e stricată, sau normalizarea textului
 * de căutare nu mai e cea din aplicație.
 *
 * Rulează sub runtime-ul Electron, pentru că better-sqlite3 e compilat pentru el:
 *   npm run sync:seed
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RADACINA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(RADACINA, 'public/hymns.db');
const FEED = 'https://hangar.it4all.ro/d/ba3166b608233a30/corrections.json';

const mor = msg => { console.error(`\n❌ ${msg}\n`); process.exit(1); };

// Aceleași două normalizări ca în electron/db.ts. Dacă vreodată se schimbă acolo și
// nu aici, verificarea de mai jos pică — în loc să scrie tăcut search_text greșit.
const numarNormalizat = n => {
  const t = String(n ?? '').trim();
  return /^\d+$/.test(t) ? String(parseInt(t, 10)).padStart(3, '0') : t;
};
const textDeCautare = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Feed ──────────────────────────────────────────────────────────────────────

let feed;
try {
  const res = await fetch(FEED, { headers: { 'User-Agent': 'AdventShow-seed-sync/1.0' } });
  if (!res.ok) mor(`hangar a răspuns ${res.status} la ${FEED}`);
  feed = await res.json();
} catch (err) {
  mor(`nu pot lua corecturile din hangar: ${err.message}`);
}
const intrari = Array.isArray(feed?.entries) ? feed.entries : null;
if (!intrari) mor('feed-ul nu are lista „entries" — nu ating baza livrată');
if (intrari.length === 0) { console.log('   feed gol — nimic de adus'); process.exit(0); }

// ── Baza livrată ──────────────────────────────────────────────────────────────

if (!fs.existsSync(SEED)) mor(`lipsește ${SEED}`);
const Database = require('better-sqlite3');
const db = new Database(SEED);

// Verificare de siguranță: normalizarea de aici trebuie să fie cea cu care a fost
// scrisă baza. Dacă a divergat, orice rând pe care îl atingem devine negăsibil.
const esantion = db.prepare(`SELECT number, title, search_text, id FROM hymns
  WHERE search_text IS NOT NULL AND search_text <> '' LIMIT 300`).all();
let nepotriviri = 0;
for (const h of esantion) {
  const sectiuni = db.prepare('SELECT text FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index')
    .all(h.id).map(s => s.text).join(' ');
  if (textDeCautare(`${h.number} ${h.title} ${sectiuni}`) !== h.search_text) nepotriviri++;
}
if (nepotriviri > esantion.length * 0.1) {
  mor(`normalizarea textului de căutare nu mai e cea din baza livrată (${nepotriviri}/${esantion.length} rânduri diferă). ` +
      'Compară cu normalizeSearchText din electron/db.ts înainte să mergi mai departe.');
}

// ── Aplicăm ───────────────────────────────────────────────────────────────────

let adaugate = 0, actualizate = 0, lasate = 0;
const colectiiNoi = [];

const tx = db.transaction(() => {
  for (const e of [...intrari].sort((a, b) => a.seq - b.seq)) {
    const numeColectie = String(e.category ?? '').trim();
    // Sfârșiturile de rând în stil Windows vin din propunerile trimise de biserici.
    // Baza livrată ține „\n"; dacă am scrie „\r\n", amprenta calculată de aplicație
    // pe baza livrată n-ar mai coincide cu cea de pe textul primit prin feed.
    const sectiuni = (Array.isArray(e.sections) ? e.sections : [])
      .filter(s => s && (s.type === 'strofa' || s.type === 'refren') && s.text)
      .map(s => ({ type: s.type, text: String(s.text).replace(/\r\n?/g, '\n') }));
    if (!numeColectie || !e.title || sectiuni.length === 0) {
      mor(`intrarea seq ${e.seq} e incompletă (colecție/titlu/strofe) — nu ghicesc ce ai vrut`);
    }

    let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(numeColectie);
    if (!cat) {
      db.prepare('INSERT INTO categories (name, is_builtin) VALUES (?, 1)').run(numeColectie);
      cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(numeColectie);
      colectiiNoi.push(numeColectie);
    }

    const numar = numarNormalizat(e.number);
    const cand = e.ts || new Date().toISOString();

    // ATENȚIE: în baza LIVRATĂ numerele sunt încă nepadate („2"), padding-ul la trei
    // cifre se face abia la prima pornire a aplicației. Căutarea directă după „002"
    // nu găsea nimic și insera un duplicat peste imnul existent. Comparăm formele
    // normalizate, nu șirurile brute, și păstrăm scrierea rândului găsit.
    const imn = db.prepare('SELECT id, title, number FROM hymns WHERE category_id = ?')
      .all(cat.id).find(h => numarNormalizat(h.number) === numar);

    // search_text folosește numărul așa cum e scris în rând, ca să rămână la fel ca
    // restul bazei; la un imn nou scriem forma padată, cea pe care o folosește app-ul.
    const numarScris = imn ? imn.number : numar;
    const cautare = textDeCautare(`${numarScris} ${e.title} ${sectiuni.map(s => s.text).join(' ')}`);

    if (!imn) {
      const r = db.prepare(`INSERT INTO hymns (number, title, search_text, category_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(numar, e.title, cautare, cat.id, cand, cand);
      sectiuni.forEach((s, i) => db.prepare(`INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at)
        VALUES (?, ?, ?, ?, ?)`).run(Number(r.lastInsertRowid), i, s.type, s.text, cand));
      adaugate++;
      console.log(`   + ${numeColectie} ${numar} — ${e.title}`);
      continue;
    }

    const acum = db.prepare('SELECT type, text FROM hymn_sections WHERE hymn_id = ? ORDER BY order_index')
      .all(imn.id);
    const lafel = imn.title.normalize('NFC').trim() === String(e.title).normalize('NFC').trim()
      && acum.length === sectiuni.length
      && acum.every((s, i) => s.type === sectiuni[i].type
        && s.text.normalize('NFC').trim() === String(sectiuni[i].text).normalize('NFC').trim());
    if (lafel) { lasate++; continue; }

    db.prepare('UPDATE hymns SET title = ?, search_text = ?, updated_at = ? WHERE id = ?')
      .run(e.title, cautare, cand, imn.id);
    // `number` NU se atinge: dacă baza livrată îl are nepadat, așa rămâne, ca
    // padding-ul de la prima pornire să-l trateze o singură dată.
    db.prepare('DELETE FROM hymn_sections WHERE hymn_id = ?').run(imn.id);
    sectiuni.forEach((s, i) => db.prepare(`INSERT INTO hymn_sections (hymn_id, order_index, type, text, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(imn.id, i, s.type, s.text, cand));
    actualizate++;
    console.log(`   ~ ${numeColectie} ${numar} — ${e.title}`);
  }

  // Plasa de siguranță: după ce am umblat la bază, nicio colecție nu are voie să
  // aibă două imnuri cu același număr. Prima versiune a scriptului a produs exact
  // asta — căuta „002" într-o bază care ține „2" — și ar fi livrat duplicate.
  const dubluri = db.prepare(`SELECT c.name, h.number, COUNT(*) n FROM hymns h
    JOIN categories c ON c.id = h.category_id
    GROUP BY h.category_id, CASE WHEN TRIM(h.number) GLOB '*[^0-9]*' THEN TRIM(h.number)
      ELSE printf('%03d', CAST(h.number AS INTEGER)) END
    HAVING n > 1`).all();
  if (dubluri.length) {
    throw new Error('au ieșit numere duplicate în baza livrată: '
      + dubluri.map(d => `${d.name} ${d.number} (×${d.n})`).join(', '));
  }
});
try {
  tx();
} catch (err) {
  db.close();
  mor(`nu am scris nimic — ${err.message}`);
}
db.close();

for (const c of colectiiNoi) console.log(`   colecție nouă în baza livrată: „${c}"`);
console.log(`   corecturi în hangar: ${intrari.length} · aduse acum: ${adaugate} noi, ${actualizate} actualizate, ${lasate} deja la zi`);
