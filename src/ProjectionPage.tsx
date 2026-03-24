import { useEffect, useRef, useState } from 'react';
import { AppSettings, HymnSection, ProjectionSlideData, UrgentTickerData } from './vite-env';

// ─────────────────────────────────────────────────────────────────────────────
// Projection Page — renders in the fullscreen secondary window
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectionPage() {
  const [data, setData] = useState<ProjectionSlideData | null>(null);
  const [urgentTicker, setUrgentTicker] = useState<UrgentTickerData | null>(null);
  const [visible, setVisible] = useState(false);
  const [bg, setBg] = useState<AppSettings>({});

  // Load background settings once on mount
  useEffect(() => {
    window.electron.settings.get().then(s => setBg(s));
  }, []);

  // Receive slide updates pushed from main process
  useEffect(() => {
    window.electron.projection.onSlide((incoming) => {
      setData(incoming);
      setUrgentTicker(null);
      setVisible(true);
    });
    return () => { window.electron.projection.offSlide(); };
  }, []);

  useEffect(() => {
    window.electron.projection.onUrgentTicker((incoming) => {
      setUrgentTicker(incoming);
      if (incoming) {
        setData(null);
        setVisible(true);
      }
    });
    return () => { window.electron.projection.offUrgentTicker(); };
  }, []);

  // Keyboard control: arrows navigate, Escape closes — all via main process
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        window.electron.projection.sendKeyRequest('next');
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        window.electron.projection.sendKeyRequest('prev');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        window.electron.projection.sendKeyRequest('close');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const section: HymnSection | undefined = data?.sections[data.currentIndex];

  // Resolve background styles
  const bgType = bg.bgType ?? 'color';
  const bgColor = bg.bgColor ?? '#000000';
  const hymnNumberColor = bg.hymnNumberColor ?? '#9fb3ff';
  const contentTextColor = bg.contentTextColor ?? '#ffffff';
  const bgStyle: React.CSSProperties =
    bgType === 'color' ? { background: bgColor } : { background: '#000000' };

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center select-none overflow-hidden"
      style={{
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        ...(data ? bgStyle : urgentTicker ? { background: 'transparent' } : bgStyle),
      }}
    >
      {/* ── Background layers ── */}

      {data && bgType === 'image' && bg.bgImagePath && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url("file://${bg.bgImagePath.replace(/\\/g, '/')}")`,
            opacity: bg.bgOpacity ?? 1,
          }}
        >
          {/* dark scrim so text stays readable */}
          <div className="absolute inset-0 bg-black/50" />
        </div>
      )}

      {data && bgType === 'video' && bg.bgVideoPath && (
        <>
          <video
            src={`file://${bg.bgVideoPath.replace(/\\/g, '/')}`}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: bg.bgOpacity ?? 1 }}
            autoPlay loop muted playsInline
          />
          <div className="absolute inset-0 bg-black/50" />
        </>
      )}

      {/* ── Content (above background) ── */}

      {/* Hymn title — top left */}
      {data && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center gap-4 px-10 py-6"
          style={{ opacity: visible ? 0.3 : 0, transition: 'opacity 0.4s' }}
        >
          <span
            className="font-black tabular-nums"
            style={{ color: hymnNumberColor, fontSize: 'clamp(1rem, 2vw, 1.5rem)' }}
          >
            {data.hymnNumber}.
          </span>
          <span
            className="font-semibold uppercase tracking-widest truncate"
            style={{ color: contentTextColor, fontSize: 'clamp(0.75rem, 1.5vw, 1.1rem)', letterSpacing: '0.2em' }}
          >
            {data.hymnTitle}
          </span>
        </div>
      )}

      {/* Section type badge */}
      {section && data && data.currentIndex >= 0 && (
        <div
          className="absolute"
          style={{
            top: '13%',
            opacity: visible ? 0.25 : 0,
            transition: 'opacity 0.4s',
          }}
        >
          <span
            className={`uppercase tracking-widest font-bold px-4 py-1 rounded-full border text-white
              ${section.type === 'refren'
                ? 'border-amber-400 text-amber-400'
                : 'border-white/30 text-white/60'}`}
            style={{ fontSize: 'clamp(0.65rem, 1.2vw, 0.9rem)', letterSpacing: '0.25em' }}
          >
            {section.type === 'refren' ? 'Refren' : `Strofă ${(data?.sections
              .slice(0, data.currentIndex + 1)
              .filter(s => s.type === 'strofa').length) ?? ''}`}
          </span>
        </div>
      )}

      {/* Main content — title slide or lyrics */}
      <div
        className="relative z-10 px-16 text-center w-full max-w-full"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
        }}
      >
        {data && data.currentIndex === -1 ? (
          /* ── Title slide ── */
          <div className="flex flex-col items-center gap-6">
            <span
              className="font-black tabular-nums"
              style={{
                color: hymnNumberColor,
                fontSize: 'clamp(3rem, 10vw, 8rem)',
                lineHeight: 1,
                textShadow: '0 4px 48px rgba(0,0,0,0.9)',
              }}
            >
              {data.hymnNumber}.
            </span>
            <p
              className="font-bold uppercase tracking-widest"
              style={{
                color: contentTextColor,
                fontSize: 'clamp(1.2rem, 3.5vw, 3.5rem)',
                letterSpacing: '0.12em',
                textShadow: '0 2px 32px rgba(0,0,0,0.9)',
              }}
            >
              {data.hymnTitle}
            </p>
            {/* <p
              className="text-white/30 uppercase tracking-widest"
              style={{ fontSize: 'clamp(0.6rem, 1.2vw, 0.9rem)', letterSpacing: '0.3em', marginTop: '1rem' }}
            >
              Apasă → pentru a începe
            </p> */}
          </div>
        ) : section ? (
          /* ── Lyrics slide ── */
          <div className="max-h-[72vh] overflow-y-auto px-3">
            <p
              className="leading-relaxed"
              style={{
                color: contentTextColor,
                fontSize: 'clamp(2rem, 4.5vw, 5.5rem)',
                fontWeight: 700,
                lineHeight: 1.45,
                textShadow: '0 2px 48px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.8)',
                whiteSpace: 'pre-line',
                overflowWrap: 'anywhere',
              }}
            >
              {section.text}
            </p>
          </div>
        ) : urgentTicker ? null : (
          <p className="text-white/10 text-4xl font-thin">Se încarcă...</p>
        )}
      </div>

      {/* Slide position dots — bottom */}
      {data && data.sections.length > 1 && data.currentIndex >= 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-2 pb-8 z-10"
          style={{ opacity: visible ? 0.4 : 0, transition: 'opacity 0.4s' }}
        >
          {data.sections.map((s, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-300 ${
                i === data.currentIndex
                  ? 'w-6 h-2 bg-white'
                  : s.type === 'refren'
                  ? 'w-2 h-2 bg-amber-400/60'
                  : 'w-2 h-2 bg-white/30'
              }`}
            />
          ))}
        </div>
      )}

      {urgentTicker && <UrgentTickerOverlay ticker={urgentTicker} />}

      {/* Keyboard hint — fades in, then out after a few seconds */}
      {!urgentTicker && <KeyboardHint />}
    </div>
  );
}

function UrgentTickerOverlay({ ticker }: { ticker: UrgentTickerData }) {
  const textRef = useRef<HTMLDivElement>(null);
  const [durationSec, setDurationSec] = useState(20);

  useEffect(() => {
    const updateDuration = () => {
      const textWidth = textRef.current?.scrollWidth ?? 0;
      const viewportWidth = window.innerWidth;
      const speed = Math.max(20, ticker.speed);
      const dist = viewportWidth + textWidth;
      setDurationSec(Math.max(3, dist / speed));
    };

    updateDuration();
    window.addEventListener('resize', updateDuration);
    return () => window.removeEventListener('resize', updateDuration);
  }, [ticker.message, ticker.fontSize, ticker.speed]);

  const verticalPadding = Math.max(6, Math.round(ticker.fontSize * 0.3));

  return (
    <div
      className="absolute inset-0 select-none overflow-hidden pointer-events-none z-30"
    >
      <div
        className="absolute bottom-0 left-0 right-0 overflow-hidden"
        style={{
          background: ticker.backgroundColor,
          paddingTop: `${verticalPadding}px`,
          paddingBottom: `${verticalPadding}px`,
        }}
      >
        <div className="relative overflow-hidden w-full">
          <div
            ref={textRef}
            className="inline-block whitespace-nowrap"
            style={{
              color: ticker.textColor,
              fontSize: `${ticker.fontSize}px`,
              fontWeight: 700,
              lineHeight: 1.2,
              animationName: 'urgent-ticker-scroll',
              animationDuration: `${durationSec}s`,
              animationTimingFunction: 'linear',
              animationIterationCount: 'infinite',
            }}
          >
            {ticker.message}
          </div>
        </div>
      </div>
    </div>
  );
}

// Small hint that appears briefly when the projection window first loads
function KeyboardHint() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="absolute bottom-8 right-8 flex items-center gap-3 transition-opacity duration-700 z-20"
      style={{ opacity: show ? 0.35 : 0 }}
    >
      {[['←', 'Înapoi'], ['→', 'Înainte'], ['Esc', 'Închide']].map(([key, label]) => (
        <div key={key} className="flex items-center gap-1.5 text-white">
          <kbd className="text-[10px] bg-white/10 border border-white/20 rounded px-1.5 py-0.5 font-mono">{key}</kbd>
          <span className="text-[10px]">{label}</span>
        </div>
      ))}
    </div>
  );
}
