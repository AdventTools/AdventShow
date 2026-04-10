import { ChevronLeft, ChevronRight, Monitor, MonitorOff, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HymnSection } from './vite-env';

// ─────────────────────────────────────────────────────────────────────────────
// Projector Controller
// Shows in the MAIN window when a projection is active.
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectorControllerProps {
  sections: HymnSection[];
  hymnTitle: string;
  hymnNumber: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ProjectorController({ sections, hymnTitle, hymnNumber, onClose, onNavigate }: ProjectorControllerProps) {
  const [currentIndex, setCurrentIndex] = useState(-1);

  const navigate = useCallback(async (index: number) => {
    const clamped = Math.max(-1, Math.min(index, sections.length - 1));
    setCurrentIndex(clamped);
    onNavigate(clamped);
  }, [sections, onNavigate]);

  // Sync index when projection window drives navigation (arrows/Escape pressed there)
  useEffect(() => {
    window.electron.projection.onControllerSync(({ currentIndex: idx }) => {
      setCurrentIndex(idx);
      currentIndexRef.current = idx;
    });
    return () => { window.electron.projection.offControllerSync(); };
  }, []);

  // Keep a ref that's always in sync so the keyboard handler never captures a stale index
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // Keyboard prev/next — capture phase, single stable registration (no currentIndex dep)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inTextField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      // When in a text field, skip arrow handling (global handler manages Escape)
      if (inTextField) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigate(currentIndexRef.current + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigate(currentIndexRef.current - 1);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // navigate is a stable useCallback — intentionally no currentIndex dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const current = sections[currentIndex];
  const prev = sections[currentIndex - 1];
  const next = sections[currentIndex + 1];

  // Count strofa index for labels
  const sectionLabel = (s: HymnSection, idx: number) => {
    if (s.type === 'refren') return 'Refren';
    const strofaNum = sections.slice(0, idx + 1).filter(x => x.type === 'strofa').length;
    return `Strofa ${strofaNum}`;
  };

  return (
    <div className="flex-shrink-0 border-t border-white/10 bg-[#0d1020] select-none">

      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5">
        <Monitor className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-black text-primary tabular-nums">{hymnNumber}.</span>
          <span className="text-xs text-white/60 font-semibold truncate">{hymnTitle}</span>
        </div>
        <span className="text-[10px] text-white/20 ml-1">
          {currentIndex === -1 ? 'Titlu' : `${currentIndex + 1} / ${sections.length}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <kbd className="text-[9px] text-white/20 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">←→ ↑↓ Space</kbd>
          <span className="text-[9px] text-white/15">pentru navigare</span>
          <button
            onClick={onClose}
            className="ml-3 flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all"
            title="Oprește proiecția (Esc)"
          >
            <MonitorOff className="w-3 h-3" /> Oprește
          </button>
        </div>
      </div>

      {/* Slides preview row */}
      <div className="flex items-stretch gap-0 px-0 py-0">

        {/* Prev section preview */}
        <button
          onClick={() => navigate(currentIndex - 1)}
          disabled={currentIndex === -1}
          className="flex items-center gap-2 px-4 py-3 text-left transition-all hover:bg-white/3 disabled:opacity-20 disabled:cursor-not-allowed flex-shrink-0 w-48 border-r border-white/5"
          title="Anterior (←)"
        >
          <ChevronLeft className="w-4 h-4 text-white/20 flex-shrink-0" />
          {currentIndex === 0 ? (
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5 text-primary/50">Titlu</div>
              <div className="text-xs text-white/25 truncate leading-snug">{hymnNumber}. {hymnTitle}</div>
            </div>
          ) : prev ? (
            <div className="min-w-0">
              <div className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${prev.type === 'refren' ? 'text-amber-400/50' : 'text-white/20'}`}>
                {sectionLabel(prev, currentIndex - 1)}
              </div>
              <div className="text-xs text-white/25 truncate leading-snug">
                {prev.text.split('\n')[0]}
              </div>
            </div>
          ) : (
            <SkipBack className="w-3 h-3 text-white/10" />
          )}
        </button>

        {/* Current section — main focus */}
        <div className="flex-1 px-6 py-3 bg-white/3 border-r border-white/5">
          {currentIndex === -1 ? (
            <>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1 text-primary/70">Titlu</div>
              <div className="text-sm text-white/80 leading-relaxed font-medium">
                <span className="text-primary font-black">{hymnNumber}.</span>{' '}{hymnTitle}
              </div>
            </>
          ) : current ? (
            <>
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${current.type === 'refren' ? 'text-amber-400' : 'text-primary/70'}`}>
                {sectionLabel(current, currentIndex)}
              </div>
              <div className="text-sm text-white/80 leading-relaxed line-clamp-3 whitespace-pre-line font-medium">
                {current.text}
              </div>
            </>
          ) : null}
        </div>

        {/* Next section preview */}
        <button
          onClick={() => navigate(currentIndex + 1)}
          disabled={currentIndex === sections.length - 1}
          className="flex items-center gap-2 px-4 py-3 text-left transition-all hover:bg-white/3 disabled:opacity-20 disabled:cursor-not-allowed flex-shrink-0 w-48 border-r border-white/5"
          title="Următor (→)"
        >
          {next ? (
            <div className="min-w-0 flex-1">
              <div className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${next.type === 'refren' ? 'text-amber-400/50' : 'text-white/20'}`}>
                {sectionLabel(next, currentIndex + 1)}
              </div>
              <div className="text-xs text-white/25 truncate leading-snug">
                {next.text.split('\n')[0]}
              </div>
            </div>
          ) : (
            <SkipForward className="w-3 h-3 text-white/10 ml-auto" />
          )}
          <ChevronRight className="w-4 h-4 text-white/20 flex-shrink-0" />
        </button>

        {/* Big prev/next buttons */}
        <div className="flex flex-col gap-0 flex-shrink-0">
          <button
            onClick={() => navigate(currentIndex - 1)}
            disabled={currentIndex === -1}
            className="flex-1 px-5 flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all border-b border-white/5"
            title="←"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => navigate(currentIndex + 1)}
            disabled={currentIndex === sections.length - 1}
            className="flex-1 px-5 flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
            title="→"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Dot navigation */}
      {sections.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-2 border-t border-white/5">
          {/* Title slide dot */}
          <button
            onClick={() => navigate(-1)}
            title="Titlu"
            className={`rounded-full transition-all duration-200 ${currentIndex === -1
              ? 'w-5 h-2 bg-primary'
              : 'w-2 h-2 bg-primary/30 hover:bg-primary/60'
              }`}
          />
          {sections.map((s, i) => (
            <button
              key={i}
              onClick={() => navigate(i)}
              title={sectionLabel(s, i)}
              className={`rounded-full transition-all duration-200 ${i === currentIndex
                ? 'w-5 h-2 bg-primary'
                : s.type === 'refren'
                  ? 'w-2 h-2 bg-amber-400/40 hover:bg-amber-400/70'
                  : 'w-2 h-2 bg-white/15 hover:bg-white/40'
                }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
