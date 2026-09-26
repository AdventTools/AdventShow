import { Fragment, useEffect } from 'react';
import { X } from 'lucide-react';
import { ALL_VERSIONS, ChangelogBlock, ChangelogVersion, versionsBetween } from './changelog';
import { useT } from './i18n';

/** **îngroșat**, `cod` și [text](link) — tot ce folosește CHANGELOG-ul în rânduri. */
function Inline({ text }: { text: string }) {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
    return (
        <>
            {parts.map((p, i) => {
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
                const link = /^\[([^\]]+)\]\([^)]+\)$/.exec(p);
                if (link) return <Fragment key={i}>{link[1]}</Fragment>;
                return <Fragment key={i}>{p}</Fragment>;
            })}
        </>
    );
}

function VersionNotes({ v }: { v: ChangelogVersion }) {
    const t = useT();
    // Punctele consecutive merg în aceeași listă; titlurile și paragrafele o întrerup.
    const groups: (ChangelogBlock | ChangelogBlock[])[] = [];
    for (const b of v.blocks) {
        const last = groups[groups.length - 1];
        if (b.kind === 'punct') {
            if (Array.isArray(last)) last.push(b);
            else groups.push([b]);
        } else groups.push(b);
    }
    return (
        <section className="whatsnew-version">
            <div className="whatsnew-head">
                <span className="whatsnew-number">{t('Versiunea {v}', { v: v.version })}</span>
                {v.date && <span className="whatsnew-date">{v.date}</span>}
            </div>
            {groups.map((g, i) => Array.isArray(g) ? (
                <ul key={i} className="whatsnew-list">
                    {g.map((b, j) => <li key={j}><Inline text={b.text} /></li>)}
                </ul>
            ) : g.kind === 'titlu' ? (
                <h5 key={i} className="whatsnew-subtitle"><Inline text={g.text} /></h5>
            ) : (
                <p key={i} className="whatsnew-text"><Inline text={g.text} /></p>
            ))}
        </section>
    );
}

/**
 * „Ce e nou": `from`/`to` = ce s-a schimbat la actualizare, toate versiunile dintre
 * ele; `all` = tot istoricul (din Setări → Despre).
 */
export function WhatsNewModal({ from, to, all, onClose }: {
    from: string | null;
    to: string;
    all?: boolean;
    onClose: () => void;
}) {
    const t = useT();
    const list = all ? ALL_VERSIONS : versionsBetween(from, to);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const titlu = all
        ? t('Istoricul versiunilor')
        : list.length > 1
            ? t('Ce e nou: de la versiunea {from} la {to}', { from: from ?? '', to })
            : t('Ce e nou în versiunea {v}', { v: to });

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-dialog modal-wide whatsnew">
                <div className="modal-header">
                    <h3>{titlu}</h3>
                    <button className="modal-close" onClick={onClose}><X className="icon-sm" /></button>
                </div>
                <div className="modal-body">
                    {!all && list.length > 1 && (
                        <p className="whatsnew-intro">
                            {t('Actualizarea cuprinde {n} versiuni. Mai jos e tot ce s-a schimbat, începând cu cea mai nouă.', { n: list.length })}
                        </p>
                    )}
                    {list.map(v => <VersionNotes key={v.version} v={v} />)}
                </div>
                <div className="whatsnew-footer">
                    <button className="btn-action" onClick={onClose}>{t('Am înțeles')}</button>
                </div>
            </div>
        </div>
    );
}
