import crypto from 'crypto';

// ═════════════════════════════════════════════════════════════════════════════
// Registrul instalărilor + recuperarea parolei de administrare
//
// Ambele folosesc UN SINGUR formular Google („AdventShow — Instalări și suport")
// care alimentează un Sheet PRIVAT al autorilor (coloana Tip face diferența):
//
// • Tip „instalare":  biserica + localitatea (obligatorii la configurarea
//   inițială; instalările existente le completează la prima pornire după
//   upgrade). Se retrimite doar dacă datele se schimbă — un rând per instalare.
// • Tip „deblocare":  cerere de resetare a parolei. Aplicația generează local
//   un cod de cerere (afișat utilizatorului) și un cod de deblocare ALEATORIU
//   (trimis DOAR autorilor, prin formular — nu apare nicăieri în UI). Autorii
//   citesc codul din Sheet/email și îl dictează telefonic; aplicația îl
//   verifică după hash-ul păstrat local. Valabil 7 zile, o singură folosință.
//
// Securitatea e intenționat modestă (aplicația e open-source): parola e o
// protecție împotriva modificărilor accidentale, nu un secret criptografic.
// ═════════════════════════════════════════════════════════════════════════════

const REGISTRY_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSdJh1t54GszlCdOuKDH0DsUVi6m0qw7KpQYVUupJDV_YIjENg/formResponse';
const REGISTRY_FIELDS = {
  tip: 'entry.1139450279',
  biserica: 'entry.390457942',
  localitatea: 'entry.606185971',
  installId: 'entry.1120324490',
  appVersion: 'entry.1517130169',
  telefon: 'entry.510558853',
  codCerere: 'entry.1661958779',
  codDeblocare: 'entry.886906709',
};

const FETCH_TIMEOUT_MS = 8000;
const UNLOCK_VALID_DAYS = 7;
// fără caractere ambigue (0/O, 1/I/l) — codurile se dictează la telefon
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface RegistrySettings {
  churchName?: string;
  churchCity?: string;
  registrySentKey?: string;      // „biserică|localitate|installId" deja trimis (dedup)
  contribInstallId?: string;     // același ID anonim ca la contribuții
  unlockCodeHash?: string;       // sha256 al codului de deblocare activ
  unlockCodeExpiry?: string;     // ISO — după această dată codul moare
}

export interface RegistryDeps {
  appVersion: string;
  getSettings: () => RegistrySettings;
  patchSettings: (patch: Partial<RegistrySettings>) => void;
  log: (...args: unknown[]) => void;
}

function randomCode(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// normalizare pentru coduri dictate la telefon: majuscule, fără spații/cratime
// (alfabetul nu conține 0/O/1/I/L, deci nu există confuzii de mapat)
function normalizeCode(input: string): string {
  return (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function postRow(fields: Record<string, string>): Promise<boolean> {
  const body = new URLSearchParams(fields);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_FORM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false; // offline — apelantul decide dacă reîncearcă
  } finally {
    clearTimeout(timer);
  }
}

function ensureInstallId(deps: RegistryDeps): string {
  const s = deps.getSettings();
  if (s.contribInstallId) return s.contribInstallId;
  const id = crypto.randomUUID();
  deps.patchSettings({ contribInstallId: id });
  return id;
}

// ── Înregistrarea instalării ─────────────────────────────────────────────────
// Idempotent: nu trimite nimic dacă datele curente au fost deja trimise.
// Offline = tace; reîncearcă automat la următoarea pornire (cheia rămâne nesetată).
export async function maybeSendRegistration(deps: RegistryDeps): Promise<boolean> {
  const s = deps.getSettings();
  const church = (s.churchName || '').trim();
  const city = (s.churchCity || '').trim();
  if (!church || !city) return false;

  const installId = ensureInstallId(deps);
  const key = `${church}|${city}|${installId}`;
  if (s.registrySentKey === key) return true; // deja trimis, nimic nou

  const ok = await postRow({
    [REGISTRY_FIELDS.tip]: 'instalare',
    [REGISTRY_FIELDS.biserica]: church,
    [REGISTRY_FIELDS.localitatea]: city,
    [REGISTRY_FIELDS.installId]: installId,
    [REGISTRY_FIELDS.appVersion]: `${deps.appVersion} (${process.platform})`,
    [REGISTRY_FIELDS.telefon]: '—',
    [REGISTRY_FIELDS.codCerere]: '—',
    [REGISTRY_FIELDS.codDeblocare]: '—',
  });
  if (ok) {
    deps.patchSettings({ registrySentKey: key });
    deps.log('[Registry] instalare înregistrată:', church, city);
  }
  return ok;
}

// ── Cerere de deblocare (parolă uitată) ──────────────────────────────────────
// Generează codurile, păstrează LOCAL doar hash-ul + expirarea, trimite totul
// autorilor prin formular. Codul de deblocare NU se afișează utilizatorului.
export async function sendUnlockRequest(
  deps: RegistryDeps, phone: string,
): Promise<{ ok: boolean; requestCode?: string; error?: string }> {
  const tel = (phone || '').trim();
  if (!tel) return { ok: false, error: 'Introduceți un număr de telefon.' };

  const s = deps.getSettings();
  const installId = ensureInstallId(deps);
  const requestCode = randomCode(4);
  const unlockCode = `${randomCode(4)}-${randomCode(4)}`;

  const ok = await postRow({
    [REGISTRY_FIELDS.tip]: 'deblocare',
    [REGISTRY_FIELDS.biserica]: (s.churchName || '').trim() || '—',
    [REGISTRY_FIELDS.localitatea]: (s.churchCity || '').trim() || '—',
    [REGISTRY_FIELDS.installId]: installId,
    [REGISTRY_FIELDS.appVersion]: `${deps.appVersion} (${process.platform})`,
    [REGISTRY_FIELDS.telefon]: tel,
    [REGISTRY_FIELDS.codCerere]: requestCode,
    [REGISTRY_FIELDS.codDeblocare]: unlockCode,
  });
  if (!ok) {
    return { ok: false, error: 'Cererea nu a putut fi trimisă — verificați conexiunea la internet și reîncercați.' };
  }

  const expiry = new Date(Date.now() + UNLOCK_VALID_DAYS * 24 * 3600 * 1000).toISOString();
  deps.patchSettings({ unlockCodeHash: sha256(normalizeCode(unlockCode)), unlockCodeExpiry: expiry });
  deps.log('[Registry] cerere deblocare trimisă, cod cerere:', requestCode);
  return { ok: true, requestCode };
}

// ── Verificarea codului dictat ───────────────────────────────────────────────
// La succes codul se CONSUMĂ (o singură folosință); parola efectivă o resetează
// apelantul (main.ts) — modulul ăsta nu atinge adminPasswordHash.
export function verifyUnlockCode(deps: RegistryDeps, input: string): boolean {
  const s = deps.getSettings();
  if (!s.unlockCodeHash || !s.unlockCodeExpiry) return false;
  if (new Date(s.unlockCodeExpiry).getTime() < Date.now()) return false;
  if (sha256(normalizeCode(input)) !== s.unlockCodeHash) return false;
  deps.patchSettings({ unlockCodeHash: undefined, unlockCodeExpiry: undefined });
  deps.log('[Registry] cod de deblocare acceptat — parola poate fi resetată');
  return true;
}
