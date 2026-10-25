/**
 * Recunoaște copia unui imn oficial după cuvinte, nu după număr sau după amprenta exactă.
 *
 * Bisericile își importă colecția de PowerPoint-uri, cu tot cu imnurile pe care le avem
 * deja: textul iese cu rânduri mutate, refrene scoase, cuvinte despărțite greșit, deci
 * nicio comparație exactă nu-l prinde. Așa au ajuns 211 copii în propuneri (2026-10).
 * Pragul: două imnuri oficiale diferite nu trec de 50% cuvinte comune; peste 50% sunt
 * doar variante ale aceluiași cântec. La 70% e sigur copia unuia de-al nostru.
 */
import { MY_HYMNS_CATEGORY } from './db';

const PRAG = 0.7;
const MINIM_CUVINTE = 12;   // sub atât, două imnuri scurte se pot potrivi din întâmplare

interface Interogabil {
  prepare(sql: string): { all(...args: unknown[]): unknown[] };
}

export interface ImnOficial { category: string; number: string; title: string; cuvinte: Set<string> }

function cuvinte(text: string): Set<string> {
  return new Set(text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** Imnurile din colecțiile oficiale ale unei baze (cea a omului sau cea livrată). */
export function indexOficial(db: Interogabil): ImnOficial[] {
  const randuri = db.prepare(
    `SELECT c.name AS category, h.number, h.title, group_concat(s.text, ' ') AS text
     FROM hymns h JOIN categories c ON c.id = h.category_id
     JOIN hymn_sections s ON s.hymn_id = h.id
     WHERE c.name <> ? GROUP BY h.id`).all(MY_HYMNS_CATEGORY) as
    { category: string; number: string; title: string; text: string }[];
  return randuri.map(r => ({
    category: r.category, number: r.number, title: r.title, cuvinte: cuvinte(`${r.title} ${r.text}`),
  }));
}

/** Imnul oficial al cărui text e, de fapt, cel primit; altfel null. */
export function copieOficiala(index: ImnOficial[], title: string, sections: { text: string }[]): ImnOficial | null {
  const ale = cuvinte(`${title} ${sections.map(s => s.text).join(' ')}`);
  if (ale.size < MINIM_CUVINTE) return null;
  let cel: ImnOficial | null = null;
  let maxim = 0;
  for (const o of index) {
    let comune = 0;
    for (const w of ale) if (o.cuvinte.has(w)) comune++;
    const j = comune / (ale.size + o.cuvinte.size - comune);
    if (j > maxim) { maxim = j; cel = o; }
  }
  return maxim >= PRAG ? cel : null;
}
