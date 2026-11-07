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
    'Pune imnul pe ecran și pornește acompaniamentul; strofele se schimbă singure (A)':
        'Puts the hymn on screen and starts the accompaniment; the verses change on their own (A)',
    'Pune imnul pe ecran și pornește acompaniamentul; strofele le schimbi tu (A)':
        'Puts the hymn on screen and starts the accompaniment; you change the verses (A)',
    'Pornește acompaniamentul; strofele se schimbă singure (A)':
        'Start the accompaniment; the verses change on their own (A)',
    'Pornește acompaniamentul (A)': 'Start the accompaniment (A)',
    'Proiectează cu acompaniament sincronizat': 'Project with synced accompaniment',
    'Proiectează cu acompaniament': 'Project with accompaniment',
    'Acompaniament sincronizat': 'Synced accompaniment',
    'Pornește acompaniamentul': 'Start the accompaniment',
    'Descarcă și pornește acompaniamentul': 'Download and start the accompaniment',
    'Doar acompaniamentul, fără proiecție': 'Accompaniment only, without projecting',

    // ProjectorController.tsx
    'Refren': 'Chorus',
    'Titlu': 'Title',
    'Se descarcă acompaniamentul… · nu porni': "Downloading accompaniment… · won't start",
    'Se descarcă acompaniamentul…': 'Downloading accompaniment…',
    'Descarcă acompaniamentul': 'Download accompaniment',
    'Doar acompaniamentul — strofele le schimbi tu': 'Accompaniment only — you change the verses',
    'Zoom text proiecție': 'Projection text zoom',
    'Micșorează textul (↓)': 'Shrink the text (↓)',
    'Înapoi la mărimea implicită (120%)': 'Back to the default size (120%)',
    'Mărește textul (↑)': 'Enlarge the text (↑)',
    'Text: {pct}%': 'Text: {pct}%',
    'Săgeți, Space: navigare · + −: font': 'Arrows, Space: navigate · + −: font size',
    ' · A: acompaniament': ' · A: accompaniment',
    'Oprește proiecția (Esc)': 'Stop the projection (Esc)',
    'Oprește': 'Stop',
    'MERGE SINGUR': 'RUNS ON ITS OWN',
    'AI PRELUAT': 'YOU TOOK OVER',
    'DOAR ACOMPANIAMENT': 'ACCOMPANIMENT ONLY',
    'Strofele se schimbă singure, pe muzică. Poți prelua oricând, cu săgețile.':
        'The verses change on their own, with the music. You can take over at any time with the arrow keys.',
    'Sincronizarea s-a oprit, pentru că ai schimbat tu strofa. De aici le schimbi tu; muzica merge înainte.':
        'Sync stopped because you changed the verse yourself. From here you change them; the music keeps playing.',
    'Imnul nu merge singur: strofele le schimbi tu.': 'The hymn does not run on its own: you change the verses.',
    'Doar acompaniamentul': 'Accompaniment only',
    'Pianul cântă {a} strofe din {b}. După strofa {a}, strofele le schimbi tu.':
        'The piano plays {a} of {b} verses. After verse {a}, you change the verses.',
    'Pianul mai cântă de {n} ori la final. Ultima strofă rămâne pe ecran.':
        'The piano plays {n} more times at the end. The last verse stays on screen.',
    'Pianul mai cântă o dată la final. Ultima strofă rămâne pe ecran.':
        'The piano plays once more at the end. The last verse stays on screen.',
    'Anterior (←)': 'Previous (←)',
    'Următor (→)': 'Next (→)',
    'T': 'T',
};
