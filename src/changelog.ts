import changelogMd from '../CHANGELOG.md?raw';

// ═════════════════════════════════════════════════════════════════════════════
// Notele de versiune, citite din CHANGELOG.md-ul intrat în aplicație la build
//
// Sursa e CHANGELOG-ul, nu hangarul: aplicația nouă îl are întreg, cu toate
// versiunile de dinainte, deci o biserică ce sare de la 1.5.2 la 1.6.1 vede tot
// ce s-a schimbat între ele, și fără internet. Blocul „Nepublicat" nu apare
// niciodată: la release, scriptul îl mută în versiunea nouă înainte de build.
// ═════════════════════════════════════════════════════════════════════════════

export type ChangelogBlock = { kind: 'titlu' | 'punct' | 'text'; text: string };

export interface ChangelogVersion {
    version: string;
    date: string;
    blocks: ChangelogBlock[];
}

/** 1.10.0 > 1.9.3: pe numere, nu ca text. */
function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

function parseChangelog(md: string): ChangelogVersion[] {
    const out: ChangelogVersion[] = [];
    let cur: ChangelogVersion | null = null;
    for (const line of md.split(/\r?\n/)) {
        const h = /^## v?(\d+\.\d+\.\d+)\s*(?:\((.*)\))?/.exec(line);
        if (h) {
            cur = { version: h[1], date: (h[2] ?? '').trim(), blocks: [] };
            out.push(cur);
            continue;
        }
        // „## Nepublicat" și orice alt titlu care nu e o versiune
        if (line.startsWith('## ')) { cur = null; continue; }
        if (!cur) continue;
        const l = line.trim();
        if (!l || l === '---') continue;
        const titlu = /^#{3,4}\s+(.*)/.exec(l);
        if (titlu) {
            // „Modificări" stă la aproape fiecare versiune și nu spune nimic în plus.
            if (titlu[1].trim() !== 'Modificări') cur.blocks.push({ kind: 'titlu', text: titlu[1] });
            continue;
        }
        if (l.startsWith('- ') || l.startsWith('* ')) cur.blocks.push({ kind: 'punct', text: l.slice(2) });
        else cur.blocks.push({ kind: 'text', text: l });
    }
    return out
        .filter(v => v.blocks.length > 0)
        .sort((a, b) => compareVersions(b.version, a.version));
}

/** Toate versiunile, cea mai nouă prima. */
export const ALL_VERSIONS = parseChangelog(changelogMd);

/**
 * Versiunile de după `from` (exclusiv) până la `to` (inclusiv), cea mai nouă prima.
 * Fără `from` — o instalare care nu știe de unde vine — doar `to`.
 */
export function versionsBetween(from: string | null, to: string): ChangelogVersion[] {
    return ALL_VERSIONS.filter(v => compareVersions(v.version, to) <= 0
        && (from === null ? compareVersions(v.version, to) === 0 : compareVersions(v.version, from) > 0));
}
