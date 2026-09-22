import type { AccompanimentControl } from './ProjectorController';
import { t } from './i18n';

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
  return acc.hasMarks
    ? t('Cântă, iar strofele se schimbă singure (A)')
    : t('Pornește acompaniamentul (A)');
}
