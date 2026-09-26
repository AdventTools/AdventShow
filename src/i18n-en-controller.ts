/**
 * Traducerile EN pentru src/ProjectorController.tsx (bara de control din
 * fereastra PRINCIPALĂ — operator, nu proiecția) și src/accompaniment-ui.ts.
 *
 * NU include src/ProjectionPage.tsx — aia e ce vede CONGREGAȚIA pe ecranul
 * de proiecție, iar limba de-acolo trebuie să urmeze conținutul (traducerea
 * Bibliei alese), nu limba interfeței operatorului. Rămâne netradusă.
 * Cheia e textul român EXACT din sursă.
 */
export const EN_CONTROLLER: Record<string, string> = {
    // accompaniment-ui.ts
    'Oprește acompaniamentul (A)': 'Stop the accompaniment (A)',
    'Se descarcă — apasă dacă NU vrei să pornească singur': 'Downloading — tap if you do NOT want it to start automatically',
    'Se descarcă': 'Downloading',
    'Descarcă și pornește acompaniamentul (A)': 'Download and start the accompaniment (A)',
    'Descarcă acompaniamentul acum, ca să fie gata la proiecție (A)': "Download the accompaniment now, so it's ready when you project (A)",
    'Cântă, iar strofele se schimbă singure (A)': 'Plays, and the verses change on their own (A)',
    'Pornește acompaniamentul (A)': 'Start the accompaniment (A)',

    // ProjectorController.tsx
    'Refren': 'Chorus',
    'Titlu': 'Title',
    'Se descarcă… · nu porni': "Downloading… · won't start",
    'Se descarcă…': 'Downloading…',
    'Descarcă și cântă': 'Download and play',
    'Descarcă': 'Download',
    'Cântă singur': 'Plays on its own',
    'Cântă': 'Play',
    'Doar acompaniamentul — strofele le schimbi tu': 'Accompaniment only — you change the verses',
    'Zoom text proiecție': 'Projection text zoom',
    'Micșorează textul (↓)': 'Shrink the text (↓)',
    'Înapoi la mărimea implicită (120%)': 'Back to the default size (120%)',
    'Mărește textul (↑)': 'Enlarge the text (↑)',
    'Text: {pct}%': 'Text: {pct}%',
    '←→ Space: navigare · ↑↓: font': '←→ Space: navigate · ↑↓: font size',
    ' · A: acompaniament': ' · A: accompaniment',
    'Oprește proiecția (Esc)': 'Stop the projection (Esc)',
    'Oprește': 'Stop',
    'AUTOMAT': 'AUTOMATIC',
    'Strofele se schimbă singure. Nu atinge nimic.': "The verses change on their own. Don't touch anything.",
    'MANUAL': 'MANUAL',
    'Ai preluat — de aici schimbi tu. Acompaniamentul merge înainte.': "You've taken over — from here you change them. The accompaniment keeps playing.",
    'Anterior (←)': 'Previous (←)',
    'Următor (→)': 'Next (→)',
    'T': 'T',
};
