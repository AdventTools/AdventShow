import { BookOpen, Play, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectorController } from './ProjectorController';
import { Category, Hymn, HymnSection, HymnWithSections } from './vite-env';

// ─────────────────────────────────────────────────────────────────────────────
// Hymn row
// ─────────────────────────────────────────────────────────────────────────────

function HymnRow({ hymn, category, isSelected, onClick, onPlay }: {
  hymn: Hymn;
  category?: Category;
  isSelected: boolean;
  onClick: () => void;
  onPlay: () => void;
}) {
  const sectionCount = hymn.section_count ?? 0;
  const sectionLabel = sectionCount === 1 ? '1 secțiune' : `${sectionCount} secțiuni`;

  return (
    <div
      onClick={onClick}
      className={`flex items-stretch rounded-xl mb-2 overflow-hidden cursor-pointer group transition-all
        ${isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-transparent' : 'hover:scale-[1.005]'}`}
    >
      {/* Left colored panel — number + title */}
      <div className={`flex items-center gap-3 px-5 w-64 flex-shrink-0 py-4 transition-colors
        ${isSelected ? 'bg-primary' : 'bg-[#1e2a5e] group-hover:bg-[#243269]'}`}
      >
        <span className={`text-xl font-black w-10 text-right flex-shrink-0 tabular-nums leading-none
          ${isSelected ? 'text-primary-content' : 'text-[#7b96ff]'}`}>
          {hymn.number}
        </span>
        <span className={`text-sm font-semibold truncate leading-tight
          ${isSelected ? 'text-primary-content' : 'text-white/80'}`}>
          {hymn.title}
        </span>
      </div>

      {/* Right dark panel — category · section count · play */}
      <div className="flex-1 bg-[#151c35] group-hover:bg-[#192040] transition-colors flex items-center px-6 gap-4">
        {category && (
          <span className="text-xs text-white/35 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />
            {category.name}
          </span>
        )}
        {category && sectionCount > 0 && (
          <span className="text-white/15 text-xs">·</span>
        )}
        {sectionCount > 0 && (
          <span className="text-xs text-white/35">{sectionLabel}</span>
        )}

        <div className="ml-auto flex-shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onPlay(); }}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-primary/30 hover:text-primary text-white/20 transition-all hover:scale-110"
            title="Proiectează"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel (right side)
// ─────────────────────────────────────────────────────────────────────────────

function HymnDetail({ hymnId, categories }: { hymnId: number; categories: Category[] }) {
  const [hymn, setHymn] = useState<HymnWithSections | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    window.electron.db.getHymnWithSections(hymnId).then(h => {
      setHymn(h);
      setLoading(false);
    });
  }, [hymnId]);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <span className="loading loading-spinner text-primary loading-md" />
    </div>
  );
  if (!hymn) return null;

  const category = categories.find(c => c.id === hymn.category_id);

  const refren = hymn.sections.find(s => s.type === 'refren');
  let strofaCount = 0;
  const displayItems: { text: string; label: string; isRefren: boolean; key: string }[] = [];

  for (const s of hymn.sections) {
    if (s.type === 'strofa') {
      strofaCount++;
      displayItems.push({ text: s.text, label: `Strofă ${strofaCount}`, isRefren: false, key: `s-${s.id}` });
      if (refren) {
        displayItems.push({ text: refren.text, label: 'Refren', isRefren: true, key: `r-after-${s.id}` });
      }
    } else if (s.type === 'refren') {
      const idx = hymn.sections.indexOf(s);
      const prevIsStrofa = idx > 0 && hymn.sections[idx - 1].type === 'strofa';
      if (!prevIsStrofa) displayItems.push({ text: s.text, label: 'Refren', isRefren: true, key: `r-${s.id}` });
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-8 pt-8 pb-6 border-b border-white/5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-black text-primary">{hymn.number}</span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white leading-tight">{hymn.title}</h2>
            <div className="flex items-center gap-3 mt-1.5">
              {category && <span className="badge badge-xs badge-ghost text-white/40">{category.name}</span>}
              <span className="text-xs text-white/25">{hymn.sections.length} secțiuni</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
        {displayItems.map(item => (
          <div key={item.key} className={`rounded-xl p-4 ${item.isRefren ? 'bg-amber-500/8 border border-amber-500/15' : 'bg-white/3'}`}>
            <div className={`text-[10px] font-bold tracking-widest uppercase mb-2 ${item.isRefren ? 'text-amber-400/60' : 'text-white/25'}`}>
              {item.label}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm text-white/75 leading-relaxed">{item.text}</pre>
          </div>
        ))}
        {displayItems.length === 0 && (
          <div className="text-center text-white/20 text-sm py-12">Nicio secțiune.</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main SearchPage
// ─────────────────────────────────────────────────────────────────────────────

export function SearchPage({ query, onQueryChange: _onQueryChange, activeCategoryId, categories, onEnterKeyRef }: {
  query: string;
  onQueryChange: (q: string) => void;
  activeCategoryId?: number;
  categories: Category[];
  onEnterKeyRef?: React.MutableRefObject<() => void>;
}) {
  const [results, setResults] = useState<Hymn[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Projection state ───────────────────────────────────────────────────────
  const [projecting, setProjecting] = useState(false);
  const [projSections, setProjSections] = useState<HymnSection[]>([]);
  const [projTitle, setProjTitle] = useState('');
  const [projNumber, setProjNumber] = useState('');

  const startProjection = useCallback(async (hymnId: number) => {
    const hymn = await window.electron.db.getHymnWithSections(hymnId);
    if (!hymn || hymn.sections.length === 0) return;
    setProjSections(hymn.sections);
    setProjTitle(hymn.title);
    setProjNumber(hymn.number);
    setProjecting(true);
    await window.electron.projection.open(hymn.sections, hymn.title, hymn.number);
  }, []);

  // Listen for projection window close (user closes it directly)
  useEffect(() => {
    window.electron.projection.onClosed(() => {
      setProjecting(false);
      setProjSections([]);
    });
    return () => { window.electron.projection.offClosed(); };
  }, []);

  // Update the Enter-key relay every time results change
  useEffect(() => {
    if (onEnterKeyRef) {
      onEnterKeyRef.current = () => {
        if (results.length === 1) startProjection(results[0].id);
      };
    }
  }, [results, onEnterKeyRef, startProjection]);

  const stopProjection = useCallback(async () => {
    setProjecting(false);
    setProjSections([]);
    await window.electron.projection.close();
  }, []);

  // ── Search ─────────────────────────────────────────────────────────────────
  const search = useCallback(async () => {
    const res = query.trim()
      ? await window.electron.db.searchHymns(query, activeCategoryId)
      : await window.electron.db.getAllHymns(activeCategoryId);
    setResults(res);
  }, [query, activeCategoryId]);

  useEffect(() => {
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setSelectedId(null); }, [activeCategoryId, query]);

  const catMap = new Map(categories.map(c => [c.id, c]));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Main body: list + detail ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Hymn list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-white/20">
              {results.length} {results.length === 1 ? 'imn' : 'imnuri'}
              {activeCategoryId && categories.find(c => c.id === activeCategoryId)
                ? ` în ${categories.find(c => c.id === activeCategoryId)!.name}`
                : ''}
            </span>
          </div>

          {results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-white/15 gap-3">
              <BookOpen className="w-12 h-12" strokeWidth={1} />
              <p className="text-sm">Niciun imn găsit</p>
            </div>
          )}

          {results.map(hymn => (
            <HymnRow
              key={hymn.id}
              hymn={hymn}
              category={hymn.category_id != null ? catMap.get(hymn.category_id) : undefined}
              isSelected={selectedId === hymn.id}
              onClick={() => setSelectedId(prev => prev === hymn.id ? null : hymn.id)}
              onPlay={() => startProjection(hymn.id)}
            />
          ))}
        </div>

        {/* Detail panel */}
        {selectedId !== null && (
          <div className="w-96 border-l border-white/5 bg-[#0f1117] flex-shrink-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-4 pb-2 flex-shrink-0">
              <span className="text-xs text-white/25 font-semibold uppercase tracking-widest">Detalii</span>
              <button
                onClick={() => setSelectedId(null)}
                className="w-6 h-6 flex items-center justify-center rounded text-white/20 hover:text-white/60 hover:bg-white/5 transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <HymnDetail hymnId={selectedId} categories={categories} />
            </div>
          </div>
        )}
      </div>

      {/* ── Projector controller bar (shown when projecting) ── */}
      {projecting && projSections.length > 0 && (
        <ProjectorController
          sections={projSections}
          hymnTitle={projTitle}
          hymnNumber={projNumber}
          onClose={stopProjection}
        />
      )}
    </div>
  );
}
