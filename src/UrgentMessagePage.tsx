import { AlertTriangle, MonitorOff, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { UrgentTickerData } from './vite-env';

const DEFAULT_BG_COLOR = '#7f1d1d';
const DEFAULT_TEXT_COLOR = '#ffffff';
const DEFAULT_FONT_SIZE = 46;
const DEFAULT_SPEED = 180;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function UrgentMessagePage() {
  const [message, setMessage] = useState('');
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BG_COLOR);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [projecting, setProjecting] = useState(false);

  const trimmedMessage = message.trim();
  const canProject = trimmedMessage.length > 0;

  const payload: UrgentTickerData = useMemo(() => ({
    message: trimmedMessage,
    backgroundColor,
    textColor,
    fontSize,
    speed,
  }), [trimmedMessage, backgroundColor, textColor, fontSize, speed]);

  useEffect(() => {
    window.electron.projection.onClosed(() => setProjecting(false));
    return () => window.electron.projection.offClosed();
  }, []);

  useEffect(() => {
    if (!projecting || !canProject) return;
    const t = setTimeout(() => {
      window.electron.projection.showUrgentTicker(payload);
    }, 120);
    return () => clearTimeout(t);
  }, [projecting, canProject, payload]);

  const startOrUpdateProjection = async () => {
    if (!canProject) return;
    await window.electron.projection.showUrgentTicker(payload);
    setProjecting(true);
  };

  const stopProjection = async () => {
    await window.electron.projection.hideUrgentTicker();
    setProjecting(false);
  };

  const previewMessage = canProject ? trimmedMessage : 'Scrie aici mesajul urgent care va fi afișat pe banda de jos.';
  const previewPadding = Math.max(6, Math.round(fontSize * 0.3));
  const approxTextWidth = Math.max(180, previewMessage.length * fontSize * 0.55);
  const previewDuration = Math.max(3, (900 + approxTextWidth) / Math.max(20, speed));

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Anunțuri Urgente</h2>
            <p className="text-xs text-white/35">Bandă jos, pe toată lățimea ecranului de proiecție.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div>
              <label className="text-xs font-bold text-white/35 uppercase tracking-widest block mb-2">Mesaj</label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={6}
                placeholder="Ex: Atenție: în 5 minute începe programul de rugăciune..."
                className="w-full resize-y bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/85 placeholder-white/25 outline-none focus:border-primary/50 transition-all"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-white/35 uppercase tracking-widest block mb-2">Fundal bară</label>
                <div className="flex items-center gap-3">
                  <div className="relative w-11 h-11 rounded-lg border border-white/10 overflow-hidden" style={{ background: backgroundColor }}>
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={e => setBackgroundColor(e.target.value)}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                  </div>
                  <span className="text-sm text-white/70 tabular-nums">{backgroundColor.toUpperCase()}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-white/35 uppercase tracking-widest block mb-2">Culoare text</label>
                <div className="flex items-center gap-3">
                  <div className="relative w-11 h-11 rounded-lg border border-white/10 overflow-hidden" style={{ background: textColor }}>
                    <input
                      type="color"
                      value={textColor}
                      onChange={e => setTextColor(e.target.value)}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                  </div>
                  <span className="text-sm text-white/70 tabular-nums">{textColor.toUpperCase()}</span>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-white/35 uppercase tracking-widest block mb-2">
                Mărime font: <span className="text-white/65">{fontSize}px</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={24}
                  max={120}
                  step={1}
                  value={fontSize}
                  onChange={e => setFontSize(clamp(Number(e.target.value), 24, 120))}
                  className="w-full accent-primary h-1.5 rounded-full cursor-pointer"
                />
                <input
                  type="number"
                  min={24}
                  max={120}
                  value={fontSize}
                  onChange={e => setFontSize(clamp(Number(e.target.value), 24, 120))}
                  className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white/80 outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-white/35 uppercase tracking-widest block mb-2">
                Viteză scroll: <span className="text-white/65">{speed}px/s</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={40}
                  max={500}
                  step={5}
                  value={speed}
                  onChange={e => setSpeed(clamp(Number(e.target.value), 40, 500))}
                  className="w-full accent-primary h-1.5 rounded-full cursor-pointer"
                />
                <input
                  type="number"
                  min={40}
                  max={500}
                  step={5}
                  value={speed}
                  onChange={e => setSpeed(clamp(Number(e.target.value), 40, 500))}
                  className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white/80 outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={startOrUpdateProjection}
                disabled={!canProject}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-content text-sm font-semibold transition-all"
              >
                <Send className="w-4 h-4" />
                {projecting ? 'Actualizează proiecția' : 'Proiectează anunțul'}
              </button>
              <button
                onClick={stopProjection}
                disabled={!projecting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-40 text-red-400 text-sm font-semibold transition-all"
              >
                <MonitorOff className="w-4 h-4" />
                Oprește anunțul
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-white/35 uppercase tracking-widest block mb-2">Previzualizare</label>
            <div
              className="relative rounded-xl overflow-hidden border border-white/8 bg-[#0a0c12]"
              style={{ aspectRatio: '16/9' }}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_55%)]" />
              <div className="absolute bottom-0 left-0 right-0 overflow-hidden"
                style={{
                  background: backgroundColor,
                  paddingTop: `${previewPadding}px`,
                  paddingBottom: `${previewPadding}px`,
                }}
              >
                <div className="inline-block whitespace-nowrap"
                  style={{
                    color: textColor,
                    fontSize: `${fontSize}px`,
                    lineHeight: 1.2,
                    fontWeight: 700,
                    animationName: 'urgent-ticker-scroll',
                    animationDuration: `${previewDuration}s`,
                    animationTimingFunction: 'linear',
                    animationIterationCount: 'infinite',
                  }}
                >
                  {previewMessage}
                </div>
              </div>
            </div>
            <p className="text-xs text-white/30 mt-2">
              Bara ocupă doar partea de jos; restul ecranului rămâne transparent în modul anunț urgent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
