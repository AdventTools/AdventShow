import { ChevronLeft, ChevronRight, Download, Loader, Monitor, MonitorOff, Music, SkipBack, SkipForward, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { accTitle } from './accompaniment-ui';
import { useT } from './i18n';

/** Secțiune de previzualizare — la Biblie `type` e 'verse' și `label` vine deja calculat („v. 5"). */
interface PreviewSection {
  text: string;
  type: string;
  label?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Projector Controller
// Shows in the MAIN window when a projection is active.
// ─────────────────────────────────────────────────────────────────────────────

/** Starea acompaniamentului, condusă din App (elementul <audio> stă acolo). */
export interface AccompanimentControl {
  playing: boolean;
  loading: boolean;
  /** Secunde rămase din piesă. */
  remaining: number;
  /** Fișierul nu e încă pe disc — butonul arată mărimea, nu ♪. */
  needsDownload: boolean;
  sizeMb: number;
  /** Gol când nu e nimic de spus. Se arată sub controale, fără dialog. */
  error?: string;
  /** Avansul automat merge ACUM. */
  sync?: boolean;
  /** Imnul pregătit ARE marcaje — se știe înainte de apăsare, nu după. */
  hasMarks?: boolean;
  /**
   * Apăsarea va porni și muzica, nu doar descărca. Fișierul e pe disc, sau
   * imnul e pe ecran și n-are cine apăsa a doua oară. Butonul își scrie
   * eticheta din asta: ce scrie pe el e ce se întâmplă.
   */
  willPlay?: boolean;
  /** 'auto' = merge singur; 'preluat' = operatorul a navigat, s-a oprit. */
  autoState?: 'auto' | 'preluat' | null;
  onToggle: () => void;
  /** Pornește sunetul fără avans automat. Doar la imnurile cu marcaje. */
  onPlayOnly?: () => void;
}

interface ProjectorControllerProps {
  sections: PreviewSection[];
  hymnTitle: string;
  hymnNumber: string;
  /** 'bible' ascunde prescurtarea cărții din antet și etichetează versetele, nu strofele. */
  contentType?: 'hymn' | 'bible';
  onClose: () => void;
  onNavigate: (index: number) => void;
  videoActive: boolean;
  /** null când imnul curent n-are acompaniament în manifest. */
  accompaniment?: AccompanimentControl | null;
  /**
   * Mărimea textului pe proiecție (1.2 = 120%), aceeași cu cea din Setări. O ține
   * App, nu bara: bara dispare cât e un imn „pregătit" și ar reporni de la zero.
   */
  zoomLevel: number | null;
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ProjectorController({ sections, hymnTitle, hymnNumber, contentType = 'hymn', onClose, onNavigate, videoActive, accompaniment, zoomLevel }: ProjectorControllerProps) {
  const t = useT();
  const [currentIndex, setCurrentIndex] = useState(-1);

  const zoomPercent = zoomLevel === null ? null : Math.round(zoomLevel * 100);
  const [zoomToast, setZoomToast] = useState(false);
  const zoomToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomPrevRef = useRef(zoomPercent);

  // La Biblie nu există „slide de titlu" (ca la imnuri) — minimul e primul verset, nu -1.
  const navigate = useCallback(async (index: number) => {
    const minIdx = contentType === 'bible' ? 0 : -1;
    const clamped = Math.max(minIdx, Math.min(index, sections.length - 1));
    setCurrentIndex(clamped);
    onNavigate(clamped);
  }, [sections, onNavigate, contentType]);

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

  // Un scurt toast „Text: NNN%" la fiecare schimbare de mărime — nu la montare,
  // unde valoarea doar e cea de dinainte.
  useEffect(() => {
    if (zoomPercent !== null && zoomPrevRef.current !== null && zoomPercent !== zoomPrevRef.current) {
      setZoomToast(true);
      if (zoomToastTimer.current) clearTimeout(zoomToastTimer.current);
      zoomToastTimer.current = setTimeout(() => setZoomToast(false), 2000);
    }
    zoomPrevRef.current = zoomPercent;
  }, [zoomPercent]);
  useEffect(() => () => {
    if (zoomToastTimer.current) clearTimeout(zoomToastTimer.current);
  }, []);

  // Antetul „numărul. titlu" e specific imnurilor — la Biblie titlul (,,Geneza 19") e de-ajuns.
  const titleLine = contentType === 'hymn' ? `${hymnNumber}. ${hymnTitle}` : hymnTitle;

  const current = sections[currentIndex];
  const prev = sections[currentIndex - 1];
  const next = sections[currentIndex + 1];

  // Eticheta vine deja calculată din previzualizare („Strofa 3", „Refren", „v. 5")
  const sectionLabel = (s: PreviewSection) => s.label ?? (s.type === 'refren' ? t('Refren') : '');

  // Etichetă scurtă pentru butonul de salt: „R" refren, numărul strofei, sau doar cifra versetului
  const dotLabel = (s: PreviewSection) => {
    if (s.type === 'refren') return 'R';
    return (s.label ?? '').replace(/^v\.\s*/, '').replace(/^Strofa\s*/, '');
  };

  return (
    <div className="flex-shrink-0 border-t border-fg/10 bg-[var(--bg-controller)] select-none">

      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-fg/5">
        <Monitor className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
        <div className="flex items-center gap-2 min-w-0">
          {contentType === 'hymn' && (
            <span className="text-xs font-black text-primary tabular-nums">{hymnNumber}.</span>
          )}
          <span className="text-xs text-fg/60 font-semibold truncate">{hymnTitle}</span>
        </div>
        <span className="text-[10px] text-fg/20 ml-1">
          {currentIndex === -1 ? t('Titlu') : `${currentIndex + 1} / ${sections.length}`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Acompaniament — o singură apăsare, sau tasta A. Cât cântă, arată
              timpul RĂMAS: operatorul vrea să știe cât mai are, nu cât a trecut. */}
          {accompaniment && (
            <>
              <button
                onClick={accompaniment.onToggle}
                className={`mr-1 flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-all ${
                  accompaniment.playing
                    ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/30 text-emerald-300'
                    : 'bg-fg/5 hover:bg-fg/10 border-fg/10 text-fg/70 hover:text-fg'
                }`}
                title={accTitle(accompaniment)}
              >
                {accompaniment.loading ? (
                  <>
                    <Loader className="w-3 h-3 animate-spin" />
                    {accompaniment.willPlay ? t('Se descarcă… · nu porni') : t('Se descarcă…')}
                  </>
                ) : accompaniment.playing ? (
                  <>
                    <Square className="w-3 h-3" />
                    <span className="tabular-nums">{mmss(accompaniment.remaining)}</span>
                  </>
                ) : accompaniment.needsDownload ? (
                  <>
                    <Download className="w-3 h-3" />
                    {accompaniment.willPlay ? t('Descarcă și cântă') : t('Descarcă')}
                    {' '}{accompaniment.sizeMb.toFixed(1)} MB
                  </>
                ) : accompaniment.hasMarks ? (
                  <><Music className="w-3 h-3" /> {t('Cântă singur')}</>
                ) : (
                  <><Music className="w-3 h-3" /> {t('Cântă')}</>
                )}
              </button>
              {accompaniment.hasMarks && !accompaniment.playing && !accompaniment.loading
                && accompaniment.onPlayOnly && (
                <button
                  onClick={accompaniment.onPlayOnly}
                  className="mr-1 flex items-center px-2 py-1 rounded-lg border border-fg/10 bg-fg/5 hover:bg-fg/10 text-xs text-fg/60 hover:text-fg transition-all"
                  title={t('Doar acompaniamentul — strofele le schimbi tu')}
                >
                  <Music className="w-3 h-3" />
                </button>
              )}
            </>
          )}

          {/* Mărimea textului — A− [nivel] A+ (click pe procent = mărimea implicită) */}
          <div className="relative flex items-center gap-0.5 rounded-lg bg-fg/5 border border-fg/10 p-0.5 mr-1" title={t('Zoom text proiecție')}>
            <button
              onClick={() => window.electron.projection.sendKeyRequest('zoom-out')}
              className="w-7 h-6 flex items-center justify-center rounded-md text-fg/60 hover:text-fg hover:bg-fg/10 transition-all text-xs font-bold"
              title={t('Micșorează textul (↓)')}
            >
              A−
            </button>
            <button
              onClick={() => window.electron.projection.sendKeyRequest('zoom-reset')}
              className="min-w-[2.75rem] h-6 px-1 flex items-center justify-center rounded-md text-[11px] font-bold tabular-nums text-fg/75 hover:text-fg hover:bg-fg/10 transition-all"
              title={t('Înapoi la mărimea implicită (120%)')}
            >
              {zoomPercent ?? '—'}%
            </button>
            <button
              onClick={() => window.electron.projection.sendKeyRequest('zoom-in')}
              className="w-7 h-6 flex items-center justify-center rounded-md text-fg/60 hover:text-fg hover:bg-fg/10 transition-all text-sm font-bold"
              title={t('Mărește textul (↑)')}
            >
              A+
            </button>
            <div
              className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 rounded-md bg-black/85 border border-white/15 text-[11px] font-semibold text-white shadow-lg pointer-events-none transition-opacity duration-300"
              style={{ opacity: zoomToast ? 1 : 0 }}
            >
              {t('Text: {pct}%', { pct: zoomPercent ?? '—' })}
            </div>
          </div>
          <kbd className="text-[9px] text-fg/20 bg-fg/5 border border-fg/10 rounded px-1.5 py-0.5">
            {t('←→ Space: navigare · ↑↓: font')}{accompaniment ? t(' · A: acompaniament') : ''}
          </kbd>
          <button
            onClick={onClose}
            className="ml-3 flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all"
            title={t('Oprește proiecția (Esc)')}
          >
            <MonitorOff className="w-3 h-3" /> {t('Oprește')}
          </button>
        </div>
      </div>

      {/* Regimul, cu litere mari: cât merge singur, operatorul trebuie să știe
          că n-are ce face. Iar în clipa în care atinge o săgeată, indicatorul
          verde DISPARE — altfel ar minți exact când contează mai mult. */}
      {accompaniment?.autoState === 'auto' && (
        <div className="flex items-center gap-2.5 px-4 py-2 bg-emerald-500/15 border-b border-emerald-400/25">
          <span className="text-xs font-black tracking-widest text-emerald-300">{t('AUTOMAT')}</span>
          <span className="text-xs text-emerald-100/85">
            {t('Strofele se schimbă singure. Nu atinge nimic.')}
          </span>
        </div>
      )}
      {accompaniment?.autoState === 'preluat' && (
        <div className="flex items-center gap-2.5 px-4 py-2 bg-amber-500/15 border-b border-amber-400/25">
          <span className="text-xs font-black tracking-widest text-amber-300">{t('MANUAL')}</span>
          <span className="text-xs text-amber-100/85">
            {t('Ai preluat — de aici schimbi tu. Acompaniamentul merge înainte.')}
          </span>
        </div>
      )}

      {/* Slides preview row */}
      <div className="flex items-stretch gap-0 px-0 py-0">

        {/* Prev section preview */}
        <button
          onClick={() => navigate(currentIndex - 1)}
          disabled={currentIndex === -1}
          className="flex items-center gap-2 px-4 py-3 text-left transition-all hover:bg-fg/3 disabled:opacity-20 disabled:cursor-not-allowed flex-shrink-0 w-48 border-r border-fg/5"
          title={t('Anterior (←)')}
        >
          <ChevronLeft className="w-4 h-4 text-fg/20 flex-shrink-0" />
          {currentIndex === 0 ? (
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5 text-primary/50">{t('Titlu')}</div>
              <div className="text-xs text-fg/25 truncate leading-snug">{titleLine}</div>
            </div>
          ) : prev ? (
            <div className="min-w-0">
              <div className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${prev.type === 'refren' ? 'text-amber-400/50' : 'text-fg/20'}`}>
                {sectionLabel(prev)}
              </div>
              <div className="text-xs text-fg/25 truncate leading-snug">
                {prev.text.split('\n')[0]}
              </div>
            </div>
          ) : (
            <SkipBack className="w-3 h-3 text-fg/10" />
          )}
        </button>

        {/* Current section — main focus */}
        <div className="flex-1 px-6 py-3 bg-fg/3 border-r border-fg/5">
          {currentIndex === -1 ? (
            <>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1 text-primary/70">{t('Titlu')}</div>
              <div className="text-sm text-fg/80 leading-relaxed font-medium">
                {contentType === 'hymn' && <span className="text-primary font-black">{hymnNumber}.</span>}{contentType === 'hymn' ? ' ' : ''}{hymnTitle}
              </div>
            </>
          ) : current ? (
            <>
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${current.type === 'refren' ? 'text-amber-400' : 'text-primary/70'}`}>
                {sectionLabel(current)}
              </div>
              <div className="text-sm text-fg/80 leading-relaxed line-clamp-3 whitespace-pre-line font-medium">
                {current.text}
              </div>
            </>
          ) : null}
        </div>

        {/* Next section preview */}
        <button
          onClick={() => navigate(currentIndex + 1)}
          disabled={currentIndex === sections.length - 1}
          className="flex items-center gap-2 px-4 py-3 text-left transition-all hover:bg-fg/3 disabled:opacity-20 disabled:cursor-not-allowed flex-shrink-0 w-48 border-r border-fg/5"
          title={t('Următor (→)')}
        >
          {next ? (
            <div className="min-w-0 flex-1">
              <div className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${next.type === 'refren' ? 'text-amber-400/50' : 'text-fg/20'}`}>
                {sectionLabel(next)}
              </div>
              <div className="text-xs text-fg/25 truncate leading-snug">
                {next.text.split('\n')[0]}
              </div>
            </div>
          ) : (
            <SkipForward className="w-3 h-3 text-fg/10 ml-auto" />
          )}
          <ChevronRight className="w-4 h-4 text-fg/20 flex-shrink-0" />
        </button>

        {/* Big prev/next buttons */}
        <div className="flex flex-col gap-0 flex-shrink-0">
          <button
            onClick={() => navigate(currentIndex - 1)}
            disabled={currentIndex === -1}
            className="flex-1 px-5 flex items-center justify-center text-fg/20 hover:text-fg/60 hover:bg-fg/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all border-b border-fg/5"
            title="←"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => navigate(currentIndex + 1)}
            disabled={currentIndex === sections.length - 1}
            className="flex-1 px-5 flex items-center justify-center text-fg/20 hover:text-fg/60 hover:bg-fg/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
            title="→"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Puncte de salt — eticheta (T / număr strofă / R) apare doar pe cel curent */}
      {sections.length > 1 && (
        <div className="flex items-center justify-center flex-wrap gap-2 py-2.5 border-t border-fg/5">
          {/* Punct slide de titlu */}
          <button
            onClick={() => navigate(-1)}
            title={t('Titlu')}
            className={`flex items-center justify-center rounded-full text-[10px] font-bold tabular-nums leading-none transition-all duration-200 ${currentIndex === -1
              ? 'h-4 min-w-[1.4rem] px-1.5 bg-primary text-white'
              : 'w-2 h-2 text-transparent bg-fg/15 hover:bg-fg/40'
              }`}
          >
            {currentIndex === -1 ? t('T') : ''}
          </button>
          {sections.map((s, i) => {
            const isCurrent = i === currentIndex;
            const isRefren = s.type === 'refren';
            return (
              <button
                key={i}
                onClick={() => navigate(i)}
                title={sectionLabel(s)}
                className={`flex items-center justify-center rounded-full text-[10px] font-bold tabular-nums leading-none transition-all duration-200 ${isCurrent
                  ? isRefren
                    ? 'h-4 min-w-[1.4rem] px-1.5 bg-amber-400 text-black'
                    : 'h-4 min-w-[1.4rem] px-1.5 bg-primary text-white'
                  : isRefren
                    ? 'w-2 h-2 bg-amber-400/40 hover:bg-amber-400/70'
                    : 'w-2 h-2 bg-fg/15 hover:bg-fg/40'
                  }`}
              >
                {isCurrent ? dotLabel(s) : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
