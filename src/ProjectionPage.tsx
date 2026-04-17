import { useCallback, useEffect, useRef, useState } from 'react';
import { AppSettings, HymnSection, ProjectionSlideData } from './vite-env';

// ─────────────────────────────────────────────────────────────────────────────
// Projection Page — renders in the fullscreen secondary window
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectionPage() {
  const [data, setData] = useState<ProjectionSlideData | null>(null);
  const [visible, setVisible] = useState(false);
  const [bg, setBg] = useState<AppSettings>({});
  const [zoomLevel, setZoomLevel] = useState(1);

  // ── Video state ──
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load background settings once on mount
  useEffect(() => {
    window.electron.settings.get().then(s => setBg(s));
  }, []);

  // Receive slide updates pushed from main process
  useEffect(() => {
    window.electron.projection.onSlide((incoming) => {
      setData(incoming);
      setVisible(true);
      // Stop video when hymn/bible projection starts
      if (videoUrl) {
        setVideoUrl(null);
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
      }
    });
    return () => { window.electron.projection.offSlide(); };
  }, [videoUrl]);

  // ── Video IPC listeners ──
  const sendVideoStatus = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    window.electron.video.sendStatus({
      currentTime: v.currentTime,
      duration: v.duration || 0,
      paused: v.paused,
    });
  }, []);

  useEffect(() => {
    window.electron.video.onLoad((url, _name) => {
      setVideoUrl(url);
      setData(null); // hide hymn/bible content
      // Audio output: use saved device if available
      window.electron.settings.get().then(s => {
        if (s.audioOutputDeviceId && videoRef.current) {
          try {
            (videoRef.current as any).setSinkId(s.audioOutputDeviceId);
          } catch { /* ignore if not supported */ }
        }
      });
    });
    window.electron.video.onPlay(() => videoRef.current?.play());
    window.electron.video.onPause(() => videoRef.current?.pause());
    window.electron.video.onStop(() => {
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
      setVideoUrl(null);
    });
    window.electron.video.onSeek((time) => {
      if (videoRef.current) videoRef.current.currentTime = time;
    });
    window.electron.video.onVolume((vol) => {
      if (videoRef.current) videoRef.current.volume = vol;
    });

    return () => {
      window.electron.video.offLoad();
      window.electron.video.offPlay();
      window.electron.video.offPause();
      window.electron.video.offStop();
      window.electron.video.offSeek();
      window.electron.video.offVolume();
    };
  }, []);

  // Signal to main process that all IPC listeners are registered and ready
  useEffect(() => {
    window.electron.projection.signalReady();
  }, []);

  // Start/stop status interval when video loads/unloads
  useEffect(() => {
    if (videoUrl) {
      statusIntervalRef.current = setInterval(sendVideoStatus, 500);
    } else {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    };
  }, [videoUrl, sendVideoStatus]);

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
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setZoomLevel(z => Math.min(z + 0.1, 2.5));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setZoomLevel(z => Math.max(z - 0.1, 0.5));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Listen for zoom commands from main window via IPC
  useEffect(() => {
    window.electron.projection.onZoom((action) => {
      if (action === 'zoom-in') setZoomLevel(z => Math.min(z + 0.1, 2.5));
      else if (action === 'zoom-out') setZoomLevel(z => Math.max(z - 0.1, 0.5));
    });
    return () => { window.electron.projection.offZoom(); };
  }, []);

  const section: HymnSection | undefined = data?.sections[data.currentIndex];
  const isBible = data?.contentType === 'bible';

  // Font size setting: default 1.2 (larger than before), user-adjustable from settings
  const fontSizeMultiplier = (bg.projectionFontSize ?? 1.2) * zoomLevel;

  // ── Uniform font size for the entire hymn ──
  // Analyze ALL sections once when the hymn changes, pick the tightest fit,
  // and use that font for every slide so it never varies mid-hymn.
  // Constants are conservative: account for header (~6vh), footer dots (~6vh),
  // padding, line-height 1.45, and bold text being ~20% wider than normal.
  const hymnFontSize = (() => {
    if (!data || data.sections.length === 0) return null;

    // For Bible content, keep per-verse sizing (verses are independent)
    if (isBible) return null;

    let worstVw = 10;
    let worstVh = 14;

    for (const sec of data.sections) {
      const lines = sec.text.split('\n');
      const lineCount = Math.max(1, lines.length);
      const maxLineCharCount = Math.max(1, ...lines.map((l: string) => l.trim().length));
      // 120 instead of 150: bold weight 700 chars are ~20% wider
      worstVw = Math.min(worstVw, 120 / maxLineCharCount);
      // 58 instead of 72: usable area is ~58vh after header + footer + padding
      worstVh = Math.min(worstVh, 58 / (lineCount * 1.45));
    }

    const vw = Math.min(10, worstVw).toFixed(2);
    const vh = Math.min(14, worstVh).toFixed(2);
    return `calc(clamp(1.5rem, min(${vw}vw, ${vh}vh), 7rem) * ${fontSizeMultiplier})`;
  })();

  // Dynamic font size: use the uniform hymn font, or per-section for Bible
  let dynamicFontSize = `calc(clamp(2.5rem, 5.5vw, 7rem) * ${fontSizeMultiplier})`;
  if (hymnFontSize) {
    // Hymn: consistent font across all slides
    dynamicFontSize = hymnFontSize;
  } else if (section) {
    // Bible or fallback: per-section sizing
    const lines = section.text.split('\n');
    const lineCount = Math.max(1, lines.length);
    const maxLineCharCount = Math.max(1, ...lines.map(l => l.trim().length));

    const maxVw = Math.min(10, 150 / maxLineCharCount).toFixed(2);
    const maxVh = Math.min(14, 72 / (lineCount * 1.45)).toFixed(2);

    const minSize = isBible ? '2.5rem' : '2rem';
    const maxSize = isBible ? '9rem' : '8rem';
    dynamicFontSize = `calc(clamp(${minSize}, min(${maxVw}vw, ${maxVh}vh), ${maxSize}) * ${fontSizeMultiplier})`;
  }

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
        ...bgStyle,
      }}
    >
      {/* ── Background layers ── */}

      {bgType === 'image' && bg.bgImagePath && (
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

      {bgType === 'video' && bg.bgVideoPath && (
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

      {/* ── Video Player (fullscreen) ── */}
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          className="absolute inset-0 w-full h-full object-contain z-20"
          style={{ background: '#000' }}
          autoPlay
          onCanPlay={() => {
            videoRef.current?.play().catch(() => { });
          }}
          onEnded={sendVideoStatus}
          onPause={sendVideoStatus}
          onPlay={sendVideoStatus}
        />
      )}

      {/* ── Content (above background, hidden when video is active) ── */}

      {/* Header — Hymn: number + title + section label, all on one bright line */}
      {!videoUrl && data && !isBible && data.currentIndex >= 0 && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center gap-4 px-10 py-5"
          style={{ opacity: visible ? 0.85 : 0, transition: 'opacity 0.4s' }}
        >
          <span
            className="font-black tabular-nums"
            style={{ color: hymnNumberColor, fontSize: 'clamp(1.1rem, 2.2vw, 1.7rem)', textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}
          >
            {data.hymnNumber}.
          </span>
          <span
            className="font-semibold uppercase tracking-widest truncate"
            style={{ color: contentTextColor, fontSize: 'clamp(0.85rem, 1.6vw, 1.2rem)', letterSpacing: '0.18em', textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}
          >
            {data.hymnTitle}
          </span>
          {section && data.currentIndex >= 0 && (
            <span
              className={`ml-auto uppercase tracking-widest font-bold px-4 py-1 rounded-full border whitespace-nowrap
                ${section.type === 'refren'
                  ? 'border-amber-400/60 text-amber-300'
                  : 'border-white/40 text-white'}`}
              style={{ fontSize: 'clamp(0.7rem, 1.2vw, 0.95rem)', letterSpacing: '0.2em', textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}
            >
              {section.type === 'refren' ? 'Refren' : `Strofa ${(data?.sections
                .slice(0, data.currentIndex + 1)
                .filter(s => s.type === 'strofa').length) ?? ''}`}
            </span>
          )}
        </div>
      )}

      {/* Main content — title slide, lyrics, or Bible verse */}
      {!videoUrl && (
        <div
          className="relative z-10 px-16 text-center w-full max-w-full"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.35s ease, transform 0.35s ease',
          }}
        >
          {data && isBible && section ? (
            /* ── Bible verse slide ── */
            <div className="flex flex-col items-center justify-center gap-8">
              <div className="max-h-[65vh] overflow-y-auto px-3">
                <p
                  className="leading-relaxed"
                  style={{
                    color: contentTextColor,
                    fontSize: dynamicFontSize,
                    fontWeight: 700,
                    lineHeight: 1.5,
                    textShadow: '0 2px 48px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.8)',
                    whiteSpace: 'pre-line',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {section.text}
                </p>
              </div>
              {/* Bible reference below the text */}
              {data.bibleRef && (
                <p
                  className="font-semibold uppercase tracking-widest"
                  style={{
                    color: hymnNumberColor,
                    fontSize: 'clamp(1rem, 2.5vw, 2rem)',
                    letterSpacing: '0.15em',
                    textShadow: '0 2px 24px rgba(0,0,0,0.8)',
                    opacity: 0.7,
                  }}
                >
                  {data.bibleRef}
                </p>
              )}
            </div>
          ) : data && data.currentIndex === -1 ? (
            /* ── Title slide ── */
            <div className="flex flex-col items-center gap-6">
              <span
                className="font-black tabular-nums"
                style={{
                  color: hymnNumberColor,
                  fontSize: `calc(clamp(3rem, 10vw, 8rem) * ${fontSizeMultiplier})`,
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
                  fontSize: `calc(clamp(1.2rem, 3.5vw, 3.5rem) * ${fontSizeMultiplier})`,
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
                  fontSize: dynamicFontSize,
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
          ) : (
            <p className="text-white/10 text-4xl font-thin">Se încarcă...</p>
          )}
        </div>
      )}

      {/* Slide position dots — bottom */}
      {!videoUrl && data && data.sections.length > 1 && data.currentIndex >= 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-2 pb-8 z-10"
          style={{ opacity: visible ? 0.7 : 0, transition: 'opacity 0.4s' }}
        >
          {isBible ? (
            /* Bible: current verse / total */
            <span className="text-white text-sm font-mono tracking-wider">
              {data.currentIndex + 1} / {data.sections.length}
            </span>
          ) : (
            data.sections.map((s, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${i === data.currentIndex
                  ? 'w-6 h-2'
                  : s.type === 'refren'
                    ? 'w-2 h-2 bg-amber-400/80'
                    : 'w-2 h-2 bg-white'
                  }`}
                style={i === data.currentIndex ? { backgroundColor: '#6ee7a0' } : undefined}
              />
            ))
          )}
        </div>
      )}

      {/* Keyboard hint — fades in, then out after a few seconds */}
      <KeyboardHint />
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
