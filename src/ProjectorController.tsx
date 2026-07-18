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
  videoActive: boolean;
}

export function ProjectorController({ sections, hymnTitle, hymnNumber, onClose, onNavigate, videoActive }: ProjectorControllerProps) {
  const [currentIndex, setCurrentIndex] = useState(-1);

  // Nivelul de zoom al textului pe proiecție, raportat înapoi din fereastra de proiecție
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomToast, setZoomToast] = useState(false);
  const zoomToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomPrevRef = useRef(100);
  const zoomInitedRef = useRef(false);

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

  // Suspendă navigarea imnurilor cât timp rulează un video (Space/săgeți controlează video-ul).
  const videoActiveRef = useRef(false);
  useEffect(() => { videoActiveRef.current = videoActive; }, [videoActive]);

  // Keyboard prev/next — capture phase, single stable registration (no currentIndex dep)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inTextField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      // When in a text field, skip arrow handling (global handler manages Escape)
      if (inTextField) return;

      // Cât timp rulează un video, nu naviga imnul — altfel Space/săgeata trimite un slide peste video.
      if (videoActiveRef.current) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        navigate(currentIndexRef.current + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        navigate(currentIndexRef.current - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        window.electron.projection.sendKeyRequest('zoom-in');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        window.electron.projection.sendKeyRequest('zoom-out');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // navigate is a stable useCallback — intentionally no currentIndex dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // Recepționează nivelul de zoom raportat din fereastra de proiecție și afișează
  // un scurt toast „Text: NNN%" la fiecare schimbare (nu la raportul inițial)
  useEffect(() => {
    window.electron.projection.onZoomLevel((level) => {
      const pct = Math.round(level * 100);
      if (zoomInitedRef.current && pct !== zoomPrevRef.current) {
        setZoomToast(true);
        if (zoomToastTimer.current) clearTimeout(zoomToastTimer.current);
        zoomToastTimer.current = setTimeout(() => setZoomToast(false), 2000);
      }
      zoomInitedRef.current = true;
      zoomPrevRef.current = pct;
      setZoomPercent(pct);
    });
    return () => {
      window.electron.projection.offZoomLevel();
      if (zoomToastTimer.current) clearTimeout(zoomToastTimer.current);
    };
  }, []);

  const current = sections[currentIndex];
  const prev = sections[currentIndex - 1];
  const next = sections[currentIndex + 1];

  // Count strofa index for labels
  const sectionLabel = (s: HymnSection, idx: number) => {
    if (s.type === 'refren') return 'Refren';
    const strofaNum = sections.slice(0, idx + 1).filter(x => x.type === 'strofa').length;
    return `Strofa ${strofaNum}`;
  };

  // Etichetă scurtă pentru butonul de salt: „R" refren, altfel numărul strofei
  const dotLabel = (s: HymnSection, idx: number) => {
    if (s.type === 'refren') return 'R';
    return String(sections.slice(0, idx + 1).filter(x => x.type === 'strofa').length);
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
          {/* Zoom text proiecție — A− [nivel] A+ (click pe procent = 100%) */}
          <div className="relative flex items-center gap-0.5 rounded-lg bg-white/5 border border-white/10 p-0.5 mr-1" title="Zoom text proiecție">
            <button
              onClick={() => window.electron.projection.sendKeyRequest('zoom-out')}
              className="w-7 h-6 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-all text-xs font-bold"
              title="Micșorează textul (↓)"
            >
              A−
            </button>
            <button
              onClick={() => window.electron.projection.sendKeyRequest('zoom-reset')}
              className="min-w-[2.75rem] h-6 px-1 flex items-center justify-center rounded-md text-[11px] font-bold tabular-nums text-white/75 hover:text-white hover:bg-white/10 transition-all"
              title="Resetează la 100%"
            >
              {zoomPercent}%
            </button>
            <button
              onClick={() => window.electron.projection.sendKeyRequest('zoom-in')}
              className="w-7 h-6 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-all text-sm font-bold"
              title="Mărește textul (↑)"
            >
              A+
            </button>
            <div
              className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 rounded-md bg-black/85 border border-white/15 text-[11px] font-semibold text-white shadow-lg pointer-events-none transition-opacity duration-300"
              style={{ opacity: zoomToast ? 1 : 0 }}
            >
              Text: {zoomPercent}%
            </div>
          </div>
          <kbd className="text-[9px] text-white/20 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">←→ Space: navigare · ↑↓: font</kbd>
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

      {/* Butoane de salt — etichetă în interior (T / număr strofă / R), curentul cu chenar gros */}
      {sections.length > 1 && (
        <div className="flex items-center justify-center flex-wrap gap-2 py-2.5 border-t border-white/5">
          {/* Buton slide de titlu */}
          <button
            onClick={() => navigate(-1)}
            title="Titlu"
            className={`w-6 h-6 flex items-center justify-center rounded-md text-[11px] font-bold tabular-nums transition-all duration-200 ${currentIndex === -1
              ? 'bg-primary text-white ring-2 ring-primary ring-offset-1 ring-offset-[#0d1020]'
              : 'bg-primary/15 text-primary/70 hover:bg-primary/30'
              }`}
          >
            T
          </button>
          {sections.map((s, i) => {
            const isCurrent = i === currentIndex;
            const isRefren = s.type === 'refren';
            return (
              <button
                key={i}
                onClick={() => navigate(i)}
                title={sectionLabel(s, i)}
                className={`w-6 h-6 flex items-center justify-center rounded-md text-[11px] font-bold tabular-nums transition-all duration-200 ${isCurrent
                  ? isRefren
                    ? 'bg-amber-400 text-black ring-2 ring-amber-400 ring-offset-1 ring-offset-[#0d1020]'
                    : 'bg-primary text-white ring-2 ring-primary ring-offset-1 ring-offset-[#0d1020]'
                  : isRefren
                    ? 'bg-amber-400/20 text-amber-300 hover:bg-amber-400/40'
                    : 'bg-white/10 text-white/60 hover:bg-white/25'
                  }`}
              >
                {dotLabel(s, i)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
