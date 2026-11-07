import type { AccompanimentControl } from './ProjectorController';
import type { SyncWarning } from './vite-env';
import { t } from './i18n';

/**
 * Ce problemă are înregistrarea, spusă operatorului ÎNAINTE să apese: la un imn
 * unde pianul se oprește mai devreme, trebuie să știe că de la o strofă încolo
 * le schimbă el, iar adunarea cântă fără pian.
 */
export function accWarnText(w: SyncWarning): string {
  if (w.kind === 'short') {
    return t('Pianul cântă {a} strofe din {b}. După strofa {a}, strofele le schimbi tu.',
      { a: w.audio, b: w.text });
  }
  const inPlus = w.audio - w.text;
  return inPlus > 1
    ? t('Pianul mai cântă de {n} ori la final. Ultima strofă rămâne pe ecran.', { n: inPlus })
    : t('Pianul mai cântă o dată la final. Ultima strofă rămâne pe ecran.');
}

/** Eticheta scurtă a stării, cât cântă: aceeași în previzualizare și în bara de proiecție. */
export function accStateLabel(s: 'auto' | 'preluat' | 'doar'): string {
  return s === 'auto' ? t('MERGE SINGUR') : s === 'preluat' ? t('AI PRELUAT') : t('DOAR ACOMPANIAMENT');
}

/** Fraza de lângă etichetă: ce înseamnă starea pentru cine stă la calculator. */
export function accStateText(s: 'auto' | 'preluat' | 'doar'): string {
  if (s === 'auto') return t('Strofele se schimbă singure, pe muzică. Poți prelua oricând, cu săgețile.');
  if (s === 'preluat') {
    return t('Sincronizarea s-a oprit, pentru că ai schimbat tu strofa. De aici le schimbi tu; muzica merge înainte.');
  }
  return t('Imnul nu merge singur: strofele le schimbi tu.');
}

/**
 * Ce scrie în tooltipul butonului de acompaniament.
 *
 * Stă separat pentru că butonul apare în două locuri — în previzualizare și în
 * bara de proiecție — iar textul trebuie să fie același în amândouă. Ce scrie pe
 * buton e ce se întâmplă la apăsare, deci fraza depinde de starea curentă.
 */
export function accTitle(acc: AccompanimentControl): string {
  if (acc.playing) return t('Oprește acompaniamentul (A)');
  if (acc.loading) {
    return acc.willPlay
      ? t('Se descarcă — apasă dacă NU vrei să pornească singur')
      : t('Se descarcă');
  }
  if (acc.needsDownload) {
    return acc.willPlay
      ? t('Descarcă și pornește acompaniamentul (A)')
      : t('Descarcă acompaniamentul acum, ca să fie gata la proiecție (A)');
  }
  if (!acc.onScreen) {
    return acc.hasMarks
      ? t('Pune imnul pe ecran și pornește acompaniamentul; strofele se schimbă singure (A)')
      : t('Pune imnul pe ecran și pornește acompaniamentul; strofele le schimbi tu (A)');
  }
  return acc.hasMarks
    ? t('Pornește acompaniamentul; strofele se schimbă singure (A)')
    : t('Pornește acompaniamentul (A)');
}

/**
 * Ce scrie pe butonul mare când fișierul e pe disc. Spune ACOMPANIAMENT, nu
 * „cântă": altfel unii se așteaptă la o înregistrare cu voci.
 */
export function accReadyLabel(acc: AccompanimentControl): string {
  if (!acc.onScreen) {
    return acc.hasMarks
      ? t('Proiectează cu acompaniament sincronizat')
      : t('Proiectează cu acompaniament');
  }
  return acc.hasMarks ? t('Acompaniament sincronizat') : t('Pornește acompaniamentul');
}

/** Butonul mare cât fișierul nu e încă pe disc. */
export function accDownloadLabel(acc: AccompanimentControl): string {
  return acc.willPlay ? t('Descarcă și pornește acompaniamentul') : t('Descarcă acompaniamentul');
}

/**
 * A doua alegere, „Doar acompaniamentul". Pe ecran contează doar la imnurile
 * sincronizate (la celelalte butonul mare face exact asta); înainte de proiecție
 * e singurul fel de a porni sunetul fără să proiectezi.
 */
export function accPlayOnlyVisible(acc: AccompanimentControl): boolean {
  if (acc.playing || acc.loading || !acc.onPlayOnly) return false;
  return acc.onScreen ? !!acc.hasMarks : !acc.needsDownload;
}

export function accPlayOnlyTitle(acc: AccompanimentControl): string {
  return acc.onScreen
    ? t('Doar acompaniamentul — strofele le schimbi tu')
    : t('Doar acompaniamentul, fără proiecție');
}
