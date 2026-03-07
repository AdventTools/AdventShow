import {
  ArrowDown, ArrowUp, Check, ChevronRight, Database, Download, FolderOpen,
  Lock, Monitor, MonitorCheck, Pencil, PencilLine, Plus,
  Search, Trash2, X
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AppSettings, Category, DisplayInfo, Hymn, HymnSection, HymnSectionInput, HymnWithSections } from './vite-env';

// ─────────────────────────────────────────────────────────────────────────────
// Section editor row
// ─────────────────────────────────────────────────────────────────────────────

function SectionRow({
  section, index, total, onUpdate, onDelete, onMoveUp, onMoveDown,
}: {
  section: HymnSection; index: number; total: number;
  onUpdate: (id: number, type: 'strofa' | 'refren', text: string) => void;
  onDelete: (id: number) => void;
  onMoveUp: (i: number) => void; onMoveDown: (i: number) => void;
}) {
  const [text, setText] = useState(section.text);
  const [type, setType] = useState<'strofa' | 'refren'>(section.type);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setText(section.text); setType(section.type); setDirty(false); }, [section.id]);

  const save = () => { onUpdate(section.id, type, text); setDirty(false); };
  const isRefren = type === 'refren';

  return (
    <div className={`rounded-xl border overflow-hidden ${isRefren ? 'border-amber-500/20 bg-amber-500/5' : 'border-white/5 bg-white/3'}`}>
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5">
        <button
          onClick={() => { setType(isRefren ? 'strofa' : 'refren'); setDirty(true); }}
          className={`text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded cursor-pointer transition-all
            ${isRefren ? 'bg-amber-500/20 text-amber-400' : 'bg-white/8 text-white/40 hover:text-white/60'}`}
          title="Click pentru a schimba tipul"
        >
          {isRefren ? 'Refren' : `Strofă ${index + 1}`}
        </button>
        <span className="text-[10px] text-white/15">click = toggle tip</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => onMoveUp(index)} disabled={index === 0}
            className="w-6 h-6 flex items-center justify-center rounded text-white/20 hover:text-white/60 hover:bg-white/5 disabled:opacity-30 transition-all">
            <ArrowUp className="w-3 h-3" />
          </button>
          <button onClick={() => onMoveDown(index)} disabled={index === total - 1}
            className="w-6 h-6 flex items-center justify-center rounded text-white/20 hover:text-white/60 hover:bg-white/5 disabled:opacity-30 transition-all">
            <ArrowDown className="w-3 h-3" />
          </button>
          <button onClick={() => onDelete(section.id)}
            className="w-6 h-6 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all">
            <X className="w-3 h-3" />
          </button>
        </div>
        {dirty && (
          <button onClick={save}
            className="px-2.5 py-0.5 bg-primary rounded text-xs font-semibold text-primary-content transition-all">Salvează</button>
        )}
      </div>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setDirty(true); }}
        rows={Math.max(3, text.split('\n').length + 1)}
        className="w-full bg-transparent px-4 py-3 text-sm text-white/70 leading-relaxed resize-y outline-none font-sans placeholder-white/20"
        placeholder="Text secțiune..."
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hymn editor panel
// ─────────────────────────────────────────────────────────────────────────────

function HymnEditor({ hymnId, categories, onDeleted, onClose, onSaved }: {
  hymnId: number; categories: Category[]; onDeleted: () => void; onClose: () => void; onSaved?: () => void;
}) {
  const [hymn, setHymn] = useState<HymnWithSections | null>(null);
  const [editNumber, setEditNumber] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<number | undefined>(undefined);
  const [savingMeta, setSavingMeta] = useState(false);

  const load = useCallback(async () => {
    const h = await window.electron.db.getHymnWithSections(hymnId);
    setHymn(h); setEditNumber(h?.number ?? ''); setEditTitle(h?.title ?? ''); setEditCategoryId(h?.category_id ?? undefined);
  }, [hymnId]);

  useEffect(() => { load(); }, [load]);

  if (!hymn) return (
    <div className="flex items-center justify-center h-full">
      <span className="loading loading-spinner text-primary loading-md" />
    </div>
  );

  const deleteHymn = async () => { if (!confirm(`Ștergi imnul "${hymn.number}. ${hymn.title}"?`)) return; await window.electron.hymn.delete(hymn.id); onDeleted(); };
  const saveMeta = async () => {
    const nextNumber = editNumber.trim();
    const nextTitle = editTitle.trim();
    const normalizedCurrentCategoryId = hymn.category_id ?? null;
    const normalizedNextCategoryId = editCategoryId ?? null;
    const categoryDirty = normalizedNextCategoryId !== normalizedCurrentCategoryId;
    if (!nextTitle) { alert('Titlul nu poate fi gol.'); return; }
    if (nextNumber === hymn.number && nextTitle === hymn.title && !categoryDirty) return;
    setSavingMeta(true);
    try {
      if (nextNumber !== hymn.number || nextTitle !== hymn.title) {
        await window.electron.hymn.update(hymn.id, nextNumber, nextTitle);
      }
      if (categoryDirty) {
        await window.electron.hymn.setCategory(hymn.id, editCategoryId);
      }
      await load();
      onSaved?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Eroare necunoscută.';
      alert(`Nu am putut salva imnul.\n\n${message}`);
    } finally {
      setSavingMeta(false);
    }
  };
  const updateSection = async (id: number, type: 'strofa' | 'refren', text: string) => { await window.electron.section.update(id, type, text); await load(); };
  const deleteSection = async (id: number) => { if (!confirm('Ștergi această secțiune?')) return; await window.electron.section.delete(id); await load(); };
  const addSection = async (type: 'strofa' | 'refren') => { await window.electron.section.add(hymn.id, type, ''); await load(); };
  const moveSection = async (index: number, dir: 'up' | 'down') => {
    const secs = [...hymn.sections]; const swap = dir === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= secs.length) return;
    [secs[index], secs[swap]] = [secs[swap], secs[index]];
    await window.electron.section.reorder(secs.map((s, i) => ({ id: s.id, order_index: i }))); await load();
  };
  const metaDirty = editNumber.trim() !== hymn.number
    || editTitle.trim() !== hymn.title
    || (editCategoryId ?? null) !== (hymn.category_id ?? null);

  return (
    <div className="h-full flex flex-col bg-[#0f1117]">
      <div className="flex-shrink-0 border-b border-white/5 px-6 py-4 bg-[#151822]">
        <div className="flex items-end gap-3">
          <div>
            <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-1">Număr</label>
            <input type="text" value={editNumber}
              onChange={e => setEditNumber(e.target.value)}
              className="w-16 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-black text-primary outline-none focus:border-primary/40 transition-all" />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-1">Titlu</label>
            <input type="text" value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-primary/40 transition-all" />
          </div>
          <div className="w-56">
            <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-1">Categorie</label>
            <select
              value={editCategoryId ?? ''}
              onChange={e => setEditCategoryId(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 outline-none focus:border-primary/40 transition-all"
            >
              <option value="">Fără categorie</option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 mb-0.5">
            <button onClick={saveMeta} disabled={!metaDirty || savingMeta}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:hover:bg-primary border border-primary/20 rounded-lg text-xs font-semibold text-primary-content transition-all">
              {savingMeta ? <span className="loading loading-spinner loading-xs" /> : <Check className="w-3 h-3" />} Salvează
            </button>
            <button onClick={deleteHymn}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs font-semibold text-red-400 transition-all">
              <Trash2 className="w-3 h-3" /> Șterge
            </button>
            <button onClick={onClose} title="Închide"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/30 hover:text-white/70 transition-all">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => addSection('strofa')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-white/60 font-medium transition-all">
            <Plus className="w-3 h-3" /> Strofă
          </button>
          <button onClick={() => addSection('refren')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 rounded-lg text-xs text-amber-400 font-medium transition-all">
            <Plus className="w-3 h-3" /> Refren
          </button>
          <span className="ml-auto text-xs text-white/20">{hymn.sections.length} secțiuni</span>
        </div>

        {hymn.sections.length === 0 && (
          <div className="border-2 border-dashed border-white/8 rounded-xl p-12 text-center text-white/15 text-sm">
            Nicio secțiune — adaugă una de mai sus
          </div>
        )}
        {hymn.sections.map((s, i) => (
          <SectionRow key={s.id} section={s} index={i} total={hymn.sections.length}
            onUpdate={updateSection} onDelete={deleteSection}
            onMoveUp={idx => moveSection(idx, 'up')} onMoveDown={idx => moveSection(idx, 'down')} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Import panel
// ─────────────────────────────────────────────────────────────────────────────

const REFREN_ALONE_RE = /^\s*(?:r|ref|refren)\.?\s*:?$/i;
const REFREN_INLINE_RE = /^\s*(?:r|ref|refren)\.?\s*:?\s+(.+)$/i;
const STROFA_HEADER_RE = /^\s*(?:strofa\s*)?\d+\s*[.)]?\s*$/i;
const STROFA_INLINE_RE = /^\s*(?:strofa\s*)?\d+\s*[.)]\s+(.+)$/i;

function normalizeInputLine(line: string): string {
  return line.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function parseRawHymnSections(rawText: string): HymnSectionInput[] {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const sections: HymnSectionInput[] = [];
  let mode: 'strofa' | 'refren' = 'strofa';
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) sections.push({ type: mode, text });
    buffer = [];
  };

  for (const rawLine of [...lines, '']) {
    const line = normalizeInputLine(rawLine);

    if (!line) {
      flush();
      if (mode === 'refren') mode = 'strofa';
      continue;
    }

    const refrenInline = line.match(REFREN_INLINE_RE);
    if (refrenInline) {
      flush();
      mode = 'refren';
      buffer.push(refrenInline[1].trim());
      continue;
    }

    if (REFREN_ALONE_RE.test(line)) {
      flush();
      mode = 'refren';
      continue;
    }

    const strofaInline = line.match(STROFA_INLINE_RE);
    if (strofaInline) {
      flush();
      mode = 'strofa';
      buffer.push(strofaInline[1].trim());
      continue;
    }

    if (STROFA_HEADER_RE.test(line)) {
      flush();
      mode = 'strofa';
      continue;
    }

    buffer.push(line);
  }

  const deduped: HymnSectionInput[] = [];
  for (const section of sections) {
    const prev = deduped[deduped.length - 1];
    if (
      prev
      && prev.type === 'refren'
      && section.type === 'refren'
      && prev.text.trim().toLowerCase() === section.text.trim().toLowerCase()
    ) {
      continue;
    }
    deduped.push(section);
  }

  const strofe = deduped.filter(section => section.type === 'strofa');
  const refrains = deduped.filter(section => section.type === 'refren');

  // If only one refrain marker is present, treat it as the common refrain and
  // repeat it after every strophe. If refrains are already repeated in input,
  // keep the original structure.
  if (refrains.length === 1 && strofe.length > 1) {
    const refrainText = refrains[0].text;
    const expanded: HymnSectionInput[] = [];
    for (const section of deduped) {
      if (section.type !== 'strofa') continue;
      expanded.push(section);
      expanded.push({ type: 'refren', text: refrainText });
    }
    return expanded;
  }

  return deduped;
}

function ImportPanel({ categories, onImportDone }: { categories: Category[]; onImportDone: () => void }) {
  const [status, setStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [folderPath, setFolderPath] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [textCategoryId, setTextCategoryId] = useState<number | undefined>(undefined);
  const [draftNumber, setDraftNumber] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');
  const [draftSections, setDraftSections] = useState<HymnSectionInput[]>([]);
  const [draftError, setDraftError] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastFormattedText, setLastFormattedText] = useState('');
  const [result, setResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupImporting, setBackupImporting] = useState(false);

  useEffect(() => {
    if (categories.length > 0) {
      const first = categories.find(c => !c.is_builtin) ?? categories[0];
      if (categoryId === undefined) setCategoryId(first?.id);
      if (textCategoryId === undefined) setTextCategoryId(first?.id);
    }
  }, [categories, categoryId, textCategoryId]);

  const pickFolder = async () => {
    const p = await window.electron.dialog.selectFolder();
    if (!p) return;
    setFolderPath(p);
    setSelectedFiles([]);
  };
  const pickFiles = async () => {
    const files = await window.electron.dialog.selectPPTXFiles();
    if (!files || files.length === 0) return;
    setSelectedFiles(files);
    setFolderPath('');
  };

  const runImport = async () => {
    if (!folderPath && selectedFiles.length === 0) return;
    setStatus('importing'); setResult(null);
    try {
      const res = selectedFiles.length > 0
        ? await window.electron.db.importPPTXFiles(selectedFiles, categoryId)
        : await window.electron.db.importPPTX(folderPath, categoryId);
      setResult(res); setStatus('done'); onImportDone();
    } catch { setStatus('error'); }
  };

  const handleClearAll = async () => {
    if (!confirm('⚠️ Ești sigur?\n\nȘterge TOATE imnurile și secțiunile. Ireversibil.')) return;
    setClearing(true); await window.electron.db.clearAll(); onImportDone(); setClearing(false);
  };

  const handleExport = async () => {
    const destPath = await window.electron.dialog.saveFile('hymns.db');
    if (!destPath) return;
    setExporting(true); await window.electron.db.exportDb(destPath); setExporting(false);
    alert(`Exportat la:\n${destPath}\n\nCopiaz-o în public/ înainte de build.`);
  };

  const handleExportJsonBackup = async () => {
    setBackupExporting(true);
    try {
      const electronBridge = window.electron as typeof window.electron & {
        invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
        dialog: typeof window.electron.dialog & {
          saveJsonFile?: (defaultName: string) => Promise<string | undefined>;
        };
        db: typeof window.electron.db & {
          exportJsonBackup?: (destPath: string) => Promise<{ categories: number; hymns: number; sections: number }>;
        };
      };

      const destPath = typeof electronBridge.dialog.saveJsonFile === 'function'
        ? await electronBridge.dialog.saveJsonFile('hymns-backup.json')
        : typeof electronBridge.invoke === 'function'
          ? (await electronBridge.invoke('dialog:save-json-file', 'hymns-backup.json') as string | undefined)
          : undefined;
      if (!destPath) return;

      const summary = typeof electronBridge.db.exportJsonBackup === 'function'
        ? await electronBridge.db.exportJsonBackup(destPath)
        : typeof electronBridge.invoke === 'function'
          ? (await electronBridge.invoke('db:export-json-backup', destPath) as { categories: number; hymns: number; sections: number })
          : null;
      if (!summary) {
        throw new Error('Funcția de export backup JSON nu este disponibilă. Repornește aplicația.');
      }

      alert(
        `Backup JSON exportat la:\n${destPath}\n\n` +
        `Categorii: ${summary.categories}\n` +
        `Imnuri: ${summary.hymns}\n` +
        `Secțiuni: ${summary.sections}`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Eroare necunoscută.';
      alert(`Nu am putut exporta backup-ul JSON.\n\n${message}`);
    } finally {
      setBackupExporting(false);
    }
  };

  const handleImportJsonBackup = async () => {
    setBackupImporting(true);
    try {
      const electronBridge = window.electron as typeof window.electron & {
        invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
        dialog: typeof window.electron.dialog & {
          selectJsonFile?: () => Promise<string | undefined>;
        };
        db: typeof window.electron.db & {
          importJsonBackup?: (filePath: string) => Promise<{ categories: number; hymns: number; sections: number }>;
        };
      };

      const filePath = typeof electronBridge.dialog.selectJsonFile === 'function'
        ? await electronBridge.dialog.selectJsonFile()
        : typeof electronBridge.invoke === 'function'
          ? (await electronBridge.invoke('dialog:select-json-file') as string | undefined)
          : undefined;
      if (!filePath) return;
      if (!confirm(
        '⚠️ Import backup JSON?\n\n' +
        'Acțiunea va înlocui complet conținutul curent (categorii, imnuri, secțiuni).'
      )) return;

      const summary = typeof electronBridge.db.importJsonBackup === 'function'
        ? await electronBridge.db.importJsonBackup(filePath)
        : typeof electronBridge.invoke === 'function'
          ? (await electronBridge.invoke('db:import-json-backup', filePath) as { categories: number; hymns: number; sections: number })
          : null;
      if (!summary) {
        throw new Error('Funcția de import backup JSON nu este disponibilă. Repornește aplicația.');
      }

      onImportDone();
      alert(
        `Backup importat cu succes.\n\n` +
        `Categorii: ${summary.categories}\n` +
        `Imnuri: ${summary.hymns}\n` +
        `Secțiuni: ${summary.sections}`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Eroare necunoscută.';
      alert(`Nu am putut importa backup-ul JSON.\n\n${message}`);
    } finally {
      setBackupImporting(false);
    }
  };

  const formatDraftText = () => {
    setDraftSaved(false);
    const sections = parseRawHymnSections(draftText);
    if (sections.length === 0) {
      setDraftSections([]);
      setDraftError('Nu am putut extrage secțiuni. Folosește strofe separate prin rând gol și/sau markerul "R." pentru refren.');
      return;
    }
    setDraftSections(sections);
    setDraftError('');
    setLastFormattedText(draftText);
  };

  const saveDraftHymn = async () => {
    const number = draftNumber.trim();
    const title = draftTitle.trim();
    if (!number) { alert('Numărul imnului este obligatoriu.'); return; }
    if (!title) { alert('Titlul imnului este obligatoriu.'); return; }
    if (draftSections.length === 0) { alert('Formatează textul înainte de salvare.'); return; }
    if (lastFormattedText !== draftText) {
      alert('Textul a fost modificat după previzualizare. Apasă din nou "Formatează și previzualizează".');
      return;
    }

    setSavingDraft(true);
    setDraftSaved(false);
    try {
      await window.electron.db.createHymnWithSections({
        number,
        title,
        categoryId: textCategoryId,
        sections: draftSections,
      });
      setDraftSaved(true);
      setDraftNumber('');
      setDraftTitle('');
      setDraftText('');
      setDraftSections([]);
      setDraftError('');
      setLastFormattedText('');
      onImportDone();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Eroare necunoscută.';
      alert(`Nu am putut adăuga imnul.\n\n${message}`);
    } finally {
      setSavingDraft(false);
    }
  };

  const hasSource = Boolean(folderPath) || selectedFiles.length > 0;
  const firstFileName = selectedFiles.length > 0
    ? selectedFiles[0].split(/[/\\]/).pop() ?? selectedFiles[0]
    : '';

  let strofaCount = 0;
  const draftPreview = draftSections.map((section, index) => {
    if (section.type === 'strofa') strofaCount += 1;
    return {
      key: `${section.type}-${index}`,
      label: section.type === 'refren' ? 'Refren' : `Strofă ${strofaCount}`,
      ...section,
    };
  });

  return (
    <div className="h-full w-full overflow-y-auto px-8 py-6 space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-bold text-white/80">Import fișiere PPTX</h2>
          <p className="text-xs text-white/30 mt-1">Selectează un folder sau unul/mai multe fișiere .pptx — fiecare slide devine o secțiune.</p>
        </div>

        {categories.length > 0 && (
          <div>
            <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-1.5">Categorie destinație</label>
            <select
              value={categoryId ?? ''}
              onChange={e => setCategoryId(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 outline-none focus:border-primary/40 transition-all"
            >
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={pickFolder}
            disabled={status === 'importing'}
            className="py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-lg text-xs text-white/60 font-medium transition-all disabled:opacity-50"
          >
            Alege folder
          </button>
          <button
            onClick={pickFiles}
            disabled={status === 'importing'}
            className="py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-lg text-xs text-white/60 font-medium transition-all disabled:opacity-50"
          >
            Alege fișiere
          </button>
        </div>

        <div
          onClick={status !== 'importing' ? (selectedFiles.length > 0 ? pickFiles : pickFolder) : undefined}
          className={`border-2 border-dashed rounded-xl p-6 flex items-center gap-4 cursor-pointer transition-all
            ${hasSource ? 'border-primary/40 bg-primary/5' : 'border-white/10 hover:border-white/20 hover:bg-white/3'}
            ${status === 'importing' ? 'pointer-events-none opacity-50' : ''}`}
        >
          <FolderOpen className={`w-7 h-7 flex-shrink-0 ${hasSource ? 'text-primary' : 'text-white/20'}`} />
          <div className="min-w-0">
            {selectedFiles.length > 0 && (
              <>
                <div className="text-sm font-medium text-primary truncate">
                  {selectedFiles.length} fișiere selectate
                </div>
                <div className="text-xs text-white/25 mt-0.5 truncate">
                  {firstFileName}
                  {selectedFiles.length > 1 ? ` + încă ${selectedFiles.length - 1}` : ''}
                </div>
                <div className="text-xs text-white/20 mt-0.5">Click pentru a schimba selecția</div>
              </>
            )}
            {selectedFiles.length === 0 && folderPath && (
              <>
                <div className="text-sm font-medium text-primary truncate">{folderPath}</div>
                <div className="text-xs text-white/25 mt-0.5">Click pentru a schimba</div>
              </>
            )}
            {!hasSource && (
              <>
                <div className="text-sm text-white/40">Selectează folderul sau fișierele PPTX</div>
                <div className="text-xs text-white/20 mt-0.5">Click pentru a naviga</div>
              </>
            )}
          </div>
        </div>

        {status === 'idle' && hasSource && (
          <button onClick={runImport}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 rounded-xl text-sm font-semibold text-primary-content transition-all shadow shadow-primary/20">
            <Download className="w-4 h-4" /> Importă imnurile
          </button>
        )}
        {status === 'importing' && (
          <div className="flex flex-col items-center py-8 gap-3">
            <span className="loading loading-spinner text-primary loading-lg" />
            <p className="text-sm text-white/30">Se procesează fișierele PPTX...</p>
          </div>
        )}
        {status === 'done' && result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                <div className="text-2xl font-black text-green-400">{result.success}</div>
                <div className="text-xs text-white/30 mt-1">importate</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                <div className="text-2xl font-black text-red-400">{result.failed}</div>
                <div className="text-xs text-white/30 mt-1">eșuate</div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-4 max-h-32 overflow-y-auto space-y-1">
                {result.errors.map((e, i) => <p key={i} className="text-xs text-red-400/70 break-words">{e}</p>)}
              </div>
            )}
            <button onClick={() => { setStatus('idle'); setResult(null); setFolderPath(''); setSelectedFiles([]); }}
              className="w-full py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-sm text-white/50 transition-all">
              Import nou
            </button>
          </div>
        )}
        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
            <span className="text-sm text-red-400">A apărut o eroare neașteptată.</span>
            <button onClick={() => setStatus('idle')} className="text-xs text-white/40 hover:text-white/60">Retry</button>
          </div>
        )}
      </section>

      <section className="border-t border-white/5 pt-6 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-white/80">Adaugă imn din text</h2>
          <p className="text-xs text-white/30 mt-1">
            Lipește textul brut, formatează automat în strofe/refren, verifică previzualizarea, apoi salvează în categorie.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-1.5">Număr</label>
                <input
                  value={draftNumber}
                  onChange={e => { setDraftNumber(e.target.value); setDraftSaved(false); }}
                  placeholder="001"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-primary/40 transition-all"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-1.5">Titlu</label>
                <input
                  value={draftTitle}
                  onChange={e => { setDraftTitle(e.target.value); setDraftSaved(false); }}
                  placeholder="Titlul imnului"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-primary/40 transition-all"
                />
              </div>
            </div>

            {categories.length > 0 && (
              <div>
                <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-1.5">Categorie</label>
                <select
                  value={textCategoryId ?? ''}
                  onChange={e => setTextCategoryId(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 outline-none focus:border-primary/40 transition-all"
                >
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-1.5">Text brut</label>
              <textarea
                value={draftText}
                onChange={e => { setDraftText(e.target.value); setDraftSaved(false); }}
                rows={10}
                placeholder={'1.\nDoamne, Tu ești lumina mea\n...\n\nR.\nRefrenul aici'}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white/75 leading-relaxed outline-none focus:border-primary/40 transition-all resize-y"
              />
              <p className="text-[11px] text-white/25 mt-1.5">
                Tips: separă strofele cu rând gol. Pentru refren folosește o linie cu <code className="text-white/40">R.</code> sau <code className="text-white/40">Refren</code>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={formatDraftText}
                className="py-2.5 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-sm text-white/70 font-medium transition-all"
              >
                Formatează și previzualizează
              </button>
              <button
                onClick={saveDraftHymn}
                disabled={savingDraft || draftSections.length === 0 || !draftNumber.trim() || !draftTitle.trim()}
                className="py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:hover:bg-primary rounded-xl text-sm font-semibold text-primary-content transition-all"
              >
                {savingDraft ? <span className="loading loading-spinner loading-xs" /> : 'Adaugă imnul'}
              </button>
            </div>

            {draftError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                {draftError}
              </div>
            )}

            {draftSaved && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-sm text-green-400">
                Imnul a fost adăugat în baza de date.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white/45 uppercase tracking-widest">Previzualizare secțiuni</h3>
              <span className="text-xs text-white/25">{draftPreview.length} secțiuni</span>
            </div>
            {draftPreview.length === 0 ? (
              <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center text-xs text-white/25">
                Apasă „Formatează și previzualizează” ca să vezi secțiunile aici.
              </div>
            ) : (
              <div className="max-h-[34rem] overflow-y-auto space-y-2 pr-1">
                {draftPreview.map(section => (
                  <div
                    key={section.key}
                    className={`rounded-xl border p-3 ${section.type === 'refren'
                      ? 'border-amber-500/25 bg-amber-500/8'
                      : 'border-white/8 bg-white/3'}`}
                  >
                    <div className={`text-[10px] uppercase tracking-widest font-bold mb-1.5 ${section.type === 'refren' ? 'text-amber-400/80' : 'text-white/30'}`}>
                      {section.label}
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm text-white/75 leading-relaxed">
                      {section.text}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-white/5 pt-6 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-white/60">Exportă DB pentru distribuire</h3>
          <p className="text-xs text-white/25 mt-1">Salvează DB-ul curent ca <code className="text-white/40">hymns.db</code> → pune în <code className="text-white/40">public/</code> → build.</p>
        </div>
        <button onClick={handleExport} disabled={exporting}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-sm text-white/50 font-medium transition-all">
          {exporting ? <span className="loading loading-spinner loading-xs" /> : <><Database className="w-4 h-4" /> Exportă hymns.db</>}
        </button>
      </section>

      <section className="border-t border-white/5 pt-6 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-white/60">Backup JSON complet</h3>
          <p className="text-xs text-white/25 mt-1">
            Exportă/importă un backup complet al bazei de date (categorii, imnuri, secțiuni).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleExportJsonBackup}
            disabled={backupExporting || backupImporting}
            className="flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-sm text-white/50 font-medium transition-all disabled:opacity-50"
          >
            {backupExporting ? <span className="loading loading-spinner loading-xs" /> : <><Download className="w-4 h-4" /> Exportă backup JSON</>}
          </button>
          <button
            onClick={handleImportJsonBackup}
            disabled={backupImporting || backupExporting}
            className="flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-sm text-white/50 font-medium transition-all disabled:opacity-50"
          >
            {backupImporting ? <span className="loading loading-spinner loading-xs" /> : <><FolderOpen className="w-4 h-4" /> Importă backup JSON</>}
          </button>
        </div>
      </section>

      <section className="border-t border-red-500/20 pt-6 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-red-400/80">Zona de pericol</h3>
          <p className="text-xs text-white/25 mt-1">Elimină <strong>toate</strong> imnurile și secțiunile. Ireversibil.</p>
        </div>
        <button onClick={handleClearAll} disabled={clearing}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 rounded-xl text-sm text-red-400 font-medium transition-all">
          {clearing ? <><span className="loading loading-spinner loading-xs" /> Se șterge...</> : <><Trash2 className="w-4 h-4" /> Șterge tot conținutul</>}
        </button>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories panel
// ─────────────────────────────────────────────────────────────────────────────

function CategoriesPanel({ categories, onChanged }: { categories: Category[]; onChanged: () => void }) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    const name = newName.trim(); if (!name) return;
    setSaving(true); await window.electron.db.createCategory(name); setNewName(''); setSaving(false); onChanged();
  };

  const del = async (c: Category) => {
    if (!confirm(`Ștergi categoria "${c.name}"?\n\nToate imnurile din ea rămân fără categorie. Ireversibil.`)) return;
    await window.electron.db.deleteCategory(c.id); onChanged();
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editName.trim(); if (!name) return;
    await window.electron.db.updateCategory(editingId, name); setEditingId(null); onChanged();
  };

  return (
    <div className="h-full overflow-y-auto px-8 py-6 max-w-lg space-y-6">
      <div>
        <h2 className="text-sm font-bold text-white/80">Categorii</h2>
        <p className="text-xs text-white/30 mt-1">Categoriile predefinite sunt blocate. Categoriile custom pot fi editate și șterse.</p>
      </div>

      <div className="space-y-2">
        {categories.map(c => (
          <div key={c.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all
            ${c.is_builtin ? 'bg-white/3 border-white/6' : 'bg-[#1e2a5e]/40 border-[#1e2a5e]/60'}`}
          >
            {c.is_builtin ? (
              <>
                <span className="flex-1 text-sm text-white/70 font-medium">{c.name}</span>
                <span className="text-xs text-white/20">{c.hymn_count ?? 0} imnuri</span>
                <Lock className="w-3 h-3 text-white/15 flex-shrink-0" />
              </>
            ) : editingId === c.id ? (
              <>
                <input autoFocus type="text" value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                  className="flex-1 bg-white/5 border border-primary/30 rounded-lg px-3 py-1.5 text-sm text-white/80 outline-none" />
                <button onClick={saveEdit} className="px-3 py-1.5 bg-primary rounded-lg text-xs font-semibold text-primary-content">
                  <Check className="w-3 h-3" />
                </button>
                <button onClick={() => setEditingId(null)} className="w-7 h-7 flex items-center justify-center rounded text-white/30 hover:text-white/60 hover:bg-white/5 transition-all">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-primary/40 flex-shrink-0" />
                <span className="flex-1 text-sm text-white/70 font-medium">{c.name}</span>
                <span className="text-xs text-white/20">{c.hymn_count ?? 0} imnuri</span>
                <button onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                  className="w-7 h-7 flex items-center justify-center rounded text-white/20 hover:text-white/60 hover:bg-white/5 transition-all">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => del(c)}
                  className="w-7 h-7 flex items-center justify-center rounded text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-white/5 pt-5">
        <label className="text-[10px] text-white/25 uppercase tracking-widest font-bold block mb-2">Adaugă categorie nouă</label>
        <div className="flex gap-2">
          <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder="Numele categoriei..."
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 outline-none focus:border-primary/40 transition-all" />
          <button onClick={create} disabled={saving || !newName.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-40 rounded-lg text-xs font-semibold text-primary-content transition-all">
            <Plus className="w-3 h-3" />{saving ? '...' : 'Adaugă'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hymn list row (admin side)
// ─────────────────────────────────────────────────────────────────────────────

function AdminHymnRow({ hymn, isSelected, category, onClick }: {
  hymn: Hymn; isSelected: boolean; category?: Category; onClick: () => void;
}) {
  return (
    <div onClick={onClick}
      className={`flex items-stretch rounded-xl mb-2 overflow-hidden cursor-pointer group transition-all
        ${isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-transparent' : 'hover:scale-[1.003]'}`}
    >
      <div className={`flex items-center gap-3 px-4 w-56 flex-shrink-0 py-3.5 transition-colors
        ${isSelected ? 'bg-primary' : 'bg-[#1e2a5e] group-hover:bg-[#243269]'}`}
      >
        <span className={`text-lg font-black w-9 text-right flex-shrink-0 tabular-nums ${isSelected ? 'text-primary-content' : 'text-[#7b96ff]'}`}>{hymn.number}</span>
        <span className={`text-xs font-semibold truncate ${isSelected ? 'text-primary-content' : 'text-white/75'}`}>{hymn.title}</span>
      </div>
      <div className="flex-1 bg-[#151c35] group-hover:bg-[#192040] transition-colors flex items-center px-4 gap-3">
        {category && <span className="text-xs text-white/30 truncate">{category.name}</span>}
        {hymn.section_count != null && hymn.section_count > 0 && (
          <span className="text-xs text-white/20 flex-shrink-0">{hymn.section_count} secț.</span>
        )}
        <div className="ml-auto">
          <ChevronRight className="w-3 h-3 text-white/15 group-hover:text-white/30 transition-colors" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main AdminPage
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Proiecție Panel — screen selection
// ─────────────────────────────────────────────────────────────────────────────

function ProiectiePanel() {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      window.electron.screen.getDisplays(),
      window.electron.settings.get(),
    ]).then(([disps, s]) => { setDisplays(disps); setSettings(s); });
  }, []);

  const save = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await window.electron.settings.set(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const effectiveId = settings.projectionDisplayId
    ?? displays.find(d => !d.isPrimary)?.id
    ?? displays[0]?.id;

  const bgType = settings.bgType ?? 'color';

  const pickImage = async () => {
    const p = await window.electron.dialog.pickMedia('image');
    if (p) save({ bgType: 'image', bgImagePath: p });
  };

  const pickVideo = async () => {
    const p = await window.electron.dialog.pickMedia('video');
    if (p) save({ bgType: 'video', bgVideoPath: p });
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-8">
      <h3 className="text-xs font-bold text-white/30 uppercase tracking-widest mb-4">{title}</h3>
      {children}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-xl">

        {/* Saved indicator */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-bold text-white">Setări proiecție</h2>
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-400/10 px-3 py-1 rounded-full">
              <Check className="w-3 h-3" /> Salvat automat
            </span>
          )}
        </div>

        {/* ── Screen selection ── */}
        <Section title="Ecran de proiecție">
          <div className="space-y-2">
            {displays.length === 0 && (
              <p className="text-white/20 text-sm py-4 text-center">Se detectează ecranele...</p>
            )}
            {displays.map(d => {
              const isSelected = d.id === effectiveId;
              return (
                <button key={d.id} onClick={() => save({ projectionDisplayId: d.id })}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all
                    ${isSelected
                      ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/30'
                      : 'bg-white/3 border-white/8 hover:bg-white/5'}`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                    ${isSelected ? 'bg-primary/20' : 'bg-white/5'}`}>
                    {isSelected
                      ? <MonitorCheck className="w-5 h-5 text-primary" />
                      : <Monitor className="w-5 h-5 text-white/30" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${isSelected ? 'text-primary' : 'text-white/80'}`}>
                        {d.label}
                      </span>
                      {d.isPrimary && (
                        <span className="text-[10px] bg-white/8 text-white/30 px-2 py-0.5 rounded-full">Principal</span>
                      )}
                    </div>
                    <div className="text-xs text-white/25 mt-0.5">
                      {d.width} × {d.height}px{d.scaleFactor !== 1 ? ` · ${d.scaleFactor}×` : ''}
                    </div>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
                    ${isSelected ? 'border-primary bg-primary' : 'border-white/20'}`}>
                    {isSelected && <Check className="w-2.5 h-2.5 text-primary-content" />}
                  </div>
                </button>
              );
            })}
            {displays.length === 1 && (
              <p className="text-xs text-white/20 text-center pt-1">
                Conectează un monitor extern pentru proiecție pe ecran separat.
              </p>
            )}
          </div>
        </Section>

        {/* ── Background type selector ── */}
        <Section title="Fundal proiecție">
          {/* Mode tabs */}
          <div className="flex gap-1 p-1 bg-white/5 rounded-xl mb-5">
            {([
              { id: 'color', label: '🎨 Culoare' },
              { id: 'image', label: '🖼️ Imagine' },
              { id: 'video', label: '🎬 Video' },
            ] as const).map(m => (
              <button
                key={m.id}
                onClick={() => save({ bgType: m.id })}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all
                  ${bgType === m.id
                    ? 'bg-primary text-primary-content shadow'
                    : 'text-white/40 hover:text-white/70'}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Color picker */}
          {bgType === 'color' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div
                  className="relative w-12 h-12 rounded-xl border border-white/10 overflow-hidden cursor-pointer flex-shrink-0"
                  style={{ background: settings.bgColor ?? '#000000' }}
                >
                  <input
                    type="color"
                    value={settings.bgColor ?? '#000000'}
                    onChange={e => save({ bgColor: e.target.value })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white/70">{(settings.bgColor ?? '#000000').toUpperCase()}</p>
                  <p className="text-xs text-white/25">Click pe pătrat pentru a alege culoarea</p>
                </div>
                {/* Quick presets */}
                <div className="ml-auto flex gap-2 flex-wrap">
                  {['#000000', '#0a0a1f', '#0f1830', '#1a0a2e', '#0a1a0a'].map(c => (
                    <button
                      key={c}
                      onClick={() => save({ bgColor: c })}
                      title={c}
                      className={`w-7 h-7 rounded-lg border-2 transition-all ${settings.bgColor === c ? 'border-primary scale-110' : 'border-transparent hover:border-white/30'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              {/* 16:9 color preview */}
              <div className="relative rounded-xl overflow-hidden border border-white/8"
                style={{ aspectRatio: '16/9', background: settings.bgColor ?? '#000000' }}>
                <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                  <span className="text-white/30 text-[10px] uppercase tracking-widest mb-2">Previzualizare fundal</span>
                  <p className="text-white font-bold leading-snug"
                    style={{ fontSize: 'clamp(0.8rem, 2.5vw, 1.1rem)', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}>
                    Doamne, Tu ești lumina mea,<br />și mântuirea mea.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Image picker */}
          {bgType === 'image' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={pickImage}
                  className="flex items-center gap-3 flex-1 p-4 rounded-xl border border-dashed border-white/15 hover:border-primary/40 hover:bg-white/3 text-white/40 hover:text-white/70 transition-all min-w-0"
                >
                  <FolderOpen className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm truncate">
                    {settings.bgImagePath
                      ? settings.bgImagePath.split('/').pop()
                      : 'Alege o imagine (JPG, PNG, WebP…)'}
                  </span>
                </button>
                {settings.bgImagePath && (
                  <button
                    onClick={() => save({ bgImagePath: undefined })}
                    title="Elimină imaginea"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Elimină
                  </button>
                )}
              </div>

              {settings.bgImagePath && (
                <>
                  {/* 16:9 mini-projection preview */}
                  <div className="relative rounded-xl overflow-hidden border border-white/8 bg-black"
                    style={{ aspectRatio: '16/9' }}>
                    <img
                      src={`localfile://${settings.bgImagePath.replace(/\\/g, '/')}`}
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ opacity: settings.bgOpacity ?? 1 }}
                      alt="preview"
                    />
                    {/* scrim */}
                    <div className="absolute inset-0 bg-black/40" />
                    {/* sample text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                      <span className="text-white/30 text-[10px] uppercase tracking-widest mb-2">Previzualizare fundal</span>
                      <p className="text-white font-bold leading-snug drop-shadow-xl"
                        style={{ fontSize: 'clamp(0.8rem, 2.5vw, 1.1rem)', textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>
                        Doamne, Tu ești lumina mea,<br />și mântuirea mea.
                      </p>
                    </div>
                    {/* remove button */}
                    <button
                      onClick={() => save({ bgImagePath: undefined })}
                      className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white/60 hover:text-white z-10"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Opacity slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-white/40 font-medium">Opacitate fundal</label>
                      <span className="text-xs font-bold text-white/60 tabular-nums">
                        {Math.round((settings.bgOpacity ?? 1) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={settings.bgOpacity ?? 1}
                      onChange={e => save({ bgOpacity: Number(e.target.value) })}
                      className="w-full accent-primary h-1.5 rounded-full cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-white/20">
                      <span>Transparent</span><span>Complet vizibil</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Video picker */}
          {bgType === 'video' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={pickVideo}
                  className="flex items-center gap-3 flex-1 p-4 rounded-xl border border-dashed border-white/15 hover:border-primary/40 hover:bg-white/3 text-white/40 hover:text-white/70 transition-all min-w-0"
                >
                  <FolderOpen className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm truncate">
                    {settings.bgVideoPath
                      ? settings.bgVideoPath.split('/').pop()
                      : 'Alege un videoclip (MP4, WebM, MOV…)'}
                  </span>
                </button>
                {settings.bgVideoPath && (
                  <button
                    onClick={() => save({ bgVideoPath: undefined })}
                    title="Elimină videoclipul"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Elimină
                  </button>
                )}
              </div>

              {settings.bgVideoPath && (
                <>
                  {/* 16:9 mini-projection preview */}
                  <div className="relative rounded-xl overflow-hidden border border-white/8 bg-black"
                    style={{ aspectRatio: '16/9' }}>
                    <video
                      src={`localfile://${settings.bgVideoPath.replace(/\\/g, '/')}`}
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ opacity: settings.bgOpacity ?? 1 }}
                      muted autoPlay loop playsInline
                    />
                    {/* scrim */}
                    <div className="absolute inset-0 bg-black/40" />
                    {/* sample text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                      <span className="text-white/30 text-[10px] uppercase tracking-widest mb-2">Previzualizare fundal</span>
                      <p className="text-white font-bold leading-snug drop-shadow-xl"
                        style={{ fontSize: 'clamp(0.8rem, 2.5vw, 1.1rem)', textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>
                        Doamne, Tu ești lumina mea,<br />și mântuirea mea.
                      </p>
                    </div>
                    {/* remove button */}
                    <button
                      onClick={() => save({ bgVideoPath: undefined })}
                      className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white/60 hover:text-white z-10"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Opacity slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-white/40 font-medium">Opacitate fundal</label>
                      <span className="text-xs font-bold text-white/60 tabular-nums">
                        {Math.round((settings.bgOpacity ?? 1) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={settings.bgOpacity ?? 1}
                      onChange={e => save({ bgOpacity: Number(e.target.value) })}
                      className="w-full accent-primary h-1.5 rounded-full cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-white/20">
                      <span>Transparent</span><span>Complet vizibil</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-white/20">Videoclipul va fi redat în buclă fără sunet.</p>
                </>
              )}
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Hymn Editor Tab — full-width 50/50 split layout
// ─────────────────────────────────────────────────────────────────────────────

function HymnEditorTab({ activeCategoryId, onCategoriesChanged }: {
  activeCategoryId?: number;
  onCategoriesChanged?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hymns, setHymns] = useState<Hymn[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filterCategoryId, setFilterCategoryId] = useState<number | undefined>(undefined);

  const loadCategories = useCallback(async () => {
    setCategories(await window.electron.db.getCategories());
  }, []);

  const loadHymns = useCallback(async () => {
    const res = query.trim()
      ? await window.electron.db.searchHymns(query, filterCategoryId)
      : await window.electron.db.getAllHymns(filterCategoryId);
    setHymns(res);
  }, [query, filterCategoryId]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { const t = setTimeout(loadHymns, 300); return () => clearTimeout(t); }, [loadHymns]);
  useEffect(() => {
    setFilterCategoryId(activeCategoryId);
  }, [activeCategoryId]);

  const catMap = new Map(categories.map(c => [c.id, c]));

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: hymn list (flex-1) ── */}
      <div className="flex-1 flex flex-col border-r border-white/5 bg-[#0d1020] min-w-0">
        {/* Search + filter */}
        <div className="flex-shrink-0 px-4 pt-4 pb-3 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/20 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Caută imn..."
              className="w-full bg-white/5 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-sm text-white/70 placeholder-white/20 outline-none focus:border-primary/30 transition-all" />
          </div>
          <select value={filterCategoryId ?? ''} onChange={e => setFilterCategoryId(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-1.5 text-xs text-white/50 outline-none focus:border-primary/30 transition-all"
          >
            <option value="">Toate categoriile</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.hymn_count ?? 0})</option>)}
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {hymns.map(h => (
            <AdminHymnRow key={h.id} hymn={h} isSelected={selectedId === h.id}
              category={h.category_id != null ? catMap.get(h.category_id) : undefined}
              onClick={() => setSelectedId(prev => prev === h.id ? null : h.id)} />
          ))}
          {hymns.length === 0 && (
            <div className="flex items-center justify-center py-16 text-white/15 text-sm">Niciun imn.</div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-white/5 text-xs text-white/20 text-center">
          {hymns.length} imnuri
        </div>
      </div>

      {/* ── Right: editor (flex-1, same width) ── */}
      <div className="flex-1 overflow-hidden min-w-0">
        {selectedId !== null ? (
          <HymnEditor key={selectedId} hymnId={selectedId} categories={categories}
            onSaved={() => { loadHymns(); loadCategories(); onCategoriesChanged?.(); }}
            onDeleted={() => { setSelectedId(null); loadHymns(); loadCategories(); onCategoriesChanged?.(); }}
            onClose={() => setSelectedId(null)} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-white/15">
            <PencilLine className="w-8 h-8" />
            <p className="text-sm">Selectează un imn din stânga pentru a-l edita</p>
          </div>
        )}
      </div>

    </div>
  );
}

export function AdminPage({ activeTab: tab, onTabChange: _setTab, activeCategoryId, onCategoriesChanged }: {
  activeTab: 'categorii' | 'import' | 'proiectie' | 'editor';
  onTabChange: (t: 'categorii' | 'import' | 'proiectie' | 'editor') => void;
  activeCategoryId?: number;
  onCategoriesChanged?: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);

  const loadCategories = useCallback(async () => {
    setCategories(await window.electron.db.getCategories());
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  return (
    <div className="flex h-full overflow-hidden bg-[#0f1117]">
      {tab === 'editor' ? (
        <div className="flex-1 overflow-hidden">
          <HymnEditorTab activeCategoryId={activeCategoryId} onCategoriesChanged={onCategoriesChanged} />
        </div>
      ) : tab === 'categorii' ? (
        <div className="flex-1 overflow-hidden">
          <CategoriesPanel categories={categories} onChanged={() => { loadCategories(); onCategoriesChanged?.(); }} />
        </div>
      ) : tab === 'import' ? (
        <div className="flex-1 overflow-hidden">
          <ImportPanel categories={categories} onImportDone={() => { loadCategories(); onCategoriesChanged?.(); }} />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ProiectiePanel />
        </div>
      )}
    </div>
  );
}
