/**
 * Certificatul vechi de semnare Windows (aprilie–mai 2026), autosemnat.
 *
 * Installerele de atunci îl puneau în Windows printre „editorii de încredere" și,
 * unde aveau drepturi de administrator, printre „autoritățile rădăcină". Cheia lui
 * privată a stat publică, deci certificatul nu mai e sigur: orice program semnat
 * cu ea ar fi trecut drept AdventShow pe acele calculatoare. Azi semnăm altfel,
 * așa că certificatul doar trebuie scos.
 *
 * Din magazinul utilizatorului se scoate fără întrebări. Din „rădăcină" Windows
 * cere singur confirmare, iar din magazinele calculatorului e nevoie de drepturi
 * de administrator: acolo omul e întrebat întâi de noi.
 */
import { execFile } from 'node:child_process'

/** Amprenta SHA-1 a certificatului `CN=AdventShow, O=AdventTools` (serial 09C13F16…). */
const THUMBPRINT = '05EE7498ED6807620FD56A5F0EFB4E8BF2A2EA88'

const STORES = [
  'CurrentUser\\TrustedPublisher',
  'CurrentUser\\Root',
  'LocalMachine\\TrustedPublisher',
  'LocalMachine\\Root',
] as const
type Store = typeof STORES[number]

function powershell(command: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { timeout, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
  })
}

/** Magazinele în care se mai află certificatul. Citirea nu cere drepturi de administrator. */
export async function findOldCert(): Promise<Store[]> {
  const paths = STORES.map(s => `'Cert:\\${s}'`).join(',')
  const out = await powershell(
    `Get-ChildItem ${paths} -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq '${THUMBPRINT}' } | ForEach-Object { $_.PSParentPath }`)
  return STORES.filter(s => out.toLowerCase().includes(`::${s.toLowerCase()}`))
}

function removeCommand(stores: readonly Store[]): string {
  return stores.map(s => `Remove-Item -Path 'Cert:\\${s}\\${THUMBPRINT}' -ErrorAction SilentlyContinue`).join('; ')
}

/** Scoate din magazinele utilizatorului (fără drepturi de administrator). */
export async function removeFromUser(stores: readonly Store[]): Promise<void> {
  const own = stores.filter(s => s.startsWith('CurrentUser'))
  if (own.length > 0) await powershell(removeCommand(own), 120000)
}

/**
 * Scoate din magazinele calculatorului printr-un PowerShell pornit ca administrator:
 * Windows arată fereastra UAC, iar dacă omul refuză, `Start-Process` dă eroare.
 */
export async function removeFromMachine(stores: readonly Store[]): Promise<void> {
  const machine = stores.filter(s => s.startsWith('LocalMachine'))
  if (machine.length === 0) return
  const inner = removeCommand(machine).replace(/'/g, "''")
  await powershell(
    `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','${inner}'`,
    300000)
}
