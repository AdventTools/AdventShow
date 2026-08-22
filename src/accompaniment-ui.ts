import type { AccompanimentControl } from './ProjectorController';

/**
 * Ce scrie în tooltipul butonului de acompaniament.
 *
 * Stă separat pentru că butonul apare în două locuri — în previzualizare și în
 * bara de proiecție — iar textul trebuie să fie același în amândouă. Ce scrie pe
 * buton e ce se întâmplă la apăsare, deci fraza depinde de starea curentă.
 */
export function accTitle(acc: AccompanimentControl): string {
  if (acc.playing) return 'Oprește acompaniamentul (A)';
  if (acc.loading) {
    return acc.willPlay
      ? 'Se descarcă — apasă dacă NU vrei să pornească singur'
      : 'Se descarcă';
  }
  if (acc.needsDownload) {
    return acc.willPlay
      ? 'Descarcă și pornește acompaniamentul (A)'
      : 'Descarcă acompaniamentul acum, ca să fie gata la proiecție (A)';
  }
  return acc.hasMarks
    ? 'Cântă, iar strofele se schimbă singure (A)'
    : 'Pornește acompaniamentul (A)';
}
