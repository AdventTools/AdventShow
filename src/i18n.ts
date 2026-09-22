import { useEffect, useState } from 'react';

/**
 * Sistemul de traducere al interfeței PROPRII a aplicației (nu al Bibliei —
 * aia are propriile traduceri de conținut, vezi bibleTranslation).
 *
 * Cheia dicționarului e chiar TEXTUL ROMÂN original din cod — nu o cheie
 * sintetică. Asta face migrarea mecanică (se împachetează fiecare string cu
 * `t('...')` fără să inventăm nume noi) și face verificarea completității
 * simplă: orice apel `t('X')` fără intrare `'X'` în EN_DICT cade pe română,
 * vizibil la o simplă comparare a listelor.
 */

export type Lang = 'ro' | 'en';

type Listener = () => void;
let currentLang: Lang = 'ro';
const listeners = new Set<Listener>();

export function getLang(): Lang {
    return currentLang;
}

export function setLang(l: Lang) {
    if (l === currentLang) return;
    currentLang = l;
    listeners.forEach(fn => fn());
}

function subscribeLang(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Se apelează o singură dată, la pornirea aplicației, cu limba din settings. */
export function initLang(l: Lang | undefined) {
    currentLang = l === 'en' ? 'en' : 'ro';
}

import { EN_DICT } from './i18n-en';

/**
 * Traduce un text românesc. `params` înlocuiește `{cheie}` din text (RO SAU
 * EN) cu valoarea dată — pentru propoziții cu numere/nume variabile.
 */
export function t(ro: string, params?: Record<string, string | number>): string {
    let s: string = currentLang === 'en' ? (EN_DICT[ro] ?? ro) : ro;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            s = s.split(`{${k}}`).join(String(v));
        }
    }
    return s;
}

/**
 * Hook de folosit în ORICE componentă care afișează text tradus: re-randează
 * componenta când se schimbă limba (fără el, `t()` ar întoarce tot vechea
 * limbă până la următorul re-render declanșat din altă parte).
 */
export function useLang(): Lang {
    const [lang, setLangState] = useState(currentLang);
    useEffect(() => subscribeLang(() => setLangState(currentLang)), []);
    return lang;
}

/** `const t = useT();` — la fel ca `t()`, dar componenta se abonează la schimbarea limbii. */
export function useT() {
    useLang();
    return t;
}
