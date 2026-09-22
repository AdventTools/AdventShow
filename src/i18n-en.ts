import { EN_APP_1 } from './i18n-en-app-1';
import { EN_APP_2 } from './i18n-en-app-2';
import { EN_APP_3 } from './i18n-en-app-3';
import { EN_CONTROLLER } from './i18n-en-controller';

/**
 * Dicționarul EN complet — reunește dicționarele per-fișier/bloc (fiecare
 * produs de migrarea secțiunii sursă cu același nume). Cheia e textul român
 * EXACT din sursă (vezi src/i18n.ts pentru convenție).
 */
export const EN_DICT: Record<string, string> = {
    ...EN_APP_1,
    ...EN_APP_2,
    ...EN_APP_3,
    ...EN_CONTROLLER,
};
