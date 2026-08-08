import crypto from 'crypto';
import { HangarDeps, HangarSettings, sendReport, track } from './hangar';

// ═════════════════════════════════════════════════════════════════════════════
// Registrul instalărilor + recuperarea parolei de administrare
//
// Amândouă mergeau până acum într-un formular Google, într-un Sheet privat al
// autorilor. Acum merg în hangar (hangar.it4all.ro), prin două drumuri diferite,
// pentru că sunt două lucruri diferite:
//
// • Înregistrarea instalării (biserica + localitatea) e o PROPRIETATE a
//   instalării, nu un mesaj. Pleacă drept `profile` la fiecare ping de
//   telemetrie și se SUPRASCRIE pe server. Nu mai există „am trimis deja":
//   ultimul ping spune adevărul, iar o biserică redenumită se corectează
//   singură la următoarea pornire. (Formularul, în schimb, producea un rând
//   nou la fiecare retrimitere.)
//
// • Cererea de deblocare e un MESAJ către autori, deci e un raport de tip
//   `unlock`. Aplicația generează local un cod de cerere (afișat utilizatorului)
//   și un cod de deblocare ALEATORIU, trimis DOAR autorilor — nu apare nicăieri
//   în interfață. Autorii îl citesc din hangar și îl dictează telefonic;
//   aplicația îl verifică după hash-ul păstrat local. Valabil 7 zile, o singură
//   folosință.
//
// Securitatea e intenționat modestă (aplicația e open-source): parola e o
// protecție împotriva modificărilor accidentale, nu un secret criptografic.
// ═════════════════════════════════════════════════════════════════════════════

const UNLOCK_VALID_DAYS = 7;
// fără caractere ambigue (0/O, 1/I/l) — codurile se dictează la telefon
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface RegistrySettings extends HangarSettings {
  unlockCodeHash?: string;       // sha256 al codului de deblocare activ
  unlockCodeExpiry?: string;     // ISO — după această dată codul moare
}

/** Aceleași dependențe ca restul comunicării cu hangar, cu setările de aici. */
export interface RegistryDeps extends HangarDeps {
  getSettings: () => RegistrySettings;
  patchSettings: (patch: Partial<RegistrySettings>) => void;
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

// ── Înregistrarea instalării ─────────────────────────────────────────────────
// Un singur ping. Idempotent prin natura lui: profilul se suprascrie pe server.
// Offline = tace; datele pleacă oricum la următorul heartbeat.
export async function maybeSendRegistration(deps: RegistryDeps): Promise<boolean> {
  const s = deps.getSettings();
  if (!(s.churchName || '').trim() || !(s.churchCity || '').trim()) return false;
  const reply = await track(deps, 'launch');
  if (reply) deps.log('[Registry] instalare anunțată:', s.churchName, s.churchCity);
  return reply !== null;
}

// ── Cerere de deblocare (parolă uitată) ──────────────────────────────────────
// Generează codurile, păstrează LOCAL doar hash-ul + expirarea, trimite totul
// autorilor. Codul de deblocare NU se afișează utilizatorului.
export async function sendUnlockRequest(
  deps: RegistryDeps, phone: string,
): Promise<{ ok: boolean; requestCode?: string; error?: string }> {
  const tel = (phone || '').trim();
  if (!tel) return { ok: false, error: 'Introduceți un număr de telefon.' };

  const s = deps.getSettings();
  const biserica = (s.churchName || '').trim() || '—';
  const localitatea = (s.churchCity || '').trim() || '—';
  const requestCode = randomCode(4);
  const unlockCode = `${randomCode(4)}-${randomCode(4)}`;

  const res = await sendReport(deps, {
    kind: 'unlock',
    subject: `Deblocare — ${biserica}, ${localitatea}`,
    body: `Cerere de resetare a parolei de administrare.\n`
      + `Sunați la ${tel} și dictați codul de deblocare de mai jos.`,
    contact: tel,
    fields: {
      biserica,
      localitatea,
      telefon: tel,
      cod_cerere: requestCode,     // îl vede și utilizatorul, ca să vă potriviți
      cod_deblocare: unlockCode,   // NU se afișează în aplicație; se dictează
    },
    // O a doua cerere de la aceeași instalare, cu alte coduri, e un rând nou:
    // codul vechi rămâne valabil până expiră, deci autorii trebuie să le vadă pe
    // amândouă. De asta nu punem dedup aici.
  });

  if (!res.ok) {
    return { ok: false, error: res.message };
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
