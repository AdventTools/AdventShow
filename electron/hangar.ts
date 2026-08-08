import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ═════════════════════════════════════════════════════════════════════════════
// Hangar — singurul drum prin care aplicația vorbește cu serverul nostru.
//
// Înlocuiește complet cele două formulare Google de până acum (registrul
// instalărilor + contribuțiile la imnuri) și adaugă ce nu se putea face prin
// formulare: heartbeat, rapoarte de eroare, feed-uri de conținut, update
// obligatoriu.
//
// Trei endpointuri publice, fără autentificare — o aplicație desktop nu poate
// ține un secret, iar cheia de proiect ajunge oricum în `app-update.yml` din
// fiecare installer. Ce protejează serverul sunt plafoanele lui, nu un token.
//
// REGULA modulului: nimic de aici nu blochează pornirea, proiecția sau
// închiderea aplicației. Fără internet totul tace și se reia mai târziu.
// ═════════════════════════════════════════════════════════════════════════════

export const HANGAR_BASE = 'https://hangar.it4all.ro';
/** Cheia publică a proiectului. Nu e un secret — e doar segmentul din URL. */
export const HANGAR_KEY = 'ba3166b608233a30';

export const HANGAR_FEED_URL = `${HANGAR_BASE}/d/${HANGAR_KEY}/`;
export const HANGAR_DOWNLOAD_URL = `${HANGAR_BASE}/get/${HANGAR_KEY}/`;
/** Corecturile publicate de autori, citite de aplicație (vezi contrib.ts). */
export const HANGAR_CORRECTIONS_URL = `${HANGAR_FEED_URL}corrections.json`;
const TRACK_URL = `${HANGAR_BASE}/hub/track.php`;
const REPORT_URL = `${HANGAR_BASE}/hub/report.php`;
const CONTENT_URL = `${HANGAR_BASE}/hub/content.php`;

const TIMEOUT_MS = 8000;
/** La pornire, apoi din 6 în 6 ore — cadența din contractul hangar. */
export const HEARTBEAT_INTERVAL_MS = 6 * 3600 * 1000;
/** Coada de retrimitere: câte rapoarte reținem cât timp nu e internet. */
const QUEUE_MAX = 25;
const QUEUE_FILE = 'hangar-queue.json';

export type UpdateChannel = 'stable' | 'beta';

export interface HangarSettings {
  contribInstallId?: string;
  contribName?: string;
  churchName?: string;
  churchCity?: string;
  updateChannel?: UpdateChannel;
}

export interface HangarDeps {
  appVersion: string;
  userDataDir: string;
  getSettings: () => HangarSettings;
  patchSettings: (patch: Partial<HangarSettings>) => void;
  log: (...args: unknown[]) => void;
}

export type TrackEvent = 'launch' | 'heartbeat' | 'check' | 'install' | 'update' | 'error';

/** Ce răspunde hub-ul la fiecare ping — destul cât să știm dacă update-ul e obligatoriu. */
export interface TrackReply {
  ok: boolean;
  latest: string | null;
  mandatory: boolean;
  minSupported: string;
  rollout: number;
  notes: string;
  download: string;
}

/** O propunere de modificare a unui imn, trimisă spre verificarea autorilor. */
export interface ContentProposal {
  action: 'modificat' | 'adaugat';
  category: string | null;
  number: string;
  title: string;
  sections: { type: 'strofa' | 'refren'; text: string }[];
  before: { title: string; sections: { type: string; text: string }[] } | null;
  /** sha256 al conținutului — cheia de idempotență, calculată în contrib.ts. */
  hash: string;
}

export interface ReportPayload {
  kind: string;                     // bug | suggestion | crash | unlock | contribution
  subject?: string;
  body?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  area?: string;
  contact?: string;
  dedup?: string;
  fields?: Record<string, string>;
  log?: string;
  log_name?: string;
}

export type ReportResult =
  | { ok: true; id?: number; created?: boolean }
  | { ok: false; reason: 'rate-limit' | 'refused' | 'offline'; queued: boolean; message: string };

// ── Utilitare ────────────────────────────────────────────────────────────────

export function hangarPlatform(): 'win' | 'mac' | 'linux' {
  return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
}

/**
 * ID-ul anonim al instalării. Refolosim `contribInstallId`, cel generat de
 * versiunile vechi pentru formularele Google: așa instalările existente rămân
 * aceleași rânduri în hangar în loc să apară ca instalări noi.
 */
export function installId(deps: HangarDeps): string {
  const s = deps.getSettings();
  if (s.contribInstallId) return s.contribInstallId;
  const id = crypto.randomUUID();
  deps.patchSettings({ contribInstallId: id });
  return id;
}

export function updateChannel(deps: HangarDeps): UpdateChannel {
  return deps.getSettings().updateChannel === 'beta' ? 'beta' : 'stable';
}

/**
 * Codul real de stare. nginx înlocuiește corpul răspunsurilor 400/401/403/404/500
 * cu pagina lui de eroare, așa că hub-ul le remapează pe sârmă; adevărul e în
 * headerul `X-Hub-Status`.
 */
function hubStatus(res: Response): number {
  const raw = Number(res.headers.get('x-hub-status'));
  return Number.isFinite(raw) && raw > 0 ? raw : res.status;
}

async function postJson(url: string, body: unknown, timeoutMs = TIMEOUT_MS):
  Promise<{ res: Response; json: Record<string, unknown> } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: Record<string, unknown> = {};
    try { json = await res.json() as Record<string, unknown>; } catch { /* corp non-JSON */ }
    return { res, json };
  } catch {
    return null; // offline / timeout — apelantul decide dacă reîncearcă
  } finally {
    clearTimeout(timer);
  }
}

// ── Telemetrie și heartbeat ──────────────────────────────────────────────────

/**
 * Un ping. `profile` (biserica + localitatea) se trimite la fiecare apel: pe
 * server se SUPRASCRIE, nu se acumulează, deci nu trebuie să ținem evidența a ce
 * am trimis deja — exact ce lipsea la varianta cu formular Google, unde fiecare
 * retrimitere producea un rând nou.
 */
export async function track(
  deps: HangarDeps, event: TrackEvent, extra: { from?: string } = {},
): Promise<TrackReply | null> {
  const s = deps.getSettings();
  const profile: Record<string, string> = {};
  if ((s.churchName || '').trim()) profile.biserica = s.churchName!.trim();
  if ((s.churchCity || '').trim()) profile.localitatea = s.churchCity!.trim();
  if ((s.contribName || '').trim()) profile.persoana_contact = s.contribName!.trim();

  const out = await postJson(TRACK_URL, {
    project: HANGAR_KEY,
    install: installId(deps),
    event,
    version: deps.appVersion,
    from: extra.from,
    channel: updateChannel(deps),
    platform: hangarPlatform(),
    arch: process.arch,
    ...(Object.keys(profile).length ? { profile } : {}),
  }, 6000);

  if (!out || hubStatus(out.res) !== 200) return null;
  return out.json as unknown as TrackReply;
}

/**
 * Pornește heartbeat-ul. Timer-ul e `unref`-uit: dacă tot restul aplicației s-a
 * închis, procesul nu mai are motiv să rămână viu pentru un ping.
 */
export function startHeartbeat(deps: HangarDeps): NodeJS.Timeout {
  const timer = setInterval(() => {
    track(deps, 'heartbeat').catch(() => { /* tăcere */ });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

// ── Propuneri de conținut (contribuțiile utilizatorilor) ─────────────────────

/**
 * Trimite propunerile de modificare a imnurilor. Autorii le văd în hangar ca
 * diferență înainte/după și publică ce merită păstrat.
 *
 * `hash` face dedup-ul PE SERVER: aceeași corectură retrimisă nu creează un rând
 * nou, iar venită de la altă biserică devine un al doilea vot pe același rând —
 * așa ies în față corecturile pe care le-au făcut mai mulți, independent.
 *
 * Întoarce null dacă nu s-a putut trimite (offline, refuz, limită): apelantul NU
 * marchează nimic ca trimis și reîncearcă la următoarea verificare.
 */
export async function sendProposals(
  deps: HangarDeps, kind: string, items: ContentProposal[],
): Promise<{ stored: number; duplicates: number } | null> {
  if (items.length === 0) return { stored: 0, duplicates: 0 };
  const out = await postJson(CONTENT_URL, {
    project: HANGAR_KEY,
    kind,
    install: installId(deps),
    name: (deps.getSettings().contribName || '').trim(),
    version: deps.appVersion,
    items,
  }, 20000);

  if (!out) return null;
  const status = hubStatus(out.res);
  if (status !== 200 || !out.json.ok) {
    deps.log(`[Hangar] propuneri refuzate (${status}):`, String(out.json.error ?? ''));
    return null;
  }
  return {
    stored: Number(out.json.stored ?? 0),
    duplicates: Number(out.json.duplicates ?? 0),
  };
}

/**
 * Compară două versiuni semver-ish. Întoarce <0 dacă a < b.
 * Suficient pentru „versiunea mea e sub minimul acceptat?" — nu tratează
 * prereleases, pentru că `minSupported` e mereu o versiune întreagă.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => String(v || '0').replace(/^v/i, '').split('-')[0]
    .split('.').map(n => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ── Rapoarte (bug, sugestie, crash, formulare proprii) ───────────────────────

interface QueuedReport { payload: Record<string, unknown>; queuedAt: string; tries: number }

function queuePath(deps: HangarDeps): string {
  return path.join(deps.userDataDir, QUEUE_FILE);
}

function readQueue(deps: HangarDeps): QueuedReport[] {
  try {
    const raw = JSON.parse(fs.readFileSync(queuePath(deps), 'utf-8')) as QueuedReport[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeQueue(deps: HangarDeps, items: QueuedReport[]): void {
  try {
    // Cele mai vechi pleacă primele: un mesaj de acum trei luni nu mai ajută pe nimeni.
    fs.writeFileSync(queuePath(deps), JSON.stringify(items.slice(-QUEUE_MAX), null, 2), 'utf-8');
  } catch (err) {
    deps.log('[Hangar] nu pot scrie coada de rapoarte:', String(err));
  }
}

function reportBody(deps: HangarDeps, r: ReportPayload): Record<string, unknown> {
  return {
    project: HANGAR_KEY,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    severity: r.severity,
    area: r.area,
    contact: r.contact,
    dedup: r.dedup,
    fields: r.fields,
    log: r.log,
    log_name: r.log_name,
    install: installId(deps),
    version: deps.appVersion,
    channel: updateChannel(deps),
    platform: hangarPlatform(),
    arch: process.arch,
  };
}

/**
 * Trimite un raport. `queueOnFailure` decide ce se întâmplă când nu merge:
 *
 * • true  — pentru ce pleacă automat (crash, contribuții, înregistrare): se pune
 *           în coadă și se reîncearcă la următoarea pornire. Un raport pierdut
 *           pentru că omul era offline e un raport care nu mai vine niciodată.
 * • false — pentru ce a scris utilizatorul chiar acum: apelantul primește
 *           motivul și îi spune pe loc, fără să-i piardă textul.
 */
export async function sendReport(
  deps: HangarDeps, r: ReportPayload, queueOnFailure = false,
): Promise<ReportResult> {
  const payload = reportBody(deps, r);
  const out = await postJson(REPORT_URL, payload, 15000);

  if (out) {
    const status = hubStatus(out.res);
    if (status === 200 && out.json.ok) {
      deps.log(`[Hangar] raport ${r.kind} trimis (#${out.json.id})`);
      return { ok: true, id: Number(out.json.id), created: Boolean(out.json.created) };
    }
    if (status === 429) {
      if (queueOnFailure) enqueue(deps, payload);
      return {
        ok: false, reason: 'rate-limit', queued: queueOnFailure,
        message: 'Ați trimis prea multe mesaje recent. Încercați peste o oră.',
      };
    }
    // 4xx care nu e limitare = ceva din datele noastre e greșit; reîncercarea nu
    // ajută, deci nu punem în coadă indiferent de ce a cerut apelantul.
    deps.log(`[Hangar] raport ${r.kind} refuzat (${status}):`, String(out.json.error ?? ''));
    return {
      ok: false, reason: 'refused', queued: false,
      message: String(out.json.error ?? 'Serverul a refuzat mesajul.'),
    };
  }

  if (queueOnFailure) enqueue(deps, payload);
  return {
    ok: false, reason: 'offline', queued: queueOnFailure,
    message: queueOnFailure
      ? 'Nu există conexiune — mesajul a fost păstrat și se trimite automat mai târziu.'
      : 'Nu există conexiune la internet. Încercați din nou mai târziu.',
  };
}

function enqueue(deps: HangarDeps, payload: Record<string, unknown>): void {
  const q = readQueue(deps);
  // Cheia de dedup e și cheia cozii: două crash-uri identice nu ocupă două locuri.
  const key = payload.dedup;
  const without = key ? q.filter(i => i.payload.dedup !== key) : q;
  without.push({ payload, queuedAt: new Date().toISOString(), tries: 0 });
  writeQueue(deps, without);
  deps.log(`[Hangar] raport pus în coadă (${without.length} în așteptare)`);
}

/**
 * Golește coada. Se cheamă la pornire, amânat, după ce fereastra e afișată.
 * Un eșec lasă totul la loc și mai încearcă data viitoare; după 10 încercări
 * eșuate un raport e abandonat, altfel coada ar căra la nesfârșit ceva ce
 * serverul refuză.
 */
export async function flushReportQueue(deps: HangarDeps): Promise<void> {
  const q = readQueue(deps);
  if (q.length === 0) return;

  const remaining: QueuedReport[] = [];
  for (const item of q) {
    const out = await postJson(REPORT_URL, item.payload, 15000);
    const status = out ? hubStatus(out.res) : 0;
    if (out && status === 200) continue;              // trimis, iese din coadă
    if (out && status >= 400 && status !== 429) continue; // refuzat definitiv, nu insistăm
    item.tries += 1;
    if (item.tries < 10) remaining.push(item);
    if (status === 429) {
      // Am atins plafonul; restul cozii rămâne pentru altă dată.
      remaining.push(...q.slice(q.indexOf(item) + 1));
      break;
    }
  }
  writeQueue(deps, remaining);
  deps.log(`[Hangar] coadă: ${q.length - remaining.length} trimise, ${remaining.length} rămase`);
}

export function pendingReportCount(deps: HangarDeps): number {
  return readQueue(deps).length;
}
