import { useCallback, useEffect, useRef, useState } from 'react';
import { AppSettings, HymnSection, ProjectionSlideData, ProjectionTimerData, ProjectionTextData } from './vite-env';

// Convert a local file path to a proper file:// URL (handles Windows drive letters)
function toFileUrl(p: string): string {
  const fwd = p.replace(/\\/g, '/')
  // Windows: C:/... → file:///C:/...    macOS/Linux: /... → file:///...
  return fwd.startsWith('/') ? `file://${fwd}` : `file:///${fwd}`
}

// Rough viewport-width sizing for free text: fewer chars on the longest line → bigger.
function textBackgroundCss(background?: { type: 'color' | 'gradient' | 'image'; value: string } | null): string | undefined {
  if (!background?.value) return undefined;
  if (background.type === 'image') return `url('localfile://${encodeURI(background.value)}') center / cover no-repeat`;
  return background.value; // culoare sau gradient CSS
}

function freeTextVw(text: string): number {
  const longest = Math.max(1, ...text.split('\n').map(l => l.trim().length));
  return Math.min(9, Math.max(3, 140 / longest));
}

// Format a millisecond duration as H:MM:SS (drops the hour when zero → M:SS).
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer / clock — full-screen, self-ticking (no IPC per second). Computes its
// display from the timestamps in `data`, so it stays accurate across lag/pauses.
// ─────────────────────────────────────────────────────────────────────────────
function TimerDisplay({ data, color, fontScale }: {
  data: ProjectionTimerData; color: string; fontScale: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    // Pauză (valoare înghețată): afișajul e static — nu bifăm deloc.
    if (data.mode !== 'clock' && data.running === false) return;

    // Granularitate aliniată la ce se VEDE (eficiență pe procesoare slabe):
    //   • ceas cu secunde / numărătoare / cronometru → 1 tick pe secundă
    //   • ceas fără secunde → 1 tick pe minut (~240× mai rar decât vechiul 250ms)
    // Faza: ceasul pe granițele de timp reale; numărătoarea/cronometrul pe faza
    // ancorei lor, ca cifra secundelor să se schimbe exact când trebuie.
    const isClock = data.mode === 'clock';
    const showSec = isClock && data.clockShowSeconds === true;
    const tickMs = isClock && !showSec ? 60000 : 1000;
    const anchor = isClock ? 0 : (data.targetEpochMs ?? data.startEpochMs ?? 0);
    const phase = anchor % tickMs;
    const delay = ((phase - Date.now()) % tickMs + tickMs) % tickMs + 15;

    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), tickMs);
    }, delay);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [data.mode, data.clockShowSeconds, data.running, data.targetEpochMs, data.startEpochMs]);

  // După terminare = „oprește": la N secunde după zero cere închiderea proiecției.
  // Închiderea reală o face procesul main (projection:key-request → projectionWin.close()).
  useEffect(() => {
    if (data.mode !== 'countdown' || data.afterZero !== 'stop' || data.running === false) return;
    if (data.targetEpochMs == null) return;
    const secs = Math.max(0, data.afterZeroSeconds ?? 30);
    const delay = data.targetEpochMs + secs * 1000 - Date.now();
    const id = setTimeout(() => { window.electron.projection.sendKeyRequest('close'); }, Math.max(0, delay));
    return () => clearTimeout(id);
  }, [data.mode, data.afterZero, data.afterZeroSeconds, data.running, data.targetEpochMs]);

  let display: string;
  let atZero = false;

  if (data.mode === 'clock') {
    const d = new Date(now);
    const h24 = data.clock24h !== false;
    let h = d.getHours();
    const suffix = h24 ? '' : (h >= 12 ? ' PM' : ' AM');
    if (!h24) { h = h % 12; if (h === 0) h = 12; }
    const pad = (n: number) => String(n).padStart(2, '0');
    const secondsPart = data.clockShowSeconds === true ? `:${pad(d.getSeconds())}` : '';
    display = `${h24 ? pad(h) : h}:${pad(d.getMinutes())}${secondsPart}${suffix}`;
  } else if (data.mode === 'stopwatch') {
    const elapsed = !data.running && data.frozenValueMs != null
      ? data.frozenValueMs
      : now - (data.startEpochMs ?? now);
    display = formatDuration(elapsed);
  } else {
    // countdown
    const remaining = !data.running && data.frozenValueMs != null
      ? data.frozenValueMs
      : (data.targetEpochMs ?? now) - now;
    atZero = remaining <= 0;
    display = atZero ? '0:00' : formatDuration(remaining);
  }

  const showZeroMsg = atZero && data.mode === 'countdown' && !!data.zeroMessage;
  const analogClock = data.mode === 'clock' && data.clockAnalog === true;

  // După terminare = „ecran negru": la zero acoperă tot cu negru (fără text/fundal).
  if (atZero && data.mode === 'countdown' && data.afterZero === 'black') {
    return <div className="absolute inset-0 z-20" style={{ background: '#000' }} />;
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center" style={{ padding: '4vh 4vw' }}>
      {data.title && (
        <div style={{
          color, opacity: 0.85, fontWeight: 600, textAlign: 'center',
          marginBottom: '2vh', textShadow: '0 2px 16px rgba(0,0,0,0.55)',
          fontSize: `calc(clamp(1.5rem, 4vw, 4rem) * ${fontScale})`,
        }}>
          {data.title}
        </div>
      )}
      {analogClock ? (
        <AnalogClock now={now} color={color} showSeconds={data.clockShowSeconds === true} fontScale={fontScale} />
      ) : (
        <div style={{
          color, fontWeight: 800, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
          lineHeight: 1, letterSpacing: '0.02em', textShadow: '0 4px 28px rgba(0,0,0,0.6)',
          fontSize: `calc(clamp(4rem, 22vw, 22rem) * ${fontScale})`,
        }}>
          {showZeroMsg ? data.zeroMessage : display}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Analog clock — SVG face with hour marks; smooth hour/minute hands, optional
// second hand. Sized relative to the screen (vmin) so it fills the projection.
// ─────────────────────────────────────────────────────────────────────────────
function AnalogClock({ now, color, showSeconds, fontScale }: {
  now: number; color: string; showSeconds: boolean; fontScale: number;
}) {
  const d = new Date(now);
  // valori DISCRETE (pas pe secundă/minut) — fără recalcul continuu din milisecunde
  const sec = d.getSeconds();
  const min = d.getMinutes() + sec / 60;
  const hr = (d.getHours() % 12) + min / 60;

  const hourAngle = hr * 30;
  const minAngle = min * 6;
  const secAngle = Math.floor(sec) * 6; // tick pe secundă întreagă

  // repere: 12 liniuțe, cele de la 12/3/6/9 mai groase
  const marks = Array.from({ length: 12 }, (_, i) => {
    const major = i % 3 === 0;
    return (
      <line
        key={i}
        x1={100} y1={major ? 12 : 15} x2={100} y2={major ? 24 : 21}
        stroke={color} strokeWidth={major ? 5 : 2.5} strokeLinecap="round"
        transform={`rotate(${i * 30} 100 100)`}
      />
    );
  });

  return (
    <svg
      viewBox="0 0 200 200"
      style={{
        width: `calc(min(68vmin, 68vh) * ${fontScale})`,
        height: `calc(min(68vmin, 68vh) * ${fontScale})`,
        // fără drop-shadow: filtrul se re-rasteriza la fiecare mișcare a limbilor
      }}
    >
      <circle cx={100} cy={100} r={96} fill="rgba(0,0,0,0.38)" stroke={color} strokeWidth={4} />
      {marks}
      {/* orar */}
      <line
        x1={100} y1={100} x2={100} y2={48}
        stroke={color} strokeWidth={7} strokeLinecap="round"
        transform={`rotate(${hourAngle} 100 100)`}
      />
      {/* minutar */}
      <line
        x1={100} y1={100} x2={100} y2={30}
        stroke={color} strokeWidth={4.5} strokeLinecap="round"
        transform={`rotate(${minAngle} 100 100)`}
      />
      {/* secundar (opțional) */}
      {showSeconds && (
        <line
          x1={100} y1={112} x2={100} y2={26}
          stroke={color} strokeWidth={1.8} strokeLinecap="round" opacity={0.85}
          transform={`rotate(${secAngle} 100 100)`}
        />
      )}
      <circle cx={100} cy={100} r={5} fill={color} />
    </svg>
  );
}

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
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // intervalul de status video nu trebuie să supraviețuiască componentei
  // (altfel continuă să ruleze într-un renderer pe moarte la închiderea proiecției)
  useEffect(() => () => {
    if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
  }, []);

  // ── Special modes: timer/clock + free text / prezentare ──
  const [timer, setTimer] = useState<ProjectionTimerData | null>(null);
  const [freeText, setFreeText] = useState<ProjectionTextData | null>(null);

  // Video-ul de fundal e complet acoperit când rulează un video proiectat sau
  // când Ceasul/Realtime au fundal propriu → îl punem pe pauză (decodarea
  // video pe ascuns ardea CPU degeaba); revine singur când redevine vizibil.
  const bgVideoCovered = !!videoUrl || !!timer?.background || !!freeText?.background;
  useEffect(() => {
    const v = bgVideoRef.current;
    if (!v) return;
    if (bgVideoCovered) v.pause();
    else if (v.paused) v.play().catch(() => { /* autoplay refuzat — rămâne static */ });
  }, [bgVideoCovered]);

  // Load background settings once on mount
  useEffect(() => {
    window.electron.settings.get().then(s => setBg(s));
  }, []);

  // Receive slide updates pushed from main process
  useEffect(() => {
    window.electron.projection.onSlide((incoming) => {
      setData(incoming);
      setVisible(true);
      // A normal slide takes over: clear video + special modes
      setTimer(null);
      setFreeText(null);
      if (videoUrl) {
        setVideoUrl(null);
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
      }
    });
    return () => { window.electron.projection.offSlide(); };
  }, [videoUrl]);

  // Special modes: timer/clock + free text. Each takes over the screen and clears
  // the others (and any active video/slide).
  useEffect(() => {
    window.electron.projection.onTimer((incoming) => {
      setTimer(incoming);
      setFreeText(null);
      setData(null);
      setVisible(true);
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
      setVideoUrl(null);
    });
    window.electron.projection.onText((incoming) => {
      setFreeText(incoming ?? { text: '' });
      setTimer(null);
      setData(null);
      setVisible(true);
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
      setVideoUrl(null);
    });
    return () => {
      window.electron.projection.offTimer();
      window.electron.projection.offText();
    };
  }, []);

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
      window.electron.settings.get().then(async s => {
        if (s.audioOutputDeviceId && videoRef.current) {
          try {
            await (videoRef.current as any).setSinkId(s.audioOutputDeviceId);
          } catch (err) {
            console.warn('[Projection] setSinkId failed, using default audio output:', err);
          }
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
      else if (action === 'zoom-reset') setZoomLevel(1);
    });
    return () => { window.electron.projection.offZoom(); };
  }, []);

  // Raportează nivelul de zoom către fereastra principală (bara de control)
  useEffect(() => {
    window.electron.projection.reportZoom(zoomLevel);
  }, [zoomLevel]);

  const section: HymnSection | undefined = data?.sections[data.currentIndex];
  const isBible = data?.contentType === 'bible';

  // Font size setting: default 1.2 (larger than before), user-adjustable from settings
  const fontSizeMultiplier = (bg.projectionFontSize ?? 1.2) * zoomLevel;

  // ── Auto-shrink: guarantees text NEVER overflows the container ──
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shrinkFactor, setShrinkFactor] = useState(1);

  // Reset shrink factor when slide changes
  useEffect(() => {
    setShrinkFactor(1);
  }, [data?.currentIndex, data?.hymnNumber, zoomLevel]);

  // la redimensionarea containerului (schimbare display/zoom) re-pornim potrivirea
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      setShrinkFactor(1);
      setResizeTick(t => t + 1);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // After render, check if content overflows and shrink until it fits
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    // Use requestAnimationFrame to measure after paint
    const raf = requestAnimationFrame(() => {
      const containerH = container.clientHeight;
      const contentH = content.scrollHeight;
      if (contentH > containerH && containerH > 0) {
        // Shrink proportionally, with a small extra margin.
        // Plafonul minim e jos intenționat: cerința e ca textul să NU depășească
        // NICIODATĂ vertical ecranul, oricât de lungă ar fi strofa.
        const newFactor = shrinkFactor * (containerH / contentH) * 0.95;
        const clamped = Math.max(0.15, newFactor);
        // gardă anti-buclă: nu reprograma dacă diferența e neglijabilă (sub 0.5%)
        if (Math.abs(clamped - shrinkFactor) > shrinkFactor * 0.005) setShrinkFactor(clamped);
      }
    });
    return () => cancelAnimationFrame(raf);
    // rulează la schimbarea conținutului/zoom-ului, la redimensionare reală
    // (resizeTick) și după fiecare pas de micșorare (shrinkFactor), până încape
  }, [shrinkFactor, resizeTick, data?.currentIndex, data?.hymnNumber, isBible, section?.text, fontSizeMultiplier]);

  // ── Uniform font size for the entire hymn ──
  // Analyze ALL sections once when the hymn changes, pick the tightest fit,
  // and use that font for every slide so it never varies mid-hymn.
  // Available area: ~88vh (header ~3vh + footer ~3vh + padding ~6vh = 12vh overhead)
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
      // Bold weight 700 chars are ~20% wider
      worstVw = Math.min(worstVw, 120 / maxLineCharCount);
      // 82vh usable area after compact header + footer + padding
      worstVh = Math.min(worstVh, 82 / (lineCount * 1.45));
    }

    const vw = Math.min(10, worstVw).toFixed(2);
    const vh = Math.min(14, worstVh).toFixed(2);
    return `calc(clamp(1.5rem, min(${vw}vw, ${vh}vh), 7rem) * ${fontSizeMultiplier} * ${shrinkFactor})`;
  })();

  // Dynamic font size: use the uniform hymn font, or per-section for Bible
  let dynamicFontSize = `calc(clamp(2.5rem, 5.5vw, 7rem) * ${fontSizeMultiplier} * ${shrinkFactor})`;
  if (hymnFontSize) {
    // Hymn: consistent font across all slides
    dynamicFontSize = hymnFontSize;
  } else if (section) {
    if (isBible) {
      // Dimensionare pe ARIE, nu pe „cea mai lungă linie". Versetele biblice sunt
      // proză continuă care se ÎNCADREAZĂ prin wrapping — vechea formulă (150/caractere)
      // presupunea o singură linie ne-întreruptă și dădea font minuscul la versete
      // lungi (ex. 120 car. pe o linie → ~1.25vw ≈ 24px). Aici: font ∝ 1/√(nr. caractere),
      // care umple coerent aria; plafonat SUS ca textele scurte să NU acopere tot
      // ecranul și JOS ca textele lungi să rămână lizibile. Bucla de shrink de mai sus
      // corectează apoi orice depășire reală măsurată.
      const charCount = Math.max(1, section.text.trim().length);
      const sizeVh = Math.max(4.5, Math.min(11, 105 / Math.sqrt(charCount)));
      dynamicFontSize = `calc(clamp(2.5rem, ${sizeVh.toFixed(2)}vh, 11rem) * ${fontSizeMultiplier} * ${shrinkFactor})`;
    } else {
      // fallback (conținut fără uniformizare): dimensionare per-secțiune ca înainte
      const lines = section.text.split('\n');
      const lineCount = Math.max(1, lines.length);
      const maxLineCharCount = Math.max(1, ...lines.map(l => l.trim().length));
      const maxVw = Math.min(10, 150 / maxLineCharCount).toFixed(2);
      const maxVh = Math.min(14, 82 / (lineCount * 1.45)).toFixed(2);
      dynamicFontSize = `calc(clamp(2rem, min(${maxVw}vw, ${maxVh}vh), 8rem) * ${fontSizeMultiplier} * ${shrinkFactor})`;
    }
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
            backgroundImage: `url("${toFileUrl(bg.bgImagePath)}")`,
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
            ref={bgVideoRef}
            src={toFileUrl(bg.bgVideoPath)}
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
          onError={() => {
            const err = videoRef.current?.error;
            const detail = err?.code === 4 ? 'formatul nu poate fi redat sau fișierul lipsește'
              : err?.code === 3 ? 'eroare la decodare'
                : err?.code === 2 ? 'eroare de rețea'
                  : 'eroare necunoscută';
            window.electron.video.sendError(`Videoclipul nu a putut fi redat (${detail}).`);
          }}
        />
      )}

      {/* Timer / clock (fullscreen, self-ticking), cu fundal opțional per-proiecție */}
      {timer && (
        <div className="absolute inset-0 z-20" style={{ background: textBackgroundCss(timer.background) }}>
          <TimerDisplay
            data={timer}
            color={bg.contentTextColor ?? '#ffffff'}
            fontScale={(bg.projectionFontSize ?? 1.2) * zoomLevel}
          />
        </div>
      )}

      {/* Realtime: text simplu (auto-fit) sau slide de prezentare (forme), cu
          fundal opțional per-mesaj peste fundalul global */}
      {freeText !== null && (
        <div className="absolute inset-0 z-20" style={{ background: textBackgroundCss(freeText.background) }}>
          {freeText.shapes ? (
            /* slide de prezentare: forme poziționate procentual; font relativ la
               lățimea ecranului ca să fie identic cu editorul (scalat) */
            <div
              className="absolute inset-0"
              style={{
                fontSize: `calc(3.2vw * ${(bg.projectionFontSize ?? 1.2) * zoomLevel / 1.2})`,
                color: freeText.textColor ?? bg.contentTextColor ?? '#ffffff',
              }}
            >
              {freeText.shapes.map((sh, i) => sh.imageSrc ? (
                <div
                  key={i}
                  className="pres-shape-view"
                  style={{ position: 'absolute', left: `${sh.x}%`, top: `${sh.y}%`, width: `${sh.w}%`, height: `${sh.h}%` }}
                >
                  <img src={`localfile://${encodeURI(sh.imageSrc)}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
              ) : (
                <div
                  key={i}
                  className="pres-shape-view"
                  style={{
                    position: 'absolute',
                    left: `${sh.x}%`, top: `${sh.y}%`, width: `${sh.w}%`, minHeight: `${sh.h}%`,
                    textShadow: '0 2px 16px rgba(0,0,0,0.55)',
                    lineHeight: 1.3,
                    ...(sh.fontScale ? { fontSize: `${sh.fontScale}em` } : {}),
                    ...(sh.columns && sh.columns > 1 ? { columnCount: sh.columns, columnGap: '1.2em' } : {}),
                    ...(sh.anchor ? {
                      height: `${sh.h}%`, display: 'flex', flexDirection: 'column',
                      justifyContent: sh.anchor === 'middle' ? 'center' : 'flex-end',
                    } : {}),
                  }}
                  dangerouslySetInnerHTML={{ __html: sh.html }}
                />
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ padding: '6vh 6vw' }}>
              <div
                style={{
                  color: freeText.textColor ?? bg.contentTextColor ?? '#ffffff',
                  fontWeight: 700,
                  textAlign: 'center',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.25,
                  textShadow: '0 2px 16px rgba(0,0,0,0.55)',
                  fontSize: `calc(clamp(2rem, ${freeTextVw(freeText.text ?? '')}vw, 9rem) * ${(bg.projectionFontSize ?? 1.2) * zoomLevel})`,
                }}
              >
                {freeText.text || ' '}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Content (above background, hidden when video is active) ── */}

      {/* Header — Hymn: number + title + section label, all on one bright line */}
      {!videoUrl && data && !isBible && data.currentIndex >= 0 && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center gap-3 px-8 py-2"
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
          ref={containerRef}
          className="relative z-10 px-12 text-center w-full"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.35s ease, transform 0.35s ease',
            // Înălțime FIXĂ (nu maxHeight): cutia observată de ResizeObserver trebuie
            // să depindă DOAR de viewport, nu de conținut. Altfel ajustarea fontului
            // schimba înălțimea containerului → ResizeObserver → reset shrink → buclă
            // infinită = renderer la 100% CPU (helper-ul macOS care nu se mai oprea).
            height: '90vh',
            paddingTop: data && !isBible && data.currentIndex >= 0 ? '3.5vh' : '0',
            paddingBottom: data && data.sections.length > 1 && data.currentIndex >= 0 ? '4vh' : '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {data && isBible && section ? (
            /* ── Bible verse slide ── */
            <div ref={contentRef} className="flex flex-col items-center justify-center gap-6">
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
              {/* Bible reference below the text */}
              {data.bibleRef && (
                <p
                  className="font-semibold uppercase tracking-widest"
                  style={{
                    color: hymnNumberColor,
                    fontSize: 'clamp(0.8rem, 2vw, 1.5rem)',
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
            <div ref={contentRef}>
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
          ) : null /* fără placeholder pe proiecție — orice text de sistem
                      („Se încarcă...") se vedea fantomatic prin overlay-ul
                      ceasului și la tranziții; ecran gol = corect aici */}
        </div>
      )}

      {/* Slide position dots — bottom */}
      {!videoUrl && data && data.sections.length > 1 && data.currentIndex >= 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-2.5 pb-4 z-10"
          style={{ opacity: visible ? 0.85 : 0, transition: 'opacity 0.4s' }}
        >
          {isBible ? (
            /* Bible: current verse / total */
            <span className="text-white text-base font-mono tracking-wider">
              {data.currentIndex + 1} / {data.sections.length}
            </span>
          ) : (
            /* Puncte simple, fără etichete — cel curent e o pastilă lată */
            data.sections.map((s, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${i === data.currentIndex
                  ? 'w-8 h-3'
                  : s.type === 'refren'
                    ? 'w-3 h-3 bg-amber-400/80'
                    : 'w-3 h-3 bg-white'
                  }`}
                style={i === data.currentIndex ? { backgroundColor: '#6ee7a0' } : undefined}
              />
            ))
          )}
        </div>
      )}

      {/* Keyboard hint — fades in, then out after a few seconds */}
      <KeyboardHint textOnly={freeText !== null && !freeText.shapes} />
    </div>
  );
}

// Small hint that appears briefly when the projection window first loads
function KeyboardHint({ textOnly = false }: { textOnly?: boolean }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 4000);
    return () => clearTimeout(t);
  }, []);

  const keys: [string, string][] = textOnly
    ? [['Esc', 'Închide']]
    : [['←', 'Înapoi'], ['→', 'Înainte'], ['Esc', 'Închide']];
  return (
    <div
      className="absolute bottom-8 right-8 flex items-center gap-3 transition-opacity duration-700 z-20"
      style={{ opacity: show ? 0.35 : 0 }}
    >
      {keys.map(([key, label]) => (
        <div key={key} className="flex items-center gap-1.5 text-white">
          <kbd className="text-[10px] bg-white/10 border border-white/20 rounded px-1.5 py-0.5 font-mono">{key}</kbd>
          <span className="text-[10px]">{label}</span>
        </div>
      ))}
    </div>
  );
}
