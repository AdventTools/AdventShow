import {
    AlertCircle,
    Book,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Download,
    Edit3,
    Film,
    FolderOpen,
    Loader,
    Lock,
    Monitor,
    Pause,
    Plus,
    Play,
    RefreshCw,
    Search,
    Settings,
    Square,
    Trash2,
    Upload,
    Volume2,
    X,
    Youtube,
    Bold,
    Italic,
    Underline,
    Strikethrough,
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignJustify,
    List,
    ListOrdered,
    IndentIncrease,
    IndentDecrease,
    Undo2,
    Redo2,
    Baseline,
    Eraser,
    Columns3,
    AlignVerticalJustifyStart,
    AlignVerticalJustifyCenter,
    AlignVerticalJustifyEnd,
    Copy,
    RotateCcw,
    Image as ImageIcon,
    MoreHorizontal,
    FileText,
    VolumeX,
    Headphones,
    HelpCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { ProjectorController } from './ProjectorController';
import type {
    AppSettings,
    BibleBook,
    BibleVerse,
    Category,
    Hymn,
    HymnSection,
    Presentation,
    PresShape,
    ProjectionTextData,
    TemplateInfo,
    YouTubeEntry,
} from './vite-env';

// ── Constants ────────────────────────────────────────────────────────────────

const MASTER_PASSWORD = 'AdventShowMaster2025!';
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDiacritics(str: string): string {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[ăâ]/gi, 'a')
        .replace(/[î]/gi, 'i')
        .replace(/[șş]/gi, 's')
        .replace(/[țţ]/gi, 't')
        .toLowerCase();
}

function getSnippetFirstLine(snippet?: string): string {
    if (!snippet) return '';
    // Remove stanza numbers (e.g. "1. ") and collapse all whitespace into single spaces
    return snippet.replace(/\d+\.\s*/g, '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function stripStanzaNumber(text: string): string {
    return text.replace(/^\d+\.\s*/, '');
}

function expandHymnSections(sections: HymnSection[]) {
    const refren = sections.find(s => s.type === 'refren');
    const result: { text: string; type: string; label: string }[] = [];
    let stanzaNum = 0;
    for (const sec of sections) {
        if (sec.type === 'strofa') {
            stanzaNum++;
            result.push({ text: stripStanzaNumber(sec.text), type: 'strofa', label: `Strofa ${stanzaNum}` });
            if (refren) {
                result.push({ text: refren.text, type: 'refren', label: 'Refren' });
            }
        } else if (sec.type === 'refren') {
            const idx = sections.indexOf(sec);
            if (idx > 0 && sections[idx - 1].type === 'strofa') continue;
            result.push({ text: sec.text, type: 'refren', label: 'Refren' });
        }
    }
    return result;
}

function hashPassword(pw: string): string {
    // Simple hash for local use (not crypto-secure, just obfuscation)
    let hash = 0;
    for (let i = 0; i < pw.length; i++) {
        const c = pw.charCodeAt(i);
        hash = ((hash << 5) - hash) + c;
        hash |= 0;
    }
    return 'h:' + hash.toString(36) + ':' + pw.length;
}

function checkPassword(input: string, hash: string): boolean {
    if (input === MASTER_PASSWORD) return true;
    return hashPassword(input) === hash;
}

function isWithinGracePeriod(createdAt?: string): boolean {
    if (!createdAt) return false;
    const created = new Date(createdAt).getTime();
    if (isNaN(created)) return false;
    return Date.now() - created < GRACE_PERIOD_MS;
}

// ── Bible reference parsing (BibleShow-style) ───────────────────────────────

/**
 * Parse a Bible reference like "deu 12 12", "gen 1:3", "1cor 3 16", "ps 23"
 * Returns the book query string, chapter number, and optional verse/range.
 */
function parseBibleReference(input: string): {
    bookQuery: string;
    chapter?: number;
    verse?: number;
    endVerse?: number;
} | null {
    let trimmed = input.trim();
    if (!trimmed) return null;

    // Normalize "gen 1:3" or "gen 1:3-5" → "gen 1 3" / "gen 1 3-5"
    trimmed = trimmed.replace(/(\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?/, (_, ch, v, ev) =>
        ev ? `${ch} ${v}-${ev}` : `${ch} ${v}`
    );

    const tokens = trimmed.split(/\s+/);
    let verse: number | undefined;
    let endVerse: number | undefined;
    let chapter: number | undefined;

    if (tokens.length >= 2) {
        const last = tokens[tokens.length - 1];
        const rangeMatch = last.match(/^(\d+)[-–](\d+)$/);

        if (rangeMatch) {
            tokens.pop();
            const v1 = parseInt(rangeMatch[1]);
            const v2 = parseInt(rangeMatch[2]);
            if (tokens.length >= 2 && /^\d+$/.test(tokens[tokens.length - 1])) {
                chapter = parseInt(tokens[tokens.length - 1]);
                tokens.pop();
                verse = v1;
                endVerse = v2;
            } else {
                chapter = v1;
                endVerse = v2;
            }
        } else if (/^\d+$/.test(last)) {
            const num = parseInt(last);
            tokens.pop();
            if (tokens.length >= 2 && /^\d+$/.test(tokens[tokens.length - 1])) {
                verse = num;
                chapter = parseInt(tokens[tokens.length - 1]);
                tokens.pop();
            } else {
                chapter = num;
            }
        }
    }

    const bookQuery = tokens.join(' ').trim();
    if (!bookQuery) return null;

    return { bookQuery, chapter, verse, endVerse };
}

/**
 * BibleShow-style book matching. Matches any prefix of the book name or
 * abbreviation, with diacritics stripped and spaces collapsed.
 * Handles numeric prefixes: "1 imp" matches "1 Împărați", "2cor" matches "2 Corinteni".
 * Returns the best-matching book or null.
 */
function matchBibleBook(query: string, booksList: BibleBook[]): BibleBook | null {
    const q = normalizeDiacritics(query).replace(/\s+/g, '');
    if (!q) return null;

    // Extract leading number prefix if present (e.g. "1", "2", "3")
    const numPrefixMatch = q.match(/^(\d+)(.*)$/);
    const qNumPrefix = numPrefixMatch ? numPrefixMatch[1] : '';
    const qRest = numPrefixMatch ? numPrefixMatch[2] : q;

    const scored: { book: BibleBook; score: number }[] = [];

    for (const book of booksList) {
        const name = normalizeDiacritics(book.name);
        const nameCompact = name.replace(/\s+/g, '');
        const abbr = normalizeDiacritics(book.abbreviation);
        const abbrCompact = abbr.replace(/\s+/g, '');

        let score = 0;

        if (abbrCompact === q) score = 100;           // Exact abbreviation
        else if (nameCompact === q) score = 95;        // Exact name
        else if (abbrCompact.startsWith(q)) score = 80; // Abbreviation prefix
        else if (nameCompact.startsWith(q)) score = 70; // Name prefix
        else if (nameCompact.includes(q)) score = 30;   // Name contains

        // Handle numeric prefix matching: "1 imp" → "1 imparati"
        // Check if book name starts with same number and rest matches
        if (score === 0 && qNumPrefix) {
            const bookNumMatch = nameCompact.match(/^(\d+)(.*)$/);
            const bookAbbrMatch = abbrCompact.match(/^(\d+)(.*)$/);
            if (bookNumMatch && bookNumMatch[1] === qNumPrefix && qRest) {
                const bookNameRest = bookNumMatch[2];
                if (bookNameRest === qRest) score = 93;
                else if (bookNameRest.startsWith(qRest)) score = 68;
                else if (bookNameRest.includes(qRest)) score = 28;
            }
            if (bookAbbrMatch && bookAbbrMatch[1] === qNumPrefix && qRest) {
                const bookAbbrRest = bookAbbrMatch[2];
                if (bookAbbrRest === qRest) score = Math.max(score, 98);
                else if (bookAbbrRest.startsWith(qRest)) score = Math.max(score, 78);
            }
        }

        if (score > 0) scored.push({ book, score });
    }

    scored.sort((a, b) => b.score - a.score || a.book.book_order - b.book.book_order);
    return scored.length > 0 ? scored[0].book : null;
}

type Tab = 'imnuri' | 'biblia' | 'video' | 'timer' | 'mesaj';

// ═════════════════════════════════════════════════════════════════════════════
// App
// ═════════════════════════════════════════════════════════════════════════════

function App() {
    // ── Tab ──
    const [tab, setTab] = useState<Tab>('imnuri');

    // ── Hymn state ──
    const [categories, setCategories] = useState<Category[]>([]);
    const [activeCategoryId, setActiveCategoryId] = useState<number | undefined>(undefined);
    const [hymns, setHymns] = useState<Hymn[]>([]);
    const [selectedHymnId, setSelectedHymnId] = useState<number | null>(null);
    const [refSearch, setRefSearch] = useState('');
    const [contentSearch, setContentSearch] = useState('');

    // ── Bible state ──
    const [books, setBooks] = useState<BibleBook[]>([]);
    const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
    const [selectedBookName, setSelectedBookName] = useState('');
    const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
    const [chapters, setChapters] = useState<number[]>([]);
    const [verses, setVerses] = useState<BibleVerse[]>([]);
    const [selectedVerseIdx, setSelectedVerseIdx] = useState(0);
    const [bibleSearchResults, setBibleSearchResults] = useState<BibleVerse[] | null>(null);
    // pasaj biblic activ (interval ex: gen 1:3-5) — contorul n/N și săgețile rămân în pasaj
    const [biblePassage, setBiblePassage] = useState<{ bookId: number; chapter: number; endVerse: number } | null>(null);
    // eroare referință nerezolvată sub câmpul de căutare (dispare la tastare)
    const [bibleRefError, setBibleRefError] = useState<string | null>(null);

    // ── Preview state ──
    const [previewType, setPreviewType] = useState<'hymn' | 'bible' | null>(null);
    const [previewSections, setPreviewSections] = useState<{ text: string; type: string; label: string }[]>([]);
    const [previewTitle, setPreviewTitle] = useState('');
    const [previewNumber, setPreviewNumber] = useState('');

    // ── Projection state ──
    const [projecting, setProjecting] = useState(false);
    const [projSlideIndex, setProjSlideIndex] = useState(0);
    // true = previzualizarea reflectă EXACT ce e pe proiector; false (în proiecție) = imn PREGĂTIT, încă neproiectat
    const [previewLive, setPreviewLive] = useState(false);
    // eticheta a ceea ce e LIVE pe ecran (capturată la proiectare) — ca badge-ul global
    // să arate imnul de pe proiector, nu previzualizarea „pregătită" a altui imn
    const [liveLabel, setLiveLabel] = useState('');

    // ── Update state ──
    const [updateInfo, setUpdateInfo] = useState<{
        available: boolean; version?: string;
    } | null>(null);
    const [updateDownloading, setUpdateDownloading] = useState(false);
    const [updateProgress, setUpdateProgress] = useState(0);
    const [updateTransferred, setUpdateTransferred] = useState(0);
    const [updateTotal, setUpdateTotal] = useState(0);
    const [updateReady, setUpdateReady] = useState(false);
    const [updateError, setUpdateError] = useState<string | null>(null);
    // Update OBLIGATORIU (decis în hangar). Nu se poate refuza, dar nici nu întrerupe
    // o proiecție în curs — instalarea așteaptă închiderea ecranului.
    const [forcedUpdate, setForcedUpdate] = useState<{
        version: string | null; reason: string; waitingForProjection: boolean;
    } | null>(null);

    // ── Video state ──
    const [videoStatus, setVideoStatus] = useState<{
        currentTime: number; duration: number; paused: boolean;
    } | null>(null);
    const [videoName, setVideoName] = useState('');
    const [videoUrl, setVideoUrl] = useState('');
    const [videoLoading, setVideoLoading] = useState(false);
    const [videoConverting, setVideoConverting] = useState(false);
    const [videoVolume, setVideoVolume] = useState(1);
    const [videoMuted, setVideoMuted] = useState(false);
    // eroare de redare vizibilă (fișier mutat/corupt) — altfel operatorul apasă degeaba
    const [videoError, setVideoError] = useState<string | null>(null);
    // monitorul de retur plutitor (Ceas/Realtime) — ascuns manual până la următorul video
    const [floatingMonitorHidden, setFloatingMonitorHidden] = useState(false);
    // badge LIVE global: re-randează când ceasul/anunțul (registre de modul) pornesc/opresc
    const [, setLiveTick] = useState(0);
    // YouTube playlist
    const [youtubePlaylist, setYoutubePlaylist] = useState<YouTubeEntry[]>([]);
    const [youtubeProgress, setYoutubeProgress] = useState<Record<string, number>>({});

    // ── Modal state ──
    const [modalOpen, setModalOpen] = useState<string | null>(null);

    // ── Video filter state ──
    const [videoFilter, setVideoFilter] = useState<VideoFilter>('all');

    // ── Context menu state ──
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hymn: Hymn } | null>(null);

    // ── Password state ──
    const [adminPasswordHash, setAdminPasswordHash] = useState<string | null>(null);
    const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
    const [needsChurchInfo, setNeedsChurchInfo] = useState(false);
    const [forgotPwOpen, setForgotPwOpen] = useState(false);
    const [setPwOpen, setSetPwOpen] = useState<'change' | 'reset' | null>(null);
    const [passwordModal, setPasswordModal] = useState<{
        action: () => void;
        title: string;
    } | null>(null);

    // ── Add/Edit Hymn modal ──
    const [hymnEditor, setHymnEditor] = useState<{
        mode: 'add' | 'edit';
        hymnId?: number;
        number: string;
        title: string;
        sections: { type: 'strofa' | 'refren'; text: string }[];
        categoryId?: number;
    } | null>(null);

    // ── Refs ──
    const refSearchRef = useRef<HTMLInputElement>(null);
    const hymnListRef = useRef<HTMLDivElement>(null);
    const projSlideIndexRef = useRef(0);
    const searchConsumedRef = useRef(true); // tracks if current search was already loaded into preview
    const skipAutoPreviewRef = useRef(false); // prevent auto-preview overriding search-triggered load

    // ── Resizable layout state ──
    const [sidebarWidth, setSidebarWidth] = useState(200);
    const [previewWidth, setPreviewWidth] = useState(640);
    const draggingRef = useRef<'sidebar' | 'preview' | null>(null);
    const mainAreaRef = useRef<HTMLDivElement>(null);
    const layoutWidthsRef = useRef<Record<Tab, { sidebarWidth: number; previewWidth: number }>>({
        imnuri: { sidebarWidth: 200, previewWidth: 640 },
        biblia: { sidebarWidth: 200, previewWidth: 640 },
        video: { sidebarWidth: 200, previewWidth: 640 },
        timer: { sidebarWidth: 200, previewWidth: 640 },
        mesaj: { sidebarWidth: 200, previewWidth: 640 },
    });
    const tabRef = useRef<Tab>('imnuri');

    // Keep ref in sync
    useEffect(() => { projSlideIndexRef.current = projSlideIndex; }, [projSlideIndex]);

    // Mark search as "new" whenever refSearch changes
    useEffect(() => { searchConsumedRef.current = false; setBibleRefError(null); }, [refSearch]);

    // Focus automat pe câmpul de căutare la pornire (tab Imnuri), imediat ce nu mai e
    // nicio fereastră de start deschisă — ca operatorul să poată tasta numărul direct.
    const startupFocusDoneRef = useRef(false);
    useEffect(() => {
        if (startupFocusDoneRef.current) return;
        if (tab !== 'imnuri') return;
        if (modalOpen || hymnEditor || passwordModal || needsPasswordSetup || needsChurchInfo) return;
        const t = setTimeout(() => {
            if (startupFocusDoneRef.current) return;
            startupFocusDoneRef.current = true;
            refSearchRef.current?.focus();
        }, 150);
        return () => clearTimeout(t);
    }, [tab, modalOpen, hymnEditor, passwordModal, needsPasswordSetup, needsChurchInfo]);

    // ── Load categories + books on mount ──
    const loadCategories = useCallback(async () => {
        const cats = await window.electron.db.getCategories();
        setCategories(cats);
        return cats;
    }, []);

    const loadBooks = useCallback(async () => {
        try {
            const b = await window.electron.bible.getBooks();
            setBooks(b);
        } catch (e) {
            console.error('Failed to load Bible books:', e);
        }
    }, []);

    // Load admin password on mount
    useEffect(() => {
        window.electron.settings.get().then(s => {
            if (s.adminPasswordHash) {
                setAdminPasswordHash(s.adminPasswordHash);
                // instalări de dinainte de registru: biserica + localitatea se
                // completează la prima pornire după upgrade (o singură dată)
                if (!s.churchName || !s.churchCity) setNeedsChurchInfo(true);
            } else {
                setNeedsPasswordSetup(true);
            }
            // Restore saved per-tab layout widths
            if (s.layoutWidths) {
                const lw = s.layoutWidths;
                if (lw.imnuri) layoutWidthsRef.current.imnuri = lw.imnuri;
                if (lw.biblia) layoutWidthsRef.current.biblia = lw.biblia;
                if (lw.video) layoutWidthsRef.current.video = lw.video;
            } else {
                // Migrate old flat widths
                if (s.sidebarWidth || s.previewWidth) {
                    const sw = s.sidebarWidth ?? 200;
                    const pw = s.previewWidth ?? 640;
                    layoutWidthsRef.current.imnuri = { sidebarWidth: sw, previewWidth: pw };
                    layoutWidthsRef.current.biblia = { sidebarWidth: sw, previewWidth: pw };
                    layoutWidthsRef.current.video = { sidebarWidth: sw, previewWidth: pw };
                }
            }
            // Apply widths for current tab (imnuri on mount)
            const cur = layoutWidthsRef.current.imnuri;
            setSidebarWidth(cur.sidebarWidth);
            setPreviewWidth(cur.previewWidth);
        });
    }, []);

    // Check for updates on mount + every 6 hours, listen for updater events
    useEffect(() => {
        const doCheck = () => {
            window.electron.update.check()
                .then(info => { if (info.available) setUpdateInfo(info) })
                .catch(() => { /* silently ignore */ });
        };
        doCheck();
        const interval = setInterval(doCheck, 6 * 60 * 60 * 1000); // 6 hours

        window.electron.update.onProgress((data) => {
            setUpdateProgress(data.percent);
            setUpdateTransferred(data.transferred);
            setUpdateTotal(data.total);
        });
        window.electron.update.onDownloaded(() => {
            setUpdateDownloading(false);
            setUpdateReady(true);
        });
        window.electron.update.onError((msg) => {
            setUpdateDownloading(false);
            setUpdateError(msg);
        });
        window.electron.update.onForced(({ version, reason }) => {
            setForcedUpdate({ version, reason, waitingForProjection: false });
        });
        window.electron.update.onForcedWaiting(({ version }) => {
            setForcedUpdate(f => ({
                version: version ?? f?.version ?? null,
                reason: f?.reason ?? '',
                waitingForProjection: true,
            }));
        });
        // Dacă verdictul a venit înainte ca fereastra să fie gata de ascultat.
        window.electron.update.forcedState()
            .then(s => { if (s.required) setForcedUpdate({ version: s.version, reason: s.reason, waitingForProjection: false }); })
            .catch(() => { /* fără rețea, se reia la următoarea pornire */ });

        return () => {
            clearInterval(interval);
            window.electron.update.offProgress();
            window.electron.update.offDownloaded();
            window.electron.update.offError();
            window.electron.update.offForced();
            window.electron.update.offForcedWaiting();
        };
    }, []);

    // Badge LIVE global: registrele de modul (Ceas/Anunțuri) cer re-randare prin liveBus
    useEffect(() => {
        liveBus.notify = () => setLiveTick(t => t + 1);
        return () => { liveBus.notify = () => { /* App demontat */ }; };
    }, []);

    // Video status listener
    useEffect(() => {
        window.electron.video.onStatus((data) => setVideoStatus(data));
        window.electron.video.onConverting((converting) => setVideoConverting(converting));
        window.electron.video.onError((msg) => setVideoError(msg));
        return () => {
            window.electron.video.offStatus();
            window.electron.video.offConverting();
            window.electron.video.offError();
        };
    }, []);

    // YouTube playlist: load on mount + listen for progress/status events
    useEffect(() => {
        window.electron.youtube.getPlaylist().then(setYoutubePlaylist);
        window.electron.youtube.onProgress((id, percent) => {
            setYoutubeProgress(prev => ({ ...prev, [id]: percent }));
        });
        window.electron.youtube.onStatus((id, status, error) => {
            setYoutubePlaylist(prev => prev.map(e =>
                e.id === id ? { ...e, status: status as YouTubeEntry['status'], error: error || undefined } : e
            ));
            // Remove progress tracking when done
            if (status !== 'downloading') {
                setYoutubeProgress(prev => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
            }
        });
        return () => {
            window.electron.youtube.offProgress();
            window.electron.youtube.offStatus();
        };
    }, []);

    useEffect(() => {
        loadCategories().then(cats => {
            const defaultCat = cats.find((c: Category) => c.name === 'Imnuri Creștine');
            if (defaultCat) setActiveCategoryId(defaultCat.id);
        });
        loadBooks();
    }, [loadCategories, loadBooks]);

    // ── Load hymns when category or search changes ──
    const loadHymns = useCallback(async () => {
        try {
            const q = refSearch.trim();
            const cq = contentSearch.trim();
            let result: Hymn[];
            if (cq && tab === 'imnuri') {
                result = await window.electron.db.searchHymnsContent(cq, activeCategoryId);
            } else if (q && tab === 'imnuri') {
                result = await window.electron.db.searchHymns(q, activeCategoryId);
            } else {
                try {
                    result = await window.electron.db.getAllHymnsWithSnippets(activeCategoryId);
                } catch {
                    result = await window.electron.db.getAllHymns(activeCategoryId);
                }
            }
            setHymns(result);
        } catch (e) {
            console.error('loadHymns error:', e);
            setHymns([]);
        }
    }, [refSearch, contentSearch, activeCategoryId, tab]);

    useEffect(() => {
        if (tab !== 'imnuri') return;
        const t = setTimeout(loadHymns, 200);
        return () => clearTimeout(t);
    }, [loadHymns, tab]);

    // ── Bible content search (triggered on Enter, not real-time) ──
    const doBibleContentSearch = useCallback(async () => {
        if (tab !== 'biblia') return;
        const cq = contentSearch.trim();
        if (cq.length >= 3) {
            const results = await window.electron.bible.search(
                cq,
                selectedBookId ?? undefined,
                selectedChapter ?? undefined,
            );
            setBibleSearchResults(results);
        } else {
            setBibleSearchResults(null);
        }
    }, [contentSearch, tab, selectedBookId, selectedChapter]);

    // ── Preview hymn ──
    const previewHymn = useCallback(async (id: number) => {
        const data = await window.electron.db.getHymnWithSections(id);
        if (!data || !data.sections.length) return;
        const expanded = expandHymnSections(data.sections);
        setPreviewType('hymn');
        setPreviewSections(expanded);
        setPreviewTitle(data.title);
        setPreviewNumber(String(data.number));
        setProjSlideIndex(-1);
        setSelectedHymnId(id);
        // În timpul proiecției, selecția DOAR pregătește imnul în previzualizare
        // („pregătit"); trecerea live se face explicit (Enter / dublu-clic / „Proiectează").
        setPreviewLive(false);
    }, []);

    // ── Preview bible search result ──
    // Loads the full chapter into preview and navigates to the clicked verse
    const previewBibleResult = useCallback(async (verse: BibleVerse) => {
        if (!verse.book_id || !verse.chapter) return;
        const book = books.find(b => b.id === verse.book_id);
        // Load all verses of the chapter so user can navigate with arrows
        const allVrs = await window.electron.bible.getVerses(verse.book_id, verse.chapter);
        const secs = allVrs.map((v: BibleVerse) => ({
            text: v.text,
            type: 'verse',
            label: `v. ${v.verse}`,
        }));
        const idx = allVrs.findIndex((v: BibleVerse) => v.verse === verse.verse);
        const safeIdx = Math.max(0, idx);
        setPreviewType('bible');
        setPreviewSections(secs);
        setPreviewTitle(`${book?.name ?? verse.book_name ?? ''} ${verse.chapter}`);
        setPreviewNumber(book?.abbreviation ?? verse.abbreviation ?? '');
        setProjSlideIndex(safeIdx);
        setSelectedVerseIdx(safeIdx);
        // Also sync sidebar to this chapter
        setSelectedBookId(verse.book_id);
        setSelectedBookName(book?.name ?? verse.book_name ?? '');
        setSelectedChapter(verse.chapter);
        skipAutoPreviewRef.current = true;
        setVerses(allVrs);
    }, [books]);

    // ── Clear preview ──
    const clearPreview = useCallback(() => {
        setPreviewType(null);
        setPreviewSections([]);
        setPreviewTitle('');
        setPreviewNumber('');
        setProjSlideIndex(0);
        setSelectedHymnId(null);
        setPreviewLive(false);
    }, []);

    // ── Projection control ──
    const startProjection = useCallback(async (startIndex?: number) => {
        if (!previewSections.length) return;
        const secs = previewSections.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection));
        const ct = previewType ?? 'hymn';
        // Hymns start at title slide (-1), Bible starts at first verse (0)
        const idx = startIndex ?? (ct === 'hymn' ? -1 : 0);
        const br = ct === 'bible' && previewSections[idx]
            ? `${previewTitle}:${(previewSections[idx] as any).label?.replace('v. ', '') ?? ''}`
            : undefined;
        await window.electron.projection.open(secs, previewTitle, previewNumber, idx, ct, br);
        setProjecting(true);
        setProjSlideIndex(idx);
        setPreviewLive(true);
        setLiveLabel(ct === 'bible' ? `${previewNumber} ${previewTitle}`.trim() : `Imn ${previewNumber ? previewNumber + ' ' : ''}${previewTitle}`.trim());
    }, [previewSections, previewTitle, previewNumber, previewType]);

    // ── Trece live imnul PREGĂTIT din previzualizare (comutare fluidă, fără blackout) ──
    // Apelată doar în timpul proiecției, când previzualizarea nu e deja live.
    const goLivePreview = useCallback(async () => {
        if (!projecting || !previewSections.length) return;
        const secs = previewSections.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection));
        const ct = previewType ?? 'hymn';
        const idx = ct === 'bible' ? Math.max(0, projSlideIndexRef.current) : -1;
        const br = ct === 'bible' && previewSections[idx]
            ? `${previewTitle}:${previewSections[idx].label?.replace('v. ', '') ?? ''}`
            : undefined;
        await window.electron.projection.updateHymn(secs, previewTitle, previewNumber, idx, ct, br);
        setProjSlideIndex(idx);
        setPreviewLive(true);
        setLiveLabel(ct === 'bible' ? `${previewNumber} ${previewTitle}`.trim() : `Imn ${previewNumber ? previewNumber + ' ' : ''}${previewTitle}`.trim());
    }, [projecting, previewSections, previewType, previewTitle, previewNumber]);

    const navigateSlide = useCallback(async (newIdx: number) => {
        if (!projecting) return;
        const n = previewSections.length;
        const minIdx = previewType === 'bible' ? 0 : -1;
        if (newIdx < minIdx || newIdx >= n) return;
        setProjSlideIndex(newIdx);
        const secs = previewSections.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection));
        const ct = previewType ?? 'hymn';
        const br = ct === 'bible' && previewSections[newIdx]
            ? `${previewTitle}:${(previewSections[newIdx] as any).label?.replace('v. ', '') ?? ''}`
            : undefined;
        await window.electron.projection.navigate(secs, newIdx, previewTitle, previewNumber, ct, br);
    }, [projecting, previewSections, previewTitle, previewNumber, previewType]);

    const stopProjection = useCallback(async () => {
        await window.electron.projection.close();
        setProjecting(false);
        setProjSlideIndex(0);
        setPreviewLive(false);
    }, []);

    // Listen for projection closed
    useEffect(() => {
        window.electron.projection.onClosed(() => {
            setProjecting(false);
            setProjSlideIndex(0);
            setPreviewLive(false);
            realtimeCtl.notifyClosed();
        });
        window.electron.projection.onControllerSync(({ currentIndex }) => {
            setProjSlideIndex(currentIndex);
        });
        return () => {
            window.electron.projection.offClosed();
            window.electron.projection.offControllerSync();
        };
    }, []);

    // ── Tab switch ──
    const switchTab = useCallback((newTab: Tab) => {
        // Save current tab widths
        layoutWidthsRef.current[tabRef.current] = { sidebarWidth, previewWidth };
        // Restore new tab widths
        const nw = layoutWidthsRef.current[newTab];
        setSidebarWidth(nw.sidebarWidth);
        setPreviewWidth(nw.previewWidth);
        tabRef.current = newTab;

        setTab(newTab);
        setRefSearch('');
        setContentSearch('');
        setBibleSearchResults(null);
        setBiblePassage(null);
        setBibleRefError(null);
        if (!projecting) clearPreview();
    }, [projecting, clearPreview, sidebarWidth, previewWidth]);

    // ── Bible navigation ──
    const selectBook = useCallback(async (book: BibleBook) => {
        setSelectedBookId(book.id);
        setSelectedBookName(book.name);
        setSelectedChapter(null);
        setVerses([]);
        setSelectedVerseIdx(0);
        setBibleSearchResults(null);
        setBiblePassage(null);
        const chs = await window.electron.bible.getChapters(book.id);
        setChapters(chs);
    }, []);

    const selectChapter = useCallback(async (ch: number) => {
        if (!selectedBookId) return;
        setBiblePassage(null);
        setSelectedChapter(ch);
        const vrs = await window.electron.bible.getVerses(selectedBookId, ch);
        setVerses(vrs);
        setSelectedVerseIdx(0);
    }, [selectedBookId]);

    // When a chapter is selected and verses load, show ALL verses in preview
    useEffect(() => {
        if (skipAutoPreviewRef.current) {
            skipAutoPreviewRef.current = false;
            return;
        }
        if (verses.length > 0 && selectedChapter) {
            const book = books.find(b => b.id === selectedBookId);
            const secs = verses.map((v: BibleVerse) => ({
                text: v.text,
                type: 'verse',
                label: `v. ${v.verse}`,
            }));
            setPreviewType('bible');
            setPreviewSections(secs);
            setPreviewTitle(`${book?.name ?? ''} ${selectedChapter}`);
            setPreviewNumber(book?.abbreviation ?? '');
            setProjSlideIndex(0);
            setSelectedVerseIdx(0);
        }
    }, [verses, selectedChapter, books, selectedBookId]);

    // ── Video actions ──
    const loadVideoFile = useCallback(async () => {
        const filePath = await window.electron.video.pickFile();
        if (!filePath) return;
        setVideoLoading(true);
        setVideoError(null);
        try {
            const result = await window.electron.video.prepare(filePath);
            if (result.error) {
                setVideoError('Nu am putut pregăti videoclipul: ' + result.error);
                setVideoLoading(false);
                return;
            }
            const url = result.url ?? '';
            const name = result.name ?? '';
            // Add to unified playlist
            const addResult = await window.electron.playlist.addLocal(url, name);
            if (addResult.entry) {
                setYoutubePlaylist(prev => [...prev, addResult.entry!]);
            }
        } catch (err) {
            setVideoError('Nu am putut pregăti videoclipul: ' + ((err as Error)?.message ?? 'eroare necunoscută'));
        }
        setVideoLoading(false);
    }, []);

    const videoStartPlayback = useCallback(async (url: string, name: string) => {
        setVideoName(name);
        setVideoUrl(url);
        setVideoStatus({ currentTime: 0, duration: 0, paused: true });
        setFloatingMonitorHidden(false);
        liveBus.notify();
        await window.electron.video.startPlayback(url, name);
    }, []);

    const videoPlay = useCallback(() => window.electron.video.play(), []);
    const videoPause = useCallback(() => window.electron.video.pause(), []);
    const videoStop = useCallback(() => {
        window.electron.video.stop();
        setVideoStatus(null);
        setVideoName('');
        setVideoUrl('');
        setVideoError(null);
    }, []);
    const videoSeek = useCallback((time: number) => window.electron.video.seek(time), []);
    const videoSetVolume = useCallback((vol: number) => {
        setVideoVolume(vol);
        setVideoMuted(false);
        window.electron.video.volume(vol);
    }, []);
    const videoToggleMute = useCallback(() => {
        setVideoMuted(m => {
            const next = !m;
            window.electron.video.volume(next ? 0 : videoVolume);
            return next;
        });
    }, [videoVolume]);

    // YouTube playlist actions
    const youtubeAdd = useCallback(async (url: string) => {
        const result = await window.electron.youtube.add(url);
        if (result.error) {
            return result.error;
        }
        if (result.entry) {
            setYoutubePlaylist(prev => [...prev, result.entry!]);
        }
        return null;
    }, []);

    const youtubeRemove = useCallback(async (id: string) => {
        await window.electron.youtube.remove(id);
        setYoutubePlaylist(prev => prev.filter(e => e.id !== id));
    }, []);

    const youtubeDelete = useCallback(async (id: string) => {
        await window.electron.youtube.delete(id);
        setYoutubePlaylist(prev => prev.filter(e => e.id !== id));
    }, []);

    const youtubePlay = useCallback(async (id: string) => {
        setVideoError(null);
        const result = await window.electron.playlist.getFileUrl(id);
        if (result.error || !result.url) {
            setVideoError((result.error || 'Fișierul nu a putut fi redat') + '. Alege-l din nou din listă.');
            return;
        }
        videoStartPlayback(result.url, result.name ?? 'Video');
    }, [videoStartPlayback]);

    const youtubeRetry = useCallback(async (id: string) => {
        setYoutubePlaylist(prev => prev.map(e =>
            e.id === id ? { ...e, status: 'downloading' as const, error: undefined } : e
        ));
        await window.electron.youtube.retryDownload(id);
    }, []);

    const youtubeUpdateTitle = useCallback(async (id: string, title: string) => {
        await window.electron.youtube.updateTitle(id, title);
        setYoutubePlaylist(prev => prev.map(e =>
            e.id === id ? { ...e, title } : e
        ));
    }, []);

    // ── Load Bible reference (Enter-triggered, BibleShow-style) ──
    const loadBibleReference = useCallback(async (): Promise<boolean> => {
        const input = refSearch.trim();
        if (!input) return false;

        const ref = parseBibleReference(input);
        if (!ref) return false;

        const book = matchBibleBook(ref.bookQuery, books);
        if (!book) return false;

        // Always expand sidebar tree: select book + load chapters
        setSelectedBookId(book.id);
        setSelectedBookName(book.name);
        setBibleSearchResults(null);
        setBiblePassage(null);
        const chs = await window.electron.bible.getChapters(book.id);
        setChapters(chs);

        if (!ref.chapter) {
            // Only book matched → show chapters, no chapter/verse selected
            setSelectedChapter(null);
            setVerses([]);
            setPreviewType(null);
            setPreviewSections([]);
            setProjSlideIndex(0);
            return true;
        }

        // Load chapter verses + expand sidebar to chapter
        setSelectedChapter(ref.chapter);
        const vrs = await window.electron.bible.getVerses(book.id, ref.chapter);
        if (!vrs.length) return false;
        skipAutoPreviewRef.current = true; // prevent auto-preview from overriding our precise index

        if (ref.verse && ref.endVerse) {
            // Interval de versete (ex: gen 1:3-5) → afișează DOAR pasajul; contorul n/N și
            // săgețile rămân în pasaj, iar ↓ dincolo de ultimul verset extinde la tot capitolul.
            const passage = await window.electron.bible.getVerseRange(book.id, ref.chapter, ref.verse, ref.endVerse);
            if (!passage.length) return false;
            setVerses(passage);
            const secs = passage.map((v: BibleVerse) => ({ text: v.text, type: 'verse', label: `v. ${v.verse}` }));
            setPreviewType('bible');
            setPreviewSections(secs);
            setPreviewTitle(`${book.name} ${ref.chapter}`);
            setPreviewNumber(book.abbreviation);
            setProjSlideIndex(0);
            setSelectedVerseIdx(0);
            setBiblePassage({ bookId: book.id, chapter: ref.chapter, endVerse: ref.endVerse });
            return true;
        }

        setVerses(vrs);

        if (ref.verse) {
            // Full reference (book + chapter + verse) → load all verses, navigate to specific one
            const verseIdx = vrs.findIndex((v: BibleVerse) => v.verse === ref.verse);
            const idx = Math.max(0, verseIdx);
            const secs = vrs.map((v: BibleVerse) => ({ text: v.text, type: 'verse', label: `v. ${v.verse}` }));
            setPreviewType('bible');
            setPreviewSections(secs);
            setPreviewTitle(`${book.name} ${ref.chapter}`);
            setPreviewNumber(book.abbreviation);
            setProjSlideIndex(idx);
            setSelectedVerseIdx(idx);
        } else {
            // Chapter only → load all verses, start at first
            const secs = vrs.map((v: BibleVerse) => ({ text: v.text, type: 'verse', label: `v. ${v.verse}` }));
            setPreviewType('bible');
            setPreviewSections(secs);
            setPreviewTitle(`${book.name} ${ref.chapter}`);
            setPreviewNumber(book.abbreviation);
            setProjSlideIndex(0);
            setSelectedVerseIdx(0);
        }

        return true;
    }, [refSearch, books]);

    // ── Scroll selected hymn into view ──
    useEffect(() => {
        if (selectedHymnId && hymnListRef.current) {
            const el = hymnListRef.current.querySelector(`[data-hymn-id="${selectedHymnId}"]`);
            if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [selectedHymnId]);

    // ── Password helper ──
    const requirePassword = useCallback((action: () => void, title: string) => {
        if (!adminPasswordHash) {
            action();
            return;
        }
        setPasswordModal({ action, title });
    }, [adminPasswordHash]);

    useEffect(() => {
        adminGate.require = requirePassword;
    }, [requirePassword]);

    // ── Context menu actions ──
    const openEditHymn = useCallback(async (hymnId: number) => {
        const data = await window.electron.db.getHymnWithSections(hymnId);
        if (!data) return;
        const doEdit = () => {
            setHymnEditor({
                mode: 'edit',
                hymnId: data.id,
                number: data.number,
                title: data.title,
                sections: data.sections.map(s => ({ type: s.type, text: s.text })),
                categoryId: data.category_id ?? undefined,
            });
        };
        // Check if within grace period
        if (isWithinGracePeriod(data.created_at)) {
            doEdit();
        } else {
            requirePassword(doEdit, 'Editare imn');
        }
    }, [requirePassword]);

    const deleteHymnAction = useCallback(async (hymnId: number) => {
        const doDelete = async () => {
            if (!confirm('Sigur vrei să ștergi acest imn?')) return;
            await window.electron.hymn.delete(hymnId);
            if (selectedHymnId === hymnId) {
                clearPreview();
                setSelectedHymnId(null);
            }
            loadHymns();
            loadCategories();
        };
        // Get hymn data to check grace period
        const data = await window.electron.db.getHymnWithSections(hymnId);
        if (data && isWithinGracePeriod(data.created_at)) {
            doDelete();
        } else {
            requirePassword(doDelete, 'Ștergere imn');
        }
    }, [selectedHymnId, clearPreview, loadHymns, loadCategories, requirePassword]);

    // ── Adaugă imn (permanent pe tabul Imnuri; imnurile noi merg la „Imnuri Speciale") ──
    const openAddHymn = useCallback(() => {
        const special = categories.find(c => c.name === 'Imnuri Speciale');
        const specialId = special?.id;
        if (specialId !== undefined && activeCategoryId !== specialId) {
            if (!confirm('Imnurile noi se adaugă la «Imnuri Speciale». Continui?')) return;
            setActiveCategoryId(specialId);
        }
        setHymnEditor({
            mode: 'add',
            number: '',
            title: '',
            sections: [{ type: 'strofa', text: '' }],
            categoryId: specialId ?? activeCategoryId,
        });
    }, [categories, activeCategoryId]);

    // ── Global keyboard ──
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
                || (e.target instanceof HTMLElement && e.target.isContentEditable);
            if (modalOpen || hymnEditor || passwordModal || needsPasswordSetup
                || needsChurchInfo || forgotPwOpen || setPwOpen) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                // Realtime: primul Esc închide editorul mare, al doilea oprește proiecția
                if (realtimeCtl.overlayOpen) { realtimeCtl.closeOverlay(); return; }
                if (realtimeCtl.projected) { realtimeCtl.stop(); return; }
                // Stop video if active
                if (videoStatus) {
                    videoStop();
                    return;
                }
                if (projecting) {
                    stopProjection();
                } else if (previewSections.length > 0) {
                    clearPreview();
                }
                // Always clear search fields and focus
                setRefSearch('');
                setContentSearch('');
                refSearchRef.current?.focus();
                return;
            }

            // ── Scurtături video (tab Video, video încărcat, în afara câmpurilor text) ──
            if (tab === 'video' && videoUrl && !inInput) {
                const k = e.key;
                if (k === ' ') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    if (videoStatus?.paused ?? true) videoPlay(); else videoPause();
                    return;
                }
                if (k === 'ArrowRight' || k === 'ArrowLeft') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    const delta = (e.shiftKey ? 30 : 5) * (k === 'ArrowRight' ? 1 : -1);
                    const cur = videoStatus?.currentTime ?? 0;
                    const dur = videoStatus?.duration ?? 0;
                    const upper = dur > 0 ? dur : cur + Math.abs(delta);
                    videoSeek(Math.max(0, Math.min(cur + delta, upper)));
                    return;
                }
                if (k === 'ArrowUp' || k === 'ArrowDown') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    const base = videoMuted ? 0 : videoVolume;
                    videoSetVolume(Math.max(0, Math.min(1, base + (k === 'ArrowUp' ? 0.05 : -0.05))));
                    return;
                }
                if (k === 'm' || k === 'M') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    videoToggleMute();
                    return;
                }
            }

            if (e.key === 'Enter' && !inInput) {
                e.preventDefault();
                if (projecting) {
                    // imn PREGĂTIT → Enter îl trece live; altfel navigarea o face ProjectorController
                    if (!previewLive) goLivePreview();
                } else if (previewSections.length > 0) {
                    startProjection(projSlideIndexRef.current);
                }
                return;
            }

            // Realtime: navighează slide-urile prezentării proiectate din fereastra
            // principală — aceeași rută ca butoanele ‹ › (goSlide → projection.updateText).
            // ←/→/PageUp/PageDown/Space; nu fură tastele când scrii în editor (!inInput).
            if (realtimeCtl.presSlides > 1 && !inInput
                && (e.key === 'ArrowRight' || e.key === 'ArrowLeft'
                    || e.key === 'PageDown' || e.key === 'PageUp' || e.key === ' ')) {
                e.preventDefault();
                if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') realtimeCtl.nextSlide();
                else realtimeCtl.prevSlide();
                return;
            }

            // ↑↓ navigate hymn list / bible verses
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !inInput) {
                if (projecting) return; // Let ProjectorController handle
                e.preventDefault();
                if (tab === 'imnuri') {
                    const currentIdx = hymns.findIndex(h => h.id === selectedHymnId);
                    let nextIdx: number;
                    if (e.key === 'ArrowDown') {
                        nextIdx = currentIdx < hymns.length - 1 ? currentIdx + 1 : currentIdx;
                    } else {
                        nextIdx = currentIdx > 0 ? currentIdx - 1 : 0;
                    }
                    if (hymns[nextIdx]) {
                        previewHymn(hymns[nextIdx].id);
                    }
                } else if (tab === 'biblia' && verses.length > 0) {
                    const newIdx = e.key === 'ArrowDown'
                        ? Math.min(selectedVerseIdx + 1, verses.length - 1)
                        : Math.max(selectedVerseIdx - 1, 0);
                    setSelectedVerseIdx(newIdx);
                    setProjSlideIndex(newIdx);
                }
                return;
            }

            // Quick focus search with /
            if (e.key === '/' && !inInput) {
                e.preventDefault();
                refSearchRef.current?.focus();
                refSearchRef.current?.select();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [projecting, previewSections, modalOpen, hymnEditor, passwordModal, needsPasswordSetup,
        needsChurchInfo, forgotPwOpen, setPwOpen,
        stopProjection, clearPreview, startProjection, tab, hymns, selectedHymnId, previewHymn,
        previewLive, goLivePreview,
        videoStatus, videoStop, videoUrl, videoVolume, videoMuted,
        videoPlay, videoPause, videoSeek, videoSetVolume, videoToggleMute,
        verses, selectedVerseIdx, books, selectedBookId, selectedChapter]);

    // ── Resizable column drag handlers ──
    const onResizeMouseDown = useCallback((which: 'sidebar' | 'preview') => {
        draggingRef.current = which;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (e: MouseEvent) => {
            if (!draggingRef.current || !mainAreaRef.current) return;
            const rect = mainAreaRef.current.getBoundingClientRect();
            if (draggingRef.current === 'sidebar') {
                const newW = Math.max(120, Math.min(400, e.clientX - rect.left));
                setSidebarWidth(newW);
            } else {
                const newW = Math.max(300, Math.min(900, rect.right - e.clientX));
                setPreviewWidth(newW);
            }
        };

        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            draggingRef.current = null;
            // Save per-tab layout widths
            setTimeout(() => {
                const sw = document.querySelector<HTMLElement>('.sidebar')?.offsetWidth ?? 200;
                const pw = document.querySelector<HTMLElement>('.preview')?.offsetWidth ?? 640;
                layoutWidthsRef.current[tabRef.current] = { sidebarWidth: sw, previewWidth: pw };
                window.electron.settings.set({ layoutWidths: { ...layoutWidthsRef.current } });
            }, 50);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, []);

    // ── Search Enter/Esc/Arrow handler ──
    const onSearchKeydown = useCallback(async (e: React.KeyboardEvent, source: 'ref' | 'content' = 'ref') => {
        if (e.key === 'Enter') {
            e.preventDefault();

            // Check if user has a new/unconsumed search query
            const isNewSearch = refSearch.trim().length > 0 && !searchConsumedRef.current;

            if (tab === 'imnuri') {
                if (isNewSearch) {
                    // Search nou → DOAR pregătește primul rezultat în previzualizare.
                    // În timpul proiecției NU mai oprim: imnul curent rămâne live până confirmi.
                    if (hymns.length > 0) {
                        searchConsumedRef.current = true;
                        await previewHymn(hymns[0].id);
                    }
                } else if (previewSections.length > 0) {
                    // Search consumat + Enter = trece live (fluid dacă proiectăm, altfel pornește)
                    if (!projecting) startProjection(projSlideIndex);
                    else if (!previewLive) await goLivePreview();
                } else if (hymns.length > 0) {
                    // Fără previzualizare (ex. după curățare) → încarcă primul rezultat
                    searchConsumedRef.current = true;
                    await previewHymn(hymns[0].id);
                }
                return;
            }

            if (tab === 'biblia') {
                if (source === 'content') {
                    // Căutare în text: pornește DOAR la ≥3 litere; sub atât nu proiecta nimic
                    if (contentSearch.trim().length >= 3) {
                        await doBibleContentSearch();
                    }
                    return;
                }
                // source === 'ref' → referință biblică / proiecție
                if (isNewSearch) {
                    if (projecting) await stopProjection();
                    const loaded = await loadBibleReference();
                    if (loaded) {
                        searchConsumedRef.current = true;
                        setBibleRefError(null);
                    } else {
                        setBibleRefError(`Nu am găsit «${refSearch.trim()}». Scrie de exemplu: ioan 3 16, ps 23, gen 1:3`);
                    }
                } else if (previewSections.length > 0 && !projecting) {
                    startProjection(projSlideIndex);
                }
                return;
            }
            return;
        }

        // When projecting, arrow keys control projection (same as ProjectorController):
        // Right/Left = navigate slides, Up/Down = zoom
        if (projecting && previewLive && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
            e.preventDefault();
            if (e.key === 'ArrowRight') navigateSlide(projSlideIndex + 1);
            else navigateSlide(projSlideIndex - 1);
            return;
        }

        if (projecting && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            window.electron.projection.sendKeyRequest(e.key === 'ArrowUp' ? 'zoom-in' : 'zoom-out');
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (tab === 'imnuri') {
                const currentIdx = hymns.findIndex(h => h.id === selectedHymnId);
                const nextIdx = currentIdx < hymns.length - 1 ? currentIdx + 1 : 0;
                if (hymns[nextIdx]) previewHymn(hymns[nextIdx].id);
            } else if (tab === 'biblia' && verses.length > 0) {
                // Continuă dincolo de pasaj: ↓ pe ultimul verset al intervalului
                // încarcă restul capitolului și trece la versetul următor.
                if (biblePassage && selectedVerseIdx >= verses.length - 1) {
                    const full = await window.electron.bible.getVerses(biblePassage.bookId, biblePassage.chapter);
                    const curVerse = verses[selectedVerseIdx]?.verse;
                    const contIdx = full.findIndex((v: BibleVerse) => v.verse === curVerse);
                    if (contIdx >= 0 && contIdx < full.length - 1) {
                        skipAutoPreviewRef.current = true;
                        setVerses(full);
                        setPreviewSections(full.map((v: BibleVerse) => ({ text: v.text, type: 'verse', label: `v. ${v.verse}` })));
                        setBiblePassage(null);
                        setSelectedVerseIdx(contIdx + 1);
                        setProjSlideIndex(contIdx + 1);
                    }
                    return;
                }
                const newIdx = Math.min(selectedVerseIdx + 1, verses.length - 1);
                setSelectedVerseIdx(newIdx);
                setProjSlideIndex(newIdx);
            }
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (tab === 'imnuri') {
                const currentIdx = hymns.findIndex(h => h.id === selectedHymnId);
                const nextIdx = currentIdx > 0 ? currentIdx - 1 : hymns.length - 1;
                if (hymns[nextIdx]) previewHymn(hymns[nextIdx].id);
            } else if (tab === 'biblia' && verses.length > 0) {
                const newIdx = Math.max(selectedVerseIdx - 1, 0);
                setSelectedVerseIdx(newIdx);
                setProjSlideIndex(newIdx);
            }
            return;
        }
    }, [projecting, previewSections, projSlideIndex, startProjection, tab,
        selectedHymnId, hymns, previewHymn, loadBibleReference, stopProjection,
        navigateSlide, contentSearch, doBibleContentSearch, refSearch, biblePassage,
        previewLive, goLivePreview,
        verses, selectedVerseIdx, books, selectedBookId, selectedChapter]);

    // ── Close context menu on click elsewhere ──
    useEffect(() => {
        if (!contextMenu) return;
        const handler = () => setContextMenu(null);
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, [contextMenu]);

    // ── Badge LIVE global: ce se proiectează ACUM (orice sursă) ──
    const liveNow: string | null = (() => {
        if (videoUrl) return `Video: ${videoName || 'videoclip'}`;
        if (projecting) return liveLabel || 'Proiecție';
        const tl = timerCtl.live;
        if (tl) return tl.mode === 'clock' ? 'Ceas' : tl.mode === 'stopwatch' ? 'Cronometru' : 'Numărătoare';
        if (realtimeCtl.projected) return 'Anunț';
        return null;
    })();
    const stopAllProjection = () => {
        if (videoUrl) { videoStop(); return; }
        if (projecting) { stopProjection(); return; }
        // Ceas / Anunț: închide proiecția și resetează registrele de modul
        window.electron.projection.close();
        timerCtl.live = null; timerCtl.anchor = {};
        realtimeCtl.notifyClosed();
        liveBus.notify();
    };

    // ══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ══════════════════════════════════════════════════════════════════════════

    return (
        <div className="app-root">
            {/* ── Actualizare obligatorie ──
                O bandă, nu un dialog care blochează: dacă asta apare sâmbătă la 10:00,
                operatorul trebuie să poată proiecta mai departe. Aplicația se repornește
                singură abia după ce ecranul de proiecție e închis. */}
            {forcedUpdate && (
                <div className="forced-update-bar">
                    <strong>Actualizare obligatorie{forcedUpdate.version ? ` — versiunea ${forcedUpdate.version}` : ''}.</strong>
                    {' '}
                    {forcedUpdate.waitingForProjection
                        ? 'Este descărcată și se instalează singură imediat ce închideți proiecția.'
                        : updateProgress > 0 && updateProgress < 100
                            ? `Se descarcă… ${updateProgress}%`
                            : 'Se descarcă în fundal. Nu întrerupe programul.'}
                    {forcedUpdate.reason && (
                        <span className="forced-update-reason"> {forcedUpdate.reason}</span>
                    )}
                </div>
            )}

            {/* ── Header ── */}
            <header className="header">
                <div className="header-logo">
                    <Monitor className="icon-sm text-indigo-400" />
                    <span>Proiecție</span>
                    {liveNow && (
                        <span className="live-badge" title="Se proiectează acum">
                            <span className="live-badge-text">● LIVE — {liveNow}</span>
                            <button className="live-badge-stop" onClick={stopAllProjection} title="Oprește proiecția">✕</button>
                        </span>
                    )}
                </div>

                {/* Tabs */}
                <div className="tabs">
                    <button
                        className={`tab-btn ${tab === 'imnuri' ? 'active' : ''}`}
                        onClick={() => switchTab('imnuri')}
                    >
                        Imnuri
                    </button>
                    <button
                        className={`tab-btn ${tab === 'biblia' ? 'active' : ''}`}
                        onClick={() => switchTab('biblia')}
                    >
                        Biblia
                    </button>
                    <button
                        className={`tab-btn ${tab === 'video' ? 'active' : ''}`}
                        onClick={() => switchTab('video')}
                    >
                        Video
                    </button>
                    <button
                        className={`tab-btn ${tab === 'timer' ? 'active' : ''}`}
                        onClick={() => switchTab('timer')}
                    >
                        Ceas
                    </button>
                    <button
                        className={`tab-btn ${tab === 'mesaj' ? 'active' : ''}`}
                        onClick={() => switchTab('mesaj')}
                    >
                        Anunțuri
                    </button>
                </div>

                {/* Search boxes */}
                <div className="search-area">
                    {(tab === 'imnuri' || tab === 'biblia') && (<>
                        <div className="search-box">
                            <Search className="search-icon" />
                            <input
                                ref={refSearchRef}
                                type="text"
                                value={refSearch}
                                onChange={e => setRefSearch(e.target.value)}
                                onKeyDown={e => onSearchKeydown(e, 'ref')}
                                placeholder={tab === 'imnuri' ? 'Nr. / Titlu imn...' : 'ex: deu 12 12, ps 23, gen 1:3'}
                            />
                            {tab === 'biblia' && bibleRefError && (
                                <div className="search-msg search-msg-error">{bibleRefError}</div>
                            )}
                        </div>
                        <div className="search-box search-box-wide">
                            <Search className="search-icon" />
                            <input
                                type="text"
                                value={contentSearch}
                                onChange={e => setContentSearch(e.target.value)}
                                onKeyDown={e => onSearchKeydown(e, 'content')}
                                placeholder={tab === 'imnuri' ? 'Caută în text...' : 'Caută în Biblie...'}
                            />
                            {tab === 'biblia' && (
                                <div className="search-msg">Scrie cel puțin 3 litere și apasă Enter.</div>
                            )}
                        </div>
                    </>)}
                </div>

                {/* Add hymn button — permanent pe tabul Imnuri (adaugă la „Imnuri Speciale") */}
                {tab === 'imnuri' && (
                    <button
                        className="header-btn add-btn"
                        onClick={openAddHymn}
                        title="Adaugă imn"
                    >
                        <Plus className="icon-sm" />
                    </button>
                )}

                {/* Ajutor */}
                <button className="header-btn" onClick={() => setModalOpen('help')} title="Ajutor — scurtături">
                    <HelpCircle className="icon-sm" />
                </button>

                {/* Settings */}
                <button className="header-btn header-btn-settings" onClick={() => setModalOpen('settings')} title="Setări">
                    <Settings className="icon-sm" />
                    <span className="header-btn-label">Setări</span>
                </button>

                <div className="kbd-hints">
                    <kbd>/</kbd>
                    <span>caută</span>
                    <kbd>↑↓</kbd>
                    <span>navigare</span>
                    <kbd>Enter</kbd>
                    <span>previzualizare / proiecție</span>
                    <kbd>Esc</kbd>
                    <span>oprește</span>
                </div>
            </header>

            {/* ── Main content area (3-column layout) ── */}
            <div
                className={`main-area ${tab === 'timer' || tab === 'mesaj' ? 'main-area-full' : ''}`}
                ref={mainAreaRef}
                style={{ gridTemplateColumns: `${sidebarWidth}px auto 1fr auto ${previewWidth}px` }}
            >
                {/* Sidebar */}
                <aside className="sidebar">
                    {tab === 'imnuri' ? (
                        <SidebarCategories
                            categories={categories}
                            activeCategoryId={activeCategoryId}
                            onSelect={setActiveCategoryId}
                        />
                    ) : tab === 'biblia' ? (
                        <SidebarBibleBooks
                            books={books}
                            selectedBookId={selectedBookId}
                            onSelect={selectBook}
                            onDeselectBook={() => {
                                setSelectedBookId(null);
                                setSelectedBookName('');
                                setSelectedChapter(null);
                                setChapters([]);
                                setVerses([]);
                                setSelectedVerseIdx(0);
                                setBibleSearchResults(null);
                                setBiblePassage(null);
                            }}
                        />
                    ) : tab !== 'video' ? (
                        /* Ceas / Realtime: fără liste în sidebar */
                        <div className="sidebar-list" />
                    ) : (
                        <SidebarVideoFilter
                            filter={videoFilter}
                            onFilter={setVideoFilter}
                            youtubePlaylist={youtubePlaylist}
                        />
                    )}
                    {/* Update banner */}
                    {(updateInfo?.available || updateReady) && (
                        <div className="update-banner update-banner-sidebar">
                            <div className="update-banner-title">
                                <Download className="icon-sm" />
                                {updateReady
                                    ? `Actualizare ${updateInfo?.version} descărcată`
                                    : `Versiune nouă: ${updateInfo?.version}`}
                            </div>
                            {updateError && (
                                <div className="update-banner-changelog" style={{ color: '#f87171' }}>
                                    Eroare: {updateError}
                                </div>
                            )}
                            {updateDownloading ? (
                                <div style={{ width: '100%' }}>
                                    <div style={{
                                        height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.15)',
                                        overflow: 'hidden', marginBottom: 4,
                                    }}>
                                        <div style={{
                                            height: '100%', width: `${updateProgress}%`,
                                            background: 'var(--accent)', borderRadius: 3,
                                            transition: 'width 0.3s ease',
                                        }} />
                                    </div>
                                    <div style={{ fontSize: 11, textAlign: 'center', opacity: 0.7 }}>
                                        {updateTotal > 0
                                            ? `${(updateTransferred / 1048576).toFixed(1)} MB / ${(updateTotal / 1048576).toFixed(1)} MB (${updateProgress}%)`
                                            : `${updateProgress}% — se descarcă...`
                                        }
                                    </div>
                                </div>
                            ) : updateReady ? (
                                <button
                                    className="update-banner-btn"
                                    onClick={() => window.electron.update.install()}
                                >
                                    Instalează și repornește
                                </button>
                            ) : (
                                <button
                                    className="update-banner-btn"
                                    onClick={() => {
                                        setUpdateDownloading(true);
                                        setUpdateProgress(0);
                                        setUpdateTransferred(0);
                                        setUpdateTotal(0);
                                        setUpdateError(null);
                                        window.electron.update.download();
                                    }}
                                >
                                    Actualizează
                                </button>
                            )}
                            <div style={{ marginTop: 4, textAlign: 'center' }}>
                                <button
                                    style={{ fontSize: 10, opacity: 0.5, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textDecoration: 'underline' }}
                                    onClick={async () =>
                                        window.electron.openExternal(await window.electron.update.downloadPage())}
                                >
                                    Descarcă manual din browser
                                </button>
                            </div>
                        </div>
                    )}
                </aside>

                {/* Resize handle: sidebar | content */}
                <div className="resize-handle" onMouseDown={() => onResizeMouseDown('sidebar')} />

                {/* Content */}
                <div className="content">
                    {tab === 'timer' ? (
                        <TimerPanel />
                    ) : tab === 'mesaj' ? (
                        <MessagePanel />
                    ) : tab === 'imnuri' ? (
                        <HymnList
                            hymns={hymns}
                            categories={categories}
                            activeCategoryId={activeCategoryId}
                            selectedHymnId={selectedHymnId}
                            onSelect={previewHymn}
                            onContextMenu={(e, hymn) => {
                                e.preventDefault();
                                setContextMenu({ x: e.clientX, y: e.clientY, hymn });
                            }}
                            listRef={hymnListRef}
                        />
                    ) : tab === 'video' ? (
                        <VideoController
                            videoName={videoName}
                            videoStatus={videoStatus}
                            videoVolume={videoVolume}
                            videoMuted={videoMuted}
                            videoError={videoError}
                            videoLoading={videoLoading}
                            videoConverting={videoConverting}
                            youtubePlaylist={youtubePlaylist}
                            youtubeProgress={youtubeProgress}
                            videoFilter={videoFilter}
                            onPickFile={loadVideoFile}
                            onDismissError={() => setVideoError(null)}
                            onPlay={videoPlay}
                            onPause={videoPause}
                            onStop={videoStop}
                            onSeek={videoSeek}
                            onVolume={videoSetVolume}
                            onToggleMute={videoToggleMute}
                            onYoutubeAdd={youtubeAdd}
                            onYoutubeRemove={youtubeRemove}
                            onYoutubeDelete={youtubeDelete}
                            onYoutubePlay={youtubePlay}
                            onYoutubeRetry={youtubeRetry}
                            onYoutubeUpdateTitle={youtubeUpdateTitle}
                        />
                    ) : bibleSearchResults ? (
                        <BibleSearchResultsList
                            results={bibleSearchResults}
                            selectedIdx={selectedVerseIdx}
                            searchScope={
                                selectedBookName
                                    ? selectedChapter
                                        ? `${selectedBookName} ${selectedChapter}`
                                        : selectedBookName
                                    : undefined
                            }
                            onSelect={(idx) => {
                                setSelectedVerseIdx(idx);
                                const verse = bibleSearchResults[idx];
                                if (verse) previewBibleResult(verse);
                            }}
                        />
                    ) : (
                        <BibleContentArea
                            selectedBookId={selectedBookId}
                            selectedBookName={selectedBookName}
                            selectedChapter={selectedChapter}
                            chapters={chapters}
                            verses={verses}
                            selectedVerseIdx={selectedVerseIdx}
                            onSelectChapter={selectChapter}
                            onSelectVerse={(idx) => {
                                setSelectedVerseIdx(idx);
                                setProjSlideIndex(idx);
                            }}
                            onBackToChapters={() => { setSelectedChapter(null); setVerses([]); }}
                        />
                    )}
                </div>

                {/* Resize handle: content | preview */}
                <div className="resize-handle" onMouseDown={() => onResizeMouseDown('preview')} />

                {/* Preview */}
                <div className="preview">
                    <PreviewPanel
                        previewType={previewType}
                        previewSections={previewSections}
                        previewTitle={previewTitle}
                        previewNumber={previewNumber}
                        projecting={projecting}
                        previewLive={previewLive}
                        projSlideIndex={projSlideIndex}
                        onStartProjection={startProjection}
                        onGoLive={goLivePreview}
                        onStopProjection={stopProjection}
                        onClearPreview={clearPreview}
                        onNavigateSlide={navigateSlide}
                        onSelectSlide={(i) => setProjSlideIndex(i)}
                        videoUrl={videoUrl}
                        videoStatus={videoStatus}
                        videoName={videoName}
                        floatingActive={(tab === 'timer' || tab === 'mesaj') && !!videoUrl && !floatingMonitorHidden}
                    />
                </div>
            </div>

            {/* Monitor de retur plutitor: pe Ceas/Realtime coloana de previzualizare
                e ascunsă, dar operatorul are nevoie să vadă/controleze video-ul live
                cât pregătește numărătoarea sau anunțul */}
            {videoUrl && (tab === 'timer' || tab === 'mesaj') && !floatingMonitorHidden && (
                <VideoReturnMonitor
                    key={videoUrl}
                    floating
                    videoUrl={videoUrl}
                    videoStatus={videoStatus}
                    videoName={videoName}
                    onClose={() => setFloatingMonitorHidden(true)}
                />
            )}

            {/* ── Controller (bottom bar when projecting) ── */}
            {projecting && previewLive && previewSections.length > 0 && (
                <ProjectorController
                    sections={previewSections.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection))}
                    hymnTitle={previewTitle}
                    hymnNumber={previewNumber}
                    onClose={stopProjection}
                    onNavigate={navigateSlide}
                    videoActive={!!videoStatus}
                />
            )}

            {/* ── Context Menu ── */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    hymn={contextMenu.hymn}
                    categories={categories}
                    onClose={() => setContextMenu(null)}
                    onEdit={() => { setContextMenu(null); openEditHymn(contextMenu.hymn.id); }}
                    onDelete={() => { setContextMenu(null); deleteHymnAction(contextMenu.hymn.id); }}
                    onChangeCategory={async (catId) => {
                        setContextMenu(null);
                        requirePassword(async () => {
                            await window.electron.hymn.setCategory(contextMenu.hymn.id, catId);
                            loadHymns();
                            loadCategories();
                        }, 'Schimbare categorie');
                    }}
                />
            )}

            {/* ── Settings Modal ── */}
            {(modalOpen === 'settings' || modalOpen === 'help') && (
                <SettingsModal
                    initialTab={modalOpen === 'help' ? 'help' : 'projection'}
                    onClose={() => setModalOpen(null)}
                    onCategoriesChanged={loadCategories}
                    onHymnsChanged={loadHymns}
                    onChangePassword={() => { setModalOpen(null); setSetPwOpen('change'); }}
                    onForgotPassword={() => { setModalOpen(null); setForgotPwOpen(true); }}
                />
            )}

            {/* ── Hymn Editor Modal ── */}
            {hymnEditor && (
                <HymnEditorModal
                    editor={hymnEditor}
                    onClose={() => setHymnEditor(null)}
                    onSave={async () => {
                        setHymnEditor(null);
                        await loadHymns();
                        await loadCategories();
                    }}
                />
            )}

            {/* ── Password Verification Modal ── */}
            {passwordModal && (
                <PasswordModal
                    title={passwordModal.title}
                    hash={adminPasswordHash ?? ''}
                    onSuccess={() => {
                        passwordModal.action();
                        setPasswordModal(null);
                    }}
                    onCancel={() => setPasswordModal(null)}
                    onForgot={() => { setPasswordModal(null); setForgotPwOpen(true); }}
                />
            )}

            {/* ── First Launch Password Setup ── */}
            {needsPasswordSetup && (
                <PasswordSetupModal
                    onSave={async (pw, church, city, folder) => {
                        const hash = hashPassword(pw);
                        setAdminPasswordHash(hash);
                        const patch: Partial<AppSettings> = {
                            adminPasswordHash: hash, churchName: church, churchCity: city,
                        };
                        if (folder) patch.downloadFolder = folder;
                        await window.electron.settings.set(patch);
                        setNeedsPasswordSetup(false);
                        // înregistrarea instalării — fire-and-forget; offline
                        // reîncearcă singură la următoarea pornire
                        window.electron.registry.submit().catch(() => { });
                    }}
                />
            )}

            {/* ── Instalări existente: completarea bisericii la prima pornire după upgrade ── */}
            {needsChurchInfo && !needsPasswordSetup && (
                <ChurchInfoModal
                    onSave={async (church, city) => {
                        await window.electron.settings.set({ churchName: church, churchCity: city });
                        setNeedsChurchInfo(false);
                        window.electron.registry.submit().catch(() => { });
                    }}
                />
            )}

            {/* ── Parolă uitată: cerere de deblocare + cod dictat telefonic ── */}
            {forgotPwOpen && (
                <ForgotPasswordModal
                    onCancel={() => setForgotPwOpen(false)}
                    onUnlocked={() => {
                        // codul a fost acceptat — parola veche e ștearsă deja în main;
                        // se cere imediat una nouă (dialog fără anulare)
                        setForgotPwOpen(false);
                        setAdminPasswordHash(null);
                        setSetPwOpen('reset');
                    }}
                />
            )}

            {/* ── Parolă nouă (după deblocare) / schimbare parolă (din Setări) ── */}
            {setPwOpen && (
                <SetPasswordModal
                    oldHash={setPwOpen === 'change' ? (adminPasswordHash ?? null) : null}
                    onCancel={setPwOpen === 'change' ? () => setSetPwOpen(null) : undefined}
                    onForgot={() => { setSetPwOpen(null); setForgotPwOpen(true); }}
                    onSave={async (newHash) => {
                        setAdminPasswordHash(newHash);
                        await window.electron.settings.set({ adminPasswordHash: newHash });
                        setSetPwOpen(null);
                    }}
                />
            )}

            {/* ── Toast global (dreapta-jos) ── */}
            <ToastHost />
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sidebar – Categories
// ═════════════════════════════════════════════════════════════════════════════

function SidebarCategories({
    categories, activeCategoryId, onSelect,
}: {
    categories: Category[];
    activeCategoryId?: number;
    onSelect: (id: number | undefined) => void;
}) {
    return (
        <>
            <div className="sidebar-title">Categorii</div>
            <div className="sidebar-list">
                <button
                    className={`sidebar-item ${activeCategoryId === undefined ? 'active' : ''}`}
                    onClick={() => onSelect(undefined)}
                >
                    <span className="dot" />
                    <span>Toate</span>
                </button>
                {categories.map(cat => (
                    <button
                        key={cat.id}
                        className={`sidebar-item ${activeCategoryId === cat.id ? 'active' : ''}`}
                        onClick={() => onSelect(cat.id)}
                    >
                        <span className="dot" />
                        <span className="sidebar-item-name">{cat.name}</span>
                        {cat.hymn_count != null && cat.hymn_count > 0 && (
                            <span className="count">{cat.hymn_count}</span>
                        )}
                    </button>
                ))}
            </div>
        </>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sidebar – Bible Books
// ═════════════════════════════════════════════════════════════════════════════

function SidebarBibleBooks({
    books, selectedBookId, onSelect, onDeselectBook,
}: {
    books: BibleBook[];
    selectedBookId: number | null;
    onSelect: (book: BibleBook) => void;
    onDeselectBook: () => void;
}) {
    const vt = books.filter(b => b.testament === 'VT');
    const nt = books.filter(b => b.testament === 'NT');

    return (
        <>
            <div className="sidebar-title">Cărți</div>
            <div className="sidebar-list">
                <button
                    className={`sidebar-item ${selectedBookId === null ? 'active' : ''}`}
                    onClick={onDeselectBook}
                >
                    <Search className="icon-xs opacity-50" />
                    <span className="sidebar-item-name">Toată Biblia</span>
                </button>
                {vt.length > 0 && (
                    <>
                        <div className="sidebar-group-label">Vechiul Testament</div>
                        {vt.map(book => (
                            <button
                                key={book.id}
                                className={`sidebar-item ${selectedBookId === book.id ? 'active' : ''}`}
                                onClick={() => onSelect(book)}
                            >
                                <span className="sidebar-item-name">{book.name}</span>
                                <span className="count">{book.chapter_count}</span>
                            </button>
                        ))}
                    </>
                )}
                {nt.length > 0 && (
                    <>
                        <div className="sidebar-group-label">Noul Testament</div>
                        {nt.map(book => (
                            <button
                                key={book.id}
                                className={`sidebar-item ${selectedBookId === book.id ? 'active' : ''}`}
                                onClick={() => onSelect(book)}
                            >
                                <span className="sidebar-item-name">{book.name}</span>
                                <span className="count">{book.chapter_count}</span>
                            </button>
                        ))}
                    </>
                )}
            </div>
        </>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sidebar – Video Filter
// ═════════════════════════════════════════════════════════════════════════════

type VideoFilter = 'all' | 'youtube' | 'local';

function SidebarVideoFilter({
    filter, onFilter, youtubePlaylist,
}: {
    filter: VideoFilter;
    onFilter: (f: VideoFilter) => void;
    youtubePlaylist: YouTubeEntry[];
}) {
    const localCount = youtubePlaylist.filter(e => !!(e as any).localUrl).length;
    const ytCount = youtubePlaylist.filter(e => !(e as any).localUrl).length;

    return (
        <>
            <div className="sidebar-title">Categorii Video</div>
            <div className="sidebar-list">
                <button
                    className={`sidebar-item ${filter === 'all' ? 'active' : ''}`}
                    onClick={() => onFilter('all')}
                >
                    <span className="dot" />
                    <span className="sidebar-item-name">Toate</span>
                    {youtubePlaylist.length > 0 && <span className="count">{youtubePlaylist.length}</span>}
                </button>
                <button
                    className={`sidebar-item ${filter === 'youtube' ? 'active' : ''}`}
                    onClick={() => onFilter('youtube')}
                >
                    <span className="dot" />
                    <span className="sidebar-item-name">YouTube</span>
                    {ytCount > 0 && <span className="count">{ytCount}</span>}
                </button>
                <button
                    className={`sidebar-item ${filter === 'local' ? 'active' : ''}`}
                    onClick={() => onFilter('local')}
                >
                    <span className="dot" />
                    <span className="sidebar-item-name">Locale</span>
                    {localCount > 0 && <span className="count">{localCount}</span>}
                </button>
            </div>
        </>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// HymnList
// ═════════════════════════════════════════════════════════════════════════════

function HymnList({
    hymns, categories, activeCategoryId, selectedHymnId, onSelect, onContextMenu, listRef,
}: {
    hymns: Hymn[];
    categories: Category[];
    activeCategoryId?: number;
    selectedHymnId: number | null;
    onSelect: (id: number) => void;
    onContextMenu: (e: React.MouseEvent, hymn: Hymn) => void;
    listRef: React.RefObject<HTMLDivElement>;
}) {
    const catName = activeCategoryId
        ? categories.find(c => c.id === activeCategoryId)?.name ?? 'Toate'
        : 'Toate';

    return (
        <div className="content-inner">
            <div className="content-status">
                {hymns.length} {hymns.length === 1 ? 'imn' : 'imnuri'} în <strong>{catName}</strong>
            </div>
            {hymns.length === 0 ? (
                <div className="empty-state">
                    <Search className="icon-lg opacity-40" />
                    <p>Niciun imn găsit</p>
                </div>
            ) : (
                <div className="hymn-list" ref={listRef}>
                    {hymns.map(hymn => {
                        const snippetLine = getSnippetFirstLine(hymn.snippet);
                        // În „Toate" arătăm din ce colecție face parte fiecare imn —
                        // același titlu poate exista în mai multe colecții.
                        const collectionName = activeCategoryId === undefined && hymn.category_id != null
                            ? categories.find(c => c.id === hymn.category_id)?.name
                            : undefined;
                        return (
                            <div
                                key={hymn.id}
                                data-hymn-id={hymn.id}
                                className={`hymn-item ${selectedHymnId === hymn.id ? 'selected' : ''}`}
                                onClick={() => onSelect(hymn.id)}
                                onContextMenu={e => onContextMenu(e, hymn)}
                            >
                                <span className="hymn-num">{hymn.number}</span>
                                <div className="hymn-info">
                                    <span className="hymn-title">{hymn.title}</span>
                                    {collectionName && <span className="hymn-collection">{collectionName}</span>}
                                    {snippetLine && <span className="hymn-snippet">— {snippetLine}</span>}
                                </div>
                                <button
                                    className="hymn-menu-btn"
                                    title="Opțiuni imn"
                                    aria-label="Opțiuni imn"
                                    onClick={e => { e.stopPropagation(); onContextMenu(e, hymn); }}
                                >
                                    <MoreHorizontal className="icon-xs" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Bible Content Area
// ═════════════════════════════════════════════════════════════════════════════

function BibleContentArea({
    selectedBookId, selectedBookName, selectedChapter, chapters, verses,
    selectedVerseIdx, onSelectChapter, onSelectVerse, onBackToChapters,
}: {
    selectedBookId: number | null;
    selectedBookName: string;
    selectedChapter: number | null;
    chapters: number[];
    verses: BibleVerse[];
    selectedVerseIdx: number;
    onSelectChapter: (ch: number) => void;
    onSelectVerse: (idx: number) => void;
    onBackToChapters: () => void;
}) {
    if (!selectedBookId) {
        return (
            <div className="content-inner">
                <div className="empty-state">
                    <Book className="icon-lg opacity-40" />
                    <p>Selectați o carte din bara laterală</p>
                </div>
            </div>
        );
    }

    return (
        <div className="content-inner bible-split-view">
            <div className="bible-breadcrumb">
                <button className="crumb-btn" onClick={onBackToChapters}>{selectedBookName}</button>
                {selectedChapter && (
                    <>
                        <span className="sep">›</span>
                        <span>Capitolul {selectedChapter}</span>
                    </>
                )}
            </div>

            {/* Chapters section — always visible */}
            <div className={`bible-chapters-section ${selectedChapter ? 'compact' : ''}`}>
                <div className="content-status">{chapters.length} capitole</div>
                <div className="chapter-grid">
                    {chapters.map(ch => (
                        <button
                            key={ch}
                            className={`chapter-btn ${selectedChapter === ch ? 'active' : ''}`}
                            onClick={() => onSelectChapter(ch)}
                        >
                            {ch}
                        </button>
                    ))}
                </div>
            </div>

            {/* Verses section — visible when a chapter is selected */}
            {selectedChapter && (
                <div className="bible-verses-section">
                    <div className="content-status">{verses.length} versete</div>
                    <div className="verse-list">
                        {verses.map((v, i) => (
                            <div
                                key={i}
                                className={`verse-item ${selectedVerseIdx === i ? 'selected' : ''}`}
                                onClick={() => onSelectVerse(i)}
                            >
                                <span className="verse-num">{v.verse}</span>
                                <span className="verse-text">{v.text}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Bible Search Results
// ═════════════════════════════════════════════════════════════════════════════

function BibleSearchResultsList({
    results, selectedIdx, onSelect, searchScope,
}: {
    results: BibleVerse[];
    selectedIdx: number;
    onSelect: (idx: number) => void;
    searchScope?: string;
}) {
    return (
        <div className="content-inner">
            <div className="content-status">
                {results.length} rezultate
                {searchScope
                    ? <span className="search-scope-badge">în {searchScope}</span>
                    : <span className="search-scope-badge">în toată Biblia</span>
                }
            </div>
            {results.length === 0 ? (
                <div className="empty-state"><p>Niciun rezultat</p></div>
            ) : (
                <div className="verse-list">
                    {results.map((v, i) => (
                        <div
                            key={i}
                            className={`verse-item ${selectedIdx === i ? 'selected' : ''}`}
                            onClick={() => onSelect(i)}
                        >
                            <span className="verse-ref">
                                {v.book_name ? `${v.book_name} ${v.chapter}:${v.verse}` : String(v.verse)}
                            </span>
                            <span className="verse-text">{v.text}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Video Controller
// ═════════════════════════════════════════════════════════════════════════════

function formatTime(seconds: number): string {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function VideoController({
    videoName, videoStatus, videoVolume, videoMuted, videoError, videoLoading, videoConverting,
    youtubePlaylist, youtubeProgress, videoFilter,
    onPickFile, onDismissError, onPlay, onPause, onStop,
    onSeek, onVolume, onToggleMute,
    onYoutubeAdd, onYoutubeRemove, onYoutubeDelete, onYoutubePlay, onYoutubeRetry, onYoutubeUpdateTitle,
}: {
    videoName: string;
    videoStatus: { currentTime: number; duration: number; paused: boolean } | null;
    videoVolume: number;
    videoMuted: boolean;
    videoError: string | null;
    videoLoading: boolean;
    videoConverting: boolean;
    youtubePlaylist: YouTubeEntry[];
    youtubeProgress: Record<string, number>;
    videoFilter: VideoFilter;
    onPickFile: () => void;
    onDismissError: () => void;
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    onSeek: (time: number) => void;
    onVolume: (vol: number) => void;
    onToggleMute: () => void;
    onYoutubeAdd: (url: string) => Promise<string | null>;
    onYoutubeRemove: (id: string) => void;
    onYoutubeDelete: (id: string) => void;
    onYoutubePlay: (id: string) => void;
    onYoutubeRetry: (id: string) => void;
    onYoutubeUpdateTitle: (id: string, title: string) => void;
}) {
    const isPlaying = !!videoStatus;
    const isPaused = videoStatus?.paused ?? true;
    const currentTime = videoStatus?.currentTime ?? 0;
    const duration = videoStatus?.duration ?? 0;

    // Scrubbing local: cât tragi, afișăm timpul-țintă (nu currentTime de la 500ms);
    // seek-ul se trimite abia la eliberare (onPointerUp), ca statusul să nu zbată cursorul.
    const [scrub, setScrub] = useState<number | null>(null);
    const scrubCommittedRef = useRef(false);
    const isScrubbing = scrub !== null;
    const displayTime = isScrubbing ? (scrub as number) : currentTime;
    // După eliberare ține ținta până când statusul real o ajunge (evită saltul înapoi de ~500ms).
    useEffect(() => {
        if (scrubCommittedRef.current && scrub !== null && Math.abs(currentTime - scrub) < 0.75) {
            scrubCommittedRef.current = false;
            setScrub(null);
        }
    }, [currentTime, scrub]);

    // YouTube URL input
    const [ytUrl, setYtUrl] = useState('');
    const [ytError, setYtError] = useState('');
    const [ytAdding, setYtAdding] = useState(false);

    // yt-dlp install/update state
    const [ytdlpInstalled, setYtdlpInstalled] = useState<boolean | null>(null);
    const [ytdlpBusy, setYtdlpBusy] = useState(false);

    // Playlist editing state
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState<string | null>(null);
    const [editTitleValue, setEditTitleValue] = useState('');

    // File paths for reveal in folder
    const [filePaths, setFilePaths] = useState<Record<string, string>>({});

    // Load file paths for entries
    useEffect(() => {
        const loadPaths = async () => {
            const paths: Record<string, string> = {};
            for (const entry of youtubePlaylist) {
                if (entry.status === 'ready') {
                    const fp = await window.electron.playlist.getFilePath(entry.id);
                    if (fp) paths[entry.id] = fp;
                }
            }
            setFilePaths(paths);
        };
        loadPaths();
    }, [youtubePlaylist]);

    // Filter playlist
    const filteredPlaylist = useMemo(() => {
        if (videoFilter === 'all') return youtubePlaylist;
        return youtubePlaylist.filter(e => {
            const isLocal = !!(e as any).localUrl;
            return videoFilter === 'local' ? isLocal : !isLocal;
        });
    }, [youtubePlaylist, videoFilter]);

    useEffect(() => {
        (async () => {
            const inst = await window.electron.ytdlp.isInstalled();
            setYtdlpInstalled(inst);
        })();
    }, []);

    const installYtDlp = async () => {
        setYtdlpBusy(true);
        setYtError('');
        try {
            const r = await window.electron.ytdlp.install();
            if (r.success) {
                setYtdlpInstalled(true);
            } else {
                setYtError('Instalare eșuată: ' + (r.error ?? ''));
            }
        } catch (err: any) {
            setYtError(err.message ?? 'Eroare necunoscută');
        }
        setYtdlpBusy(false);
    };

    const updateYtDlp = async () => {
        setYtdlpBusy(true);
        setYtError('');
        try {
            const r = await window.electron.ytdlp.update();
            if (r.success) {
                // updated successfully
            } else {
                setYtError('Actualizare eșuată: ' + (r.error ?? ''));
            }
        } catch (err: any) {
            setYtError(err.message ?? 'Eroare necunoscută');
        }
        setYtdlpBusy(false);
    };

    const addYouTube = async () => {
        if (!ytUrl.trim()) return;
        setYtAdding(true);
        setYtError('');
        const error = await onYoutubeAdd(ytUrl.trim());
        if (error) {
            setYtError(error);
        } else {
            setYtUrl('');
        }
        setYtAdding(false);
    };

    // ── Playing state: show player controls ──
    if (isPlaying && !videoConverting) {
        return (
            <div className="content-inner video-controller">
                <div className="video-player-controls">
                    <div className="video-player-name">
                        <Film className="icon-sm opacity-50" />
                        <span>{videoName}</span>
                        <span className={`video-state-pill ${isPaused ? 'paused' : 'playing'}`}>
                            {isPaused ? '❚❚ PAUZĂ' : '▶ REDARE'}
                        </span>
                    </div>
                    <div className="video-seekbar-container">
                        <span className="video-time">{formatTime(displayTime)}</span>
                        <div className="video-seekbar-wrap">
                            <input
                                type="range"
                                className="video-seekbar"
                                min={0}
                                max={duration || 1}
                                step={0.1}
                                value={displayTime}
                                onPointerDown={(e) => setScrub(Number((e.currentTarget as HTMLInputElement).value))}
                                onChange={(e) => setScrub(Number(e.target.value))}
                                onPointerUp={() => { if (scrub !== null) { onSeek(scrub); scrubCommittedRef.current = true; } }}
                                onKeyUp={() => { if (scrub !== null) { onSeek(scrub); scrubCommittedRef.current = true; } }}
                                onBlur={() => { if (scrub !== null) { onSeek(scrub); scrubCommittedRef.current = true; } }}
                            />
                            {isScrubbing && duration > 0 && (
                                <div
                                    className="video-seek-tooltip"
                                    style={{ left: `${Math.min(100, Math.max(0, ((scrub as number) / (duration || 1)) * 100))}%` }}
                                >
                                    {formatTime(scrub as number)}
                                </div>
                            )}
                        </div>
                        <span className="video-time">{formatTime(duration)}</span>
                    </div>
                    <div className="video-buttons">
                        <button
                            className="video-btn video-btn-main video-btn-labeled"
                            onClick={isPaused ? onPlay : onPause}
                        >
                            {isPaused ? <Play className="icon-sm" /> : <Pause className="icon-sm" />}
                            <span>{isPaused ? 'Redă' : 'Pauză'}</span>
                        </button>
                        <button className="video-btn video-btn-labeled" onClick={onStop}>
                            <Square className="icon-sm" />
                            <span>Oprește</span>
                        </button>
                        <div className="video-volume-group">
                            <button
                                className={`video-btn video-mute-btn ${videoMuted ? 'muted' : ''}`}
                                onClick={onToggleMute}
                                title={videoMuted ? 'Repornește sunetul' : 'Fără sunet'}
                            >
                                {videoMuted ? <VolumeX className="icon-sm" /> : <Volume2 className="icon-sm" />}
                            </button>
                            <input
                                type="range"
                                className="video-volume-slider"
                                min={0}
                                max={1}
                                step={0.05}
                                value={videoMuted ? 0 : videoVolume}
                                onChange={(e) => onVolume(Number(e.target.value))}
                            />
                            <span className="video-volume-pct">{Math.round((videoMuted ? 0 : videoVolume) * 100)}%</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Converting state ──
    if (videoConverting) {
        return (
            <div className="content-inner video-controller">
                <div className="video-dropzone">
                    <div className="video-converting-spinner" />
                    <p className="video-dropzone-title">Se pregătește videoclipul...</p>
                    <p className="video-dropzone-sub">Se optimizează pentru redare fără probleme. Poate dura puțin.</p>
                </div>
            </div>
        );
    }

    // ── Idle / Prepared state ──
    return (
        <div className="content-inner video-controller">
            {videoError && (
                <div className="video-error-banner">
                    <AlertCircle className="icon-sm" />
                    <span className="video-error-text">{videoError}</span>
                    <button className="video-error-action" onClick={onPickFile}>
                        <FolderOpen className="icon-xs" /> Alege din nou fișierul…
                    </button>
                    <button className="video-error-dismiss" onClick={onDismissError} title="Închide">
                        <X className="icon-xs" />
                    </button>
                </div>
            )}

            {/* ── Add sources: two clear, separate zones ── */}
            <div className="video-section">
                <div className="video-section-header">
                    <Film className="icon-sm opacity-60" />
                    <span>Adaugă video în playlist</span>
                </div>

                <div className="video-add-grid">
                    {/* Zone 1 — local file */}
                    <div className="video-add-card">
                        <div className="video-add-card-head">
                            <Upload className="icon-sm" /> Fișier de pe calculator
                        </div>
                        <button className="video-add-btn video-add-btn-local" onClick={onPickFile} disabled={videoLoading}>
                            {videoLoading
                                ? <Loader className="icon-sm animate-spin" />
                                : <FolderOpen className="icon-sm" />}
                            <span>{videoLoading ? 'Se încarcă...' : 'Alege fișier video'}</span>
                        </button>
                        <p className="video-add-hint">Orice format uzual — MP4, MKV, AVI, MOV, WMV… Cele neacceptate se convertesc automat.</p>
                    </div>

                    {/* Zone 2 — YouTube link */}
                    <div className="video-add-card">
                        <div className="video-add-card-head">
                            <Youtube className="icon-sm" /> Link YouTube
                        </div>
                        {ytdlpInstalled === false ? (
                            <>
                                <button className="video-add-btn" onClick={installYtDlp} disabled={ytdlpBusy}>
                                    <Download className="icon-sm" />
                                    <span>{ytdlpBusy ? 'Se instalează...' : 'Instalează yt-dlp'}</span>
                                </button>
                                <p className="video-add-hint">Necesar o singură dată pentru descărcările de pe YouTube.</p>
                            </>
                        ) : (
                            <>
                                <input
                                    type="text"
                                    className="video-youtube-input"
                                    placeholder="Lipește un link YouTube..."
                                    value={ytUrl}
                                    onChange={(e) => setYtUrl(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') addYouTube(); }}
                                />
                                <button className="video-add-btn" onClick={addYouTube} disabled={ytAdding || !ytUrl.trim()}>
                                    {ytAdding ? <Loader className="icon-sm animate-spin" /> : <Plus className="icon-sm" />}
                                    <span>{ytAdding ? 'Se adaugă...' : 'Adaugă în listă'}</span>
                                </button>
                                <p className="video-add-hint">Se descarcă local și rămâne disponibil și fără internet.</p>
                            </>
                        )}
                    </div>
                </div>

                {ytError && <p className="video-youtube-error">{ytError}</p>}
            </div>

            {/* ── Filtered Playlist ── */}
            {filteredPlaylist.length > 0 && (
                <div className="yt-playlist">
                    {filteredPlaylist.map(entry => {
                        const isLocal = !!(entry as any).localUrl;
                        const fp = filePaths[entry.id];
                        const shortPath = fp ? (fp.length > 60 ? '…' + fp.slice(-58) : fp) : '';
                        return (
                            <div key={entry.id} className={`yt-playlist-item yt-status-${entry.status}`}>
                                <div className="yt-playlist-item-top">
                                    <span className={`yt-source-badge ${isLocal ? 'yt-badge-local' : 'yt-badge-yt'}`}>
                                        {isLocal ? 'Local' : 'YT'}
                                    </span>
                                    {editingTitle === entry.id ? (
                                        <input
                                            className="yt-playlist-title-input"
                                            value={editTitleValue}
                                            onChange={(e) => setEditTitleValue(e.target.value)}
                                            onBlur={() => {
                                                onYoutubeUpdateTitle(entry.id, editTitleValue);
                                                setEditingTitle(null);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    onYoutubeUpdateTitle(entry.id, editTitleValue);
                                                    setEditingTitle(null);
                                                }
                                                if (e.key === 'Escape') setEditingTitle(null);
                                            }}
                                            autoFocus
                                        />
                                    ) : (
                                        <span
                                            className="yt-playlist-title"
                                            onDoubleClick={() => {
                                                setEditingTitle(entry.id);
                                                setEditTitleValue(entry.title);
                                            }}
                                            title="Dublu-click pentru a edita titlul"
                                        >
                                            {entry.title}
                                        </span>
                                    )}
                                    <span className={`yt-status-badge yt-badge-${entry.status}`}>
                                        {entry.status === 'downloading' && <Loader className="icon-xs animate-spin" />}
                                        {entry.status === 'ready' && '✓'}
                                        {entry.status === 'error' && <AlertCircle className="icon-xs" />}
                                        <span>
                                            {entry.status === 'downloading' ? `${Math.round(youtubeProgress[entry.id] ?? 0)}%` :
                                                entry.status === 'ready' ? 'Gata' : 'Eroare'}
                                        </span>
                                    </span>
                                </div>

                                {/* File location — clickable to open folder */}
                                {fp && (
                                    <div
                                        className="yt-file-path"
                                        onClick={() => window.electron.playlist.revealInFolder(fp)}
                                        title={`Deschide în ${navigator.platform.includes('Mac') ? 'Finder' : 'Explorer'}: ${fp}`}
                                    >
                                        <FolderOpen className="icon-xs" />
                                        <span>{shortPath}</span>
                                    </div>
                                )}

                                {/* Progress bar for downloading */}
                                {entry.status === 'downloading' && (
                                    <div className="yt-progress-bar">
                                        <div
                                            className="yt-progress-fill"
                                            style={{ width: `${youtubeProgress[entry.id] ?? 0}%` }}
                                        />
                                    </div>
                                )}

                                {/* Error message */}
                                {entry.status === 'error' && entry.error && (
                                    <p className="yt-error-msg">{entry.error}</p>
                                )}

                                {/* Action buttons */}
                                <div className="yt-playlist-actions">
                                    {entry.status === 'ready' && (
                                        <button
                                            className="video-btn video-btn-play yt-play-btn"
                                            onClick={() => onYoutubePlay(entry.id)}
                                            title="Redă"
                                        >
                                            <Play className="icon-sm" /> Redă
                                        </button>
                                    )}
                                    {entry.status === 'error' && !isLocal && (
                                        <button
                                            className="video-btn yt-retry-btn"
                                            onClick={() => onYoutubeRetry(entry.id)}
                                            title="Reîncearcă descărcarea"
                                        >
                                            <RefreshCw className="icon-sm" /> Reîncearcă
                                        </button>
                                    )}

                                    {/* Remove from playlist (always visible) */}
                                    <button
                                        className="video-btn yt-remove-btn"
                                        onClick={() => onYoutubeRemove(entry.id)}
                                        title="Elimină din playlist"
                                    >
                                        <X className="icon-sm" />
                                    </button>

                                    {/* Delete from disk (only for ready non-local entries) */}
                                    {entry.status === 'ready' && !isLocal && (
                                        deleteConfirm === entry.id ? (
                                            <div className="yt-delete-confirm">
                                                <span className="text-white/60 text-xs">Ștergi fișierul de pe disc?</span>
                                                <button
                                                    className="video-btn yt-btn-small yt-btn-danger"
                                                    onClick={() => { onYoutubeDelete(entry.id); setDeleteConfirm(null); }}
                                                >
                                                    Da, șterge
                                                </button>
                                                <button
                                                    className="video-btn yt-btn-small"
                                                    onClick={() => setDeleteConfirm(null)}
                                                >
                                                    Anulează
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                className="video-btn yt-btn-small yt-btn-danger"
                                                onClick={() => setDeleteConfirm(entry.id)}
                                                title="Șterge fișierul de pe disc"
                                            >
                                                <Trash2 className="icon-sm" />
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {filteredPlaylist.length === 0 && !videoLoading && (
                <div className="empty-state" style={{ padding: '2rem 0' }}>
                    <Film className="icon-lg opacity-20" />
                    <p className="text-white/30 text-sm">
                        {youtubePlaylist.length === 0
                            ? 'Playlist-ul este gol. Adaugă un fișier local sau un link YouTube.'
                            : 'Niciun videoclip în această categorie.'}
                    </p>
                </div>
            )}

            {/* yt-dlp update */}
            {ytdlpInstalled && (
                <div className="video-youtube-footer">
                    <button
                        className="video-youtube-update-btn"
                        onClick={updateYtDlp}
                        disabled={ytdlpBusy}
                    >
                        <RefreshCw className={`icon-xs ${ytdlpBusy ? 'animate-spin' : ''}`} />
                        {ytdlpBusy ? 'Se actualizează...' : 'Actualizează yt-dlp'}
                    </button>
                    <p className="video-youtube-disclaimer">
                        Dacă descărcarea eșuează, actualizează yt-dlp.
                    </p>
                </div>
            )}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Monitor de retur video — imaginea LIVE din sală, în interfață, cu confirmarea
// sunetului. Folosit în panoul din dreapta ȘI ca fereastră plutitoare pe Ceas/
// Realtime. Cheie `key={videoUrl}` la montare → element + graf audio proaspete.
// ═════════════════════════════════════════════════════════════════════════════
function VideoReturnMonitor({ videoUrl, videoStatus, videoName, floating = false, enableAudio = true, onClose }: {
    videoUrl: string;
    videoStatus: { currentTime: number; duration: number; paused: boolean } | null;
    videoName: string;
    floating?: boolean;
    enableAudio?: boolean;
    onClose?: () => void;
}) {
    const vRef = useRef<HTMLVideoElement>(null);
    const [vu, setVu] = useState(0);
    const [listenLocal, setListenLocal] = useState(false);
    const audioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);

    // sursa
    useEffect(() => {
        const v = vRef.current; if (!v) return;
        v.src = videoUrl; v.load();
        return () => { v.pause(); v.src = ''; };
    }, [videoUrl]);

    // sincron cu statusul proiecției (același fișier, redat în paralel, mut)
    useEffect(() => {
        const v = vRef.current; if (!v || !videoStatus) return;
        if (videoStatus.paused && !v.paused) v.pause();
        else if (!videoStatus.paused && v.paused) v.play().catch(() => { });
        if (Math.abs(v.currentTime - videoStatus.currentTime) > 1) v.currentTime = videoStatus.currentTime;
    }, [videoStatus]);

    // VU-meter SIGUR: tapează elementul de previzualizare, NU proiecția (a cărei
    // rutare audio e sensibilă pe Windows). Graf: source → analyser (nivel) și
    // source → gain(0) → destinație → tăcere garantată (nu iese sunet în sală).
    // „Ascultă local" ridică gain-ul, doar pentru căști.
    useEffect(() => {
        if (!enableAudio) return;
        const v = vRef.current; if (!v) return;
        let raf = 0, cancelled = false;
        try {
            const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
            const ctx: AudioContext = new Ctx();
            const src = ctx.createMediaElementSource(v);
            const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
            const gain = ctx.createGain(); gain.gain.value = 0;
            src.connect(analyser); src.connect(gain); gain.connect(ctx.destination);
            v.muted = false; // de acum graful controlează ieșirea (gain 0 = mut)
            audioRef.current = { ctx, gain };
            ctx.resume().catch(() => { });
            const buf = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
                if (cancelled) return;
                analyser.getByteTimeDomainData(buf);
                let sum = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
                setVu(Math.min(1, Math.sqrt(sum / buf.length) * 3.2));
                raf = requestAnimationFrame(tick);
            };
            tick();
        } catch { /* deja legat / nesuportat */ }
        return () => {
            cancelled = true; if (raf) cancelAnimationFrame(raf);
            const a = audioRef.current;
            if (a) { try { a.ctx.close(); } catch { /* deja închis */ } audioRef.current = null; }
        };
    }, [enableAudio]);

    const toggleListen = () => {
        const a = audioRef.current; if (!a) return;
        const next = !listenLocal;
        a.gain.gain.value = next ? 0.25 : 0;
        a.ctx.resume().catch(() => { });
        setListenLocal(next);
    };

    const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const paused = videoStatus?.paused ?? true;

    return (
        <div className={`video-monitor ${floating ? 'video-monitor-floating' : ''}`}>
            <div className="video-monitor-head">
                <span className={`video-state-pill ${paused ? 'paused' : 'playing'}`}>{paused ? '❚❚ PAUZĂ' : '▶ REDARE'}</span>
                <span className="video-monitor-name">{videoName}</span>
                {floating && onClose && <button className="video-monitor-close" onClick={onClose} title="Ascunde monitorul"><X className="icon-xs" /></button>}
            </div>
            <video ref={vRef} muted playsInline className="video-monitor-video" />
            <div className="video-monitor-foot">
                <span className="video-monitor-time">
                    {videoStatus ? `${fmt(videoStatus.currentTime)} / ${fmt(videoStatus.duration)}` : 'Se încarcă…'}
                </span>
                {enableAudio && (
                    <div className="video-vu" title="Nivel sunet (din fișier)">
                        <div className="video-vu-fill" style={{ width: `${Math.round(vu * 100)}%` }} />
                    </div>
                )}
            </div>
            <div className="video-monitor-note">
                <span>Aici imaginea e <strong>fără sunet</strong> — sunetul se aude în sală.</span>
                {enableAudio && (
                    <button className={`video-listen-btn ${listenLocal ? 'on' : ''}`} onClick={toggleListen} title="Verificare rapidă cu căști">
                        <Headphones className="icon-xs" /> {listenLocal ? 'Oprește' : 'Ascultă local'}
                    </button>
                )}
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Preview Panel
// ═════════════════════════════════════════════════════════════════════════════

function PreviewPanel({
    previewType, previewSections, previewTitle, previewNumber,
    projecting, projSlideIndex, previewLive,
    onStartProjection, onGoLive, onStopProjection, onClearPreview, onNavigateSlide, onSelectSlide,
    videoUrl, videoStatus, videoName, floatingActive = false,
}: {
    previewType: 'hymn' | 'bible' | null;
    previewSections: { text: string; type: string; label: string }[];
    previewTitle: string;
    previewNumber: string;
    projecting: boolean;
    projSlideIndex: number;
    previewLive: boolean;
    onStartProjection: (startIndex?: number) => void;
    onGoLive: () => void;
    onStopProjection: () => void;
    onClearPreview: () => void;
    onNavigateSlide: (idx: number) => void;
    onSelectSlide: (idx: number) => void;
    videoUrl: string;
    videoStatus: { currentTime: number; duration: number; paused: boolean } | null;
    videoName: string;
    floatingActive?: boolean;
}) {
    const bodyRef = useRef<HTMLDivElement>(null);

    // ── Auto-resize font for preview sections ──
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const body = bodyRef.current;
        if (!body) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        ro.observe(body);
        return () => ro.disconnect();
    }, []);

    const fontSize = useMemo(() => {
        if (!containerWidth || !previewSections.length) return null;
        if (previewType !== 'hymn' && previewType !== 'bible') return null;
        const availWidth = containerWidth - 36; // padding + borders
        if (availWidth <= 0) return null;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const fontFamily = getComputedStyle(document.documentElement).fontFamily || 'sans-serif';
        const baseMeasure = 14;
        ctx.font = `${baseMeasure}px ${fontFamily}`;

        // Find the longest line across ALL sections
        let maxLineWidth = 0;
        for (const sec of previewSections) {
            const lines = sec.text.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const w = ctx.measureText(line).width;
                if (w > maxLineWidth) maxLineWidth = w;
            }
        }
        if (maxLineWidth <= 0) return null;

        const scale = availWidth / maxLineWidth;
        const ideal = baseMeasure * scale;
        // Hymns: clamp 9-22px | Bible: clamp 12-28px (single verse, allow larger)
        if (previewType === 'bible') {
            return Math.min(Math.max(ideal, 12), 28);
        }
        return Math.min(Math.max(ideal, 9), 22);
    }, [containerWidth, previewSections, previewType]);

    // Scroll current/selected slide into view
    useEffect(() => {
        if (bodyRef.current) {
            const cur = bodyRef.current.querySelector('.preview-section.current, .preview-section.selected');
            if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [projSlideIndex, projecting]);

    // If video is active, show the return monitor (imagine live + confirmare sunet).
    // enableAudio=false când fereastra plutitoare e activă pe alt tab (ea preia VU-ul),
    // ca să nu ruleze două grafuri audio pe același fișier.
    if (videoUrl) {
        return (
            <div className="preview-panel projecting">
                <VideoReturnMonitor
                    videoUrl={videoUrl}
                    videoStatus={videoStatus}
                    videoName={videoName}
                    enableAudio={!floatingActive}
                />
            </div>
        );
    }

    if (!previewType || !previewSections.length) {
        return (
            <div className="preview-panel empty">
                <div className="preview-header">
                    <span className="label">Previzualizare</span>
                </div>
                <div className="preview-body">
                    <div className="preview-empty">
                        <Monitor className="icon-lg opacity-20" />
                        <p>Selectați un imn sau un pasaj biblic</p>
                        <div className="preview-shortcuts">
                            <div><kbd>Enter</kbd> previzualizare → <kbd>Enter</kbd> proiecție</div>
                            <div><kbd>↑↓</kbd> navighează versete / imnuri</div>
                            <div><kbd>Esc</kbd> oprește / curăță</div>
                            <div><kbd>/</kbd> caută rapid</div>
                            <div>ex: <em>deu 12 12</em>, <em>ps 23</em>, <em>gen 1:3</em></div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`preview-panel ${projecting ? (previewLive ? 'projecting' : 'staged') : ''}`}>
            <div className="preview-header">
                <span className="label">{projecting ? (previewLive ? '● LIVE' : '◐ PREGĂTIT') : 'Previzualizare'}</span>
                <span className="title">
                    {previewNumber ? `${previewNumber}. ` : ''}{previewTitle}
                </span>
                <span className="slide-counter">{projSlideIndex + 1}/{previewSections.length}</span>
            </div>
            <div className="preview-body" ref={bodyRef}>
                {previewSections.map((sec, i) => {
                    let cls = 'preview-section clickable';
                    if (projecting && i === projSlideIndex) cls += ' current';
                    else if (!projecting && i === projSlideIndex) cls += ' selected';
                    if (projecting && i === projSlideIndex + 1) cls += ' next';

                    return (
                        <div
                            key={i}
                            className={cls}
                            onClick={() => {
                                if (projecting && previewLive) {
                                    onNavigateSlide(i);
                                } else {
                                    // Neproiectat SAU pregătit: click doar selectează secțiunea
                                    onSelectSlide(i);
                                }
                            }}
                            onDoubleClick={() => {
                                if (!projecting) {
                                    onStartProjection(i);
                                } else if (!previewLive) {
                                    onGoLive();
                                }
                            }}
                        >
                            <div className={`sec-label ${sec.type}`}>{sec.label}</div>
                            <div className="sec-text" style={fontSize ? { fontSize: `${fontSize}px` } : undefined}>{sec.text}</div>
                        </div>
                    );
                })}
            </div>
            <div className="preview-actions">
                {projecting && previewLive ? (
                    <>
                        <button className="btn-stop" onClick={onStopProjection}>
                            <Square className="icon-xs" /> Oprește
                        </button>
                        <div className="nav-btns">
                            <button className="btn-nav" onClick={() => onNavigateSlide(projSlideIndex - 1)} disabled={projSlideIndex <= -1}>
                                <ChevronLeft className="icon-xs" />
                            </button>
                            <button className="btn-nav" onClick={() => onNavigateSlide(projSlideIndex + 1)} disabled={projSlideIndex >= previewSections.length - 1}>
                                <ChevronRight className="icon-xs" />
                            </button>
                        </div>
                    </>
                ) : projecting ? (
                    <>
                        <button className="btn-project" onClick={onGoLive}>
                            <Play className="icon-xs" /> Proiectează
                        </button>
                        <span className="staged-hint">pregătit — Enter</span>
                        <button className="btn-clear" onClick={onStopProjection}>
                            <Square className="icon-xs" /> Oprește
                        </button>
                    </>
                ) : (
                    <>
                        <button className="btn-project" onClick={() => onStartProjection(projSlideIndex)}>
                            <Play className="icon-xs" /> Proiectează
                        </button>
                        <button className="btn-clear" onClick={onClearPreview}>
                            <X className="icon-xs" /> Curăță
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Context Menu
// ═════════════════════════════════════════════════════════════════════════════

function ContextMenu({
    x, y, hymn, categories, onEdit, onDelete, onChangeCategory,
}: {
    x: number;
    y: number;
    hymn: Hymn;
    categories: Category[];
    onClose: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onChangeCategory: (catId?: number) => void;
}) {
    const [showCategories, setShowCategories] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Adjust position if menu goes off-screen
    const style: React.CSSProperties = {
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 250),
        zIndex: 1000,
    };

    return (
        <div className="context-menu" style={style} ref={menuRef} onClick={e => e.stopPropagation()}>
            <div className="context-menu-header">
                <span className="context-hymn-num">{hymn.number}</span>
                <span className="context-hymn-title">{hymn.title}</span>
            </div>
            <button className="context-item" onClick={onEdit}>
                <Edit3 className="icon-xs" /> Editează
            </button>
            <button className="context-item" onClick={() => setShowCategories(!showCategories)}>
                <FolderOpen className="icon-xs" /> Schimbă categoria
                <ChevronRight className="icon-xs ml-auto" />
            </button>
            {showCategories && (
                <div className="context-submenu">
                    {categories.map(cat => (
                        <button
                            key={cat.id}
                            className={`context-subitem ${hymn.category_id === cat.id ? 'active' : ''}`}
                            onClick={() => onChangeCategory(cat.id)}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>
            )}
            <div className="context-divider" />
            <button className="context-item danger" onClick={onDelete}>
                <Trash2 className="icon-xs" /> Șterge
            </button>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Hymn Editor Modal (Add / Edit)
// ═════════════════════════════════════════════════════════════════════════════

function HymnEditorModal({
    editor, onClose, onSave,
}: {
    editor: {
        mode: 'add' | 'edit';
        hymnId?: number;
        number: string;
        title: string;
        sections: { type: 'strofa' | 'refren'; text: string }[];
        categoryId?: number;
    };
    onClose: () => void;
    onSave: () => void;
}) {
    const [number, setNumber] = useState(editor.number);
    const [title, setTitle] = useState(editor.title);
    const [sections, setSections] = useState(editor.sections.length > 0
        ? editor.sections
        : [{ type: 'strofa' as const, text: '' }]);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [importing, setImporting] = useState(false);
    // Închidem pe click pe fundal DOAR dacă apăsarea a început tot pe fundal.
    // Altfel, o selecție de text cu mouse-ul (mousedown în textarea, mouseup pe
    // fundal) genera un „click" pe overlay și închidea editorul, pierzând tot.
    const overlayMouseDownOnSelf = useRef(false);

    const addSection = (type: 'strofa' | 'refren') => {
        setSections([...sections, { type, text: '' }]);
    };

    const updateSection = (idx: number, field: 'type' | 'text', value: string) => {
        const updated = [...sections];
        if (field === 'type') updated[idx] = { ...updated[idx], type: value as 'strofa' | 'refren' };
        else updated[idx] = { ...updated[idx], text: value };
        setSections(updated);
    };

    const removeSection = (idx: number) => {
        if (sections.length <= 1) return;
        setSections(sections.filter((_, i) => i !== idx));
    };

    const moveSection = (idx: number, dir: -1 | 1) => {
        const target = idx + dir;
        if (target < 0 || target >= sections.length) return;
        const updated = [...sections];
        [updated[idx], updated[target]] = [updated[target], updated[idx]];
        setSections(updated);
    };

    const handleSave = async () => {
        setError('');
        if (!number.trim()) { setError('Numărul este obligatoriu.'); return; }
        if (!title.trim()) { setError('Titlul este obligatoriu.'); return; }
        const validSections = sections.filter(s => s.text.trim());
        if (validSections.length === 0) { setError('Adaugă cel puțin o secțiune cu text.'); return; }

        setSaving(true);
        try {
            if (editor.mode === 'add') {
                await window.electron.db.createHymnWithSections({
                    number: number.trim(),
                    title: title.trim(),
                    categoryId: editor.categoryId,
                    sections: validSections,
                });
            } else if (editor.hymnId) {
                await window.electron.db.updateHymnWithSections(editor.hymnId, {
                    number: number.trim(),
                    title: title.trim(),
                    sections: validSections,
                });
            }
            showToast(`Imn salvat: ${number.trim()} — ${title.trim()}`);
            onSave();
        } catch (err: any) {
            setError(err?.message ?? 'Eroare la salvare');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="modal-overlay"
            onMouseDown={e => { overlayMouseDownOnSelf.current = e.target === e.currentTarget; }}
            onClick={e => {
                if (e.target === e.currentTarget && overlayMouseDownOnSelf.current) onClose();
                overlayMouseDownOnSelf.current = false;
            }}
        >
            <div className="modal-dialog modal-wide">
                <div className="modal-header">
                    <h3>{editor.mode === 'add' ? 'Adaugă Imn' : 'Editează Imn'}</h3>
                    <button className="modal-close" onClick={onClose}><X className="icon-sm" /></button>
                </div>
                <div className="modal-body">
                    <div className="hymn-editor">
                        {editor.mode === 'add' && (
                            <div className="field">
                                <button
                                    className="btn-sm"
                                    disabled={importing}
                                    onClick={async () => {
                                        setError('');
                                        const file = await window.electron.presentation.pickFile();
                                        if (!file) return;
                                        setImporting(true);
                                        try {
                                            const res = await window.electron.presentation.parseHymn(file);
                                            if (res.ok) {
                                                // precompletăm — userul revizuiește/corectează,
                                                // imnul se salvează DOAR la „Salvează"
                                                setNumber(res.data.number || '');
                                                setTitle(res.data.title || '');
                                                if (res.data.sections.length > 0) setSections(res.data.sections);
                                            } else {
                                                setError(res.error);
                                            }
                                        } finally {
                                            setImporting(false);
                                        }
                                    }}
                                >
                                    {importing ? 'Se citește prezentarea...' : 'Din PowerPoint... (precompletează din .ppt/.pptx)'}
                                </button>
                            </div>
                        )}
                        <div className="editor-row">
                            <div className="field">
                                <label>Număr</label>
                                <input
                                    type="text"
                                    className="editor-input"
                                    value={number}
                                    onChange={e => setNumber(e.target.value)}
                                    placeholder="001"
                                />
                            </div>
                            <div className="field" style={{ flex: 1 }}>
                                <label>Titlu</label>
                                <input
                                    type="text"
                                    className="editor-input"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    placeholder="Titlul imnului..."
                                />
                            </div>
                        </div>

                        <div className="editor-sections-label">Secțiuni</div>
                        {sections.map((sec, i) => (
                            <div key={i} className="editor-section">
                                <div className="editor-section-header">
                                    <select
                                        value={sec.type}
                                        onChange={e => updateSection(i, 'type', e.target.value)}
                                        className="editor-select"
                                    >
                                        <option value="strofa">Strofa</option>
                                        <option value="refren">Refren</option>
                                    </select>
                                    <div className="editor-section-actions">
                                        <button
                                            className="btn-sm"
                                            onClick={() => moveSection(i, -1)}
                                            disabled={i === 0}
                                            title="Mută mai sus"
                                            aria-label="Mută mai sus"
                                        >
                                            <ChevronUp className="icon-xs" />
                                        </button>
                                        <button
                                            className="btn-sm"
                                            onClick={() => moveSection(i, 1)}
                                            disabled={i === sections.length - 1}
                                            title="Mută mai jos"
                                            aria-label="Mută mai jos"
                                        >
                                            <ChevronDown className="icon-xs" />
                                        </button>
                                        <button
                                            className="btn-sm danger"
                                            onClick={() => removeSection(i)}
                                            disabled={sections.length <= 1}
                                            title="Șterge secțiunea"
                                            aria-label="Șterge secțiunea"
                                        >
                                            <X className="icon-xs" />
                                        </button>
                                    </div>
                                </div>
                                <textarea
                                    className="editor-textarea"
                                    value={sec.text}
                                    onChange={e => updateSection(i, 'text', e.target.value)}
                                    placeholder="Textul secțiunii..."
                                    rows={4}
                                />
                            </div>
                        ))}

                        <div className="editor-add-btns">
                            <button className="btn-sm" onClick={() => addSection('strofa')}>
                                <Plus className="icon-xs" /> Strofa
                            </button>
                            <button className="btn-sm" onClick={() => addSection('refren')}>
                                <Plus className="icon-xs" /> Refren
                            </button>
                        </div>

                        {error && <div className="editor-error">{error}</div>}

                        <div className="editor-actions">
                            <button className="btn-project" onClick={handleSave} disabled={saving}>
                                {saving ? 'Se salvează...' : 'Salvează'}
                            </button>
                            <button className="btn-clear" onClick={onClose}>Anulează</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Password Modal
// ═════════════════════════════════════════════════════════════════════════════

// Buton + text scurt de recuperare a parolei, afișat în TOATE prompturile care
// cer parola existentă (gate de acțiune + schimbare). Recuperarea cere oricum un
// cod telefonic de la autori, deci e benign să fie mereu vizibil.
function ForgotPasswordHint({ onForgot }: { onForgot: () => void }) {
    return (
        <div className="forgot-hint">
            <button type="button" className="btn-link-forgot" onClick={onForgot}>
                Am uitat parola
            </button>
            <span className="forgot-hint-text">
                O poți reseta acum, cu un cod primit telefonic de la autori.
            </span>
        </div>
    );
}

function PasswordModal({
    title, hash, onSuccess, onCancel, onForgot,
}: {
    title: string;
    hash: string;
    onSuccess: () => void;
    onCancel: () => void;
    onForgot: () => void;
}) {
    const [pw, setPw] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleSubmit = () => {
        if (checkPassword(pw, hash)) {
            onSuccess();
        } else {
            setError('Parolă incorectă');
            setPw('');
        }
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
            <div className="modal-dialog modal-sm">
                <div className="modal-header">
                    <h3><Lock className="icon-sm" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />{title}</h3>
                    <button className="modal-close" onClick={onCancel}><X className="icon-sm" /></button>
                </div>
                <div className="modal-body">
                    <div className="field">
                        <label>Introduceți parola de admin:</label>
                        <input
                            ref={inputRef}
                            type="password"
                            className="editor-input"
                            value={pw}
                            onChange={e => { setPw(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                            placeholder="Parola..."
                        />
                    </div>
                    {error && <div className="editor-error">{error}</div>}
                    <ForgotPasswordHint onForgot={onForgot} />
                    <div className="editor-actions" style={{ marginTop: 12 }}>
                        <button className="btn-project" onClick={handleSubmit}>Confirmă</button>
                        <button className="btn-clear" onClick={onCancel}>Anulează</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Password Setup Modal (first launch)
// ═════════════════════════════════════════════════════════════════════════════

function PasswordSetupModal({ onSave }: {
    onSave: (pw: string, church: string, city: string, downloadFolder?: string) => void;
}) {
    const [pw, setPw] = useState('');
    const [confirm, setConfirm] = useState('');
    const [church, setChurch] = useState('');
    const [city, setCity] = useState('');
    const [downloadFolder, setDownloadFolder] = useState('');
    const [defaultFolder, setDefaultFolder] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => {
        window.electron.playlist.getDownloadFolder().then(f => {
            setDefaultFolder(f);
            setDownloadFolder(f);
        });
        // resetare de parolă întreruptă / reinstalare: biserica e deja cunoscută
        window.electron.settings.get().then(s => {
            if (s.churchName) setChurch(s.churchName);
            if (s.churchCity) setCity(s.churchCity);
        });
    }, []);

    const handleSave = () => {
        if (pw.length < 4) { setError('Parola trebuie să aibă cel puțin 4 caractere.'); return; }
        if (pw !== confirm) { setError('Parolele nu se potrivesc.'); return; }
        if (!church.trim()) { setError('Completează numele bisericii.'); return; }
        if (!city.trim()) { setError('Completează localitatea.'); return; }
        if (!downloadFolder) { setError('Selectează un folder pentru descărcări video.'); return; }
        onSave(pw, church.trim(), city.trim(), downloadFolder !== defaultFolder ? downloadFolder : undefined);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-dialog modal-sm">
                <div className="modal-header">
                    <h3><Lock className="icon-sm" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Configurare Inițială</h3>
                </div>
                <div className="modal-body">
                    <p className="setup-hint">
                        Bine ai venit în AdventShow! Configurează parola de administrare și folderul pentru videoclipuri descărcate.
                    </p>
                    <p className="setup-hint setup-hint-pw">
                        Parola protejează acțiunile care pot strica baza de imnuri sau șabloanele
                        — ți se va cere la: <b>adăugarea, editarea sau ștergerea imnurilor</b>,
                        <b>mutarea unui imn în altă categorie</b>, <b>importurile în baza de date</b>
                        (PPT în masă sau backup JSON) și <b>ștergerea ori suprascrierea șabloanelor</b>.
                        Proiecția și folosirea de zi cu zi nu cer niciodată parola.
                        Dacă o uiți, o poți recupera oricând — butonul <b>„Am uitat parola"</b> apare
                        la fiecare cerere de parolă; primești un cod telefonic de la autori.
                    </p>
                    <div className="field">
                        <label>Parolă admin</label>
                        <input
                            ref={inputRef}
                            type="password"
                            className="editor-input"
                            value={pw}
                            onChange={e => { setPw(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') document.getElementById('confirm-pw')?.focus(); }}
                            placeholder="Minim 4 caractere..."
                        />
                    </div>
                    <div className="field">
                        <label>Confirmă parola</label>
                        <input
                            id="confirm-pw"
                            type="password"
                            className="editor-input"
                            value={confirm}
                            onChange={e => { setConfirm(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                            placeholder="Repetă parola..."
                        />
                    </div>
                    <div className="field" style={{ marginTop: 8 }}>
                        <label>Biserica</label>
                        <input
                            type="text"
                            className="editor-input"
                            value={church}
                            onChange={e => { setChurch(e.target.value); setError(''); }}
                            placeholder="ex: Biserica Adventistă Speranța"
                        />
                    </div>
                    <div className="field">
                        <label>Localitatea</label>
                        <input
                            type="text"
                            className="editor-input"
                            value={city}
                            onChange={e => { setCity(e.target.value); setError(''); }}
                            placeholder="ex: Cluj-Napoca"
                        />
                    </div>
                    <p className="text-white/40 text-xs mt-1">
                        Biserica și localitatea se trimit autorilor pentru evidența instalărilor
                        și pentru ajutor la recuperarea parolei. Nu se trimit alte date.
                    </p>
                    <div className="field" style={{ marginTop: 8 }}>
                        <label>Folder descărcări video</label>
                        <div className="field-row">
                            <span className="field-value" title={downloadFolder}>
                                {downloadFolder ? downloadFolder.split('/').slice(-2).join('/') : 'Se detectează...'}
                            </span>
                            <button className="btn-sm" onClick={async () => {
                                const p = await window.electron.dialog.selectFolder();
                                if (p) setDownloadFolder(p);
                            }}>Schimbă...</button>
                        </div>
                        <p className="text-white/40 text-xs mt-1">
                            Aici se vor salva videoclipurile descărcate de pe YouTube.
                        </p>
                    </div>
                    {error && <div className="editor-error">{error}</div>}
                    <div className="editor-actions" style={{ marginTop: 12 }}>
                        <button className="btn-project" onClick={handleSave}>Salvează</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Church Info Modal — instalările existente (de dinainte de registru) își
// completează biserica + localitatea la prima pornire după upgrade
// ═════════════════════════════════════════════════════════════════════════════

function ChurchInfoModal({ onSave }: { onSave: (church: string, city: string) => void }) {
    const [church, setChurch] = useState('');
    const [city, setCity] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleSave = () => {
        if (!church.trim()) { setError('Completează numele bisericii.'); return; }
        if (!city.trim()) { setError('Completează localitatea.'); return; }
        onSave(church.trim(), city.trim());
    };

    return (
        <div className="modal-overlay">
            <div className="modal-dialog modal-sm">
                <div className="modal-header">
                    <h3>Despre instalarea ta</h3>
                </div>
                <div className="modal-body">
                    <p className="setup-hint">
                        AdventShow ține acum o evidență a bisericilor unde e instalat — ca autorii
                        să știe pe cine ajută aplicația și ca să te poată sprijini la recuperarea
                        parolei. Completează o singură dată:
                    </p>
                    <div className="field">
                        <label>Biserica</label>
                        <input
                            ref={inputRef}
                            type="text"
                            className="editor-input"
                            value={church}
                            onChange={e => { setChurch(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') document.getElementById('church-city')?.focus(); }}
                            placeholder="ex: Biserica Adventistă Speranța"
                        />
                    </div>
                    <div className="field">
                        <label>Localitatea</label>
                        <input
                            id="church-city"
                            type="text"
                            className="editor-input"
                            value={city}
                            onChange={e => { setCity(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                            placeholder="ex: Cluj-Napoca"
                        />
                    </div>
                    <p className="text-white/40 text-xs mt-1">
                        Se trimit doar aceste două câmpuri și versiunea aplicației. Nimic altceva.
                    </p>
                    {error && <div className="editor-error">{error}</div>}
                    <div className="editor-actions" style={{ marginTop: 12 }}>
                        <button className="btn-project" onClick={handleSave}>Salvează</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Feedback — o problemă sau o sugestie, trimisă direct autorilor
//
// Regula, învățată din ghidul hangar: dacă trimiterea eșuează, dialogul NU se
// închide și textul NU se pierde. Un feedback pierdut pentru că omul era offline
// e un feedback care nu mai vine niciodată.
// ═════════════════════════════════════════════════════════════════════════════

function FeedbackModal({ initialKind, onClose, onSent }: {
    initialKind: 'bug' | 'suggestion';
    onClose: () => void;
    onSent: (msg: string) => void;
}) {
    const [kind, setKind] = useState<'bug' | 'suggestion'>(initialKind);
    const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [contact, setContact] = useState('');
    const [attachLog, setAttachLog] = useState(true);
    const [showLog, setShowLog] = useState(false);
    const [logPreview, setLogPreview] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const send = async () => {
        if (!subject.trim()) { setError('Scrieți pe scurt despre ce e vorba.'); return; }
        if (!body.trim()) { setError('Adăugați câteva detalii — ce ați făcut și ce s-a întâmplat.'); return; }
        setBusy(true);
        setError('');
        const res = await window.electron.feedback.send({
            kind,
            subject: subject.trim(),
            body: body.trim(),
            severity: kind === 'bug' ? severity : undefined,
            contact: contact.trim() || undefined,
            attachLog,
        });
        setBusy(false);
        if (res.ok) {
            onSent('Mulțumim! Mesajul a ajuns la autori.');
            onClose();
            return;
        }
        // Textul rămâne pe ecran, indiferent de motiv.
        setError(res.message);
    };

    const toggleLogPreview = async () => {
        if (!showLog && !logPreview) setLogPreview(await window.electron.feedback.logPreview());
        setShowLog(!showLog);
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-dialog modal-sm">
                <div className="modal-header">
                    <h3>{kind === 'bug' ? 'Raportează o problemă' : 'Sugerează o îmbunătățire'}</h3>
                    <button className="modal-close" onClick={onClose}><X className="icon-sm" /></button>
                </div>
                <div className="modal-body">
                    <div className="field">
                        <label>Tip</label>
                        <select className="timer-text-input" value={kind}
                            onChange={e => setKind(e.target.value as 'bug' | 'suggestion')}>
                            <option value="bug">Problemă (ceva nu merge)</option>
                            <option value="suggestion">Sugestie (ceva ar merge mai bine)</option>
                        </select>
                    </div>
                    {kind === 'bug' && (
                        <div className="field">
                            <label>Cât de grav e</label>
                            <select className="timer-text-input" value={severity}
                                onChange={e => setSeverity(e.target.value as typeof severity)}>
                                <option value="low">Mic — mă încurcă, dar merge</option>
                                <option value="medium">Mediu — trebuie să ocolesc problema</option>
                                <option value="high">Mare — nu pot folosi o funcție</option>
                                <option value="critical">Critic — nu pot ține serviciul</option>
                            </select>
                        </div>
                    )}
                    <div className="field">
                        <label>Pe scurt</label>
                        <input ref={inputRef} type="text" className="timer-text-input" maxLength={200}
                            value={subject} onChange={e => { setSubject(e.target.value); setError(''); }}
                            placeholder={kind === 'bug'
                                ? 'ex: proiecția rămâne neagră la al doilea imn'
                                : 'ex: căutare după primul vers, nu doar după titlu'} />
                    </div>
                    <div className="field">
                        <label>Detalii</label>
                        <textarea className="timer-text-input" rows={6} maxLength={20000}
                            value={body} onChange={e => { setBody(e.target.value); setError(''); }}
                            placeholder={kind === 'bug'
                                ? 'Ce ați făcut, ce ați așteptat să se întâmple și ce s-a întâmplat de fapt.'
                                : 'Ce ați vrea să puteți face și de ce v-ar ajuta.'} />
                    </div>
                    <div className="field">
                        <label>Cum vă putem contacta (opțional)</label>
                        <input type="text" className="timer-text-input" maxLength={120}
                            value={contact} onChange={e => setContact(e.target.value)}
                            placeholder="telefon sau e-mail, dacă vreți răspuns" />
                    </div>
                    <label className="flex items-center gap-2 text-white/70 text-xs mt-1 cursor-pointer">
                        <input type="checkbox" checked={attachLog}
                            onChange={e => setAttachLog(e.target.checked)} />
                        Atașează ultimele 200 de linii din jurnalul aplicației
                        <button type="button" className="underline opacity-60" onClick={toggleLogPreview}>
                            {showLog ? 'ascunde' : 'vezi ce se trimite'}
                        </button>
                    </label>
                    {showLog && (
                        <pre className="text-white/50 text-[10px] mt-2 p-2 rounded bg-black/40 max-h-40 overflow-auto whitespace-pre-wrap">
                            {logPreview || '(jurnalul e gol — depanarea nu e pornită)'}
                        </pre>
                    )}
                    {error && <div className="editor-error">{error}</div>}
                    <div className="editor-actions" style={{ marginTop: 12 }}>
                        <button className="btn-clear" onClick={onClose} disabled={busy}>Renunță</button>
                        <button className="btn-project" onClick={send} disabled={busy}>
                            {busy ? 'Se trimite…' : 'Trimite'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Parolă uitată — cerere de deblocare prin formular + cod dictat telefonic
// ═════════════════════════════════════════════════════════════════════════════

function ForgotPasswordModal({ onUnlocked, onCancel }: {
    onUnlocked: () => void;
    onCancel: () => void;
}) {
    const [phone, setPhone] = useState('');
    const [requestCode, setRequestCode] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, [requestCode]);

    const sendRequest = async () => {
        const digits = phone.replace(/\D/g, '');
        if (digits.length < 7) {
            setError('Număr de telefon invalid — introduceți un număr real la care puteți fi sunat (codul se dictează telefonic).');
            return;
        }
        setBusy(true);
        setError('');
        const res = await window.electron.registry.unlockRequest(phone.trim());
        setBusy(false);
        if (res.ok && res.requestCode) {
            setRequestCode(res.requestCode);
        } else {
            setError(res.error ?? 'Cererea nu a putut fi trimisă.');
        }
    };

    const verify = async () => {
        if (!code.trim()) { setError('Introduceți codul de deblocare primit.'); return; }
        setBusy(true);
        setError('');
        const ok = await window.electron.registry.unlockVerify(code.trim());
        setBusy(false);
        if (ok) {
            onUnlocked();
        } else {
            setError('Cod incorect sau expirat. Verificați și reîncercați.');
            setCode('');
        }
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
            <div className="modal-dialog modal-sm">
                <div className="modal-header">
                    <h3><Lock className="icon-sm" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Recuperare parolă</h3>
                    <button className="modal-close" onClick={onCancel}><X className="icon-sm" /></button>
                </div>
                <div className="modal-body">
                    {!requestCode ? (
                        <>
                            <p className="setup-hint">
                                Aplicația trimite o cerere către autorii AdventShow. Vei fi contactat
                                la numărul de mai jos și vei primi un cod de deblocare.
                            </p>
                            <div className="field">
                                <label>Telefonul tău</label>
                                <input
                                    ref={inputRef}
                                    type="tel"
                                    className="editor-input"
                                    value={phone}
                                    onChange={e => { setPhone(e.target.value); setError(''); }}
                                    onKeyDown={e => { if (e.key === 'Enter') sendRequest(); }}
                                    placeholder="ex: 07xx xxx xxx"
                                />
                            </div>
                            {error && <div className="editor-error">{error}</div>}
                            <div className="editor-actions" style={{ marginTop: 12 }}>
                                <button className="btn-project" onClick={sendRequest} disabled={busy}>
                                    {busy ? 'Se trimite...' : 'Trimite cererea'}
                                </button>
                                <button className="btn-clear" onClick={onCancel}>Anulează</button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="setup-hint">
                                Cererea a fost trimisă. Dacă nu ești contactat curând, sună tu autorii
                                și comunică-le <b>codul cererii</b>:
                            </p>
                            <div className="unlock-request-code">{requestCode}</div>
                            <div className="field" style={{ marginTop: 10 }}>
                                <label>Codul de deblocare primit</label>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    className="editor-input"
                                    value={code}
                                    onChange={e => { setCode(e.target.value); setError(''); }}
                                    onKeyDown={e => { if (e.key === 'Enter') verify(); }}
                                    placeholder="ex: ABCD-2345"
                                    autoCapitalize="characters"
                                />
                            </div>
                            <p className="text-white/40 text-xs mt-1">
                                Codul e valabil 7 zile și poate fi folosit o singură dată.
                            </p>
                            {error && <div className="editor-error">{error}</div>}
                            <div className="editor-actions" style={{ marginTop: 12 }}>
                                <button className="btn-project" onClick={verify} disabled={busy}>
                                    {busy ? 'Se verifică...' : 'Deblochează'}
                                </button>
                                <button className="btn-clear" onClick={onCancel}>Anulează</button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Setare parolă nouă — după deblocare (fără parola veche) sau din Setări (cu ea)
// ═════════════════════════════════════════════════════════════════════════════

function SetPasswordModal({ oldHash, onSave, onCancel, onForgot }: {
    oldHash: string | null;        // null = resetare (nu se cere parola veche)
    onSave: (newHash: string) => void;
    onCancel?: () => void;         // absent = nu se poate închide (după deblocare)
    onForgot?: () => void;         // recuperare parolă (doar în modul „schimbă")
}) {
    const [oldPw, setOldPw] = useState('');
    const [pw, setPw] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleSave = () => {
        if (oldHash && !checkPassword(oldPw, oldHash)) { setError('Parola actuală e incorectă.'); setOldPw(''); return; }
        if (pw.length < 4) { setError('Parola trebuie să aibă cel puțin 4 caractere.'); return; }
        if (pw !== confirm) { setError('Parolele nu se potrivesc.'); return; }
        onSave(hashPassword(pw));
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && onCancel) onCancel(); }}>
            <div className="modal-dialog modal-sm">
                <div className="modal-header">
                    <h3><Lock className="icon-sm" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                        {oldHash ? 'Schimbă parola' : 'Setează parola nouă'}</h3>
                    {onCancel && <button className="modal-close" onClick={onCancel}><X className="icon-sm" /></button>}
                </div>
                <div className="modal-body">
                    {!oldHash && (
                        <p className="setup-hint">
                            Deblocare reușită — alege acum o parolă nouă de administrare.
                        </p>
                    )}
                    {oldHash && (
                        <div className="field">
                            <label>Parola actuală</label>
                            <input
                                ref={inputRef}
                                type="password"
                                className="editor-input"
                                value={oldPw}
                                onChange={e => { setOldPw(e.target.value); setError(''); }}
                                onKeyDown={e => { if (e.key === 'Enter') document.getElementById('new-pw')?.focus(); }}
                                placeholder="Parola curentă..."
                            />
                        </div>
                    )}
                    <div className="field">
                        <label>Parola nouă</label>
                        <input
                            id="new-pw"
                            ref={oldHash ? undefined : inputRef}
                            type="password"
                            className="editor-input"
                            value={pw}
                            onChange={e => { setPw(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') document.getElementById('new-pw-confirm')?.focus(); }}
                            placeholder="Minim 4 caractere..."
                        />
                    </div>
                    <div className="field">
                        <label>Confirmă parola nouă</label>
                        <input
                            id="new-pw-confirm"
                            type="password"
                            className="editor-input"
                            value={confirm}
                            onChange={e => { setConfirm(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                            placeholder="Repetă parola..."
                        />
                    </div>
                    {error && <div className="editor-error">{error}</div>}
                    {oldHash && onForgot && <ForgotPasswordHint onForgot={onForgot} />}
                    <div className="editor-actions" style={{ marginTop: 12 }}>
                        <button className="btn-project" onClick={handleSave}>Salvează</button>
                        {onCancel && <button className="btn-clear" onClick={onCancel}>Anulează</button>}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Settings Modal
// ═════════════════════════════════════════════════════════════════════════════

function SettingsModal({ onClose, onCategoriesChanged, onHymnsChanged, onChangePassword, onForgotPassword, initialTab }: {
    onClose: () => void;
    onCategoriesChanged: () => void;
    onHymnsChanged: () => void;
    onChangePassword: () => void;
    onForgotPassword: () => void;
    initialTab?: 'projection' | 'import' | 'admin' | 'about' | 'help';
}) {
    const [activeTab, setActiveTab] = useState<'projection' | 'import' | 'admin' | 'about' | 'help'>(initialTab ?? 'projection');
    const [settings, setSettings] = useState<AppSettings>({});
    const [importStatus, setImportStatus] = useState('');
    const [updateChannelValue, setUpdateChannelValue] = useState<'stable' | 'beta'>('stable');
    const [feedbackKind, setFeedbackKind] = useState<'bug' | 'suggestion' | null>(null);
    const [pendingFeedback, setPendingFeedback] = useState(0);

    useEffect(() => {
        window.electron.settings.get().then(s => setSettings(s));
        window.electron.update.getChannel().then(setUpdateChannelValue).catch(() => { });
        window.electron.feedback.pending().then(setPendingFeedback).catch(() => { });
    }, []);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const saveSettings = async (patch: Partial<AppSettings>) => {
        const updated = { ...settings, ...patch };
        setSettings(updated);
        await window.electron.settings.set(patch);
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-dialog">
                <div className="modal-header">
                    <h3>Setări & Administrare</h3>
                    <button className="modal-close" onClick={onClose}><X className="icon-sm" /></button>
                </div>
                <div className="modal-body">
                    <div className="settings-tabs">
                        {(['projection', 'import', 'admin', 'about', 'help'] as const).map(t => (
                            <button
                                key={t}
                                className={`stab ${activeTab === t ? 'active' : ''}`}
                                onClick={() => setActiveTab(t)}
                            >
                                {t === 'projection' ? 'Proiecție' : t === 'import' ? 'Imnuri — Import / Export' : t === 'admin' ? 'Administrare' : t === 'about' ? 'Despre' : 'Ajutor'}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'projection' && (
                        <div className="settings-content">
                            <div className="field">
                                <label>Mărime text interfață (fereastra principală)</label>
                                <select
                                    value={String(settings.uiZoom ?? 1)}
                                    onChange={e => {
                                        const f = parseFloat(e.target.value);
                                        saveSettings({ uiZoom: f });
                                        window.electron.settings.setUiZoom(f);
                                    }}
                                >
                                    <option value="1">100%</option>
                                    <option value="1.15">115%</option>
                                    <option value="1.3">130%</option>
                                    <option value="1.5">150%</option>
                                </select>
                                <p className="text-white/40 text-xs mt-1">
                                    Mărește tot textul și butoanele din fereastra principală. Nu afectează ecranul de proiecție.
                                </p>
                            </div>
                            <div className="field">
                                <label>Fundal Proiecție</label>
                                <select
                                    value={settings.bgType ?? 'color'}
                                    onChange={e => saveSettings({ bgType: e.target.value as AppSettings['bgType'] })}
                                >
                                    <option value="color">Culoare</option>
                                    <option value="image">Imagine</option>
                                    <option value="video">Video</option>
                                </select>
                            </div>
                            <div className="field">
                                <label>Culoare Fundal</label>
                                <input
                                    type="color"
                                    value={settings.bgColor ?? '#000000'}
                                    onChange={e => saveSettings({ bgColor: e.target.value })}
                                />
                            </div>
                            <div className="field">
                                <label>Imagine Fundal</label>
                                <div className="field-row">
                                    <span className="field-value">{settings.bgImagePath || 'Niciuna'}</span>
                                    <button className="btn-sm" onClick={async () => {
                                        const p = await window.electron.dialog.pickMedia('image');
                                        if (p) saveSettings({ bgImagePath: p });
                                    }}>Alege...</button>
                                </div>
                            </div>
                            <div className="field">
                                <label>Video Fundal</label>
                                <div className="field-row">
                                    <span className="field-value">{settings.bgVideoPath || 'Niciunul'}</span>
                                    <button className="btn-sm" onClick={async () => {
                                        const p = await window.electron.dialog.pickMedia('video');
                                        if (p) saveSettings({ bgVideoPath: p });
                                    }}>Alege...</button>
                                </div>
                            </div>
                            <div className="field">
                                <label>Opacitate: {((settings.bgOpacity ?? 1) * 100).toFixed(0)}%</label>
                                <input
                                    type="range" min="0" max="1" step="0.05"
                                    value={settings.bgOpacity ?? 1}
                                    onChange={e => saveSettings({ bgOpacity: parseFloat(e.target.value) })}
                                />
                            </div>
                            <div className="field">
                                <label>Culoare Număr Imn</label>
                                <div className="field-row">
                                    <input
                                        type="color"
                                        value={settings.hymnNumberColor ?? '#9fb3ff'}
                                        onChange={e => saveSettings({ hymnNumberColor: e.target.value })}
                                    />
                                    <span className="color-preview" style={{ color: settings.hymnNumberColor ?? '#9fb3ff' }}>
                                        123.
                                    </span>
                                </div>
                            </div>
                            <div className="field">
                                <label>Culoare Text Conținut</label>
                                <div className="field-row">
                                    <input
                                        type="color"
                                        value={settings.contentTextColor ?? '#ffffff'}
                                        onChange={e => saveSettings({ contentTextColor: e.target.value })}
                                    />
                                    <span className="color-preview" style={{ color: settings.contentTextColor ?? '#ffffff' }}>
                                        Exemplu text
                                    </span>
                                </div>
                            </div>
                            <div className="field">
                                <label>Ecran Proiecție</label>
                                <DisplayPicker settings={settings} onSave={saveSettings} />
                            </div>
                            <div className="field">
                                <label>Mărime Font Proiecție: {((settings.projectionFontSize ?? 1.2) * 100).toFixed(0)}%</label>
                                <input
                                    type="range" min="0.6" max="2.0" step="0.05"
                                    value={settings.projectionFontSize ?? 1.2}
                                    onChange={e => saveSettings({ projectionFontSize: parseFloat(e.target.value) })}
                                />
                            </div>
                            <AudioOutputPicker settings={settings} onSave={saveSettings} />
                            <div className="field">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={settings.debugLog ?? false}
                                        onChange={e => saveSettings({ debugLog: e.target.checked })}
                                    />
                                    Jurnal detaliat pentru depanare (debug log)
                                </label>
                                <p className="text-white/40 text-xs mt-1">
                                    Scrie un fișier de log detaliat în folderul aplicației. Util pentru diagnosticarea problemelor cu video și YouTube.
                                </p>
                                {settings.debugLog && (
                                    <button
                                        className="btn-sm mt-1"
                                        onClick={() => window.electron.update.openLogFile()}
                                    >
                                        Deschide fișierul de log
                                    </button>
                                )}
                            </div>
                            <DownloadFolderPicker settings={settings} onSave={saveSettings} />
                        </div>
                    )}

                    {activeTab === 'import' && (
                        <div className="settings-content">
                            <p className="text-white/50 text-sm mb-4">
                                Importă imnuri din fișiere PowerPoint (.pptx) sau gestionează backup-ul bazei de date cu imnuri.
                            </p>
                            <div className="field">
                                <label>Import imnuri din folder cu fișiere PPTX</label>
                                <button className="btn-action" onClick={() => adminGate.require(async () => {
                                    const folder = await window.electron.dialog.selectFolder();
                                    if (!folder) return;
                                    setImportStatus('Se importă imnurile...');
                                    const result = await window.electron.db.importPresentations(folder);
                                    onCategoriesChanged();
                                    onHymnsChanged();
                                    setImportStatus(`Import imnuri: ${result.success} reușite, ${result.failed} eșuate`);
                                }, 'Import imnuri din folder')}>
                                    <FolderOpen className="icon-xs" /> Alege folder cu PPTX
                                </button>
                            </div>
                            <div className="field">
                                <label>Import imnuri din fișiere PPTX individuale</label>
                                <button className="btn-action" onClick={() => adminGate.require(async () => {
                                    const files = await window.electron.dialog.selectPresentationFiles();
                                    if (!files?.length) return;
                                    setImportStatus('Se importă imnurile...');
                                    const result = await window.electron.db.importPresentationFiles(files);
                                    onCategoriesChanged();
                                    onHymnsChanged();
                                    setImportStatus(`Import imnuri: ${result.success} reușite, ${result.failed} eșuate`);
                                }, 'Import imnuri PPT')}>
                                    <Upload className="icon-xs" /> Alege fișiere PPTX
                                </button>
                            </div>
                            <div className="border-t border-white/10 w-full my-3" />
                            <div className="field">
                                <label>Backup imnuri — Export / Import JSON</label>
                                <p className="text-white/40 text-xs mb-2">
                                    Exportă toate imnurile într-un fișier JSON pentru backup sau transfer pe alt calculator.
                                </p>
                                <div className="field-row">
                                    <button className="btn-action" onClick={async () => {
                                        const p = await window.electron.dialog.saveJsonFile('backup-imnuri.json');
                                        if (p) {
                                            const r = await window.electron.db.exportJsonBackup(p);
                                            setImportStatus(`Export reușit: ${r.hymns} imnuri, ${r.sections} secțiuni`);
                                        }
                                    }}>
                                        <Download className="icon-xs" /> Exportă imnuri (JSON)
                                    </button>
                                    <button className="btn-action" onClick={() => adminGate.require(async () => {
                                        const p = await window.electron.dialog.selectJsonFile();
                                        if (p) {
                                            await window.electron.db.importJsonBackup(p);
                                            onCategoriesChanged();
                                            onHymnsChanged();
                                            setImportStatus('Import imnuri din JSON reușit!');
                                        }
                                    }, 'Import bază de date (JSON)')}>
                                        <Upload className="icon-xs" /> Importă imnuri (JSON)
                                    </button>
                                </div>
                            </div>
                            <div className="field">
                                <label>Export baza de date completă (SQLite)</label>
                                <button className="btn-action" onClick={async () => {
                                    const p = await window.electron.dialog.saveFile('hymns-backup.db');
                                    if (p) {
                                        await window.electron.db.exportDb(p);
                                        setImportStatus('Baza de date cu imnuri exportată!');
                                    }
                                }}>
                                    <Download className="icon-xs" /> Export DB
                                </button>
                            </div>
                            {importStatus && <div className="import-msg">{importStatus}</div>}
                        </div>
                    )}

                    {activeTab === 'admin' && (
                        <div className="settings-content">
                            <div className="field">
                                <label>Biserica</label>
                                <input
                                    type="text"
                                    className="timer-text-input"
                                    placeholder="ex: Biserica Adventistă Speranța"
                                    value={settings.churchName ?? ''}
                                    onChange={e => saveSettings({ churchName: e.target.value })}
                                    onBlur={() => { window.electron.registry.submit().then(sent => { if (sent) showToast('Datele bisericii au fost trimise'); }).catch(() => { }); }}
                                />
                            </div>
                            <div className="field">
                                <label>Localitatea</label>
                                <input
                                    type="text"
                                    className="timer-text-input"
                                    placeholder="ex: Cluj-Napoca"
                                    value={settings.churchCity ?? ''}
                                    onChange={e => saveSettings({ churchCity: e.target.value })}
                                    onBlur={() => { window.electron.registry.submit().then(sent => { if (sent) showToast('Datele bisericii au fost trimise'); }).catch(() => { }); }}
                                />
                            </div>
                            <p className="text-white/40 text-xs mb-3">
                                Se trimit autorilor pentru evidența instalărilor și pentru ajutor
                                la recuperarea parolei. Modificările se retrimit automat.
                            </p>
                            <div className="border-t border-white/10 w-full mb-3" />

                            <div className="field">
                                <label>Canal de actualizare</label>
                                <select
                                    className="timer-text-input"
                                    value={updateChannelValue}
                                    onChange={async e => {
                                        const ch = e.target.value as 'stable' | 'beta';
                                        setUpdateChannelValue(ch);
                                        await window.electron.update.setChannel(ch);
                                        showToast(ch === 'beta'
                                            ? 'Veți primi versiunile de test, înaintea celorlalți'
                                            : 'Veți primi doar versiunile stabile');
                                    }}
                                >
                                    <option value="stable">Stabil — recomandat</option>
                                    <option value="beta">Beta — versiuni de test, înaintea tuturor</option>
                                </select>
                                <p className="text-white/40 text-xs mt-2">
                                    Pe „beta" primiți versiunile noi cu câteva zile mai devreme, ca să
                                    le încercați înainte să ajungă la toate bisericile. Dacă vă
                                    întoarceți la „stabil", următoarea actualizare vă readuce pe
                                    versiunea stabilă curentă.
                                </p>
                            </div>

                            <div className="border-t border-white/10 w-full mb-3" />

                            <div className="field">
                                <label>Trimite-ne un mesaj</label>
                                <p className="text-white/40 text-xs mb-2">
                                    Ajunge direct la autori, împreună cu versiunea și platforma.
                                    {pendingFeedback > 0 && (
                                        <> {pendingFeedback} {pendingFeedback === 1 ? 'mesaj așteaptă' : 'mesaje așteaptă'} să
                                        plece (nu era internet) — se trimit automat.</>
                                    )}
                                </p>
                                <div className="flex gap-2">
                                    <button className="btn-action" onClick={() => setFeedbackKind('bug')}>
                                        Raportează o problemă
                                    </button>
                                    <button className="btn-clear" onClick={() => setFeedbackKind('suggestion')}>
                                        Sugerează o îmbunătățire
                                    </button>
                                </div>
                            </div>

                            <div className="border-t border-white/10 w-full mb-3" />
                            <div className="field">
                                <label>Parola de administrare</label>
                                <p className="text-white/40 text-xs mb-2">
                                    Protejează modificarea imnurilor, importurile și ștergerea șabloanelor.
                                </p>
                                <div className="flex gap-2">
                                    <button className="btn-action" onClick={onChangePassword}>
                                        <Lock className="icon-xs" /> Schimbă parola
                                    </button>
                                    <button className="btn-clear" onClick={onForgotPassword}>
                                        Am uitat parola...
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'about' && (
                        <div className="settings-content">
                            <div className="flex flex-col items-center gap-5 py-6 text-center">

                                {/* Logo + versiune */}
                                <h2 className="text-3xl font-black text-primary tracking-wide">AdventShow</h2>
                                <p className="text-white/40 text-xs -mt-3">versiunea {import.meta.env.VITE_APP_VERSION ?? '1.0.0'}</p>

                                {/* Descriere */}
                                <p className="text-white/70 text-sm leading-relaxed max-w-sm">
                                    Aplicație gratuită și open-source pentru proiecția imnurilor și versetelor biblice în biserici.
                                </p>

                                <div className="border-t border-white/10 w-full" />

                                {/* Ce include */}
                                <div className="text-sm text-white/60 leading-relaxed max-w-sm w-full text-left">
                                    <p className="font-semibold text-white/80 mb-2 text-center">Ce include</p>
                                    <ul className="list-disc list-inside space-y-1">
                                        <li><strong>1.324 de imnuri și cântări</strong> — Imnuri Creștine, Licurici, Exploratori, Companioni, Tineret, Amicus</li>
                                        <li><strong>Biblia Cornilescu</strong> — 66 cărți, 31.102 versete</li>
                                        <li>Proiecție fullscreen pe ecran secundar</li>
                                        <li>Redare video — fișiere locale și YouTube</li>
                                        <li>Editor integrat, import PowerPoint, căutare</li>
                                        <li>Actualizări automate — descarcă și instalează ultima versiune</li>
                                    </ul>
                                </div>

                                <div className="border-t border-white/10 w-full" />

                                {/* Dezvoltatori */}
                                <div className="w-full max-w-sm">
                                    <p className="font-semibold text-white/80 mb-3 text-center text-sm">Dezvoltatori</p>
                                    <div className="flex flex-col gap-2">
                                        <div className="rounded-lg bg-white/5 px-4 py-3 text-left">
                                            <p className="text-white/90 font-semibold text-sm">Ovidius Zanfir</p>
                                            <p className="text-white/40 text-xs mt-0.5">Concept, design interfață, baza de date imnuri</p>
                                        </div>
                                        <div className="rounded-lg bg-white/5 px-4 py-3 text-left">
                                            <p className="text-white/90 font-semibold text-sm">Samy Balasa</p>
                                            <p className="text-white/40 text-xs mt-0.5">Video, YouTube, Biblie, auto-update, release pipeline</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="border-t border-white/10 w-full" />

                                {/* Link GitHub */}
                                <a
                                    href="https://github.com/AdventTools"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-primary hover:text-primary/80 text-sm font-medium transition-colors"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.184 6.839 9.504.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.026 2.747-1.026.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.2 22 16.447 22 12.021 22 6.484 17.522 2 12 2z" />
                                    </svg>
                                    github.com/AdventTools
                                </a>

                                <div className="border-t border-white/10 w-full" />
                                <UpdateChecker />
                                <div className="border-t border-white/10 w-full" />
                                <YtDlpSettings />
                                <div className="border-t border-white/10 w-full" />

                                <p className="text-white/25 text-xs">
                                    Distribuit gratuit. Biblia Cornilescu — text în domeniu public.
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'help' && (
                        <div className="settings-content">
                            <p className="text-white/60 text-sm mb-3">
                                Scurtături de tastatură pentru operare rapidă în timpul programului.
                            </p>
                            <div className="help-shortcuts">
                                <div className="help-row">
                                    <kbd>Enter</kbd>
                                    <span>În listă: prima apăsare deschide previzualizarea, a doua trimite pe ecran (proiectează).</span>
                                </div>
                                <div className="help-row">
                                    <kbd>Esc</kbd>
                                    <span>Oprește proiecția / oprește videoul / golește previzualizarea. În Anunțuri primul Esc închide editorul mare, al doilea oprește proiecția.</span>
                                </div>
                                <div className="help-row">
                                    <kbd>↑</kbd><kbd>↓</kbd>
                                    <span>Navighează prin lista de imnuri sau prin versete (când NU proiectezi).</span>
                                </div>
                                <div className="help-row">
                                    <kbd>←</kbd><kbd>→</kbd>
                                    <span>În timpul proiecției: strofa anterioară / următoare (funcționează și PageUp / PageDown / Spațiu pentru înainte).</span>
                                </div>
                                <div className="help-row">
                                    <kbd>↑</kbd><kbd>↓</kbd>
                                    <span>În timpul proiecției: mărește / micșorează textul de pe ecran (zoom).</span>
                                </div>
                                <div className="help-row">
                                    <kbd>/</kbd>
                                    <span>Sare direct în câmpul de căutare.</span>
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {feedbackKind && (
                <FeedbackModal
                    initialKind={feedbackKind}
                    onClose={() => {
                        setFeedbackKind(null);
                        window.electron.feedback.pending().then(setPendingFeedback).catch(() => { });
                    }}
                    onSent={msg => showToast(msg)}
                />
            )}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Timer panel — countdown (default) / stopwatch / clock, projected full-screen
// ═════════════════════════════════════════════════════════════════════════════

// Următoarea apariție a orei HH:MM: azi dacă mai e în viitor (sau trecută cu
// sub un minut → acum), altfel mâine. Fără surprize la miezul nopții.
function nextClockOccurrence(hh: number, mm: number): { epoch: number; tomorrow: boolean } {
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    let epoch = d.getTime();
    let tomorrow = false;
    if (epoch < Date.now() - 60_000) { epoch += 24 * 60 * 60 * 1000; tomorrow = true; }
    return { epoch, tomorrow };
}

// Format H:MM:SS (fără oră când e zero → M:SS) — identic cu cel de pe proiecție,
// ca previzualizarea și ecranul să afișeze exact același text.
function fmtTimerMs(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Starea ceasului trăiește la nivel de MODUL (nu doar în TimerPanel), pentru că
// TimerPanel se demontează la schimbarea tabului. Astfel:
//  • numărătoarea programată pornește chiar dacă operatorul e pe alt tab;
//  • la revenirea pe tabul Ceas, panoul reflectă ce e live acum.
const timerCtl: {
    timeoutId: ReturnType<typeof setTimeout> | null;
    armed: { fireAtEpochMs: number; label: string } | null;
    live: import('./vite-env').ProjectionTimerData | null;
    anchor: { targetEpochMs?: number; startEpochMs?: number };
    sync: (() => void) | null;
} = { timeoutId: null, armed: null, live: null, anchor: {}, sync: null };

function TimerPanel() {
    const [mode, setMode] = useState<'countdown' | 'stopwatch' | 'clock'>(timerCtl.live?.mode ?? 'countdown');
    const [minutes, setMinutes] = useState(5);
    const [seconds, setSeconds] = useState(0);
    const [title, setTitle] = useState('');
    const [zeroMessage, setZeroMessage] = useState('');
    const [afterZero, setAfterZero] = useState<'stay' | 'black' | 'stop'>('stay');
    const [afterZeroStopSec, setAfterZeroStopSec] = useState(30);
    const [clock24h, setClock24h] = useState(true);
    const [clockShowSeconds, setClockShowSeconds] = useState(false);
    const [clockAnalog, setClockAnalog] = useState(false);
    const [running, setRunning] = useState(timerCtl.live ? timerCtl.live.running !== false : false);
    const [projected, setProjected] = useState(!!timerCtl.live);
    const [bgChoice, setBgChoice] = useState<BgChoice>({ kind: 'preset', css: '' });

    // Pornire numărătoare: acum / numără până la ora X / automat la ora X
    const [startMode, setStartMode] = useState<'now' | 'until' | 'at'>('now');
    const [untilHH, setUntilHH] = useState(10);
    const [untilMM, setUntilMM] = useState(0);
    const [atHH, setAtHH] = useState(9);
    const [atMM, setAtMM] = useState(50);
    // numărătoare programată armată (supraviețuiește schimbării de tab prin timerCtl)
    const [scheduled, setScheduled] = useState<{ fireAtEpochMs: number; label: string } | null>(timerCtl.armed);

    // Anchors for the currently projected timer (so Pause can freeze accurately)
    const anchorRef = useRef<{ targetEpochMs?: number; startEpochMs?: number }>({});
    // ultima trimitere — ca schimbarea fundalului să se aplice LIVE fără a
    // reseta ancorele cronometrului
    const lastSentRef = useRef<import('./vite-env').ProjectionTimerData | null>(null);

    const durationMs = Math.max(0, (minutes * 60 + seconds) * 1000);

    const bgRef = useRef(bgChoice);
    bgRef.current = bgChoice;
    const send = useCallback((data: import('./vite-env').ProjectionTimerData) => {
        const payload = { ...data, background: bgToPayload(bgRef.current) };
        lastSentRef.current = payload;
        timerCtl.live = payload;   // persistă pentru remontarea panoului (schimbare de tab)
        window.electron.projection.showTimer(payload);
        setProjected(true);
        liveBus.notify();
    }, []);

    // fundal schimbat în timp ce proiecția rulează → retrimite același payload
    // cu noul fundal (ancorele rămân, ceasul nu sare)
    useEffect(() => {
        if (!projected || !lastSentRef.current) return;
        const payload = { ...lastSentRef.current, background: bgToPayload(bgChoice) };
        lastSentRef.current = payload;
        timerCtl.live = payload;
        window.electron.projection.showTimer(payload);
    }, [bgChoice, projected]);

    // proiectează o numărătoare cu ținta dată (folosit și de „până la ora X")
    const projectCountdown = useCallback((targetEpochMs: number) => {
        anchorRef.current = { targetEpochMs };
        timerCtl.anchor = anchorRef.current;
        setRunning(true);
        send({ mode: 'countdown', targetEpochMs, running: true, title: title || undefined, zeroMessage: zeroMessage || undefined, afterZero, afterZeroSeconds: afterZeroStopSec });
    }, [title, zeroMessage, afterZero, afterZeroStopSec, send]);

    const startCountdown = useCallback(() => projectCountdown(Date.now() + durationMs), [durationMs, projectCountdown]);

    const startStopwatch = useCallback(() => {
        const start = Date.now();
        anchorRef.current = { startEpochMs: start };
        timerCtl.anchor = anchorRef.current;
        setRunning(true);
        send({ mode: 'stopwatch', startEpochMs: start, running: true, title: title || undefined });
    }, [title, send]);

    const showClock = useCallback(() => {
        setRunning(true);
        send({
            mode: 'clock', running: true, title: title || undefined,
            clock24h, clockShowSeconds, clockAnalog,
        });
    }, [title, clock24h, clockShowSeconds, clockAnalog, send]);

    const pause = useCallback(() => {
        const now = Date.now();
        if (mode === 'countdown' && anchorRef.current.targetEpochMs != null) {
            const remaining = Math.max(0, anchorRef.current.targetEpochMs - now);
            setRunning(false);
            send({ mode: 'countdown', running: false, frozenValueMs: remaining, title: title || undefined, zeroMessage: zeroMessage || undefined, afterZero, afterZeroSeconds: afterZeroStopSec });
        } else if (mode === 'stopwatch' && anchorRef.current.startEpochMs != null) {
            const elapsed = now - anchorRef.current.startEpochMs;
            setRunning(false);
            send({ mode: 'stopwatch', running: false, frozenValueMs: elapsed, title: title || undefined });
        }
    }, [mode, title, zeroMessage, afterZero, afterZeroStopSec, send]);

    // „Continuă" reia din valoarea ÎNGHEȚATĂ la pauză (nu de la capăt): ancorează
    // o țintă/start nou care produce exact timpul rămas/scurs de la pauză.
    const resume = useCallback(() => {
        const frozen = lastSentRef.current?.frozenValueMs;
        if (mode === 'countdown') {
            projectCountdown(Date.now() + (frozen ?? durationMs));
        } else if (mode === 'stopwatch') {
            const start = Date.now() - (frozen ?? 0);
            anchorRef.current = { startEpochMs: start };
            timerCtl.anchor = anchorRef.current;
            setRunning(true);
            send({ mode: 'stopwatch', startEpochMs: start, running: true, title: title || undefined });
        }
    }, [mode, durationMs, title, projectCountdown, send]);

    // programează pornirea automată a numărătorii la ora atHH:atMM. Timerul stă în
    // timerCtl (nivel modul) ca să pornească și dacă operatorul e pe alt tab.
    const scheduleAt = useCallback(() => {
        const { epoch, tomorrow } = nextClockOccurrence(atHH, atMM);
        const pad = (n: number) => String(n).padStart(2, '0');
        const label = `${tomorrow ? 'mâine ' : ''}la ${pad(atHH)}:${pad(atMM)}`;
        const durMs = durationMs, t = title, z = zeroMessage, az = afterZero, azs = afterZeroStopSec, bg = bgToPayload(bgRef.current);
        if (timerCtl.timeoutId) clearTimeout(timerCtl.timeoutId);
        timerCtl.armed = { fireAtEpochMs: epoch, label };
        timerCtl.timeoutId = setTimeout(() => {
            timerCtl.timeoutId = null;
            timerCtl.armed = null;
            const target = Date.now() + durMs;
            timerCtl.anchor = { targetEpochMs: target };
            const payload: import('./vite-env').ProjectionTimerData = {
                mode: 'countdown', targetEpochMs: target, running: true,
                title: t || undefined, zeroMessage: z || undefined,
                afterZero: az, afterZeroSeconds: azs, background: bg,
            };
            timerCtl.live = payload;
            window.electron.projection.showTimer(payload);
            timerCtl.sync?.();   // dacă panoul e montat, își reîmprospătează starea
            liveBus.notify();
        }, Math.max(0, epoch - Date.now()));
        setScheduled(timerCtl.armed);
    }, [atHH, atMM, durationMs, title, zeroMessage, afterZero, afterZeroStopSec]);

    const cancelSchedule = useCallback(() => {
        if (timerCtl.timeoutId) { clearTimeout(timerCtl.timeoutId); timerCtl.timeoutId = null; }
        timerCtl.armed = null;
        setScheduled(null);
    }, []);

    const start = useCallback(() => {
        if (mode === 'stopwatch') { startStopwatch(); return; }
        if (mode === 'clock') { showClock(); return; }
        // countdown
        if (startMode === 'until') projectCountdown(nextClockOccurrence(untilHH, untilMM).epoch);
        else if (startMode === 'at') scheduleAt();
        else startCountdown();
    }, [mode, startMode, untilHH, untilMM, startStopwatch, showClock, projectCountdown, scheduleAt, startCountdown]);

    const stop = useCallback(() => {
        if (timerCtl.timeoutId) { clearTimeout(timerCtl.timeoutId); timerCtl.timeoutId = null; }
        timerCtl.armed = null;
        timerCtl.live = null;
        timerCtl.anchor = {};
        setScheduled(null);
        setRunning(false);
        setProjected(false);
        anchorRef.current = {};
        window.electron.projection.close();
        liveBus.notify();
    }, []);

    // Esc oprește și ceasul/cronometrul; iar dacă proiecția se închide pe altă
    // cale (Esc pe ecranul de proiecție), starea panoului se resetează și ea
    useEffect(() => {
        realtimeCtl.projected = projected;
        realtimeCtl.stop = stop;
        realtimeCtl.notifyClosed = () => {
            timerCtl.live = null;
            timerCtl.anchor = {};
            setProjected(false);
            setRunning(false);
            anchorRef.current = {};
            liveBus.notify();
        };
        return () => { realtimeCtl.projected = false; };
    }, [projected, stop]);

    // Resincronizare panou ↔ timerCtl: la montare (revenire pe tab) preia ce e
    // live/armat acum; iar numărătoarea programată care pornește cât panoul e
    // montat îl anunță prin timerCtl.sync().
    useEffect(() => {
        const pull = () => {
            if (timerCtl.live) {
                lastSentRef.current = timerCtl.live;
                anchorRef.current = timerCtl.anchor;
                setMode(timerCtl.live.mode);
                setProjected(true);
                setRunning(timerCtl.live.running !== false);
                setScheduled(null);
            }
            setScheduled(timerCtl.armed);
        };
        pull();
        timerCtl.sync = pull;
        return () => { if (timerCtl.sync === pull) timerCtl.sync = null; };
    }, []);

    const presets = [1, 3, 5, 10, 15, 20];

    // ── Previzualizare live (coloana din dreapta) ────────────────────────────
    const [projBg, setProjBg] = useState<{ bgType?: string; bgColor?: string; bgImagePath?: string }>({});
    const [, setNowTick] = useState(0);
    useEffect(() => {
        window.electron.settings.get().then(s => setProjBg({ bgType: s.bgType, bgColor: s.bgColor, bgImagePath: s.bgImagePath })).catch(() => { });
    }, []);
    // ticăie o dată pe secundă cât timp e ceva de arătat live: ceasul, o
    // numărătoare/cronometru proiectate și pornite, sau o programare armată
    useEffect(() => {
        const liveTick = mode === 'clock' || (projected && running) || !!scheduled;
        if (!liveTick) return;
        const id = setInterval(() => setNowTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, [mode, projected, running, scheduled]);
    const previewBg = (() => {
        const b = bgToPayload(bgChoice);
        if (b) return b.type === 'image' ? `url('localfile://${encodeURI(b.value)}') center / cover no-repeat` : b.value;
        if (projBg.bgType === 'image' && projBg.bgImagePath) return `url('localfile://${encodeURI(projBg.bgImagePath)}') center / cover no-repeat`;
        return projBg.bgColor || '#000000';
    })();
    // timpul brut pe care îl arată proiecția ACUM (live când e proiectat, din ancore)
    const previewMs = (() => {
        if (mode === 'countdown') {
            if (projected) return running
                ? Math.max(0, (anchorRef.current.targetEpochMs ?? Date.now()) - Date.now())
                : (lastSentRef.current?.frozenValueMs ?? 0);
            if (startMode === 'until') return Math.max(0, nextClockOccurrence(untilHH, untilMM).epoch - Date.now());
            return durationMs;
        }
        if (mode === 'stopwatch') {
            if (projected) return running
                ? Date.now() - (anchorRef.current.startEpochMs ?? Date.now())
                : (lastSentRef.current?.frozenValueMs ?? 0);
            return 0;
        }
        return 0;
    })();
    const previewAtZero = mode === 'countdown' && projected && running && previewMs <= 0;
    const previewWarn = mode === 'countdown' && projected && running && previewMs > 0 && previewMs < 60_000;
    const previewClockText = (() => {
        const d = new Date(); let h = d.getHours();
        const mm = String(d.getMinutes()).padStart(2, '0'); const ss = String(d.getSeconds()).padStart(2, '0');
        let ap = ''; if (!clock24h) { ap = h >= 12 ? ' PM' : ' AM'; h = h % 12 || 12; }
        return `${h}:${mm}${clockShowSeconds ? ':' + ss : ''}${ap}`;
    })();
    const previewTime = mode === 'clock'
        ? previewClockText
        : previewAtZero ? (zeroMessage || 'S-a terminat') : fmtTimerMs(previewMs);
    // echivalentul în minute pentru „numără până la ora X" (afișat live)
    const untilEquivMin = Math.max(0, Math.round((nextClockOccurrence(untilHH, untilMM).epoch - Date.now()) / 60_000));
    // cât mai e până pornește numărătoarea programată
    const scheduledInMs = scheduled ? Math.max(0, scheduled.fireAtEpochMs - Date.now()) : 0;

    return (
        <div className="content-inner timer-panel rt-host">
          <div className="rt-layout">
            <div className="rt-left">
            <div className="timer-mode-switch">
                {(['countdown', 'stopwatch', 'clock'] as const).map(m => (
                    <button
                        key={m}
                        className={`timer-mode-btn ${mode === m ? 'active' : ''}`}
                        onClick={() => { setMode(m); setRunning(false); }}
                    >
                        {m === 'countdown' ? 'Numărătoare inversă' : m === 'stopwatch' ? 'Cronometru' : 'Ceas'}
                    </button>
                ))}
            </div>

            {mode === 'countdown' && (
                <div className="timer-section">
                    <label className="timer-label">Presetări</label>
                    <div className="timer-presets">
                        {presets.map(p => (
                            <button key={p} className="timer-preset-btn" onClick={() => { setMinutes(p); setSeconds(0); }}>
                                {p} min
                            </button>
                        ))}
                    </div>
                    <label className="timer-label">Durată</label>
                    <div className="timer-duration">
                        <input type="number" min={0} max={599} value={minutes}
                            onChange={e => setMinutes(Math.max(0, Math.min(599, parseInt(e.target.value) || 0)))} />
                        <span>min</span>
                        <input type="number" min={0} max={59} value={seconds}
                            onChange={e => setSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} />
                        <span>sec</span>
                    </div>

                    <label className="timer-label">Pornire</label>
                    <div className="timer-start-modes">
                        <label className="timer-radio">
                            <input type="radio" name="startMode" checked={startMode === 'now'} onChange={() => setStartMode('now')} />
                            <span>Acum, la apăsarea „Proiectează”</span>
                        </label>
                        <label className="timer-radio">
                            <input type="radio" name="startMode" checked={startMode === 'until'} onChange={() => setStartMode('until')} />
                            <span>Numără până la ora</span>
                            <input className="timer-time-input" type="number" min={0} max={23} value={untilHH}
                                onFocus={() => setStartMode('until')}
                                onChange={e => setUntilHH(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))} />
                            <span className="timer-colon">:</span>
                            <input className="timer-time-input" type="number" min={0} max={59} value={untilMM}
                                onFocus={() => setStartMode('until')}
                                onChange={e => setUntilMM(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} />
                        </label>
                        {startMode === 'until' && (
                            <div className="timer-hint-sm">≈ {untilEquivMin} min din acest moment{nextClockOccurrence(untilHH, untilMM).tomorrow ? ' (mâine)' : ''} — durata se calculează singură.</div>
                        )}
                        <label className="timer-radio">
                            <input type="radio" name="startMode" checked={startMode === 'at'} onChange={() => setStartMode('at')} />
                            <span>Pornește automat la ora</span>
                            <input className="timer-time-input" type="number" min={0} max={23} value={atHH}
                                onFocus={() => setStartMode('at')}
                                onChange={e => setAtHH(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))} />
                            <span className="timer-colon">:</span>
                            <input className="timer-time-input" type="number" min={0} max={59} value={atMM}
                                onFocus={() => setStartMode('at')}
                                onChange={e => setAtMM(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} />
                        </label>
                        {startMode === 'at' && (
                            <div className="timer-hint-sm">Numărătoarea de {fmtTimerMs(durationMs)} pornește singură {nextClockOccurrence(atHH, atMM).tomorrow ? 'mâine ' : ''}la {String(atHH).padStart(2, '0')}:{String(atMM).padStart(2, '0')}.</div>
                        )}
                    </div>

                    <label className="timer-label">Mesaj la final (opțional)</label>
                    <input className="timer-text-input" type="text" placeholder="ex: Bine ați venit!"
                        value={zeroMessage} onChange={e => setZeroMessage(e.target.value)} />

                    <label className="timer-label">După terminare</label>
                    <div className="timer-after-zero">
                        <select className="timer-text-input" value={afterZero}
                            onChange={e => setAfterZero(e.target.value as 'stay' | 'black' | 'stop')}>
                            <option value="stay">Rămâne mesajul</option>
                            <option value="black">Ecran negru</option>
                            <option value="stop">Oprește proiecția</option>
                        </select>
                        {afterZero === 'stop' && (
                            <span className="timer-after-zero-sec">
                                după
                                <input className="timer-time-input" type="number" min={0} max={600} value={afterZeroStopSec}
                                    onChange={e => setAfterZeroStopSec(Math.max(0, Math.min(600, parseInt(e.target.value) || 0)))} />
                                sec
                            </span>
                        )}
                    </div>
                    {afterZero === 'black' && (
                        <div className="timer-hint">La zero ecranul devine negru (fără text).</div>
                    )}
                    {afterZero === 'stop' && (
                        <div className="timer-hint">La zero proiecția se închide automat după {afterZeroStopSec} sec.</div>
                    )}
                </div>
            )}

            {mode === 'clock' && (
                <div className="timer-section">
                    <label className="timer-label">Tip ceas</label>
                    <div className="timer-mode-switch">
                        <button
                            className={`timer-mode-btn ${!clockAnalog ? 'active' : ''}`}
                            onClick={() => setClockAnalog(false)}
                        >
                            Digital
                        </button>
                        <button
                            className={`timer-mode-btn ${clockAnalog ? 'active' : ''}`}
                            onClick={() => setClockAnalog(true)}
                        >
                            Analogic
                        </button>
                    </div>
                    <label className="timer-checkbox">
                        <input type="checkbox" checked={clockShowSeconds} onChange={e => setClockShowSeconds(e.target.checked)} />
                        Afișează secundele
                    </label>
                    {!clockAnalog && (
                        <label className="timer-checkbox">
                            <input type="checkbox" checked={clock24h} onChange={e => setClock24h(e.target.checked)} />
                            Format 24 de ore
                        </label>
                    )}
                </div>
            )}

            <div className="timer-section">
                <label className="timer-label">Titlu (opțional)</label>
                <input className="timer-text-input" type="text"
                    placeholder={mode === 'countdown' ? 'ex: Serviciul începe în'
                        : mode === 'stopwatch' ? 'ex: Timp scurs'
                            : 'ex: Bine ați venit!'}
                    value={title} onChange={e => setTitle(e.target.value)} />
            </div>

            <div className="timer-section">
                <BackgroundPicker bg={bgChoice} onChange={setBgChoice} />
            </div>

            {scheduled ? (
                <div className="timer-scheduled">
                    <div className="timer-scheduled-info">
                        <strong>Programat {scheduled.label}</strong>
                        <span>Pornește în {fmtTimerMs(scheduledInMs)} — proiecția pornește singură.</span>
                    </div>
                    <button className="btn-sm timer-stop" onClick={cancelSchedule}>Anulează</button>
                </div>
            ) : (
                <div className="timer-actions">
                    {!projected || mode === 'clock' ? (
                        <button className="btn-project timer-start" onClick={start}>
                            {mode === 'clock' ? 'Proiectează ceasul'
                                : (mode === 'countdown' && startMode === 'at') ? 'Programează'
                                    : 'Proiectează'}
                        </button>
                    ) : running ? (
                        previewAtZero ? (
                            <button className="btn-project timer-start" onClick={startCountdown}>Repornește</button>
                        ) : (
                            <button className="btn-sm timer-pause" onClick={pause}>Pauză</button>
                        )
                    ) : (
                        <button className="btn-project timer-start" onClick={resume}>Continuă</button>
                    )}
                    {projected && (
                        <button className="btn-sm timer-stop" onClick={stop}>Oprește</button>
                    )}
                </div>
            )}
            <p className="timer-hint">
                {mode === 'countdown' ? 'Numărătoarea inversă apare pe ecranul de proiecție.'
                    : mode === 'stopwatch' ? 'Cronometrul pornește de la zero și urcă.'
                        : 'Se afișează ora curentă pe ecranul de proiecție.'}
            </p>
            </div>

            <div className="rt-right">
                <label className="timer-label">Previzualizare (cum apare pe ecran)</label>
                <div className="rt-preview" style={{ background: previewBg }}>
                    <div className="rt-preview-center">
                        {title && <div className="rt-preview-title">{title}</div>}
                        <div className="rt-preview-time" style={{ color: previewWarn ? '#f59e0b' : undefined }}>{previewTime}</div>
                        {mode === 'clock' && clockAnalog && <div className="rt-preview-note">(pe proiecție: ceas analogic)</div>}
                        {projected && !running && mode !== 'clock' && <div className="rt-preview-note">⏸ pauză</div>}
                    </div>
                </div>
                {projected
                    ? <span className="live-indicator">● LIVE pe proiecție{previewAtZero ? ' — s-a terminat' : ''}</span>
                    : scheduled && <span className="live-indicator scheduled">◷ programat {scheduled.label}</span>}
            </div>
          </div>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Message panel — free text projected live as you type
// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// Realtime — text liber proiectat live + prezentări editabile (PPT/șabloane)
// ═════════════════════════════════════════════════════════════════════════════

// registru pentru handlerul global de taste: starea Realtime trăiește în
// MessagePanel, dar Esc e gestionat global (primul Esc = închide editorul mare,
// al doilea = oprește proiecția)
// poarta de parolă admin, folosibilă și din componente fără acces la state-ul
// App-ului (ex. managerul de șabloane); App o leagă la requirePassword la montare
const adminGate: { require: (action: () => void, title: string) => void } = {
    // implicit: rulează direct; App o înlocuiește cu requirePassword la montare
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    require: (action, _title) => { action(); },
};

const realtimeCtl = {
    overlayOpen: false,
    closeOverlay: () => { /* setat de MessagePanel */ },
    projected: false,
    stop: () => { /* setat de MessagePanel */ },
    // proiecția s-a închis pe ORICE cale (Esc pe ecranul de proiecție, buton etc.)
    // → indicatorii LIVE din Realtime trebuie să moară odată cu ea
    notifyClosed: () => { /* setat de MessagePanel */ },
    // R2: navigarea slide-urilor de prezentare din fereastra principală, prin
    // aceeași rută ca butoanele ‹ › (goSlide → projection.updateText). presSlides
    // > 1 ⇔ o prezentare cu mai multe slide-uri e proiectată acum.
    presSlides: 0,
    nextSlide: () => { /* setat de MessagePanel */ },
    prevSlide: () => { /* setat de MessagePanel */ },
};

// Badge LIVE global din header: starea „ce e live acum" vine din surse reactive
// (proiectare imn/verset, video) DAR și din registre de modul (Ceas = timerCtl,
// Anunțuri = realtimeCtl). liveBus lasă acele registre să ceară App-ului o
// re-randare când pornesc/opresc, ca badge-ul să reflecte și ceasul/anunțul.
const liveBus: { notify: () => void } = { notify: () => { /* setat de App */ } };

// ── Toast global (registru la nivel de MODUL, în stilul realtimeCtl) ──────────
// Un singur ToastHost e montat în App(); showToast() poate fi apelat de oriunde
// din acest modul (editor imn, setări, salvări) fără prop-drilling.
const toastCtl: { show: (msg: string) => void } = {
    show: () => { /* setat de ToastHost la montare */ },
};
function showToast(msg: string) { toastCtl.show(msg); }

function ToastHost() {
    const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
    useEffect(() => {
        toastCtl.show = (msg: string) => {
            const id = Date.now() + Math.random();
            setToasts(t => [...t, { id, msg }]);
            setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
        };
        return () => { toastCtl.show = () => { /* demontat */ }; };
    }, []);
    if (toasts.length === 0) return null;
    return (
        <div className="toast-stack">
            {toasts.map(t => (
                <div key={t.id} className="toast">{t.msg}</div>
            ))}
        </div>
    );
}

// fundaluri predefinite pentru Realtime (CSS — fără asset-uri)
const BG_PRESETS: { name: string; css: string }[] = [
    { name: 'Fundalul aplicației', css: '' },
    { name: 'Albastru noapte', css: 'linear-gradient(135deg,#0b1026,#1b2a5b)' },
    { name: 'Vișiniu', css: 'linear-gradient(135deg,#2a0a12,#5b1b2a)' },
    { name: 'Verde pădure', css: 'linear-gradient(135deg,#06170f,#1b4332)' },
    { name: 'Auriu apus', css: 'linear-gradient(135deg,#3a2305,#7a4a0f)' },
    { name: 'Ardezie', css: 'linear-gradient(135deg,#0f172a,#334155)' },
    { name: 'Negru', css: '#000000' },
];

// igienizare strictă a HTML-ului din editorul contenteditable: doar structura de
// text (p/div/ul/ol/li/b/i/u/s/br/span) și doar stilurile de formatare validate
// (aliniere, indentare, mărime, culoare, tăiere). E POARTA COMUNĂ pentru toolbar
// ȘI pentru importul din PPT — orice stil neacceptat aici dispare la editare.
const SANITIZE_ALLOWED = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'SPAN']);
const RE_FONT_SIZE = /^([\d.]+(em|px|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/;
const RE_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\))$/;
const RE_TEXT_DECO = /^(none|underline|line-through|overline|underline line-through)$/;
function sanitizePresHtml(html: string): string {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const clean = (parent: Node) => {
        for (const node of Array.from(parent.childNodes)) {
            if (node.nodeType === Node.COMMENT_NODE) { node.remove(); continue; }
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node as HTMLElement;
            clean(el); // întâi copiii (unwrap-ul de mai jos îi mută în părinte)
            if (!SANITIZE_ALLOWED.has(el.tagName)) {
                el.replaceWith(...Array.from(el.childNodes));
                continue;
            }
            const align = el.style?.textAlign;
            const marginLeft = el.style?.marginLeft;
            const fontSize = el.style?.fontSize;
            const color = el.style?.color;
            const deco = el.style?.textDecorationLine || el.style?.textDecoration;
            for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
            let style = '';
            if (align) style += `text-align:${align};`;
            if (marginLeft && /^[\d.]+(em|px|rem|%)$/.test(marginLeft)) style += `margin-left:${marginLeft};`;
            if (fontSize && RE_FONT_SIZE.test(fontSize)) style += `font-size:${fontSize};`;
            if (color && RE_COLOR.test(color)) style += `color:${color};`;
            if (deco && RE_TEXT_DECO.test(deco)) style += `text-decoration:${deco};`;
            if (style) el.setAttribute('style', style);
        }
    };
    clean(tpl.content);
    return tpl.innerHTML;
}

type BgChoice = { kind: 'preset'; css: string } | { kind: 'image'; path: string };

function bgToPayload(bg: BgChoice, slide?: { bgColor?: string; bgGradient?: string; bgImage?: string }): ProjectionTextData['background'] {
    // alegerea explicită a userului bate fundalul venit din PPT
    if (bg.kind === 'image') return { type: 'image', value: bg.path };
    if (bg.css) return { type: 'gradient', value: bg.css };
    if (slide?.bgImage) return { type: 'image', value: slide.bgImage };
    if (slide?.bgGradient) return { type: 'gradient', value: slide.bgGradient };
    if (slide?.bgColor) return { type: 'color', value: slide.bgColor };
    return null; // fundalul global al aplicației
}

function BackgroundPicker({ bg, onChange, existingLabel = 'Fundalul aplicației' }: {
    bg: BgChoice; onChange: (b: BgChoice) => void; existingLabel?: string;
}) {
    const pickImage = async () => {
        const p = await window.electron.dialog.pickMedia('image');
        if (p) onChange({ kind: 'image', path: p });
    };
    return (
        <div className="field">
            <label className="timer-label">Fundal</label>
            <div className="bg-grid">
                {/* fundal implicit al aplicației / existent din PPT */}
                <button
                    type="button"
                    className={`bg-card ${bg.kind === 'preset' && bg.css === '' ? 'active' : ''}`}
                    title={existingLabel}
                    onClick={() => onChange({ kind: 'preset', css: '' })}
                >
                    <span className="bg-card-swatch bg-card-default">
                        {bg.kind === 'preset' && bg.css === '' && <span className="bg-card-check">✓</span>}
                    </span>
                    <span className="bg-card-name">{existingLabel}</span>
                </button>
                {/* culori / gradient predefinite */}
                {BG_PRESETS.filter(p => p.css).map(p => {
                    const active = bg.kind === 'preset' && bg.css === p.css;
                    return (
                        <button
                            key={p.name}
                            type="button"
                            className={`bg-card ${active ? 'active' : ''}`}
                            title={p.name}
                            onClick={() => onChange({ kind: 'preset', css: p.css })}
                        >
                            <span className="bg-card-swatch" style={{ background: p.css }}>
                                {active && <span className="bg-card-check">✓</span>}
                            </span>
                            <span className="bg-card-name">{p.name}</span>
                        </button>
                    );
                })}
                {/* imagine de pe disc */}
                <button
                    type="button"
                    className={`bg-card ${bg.kind === 'image' ? 'active' : ''}`}
                    title="Imagine de pe disc"
                    onClick={pickImage}
                >
                    <span className="bg-card-swatch bg-card-image">
                        {bg.kind === 'image' ? <span className="bg-card-check">✓</span> : <ImageIcon className="icon-xs" />}
                    </span>
                    <span className="bg-card-name">Imagine…</span>
                </button>
            </div>
            {bg.kind === 'image' && (
                <span className="bg-image-name">📎 {bg.path.split('/').pop()}</span>
            )}
        </div>
    );
}

function MessagePanel() {
    const [mode, setMode] = useState<'text' | 'pres'>('text');

    // ── Text simplu ──────────────────────────────────────────────────────────
    const [text, setText] = useState('');
    const [live, setLive] = useState(true);
    const [projected, setProjected] = useState(false);
    const [bgChoice, setBgChoice] = useState<BgChoice>({ kind: 'preset', css: '' });
    // culoarea textului (text simplu ȘI prezentare) — peste contentTextColor global
    const [textColor, setTextColor] = useState('#ffffff');
    // fundalul global configurat al proiecției — ca previzualizarea să arate exact
    // ce iese pe ecran (nu o altă culoare)
    const [projBg, setProjBg] = useState<{ bgType?: string; bgColor?: string; bgImagePath?: string }>({});
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // preluăm fundalul global + culoarea implicită a textului din setări (o singură dată)
    useEffect(() => {
        window.electron.settings.get().then(s => {
            setProjBg({ bgType: s.bgType, bgColor: s.bgColor, bgImagePath: s.bgImagePath });
            if (s.contentTextColor) setTextColor(s.contentTextColor);
        }).catch(() => { /* implicit */ });
    }, []);

    // Prima proiectare: deschide fereastra (cu dansul de focus, O SINGURĂ dată).
    const project = useCallback((value: string) => {
        window.electron.projection.showText({ text: value, background: bgToPayload(bgChoice), textColor });
        setProjected(true);
    }, [bgChoice, textColor]);

    // Actualizările ulterioare: canal PUR de date — fără creare de fereastră, fără
    // focus. showText la fiecare propagare fura focusul de pe textarea și înghițea
    // tastele: scriai „pe sărite".
    const update = useCallback((value: string) => {
        window.electron.projection.updateText({ text: value, background: bgToPayload(bgChoice), textColor });
    }, [bgChoice, textColor]);

    useEffect(() => {
        if (mode !== 'text' || !live || !projected) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => update(text), 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [text, live, projected, update, mode]);

    // schimbarea fundalului se propagă imediat dacă suntem proiectați
    useEffect(() => {
        if (mode === 'text' && projected) update(text);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bgChoice, textColor]);

    const stop = useCallback(() => {
        setProjected(false);
        window.electron.projection.close();
    }, []);

    // ── Prezentare (PPT convertit / șabloane) ────────────────────────────────
    const presRef = useRef<Presentation | null>(null);
    const [presName, setPresName] = useState<string | null>(null);
    const [slideCount, setSlideCount] = useState(0);
    const [curSlide, setCurSlide] = useState(0);
    const [presProjected, setPresProjected] = useState(false);
    const [templates, setTemplates] = useState<TemplateInfo[]>([]);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [saveName, setSaveName] = useState('');
    const [presStatus, setPresStatus] = useState('');
    const [importToast, setImportToast] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);          // modificări nesalvate în editor
    const [loadedFile, setLoadedFile] = useState<string | null>(null); // șablonul încărcat (null = PPT nou)
    const [rowMenu, setRowMenu] = useState<string | null>(null); // meniul „⋯" deschis pe un rând de șablon
    const [saveAsOpen, setSaveAsOpen] = useState(false); // dialogul „Salvează ca șablon nou"
    const [overlayOpen, setOverlayOpen] = useState(false);
    const [canvasFont, setCanvasFont] = useState(16);
    const [focusedShape, setFocusedShape] = useState<number | null>(null);
    const [, setShapeTick] = useState(0); // forțează re-randarea după mutații pe model
    const canvasRef = useRef<HTMLDivElement>(null);
    const presDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    // ultima selecție din interiorul unei casete — păstrată ca să putem aplica
    // culoare/mărime după ce pickerul nativ (input color / select) fură focusul
    const savedRangeRef = useRef<Range | null>(null);

    // închiderea editorului: dacă există modificări nesalvate, cere confirmare
    const attemptCloseOverlay = useCallback(() => {
        if (dirty && !window.confirm('Ai modificări nesalvate în acest șablon. Închizi fără să salvezi? (poți edita și proiecta și fără să salvezi)')) return;
        setOverlayOpen(false);
    }, [dirty]);

    // Esc global: primul închide editorul mare, al doilea oprește proiecția
    useEffect(() => {
        realtimeCtl.overlayOpen = overlayOpen;
        realtimeCtl.closeOverlay = attemptCloseOverlay;
        return () => { realtimeCtl.overlayOpen = false; };
    }, [overlayOpen, attemptCloseOverlay]);
    useEffect(() => {
        realtimeCtl.projected = projected || presProjected;
        realtimeCtl.stop = () => {
            setProjected(false);
            setPresProjected(false);
            window.electron.projection.close();
            liveBus.notify();
        };
        realtimeCtl.notifyClosed = () => {
            setProjected(false);
            setPresProjected(false);
            liveBus.notify();
        };
        liveBus.notify();   // badge LIVE global reflectă anunțul pornit/oprit
        return () => { realtimeCtl.projected = false; };
    }, [projected, presProjected]);

    const refreshTemplates = useCallback(() => {
        window.electron.templates.list().then(setTemplates).catch(() => setTemplates([]));
    }, []);
    useEffect(() => { if (mode === 'pres') refreshTemplates(); }, [mode, refreshTemplates]);

    // fontul din canvas scalează cu lățimea, ca pe proiecție (3.2vw acolo)
    useEffect(() => {
        if (!overlayOpen) return;
        const el = canvasRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setCanvasFont(el.clientWidth * 0.032));
        ro.observe(el);
        setCanvasFont(el.clientWidth * 0.032);
        return () => ro.disconnect();
    }, [overlayOpen, presName, slideCount]);

    // memorăm ultima selecție din interiorul unei casete editabile
    useEffect(() => {
        if (!overlayOpen) return;
        const onSel = () => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const node = sel.anchorNode;
            const host = (node instanceof Element ? node : node?.parentElement)?.closest('.pres-shape-inner');
            if (host) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
        };
        document.addEventListener('selectionchange', onSel);
        return () => document.removeEventListener('selectionchange', onSel);
    }, [overlayOpen]);

    // reaplică selecția salvată (după ce pickerul a furat focusul), apoi rulează fn
    const withSavedSelection = (fn: () => void) => {
        const r = savedRangeRef.current;
        if (r) {
            const host = (r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement)?.closest('.pres-shape-inner') as HTMLElement | null;
            host?.focus();
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
        }
        fn();
    };

    // scurtături Office în editor (focus în overlay) — nu fură navigarea pe slide-uri
    // fiindcă handlerul global ignoră săgețile când focusul e într-un contenteditable
    const onOverlayKeyDown = (e: React.KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        const align: Record<string, string> = { l: 'justifyLeft', e: 'justifyCenter', r: 'justifyRight', j: 'justifyFull' };
        if (k === 'z') { e.preventDefault(); exec(e.shiftKey ? 'redo' : 'undo'); }
        else if (k === 'y') { e.preventDefault(); exec('redo'); }
        else if (k === 'b') { e.preventDefault(); exec('bold'); }
        else if (k === 'i') { e.preventDefault(); exec('italic'); }
        else if (k === 'u') { e.preventDefault(); exec('underline'); }
        else if (align[k]) { e.preventDefault(); exec(align[k]); }
    };

    const setPresentation = (p: Presentation | null, file: string | null = null) => {
        presRef.current = p;
        setPresName(p?.name ?? null);
        setSlideCount(p?.slides.length ?? 0);
        setCurSlide(0);
        setPresProjected(false);
        setLoadedFile(file);
        setDirty(false);
        // fundalul vine implicit DIN fișier; resetăm orice alegere manuală anterioară
        // ca să NU mascheze fundalul importat (cauza «litere albe pe alb»)
        setBgChoice({ kind: 'preset', css: '' });
    };

    const slidePayload = useCallback((idx: number): ProjectionTextData => {
        const p = presRef.current!;
        const slide = p.slides[idx];
        return { shapes: slide.shapes, background: bgToPayload(bgChoice, slide), textColor };
    }, [bgChoice, textColor]);

    const projectSlide = useCallback((idx: number, first: boolean) => {
        const payload = slidePayload(idx);
        if (first) window.electron.projection.showText(payload);
        else window.electron.projection.updateText(payload);
        setPresProjected(true);
    }, [slidePayload]);

    const schedulePresUpdate = useCallback(() => {
        if (!presProjected) return;
        if (presDebounce.current) clearTimeout(presDebounce.current);
        presDebounce.current = setTimeout(() => {
            if (presRef.current) window.electron.projection.updateText(slidePayload(curSlide));
        }, 500);
    }, [presProjected, slidePayload, curSlide]);

    const goSlide = (idx: number) => {
        if (!presRef.current) return;
        const n = presRef.current.slides.length;
        const clamped = Math.max(0, Math.min(n - 1, idx));
        setCurSlide(clamped);
        if (presProjected) projectSlide(clamped, false);
    };

    // R2: publică navigarea slide-urilor pentru handlerul global de taste din App.
    // Fără listă de dependențe: rulează la fiecare render ca să folosească mereu
    // goSlide/curSlide curente (3 atribuiri pe obiect de modul — nu re-randează).
    useEffect(() => {
        realtimeCtl.presSlides = (mode === 'pres' && presProjected) ? slideCount : 0;
        realtimeCtl.nextSlide = () => goSlide(curSlide + 1);
        realtimeCtl.prevSlide = () => goSlide(curSlide - 1);
        return () => { realtimeCtl.presSlides = 0; };
    });

    const onShapeInput = (shapeIdx: number, el: HTMLElement) => {
        const p = presRef.current;
        if (!p) return;
        p.slides[curSlide].shapes[shapeIdx].html = sanitizePresHtml(el.innerHTML);
        setDirty(true);
        schedulePresUpdate();
    };

    // comenzi de formatare pe SELECȚIE. styleWithCSS:false → produce tag-uri
    // (b/i/u/liste); true → produce stiluri inline (culoare, mărime, tăiere,
    // indentare cu margin) compatibile cu sanitizer-ul. Butoanele folosesc
    // onMouseDown+preventDefault ca selecția să rămână în casetă.
    const exec = (cmd: string) => {
        document.execCommand('styleWithCSS', false, 'false');
        document.execCommand(cmd, false);
        setDirty(true);
    };
    const execCss = (cmd: string, val?: string) => {
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand(cmd, false, val);
        setDirty(true);
    };

    // acțiuni la nivel de CASETĂ (pe cea focalizată)
    const mutateShape = (fn: (sh: PresShape) => void) => {
        const p = presRef.current;
        if (!p || focusedShape == null) return;
        const sh = p.slides[curSlide]?.shapes[focusedShape];
        if (!sh) return;
        fn(sh);
        setShapeTick(t => t + 1);
        setDirty(true);
        schedulePresUpdate();
    };
    const cycleColumns = () => mutateShape(sh => {
        sh.columns = ((sh.columns ?? 1) % 3) + 1;
        if (sh.columns === 1) delete sh.columns;
    });
    const bumpFont = (delta: number) => mutateShape(sh => {
        sh.fontScale = Math.max(0.4, Math.min(3, +( (sh.fontScale ?? 1) + delta ).toFixed(2)));
        if (sh.fontScale === 1) delete sh.fontScale;
    });
    const addShape = () => {
        const p = presRef.current;
        if (!p) return;
        p.slides[curSlide].shapes.push({ x: 10, y: 40, w: 80, h: 22, html: '<p>Text nou</p>' });
        setShapeTick(t => t + 1);
        setFocusedShape(p.slides[curSlide].shapes.length - 1);
        setDirty(true);
        schedulePresUpdate();
    };
    const duplicateShape = () => {
        const p = presRef.current;
        if (!p || focusedShape == null) return;
        const src = p.slides[curSlide].shapes[focusedShape];
        if (!src) return;
        p.slides[curSlide].shapes.push({ ...src, x: Math.min(92, src.x + 3), y: Math.min(92, src.y + 3) });
        setFocusedShape(p.slides[curSlide].shapes.length - 1);
        setShapeTick(t => t + 1);
        setDirty(true);
        schedulePresUpdate();
    };
    const deleteShape = () => {
        const p = presRef.current;
        if (!p || focusedShape == null) return;
        if (p.slides[curSlide].shapes.length <= 1) return;
        p.slides[curSlide].shapes.splice(focusedShape, 1);
        setFocusedShape(null);
        setShapeTick(t => t + 1);
        setDirty(true);
        schedulePresUpdate();
    };
    // ancorarea verticală a textului în casetă (sus = implicit / mijloc / jos)
    const setAnchor = (a: 'top' | 'middle' | 'bottom') => mutateShape(sh => {
        if (a === 'top') delete sh.anchor; else sh.anchor = a;
    });
    // culoare / mărime font pe SELECȚIE (stiluri inline compatibile cu sanitizer-ul)
    const applyColor = (hex: string) => execCss('foreColor', hex);
    const applyFontSize = (level: string) => { if (level) execCss('fontSize', level); };

    // ── Salvarea șabloanelor: explicită (fără autosave); parolă la suprascriere ──
    const writeTemplate = async (name: string, file?: string) => {
        const info = await window.electron.templates.save(name, { ...presRef.current!, name: name.trim() }, file);
        setLoadedFile(info.file);
        setDirty(false);
        setSaveName('');
        refreshTemplates();
        setPresStatus(`Șablon salvat: ${info.name}`);
    };
    // „Salvează" = suprascrie șablonul ÎNCĂRCAT (există deja → cere parola)
    const onSaveOver = () => {
        if (!presRef.current || !loadedFile) return;
        const cur = templates.find(t => t.file === loadedFile);
        const name = cur?.name ?? presName ?? 'Șablon';
        adminGate.require(
            () => writeTemplate(name, loadedFile).catch(() => setPresStatus('Salvarea a eșuat.')),
            'Salvare șablon',
        );
    };
    // „Salvează ca…" = nume nou; dacă există deja un fișier cu acel nume → parolă
    const onSaveAs = () => {
        const name = saveName.trim();
        if (!name || !presRef.current) return;
        const safe = name.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'Șablon';
        const collide = templates.some(t => t.file === `${safe}.json`);
        const go = () => writeTemplate(name).then(() => setSaveAsOpen(false)).catch(() => setPresStatus('Salvarea a eșuat.'));
        if (collide) adminGate.require(go, 'Suprascriere șablon'); else go();
    };
    // duplicare cu nume nou liber (« (copie) », « (copie 2) »…) — fără parolă
    const duplicateTemplate = async (t: TemplateInfo) => {
        try {
            const p = await window.electron.templates.load(t.file);
            const exists = (nm: string) => templates.some(x => x.name.toLowerCase() === nm.toLowerCase());
            const base = `${t.name} (copie)`;
            let name = base, n = 2;
            while (exists(name)) name = `${base} ${n++}`;
            const info = await window.electron.templates.save(name, { ...p, name });
            refreshTemplates();
            setPresStatus(`Copie creată: ${info.name}`);
        } catch { setPresStatus('Duplicarea a eșuat.'); }
    };
    // readucerea unui șablon IMPLICIT la varianta livrată (pierde editările → parolă)
    const resetBuiltinTpl = (t: TemplateInfo) => {
        adminGate.require(async () => {
            try {
                const p = await window.electron.templates.resetBuiltin(t.file);
                refreshTemplates();
                if (loadedFile === t.file || presName === t.name) setPresentation(p, t.file);
                setPresStatus(`„${t.name}" a fost readus la varianta implicită.`);
            } catch { setPresStatus('Resetarea a eșuat.'); }
        }, 'Resetare șablon implicit');
    };

    // mutarea / redimensionarea casetelor cu mouse-ul (mânerele de pe casetă)
    const dragRef = useRef<{
        mode: 'move' | 'resize';
        idx: number;
        startX: number;
        startY: number;
        orig: { x: number; y: number; w: number; h: number };
    } | null>(null);

    const onGripDown = (idx: number, gripMode: 'move' | 'resize', e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const sh = presRef.current?.slides[curSlide]?.shapes[idx];
        const canvas = canvasRef.current;
        if (!sh || !canvas) return;
        setFocusedShape(idx);
        dragRef.current = {
            mode: gripMode, idx,
            startX: e.clientX, startY: e.clientY,
            orig: { x: sh.x, y: sh.y, w: sh.w, h: sh.h },
        };
        const rect = canvas.getBoundingClientRect();
        const onMove = (ev: MouseEvent) => {
            const d = dragRef.current;
            const shape = presRef.current?.slides[curSlide]?.shapes[d?.idx ?? -1];
            if (!d || !shape) return;
            const dx = ((ev.clientX - d.startX) / rect.width) * 100;
            const dy = ((ev.clientY - d.startY) / rect.height) * 100;
            if (d.mode === 'move') {
                shape.x = Math.max(0, Math.min(98 - Math.min(d.orig.w, 98), d.orig.x + dx));
                shape.y = Math.max(0, Math.min(96, d.orig.y + dy));
            } else {
                shape.w = Math.max(6, Math.min(100 - d.orig.x, d.orig.w + dx));
                shape.h = Math.max(4, Math.min(100 - d.orig.y, d.orig.h + dy));
            }
            setShapeTick(t => t + 1);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (dragRef.current) {
                dragRef.current = null;
                setDirty(true);
                schedulePresUpdate();
            }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const slide = presRef.current?.slides[curSlide];
    const bgPayloadToCss = (b: ProjectionTextData['background']): string | undefined => {
        if (!b) return undefined;
        return b.type === 'image' ? `url('localfile://${encodeURI(b.value)}') center / cover no-repeat` : b.value;
    };
    // fundalul global al proiecției — folosit ca fallback ca editorul/preview-ul să
    // arate EXACT ce iese pe ecran când nu există fundal per-slide/manual
    const projFallbackCss = (() => {
        if (projBg.bgType === 'image' && projBg.bgImagePath) return `url('localfile://${encodeURI(projBg.bgImagePath)}') center / cover no-repeat`;
        return projBg.bgColor || '#000000';
    })();
    const canvasBgCss = slide ? bgPayloadToCss(bgToPayload(bgChoice, slide)) : undefined;
    // previzualizarea pentru „text simplu": exact fundalul + culoarea ce vor apărea
    const textPreviewBgCss = bgPayloadToCss(bgToPayload(bgChoice)) ?? projFallbackCss;

    return (
        <div className="content-inner message-panel rt-host">
            <div className="timer-mode-switch">
                <button className={`timer-mode-btn ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')}>
                    Text simplu
                </button>
                <button className={`timer-mode-btn ${mode === 'pres' ? 'active' : ''}`} onClick={() => setMode('pres')}>
                    Prezentare
                </button>
            </div>

            {mode === 'text' && (
                <div className="rt-layout">
                    <div className="rt-left">
                        <label className="timer-label">Text de proiectat</label>
                        <textarea
                            className="message-textarea"
                            placeholder="Scrie un mesaj... apare pe proiecție în timp real."
                            value={text}
                            onChange={e => setText(e.target.value)}
                            rows={6}
                        />
                        <label className="timer-checkbox">
                            <input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} />
                            Actualizare în timp real (pe măsură ce scrii)
                        </label>
                        <div className="field">
                            <label className="timer-label">Culoare text</label>
                            <div className="color-row">
                                <input
                                    type="color"
                                    className="color-input"
                                    value={/^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#ffffff'}
                                    onChange={e => setTextColor(e.target.value)}
                                />
                                <span className="color-hex">{textColor}</span>
                            </div>
                        </div>
                        <BackgroundPicker bg={bgChoice} onChange={setBgChoice} />
                        <div className="timer-actions">
                            {!projected ? (
                                <button className="btn-project timer-start" onClick={() => project(text)}>Proiectează</button>
                            ) : (
                                <>
                                    {live && <span className="live-indicator">● LIVE</span>}
                                    {!live && (
                                        <button className="btn-project timer-start" onClick={() => update(text)}>Trimite</button>
                                    )}
                                    <button className="btn-sm timer-stop" onClick={stop}>Oprește</button>
                                </>
                            )}
                        </div>
                        <p className="timer-hint">Bun pentru anunțuri, urări, un verset tastat manual sau „Pauză 10 min".</p>
                    </div>
                    <div className="rt-right">
                        <label className="timer-label">Previzualizare (cum apare pe ecran)</label>
                        <div className="rt-preview" style={{ background: textPreviewBgCss }}>
                            <div className="rt-preview-center rt-preview-text" style={{ color: textColor }}>
                                {text.trim() || 'Scrie un mesaj…'}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {mode === 'pres' && (
                <div className="rt-layout">
                    <div className="rt-left">
                        <button className="btn-sm rt-import-btn" onClick={async () => {
                            const file = await window.electron.presentation.pickFile();
                            if (!file) return;
                            setPresStatus('Se convertește prezentarea...');
                            const res = await window.electron.presentation.parse(file);
                            if (res.ok) {
                                setPresentation(res.data, null);
                                setPresStatus('');
                                setOverlayOpen(true);
                                const s = res.summary;
                                setImportToast(s
                                    ? `Am adus din PPT: fundal ${s.background ? '✓' : '✗'} · culori text ${s.colors ? '✓' : '✗'} · ${s.images} ${s.images === 1 ? 'imagine' : 'imagini'} · ${s.textBoxes} casete text · ${s.slides} slide-uri`
                                    : null);
                            }
                            else setPresStatus(res.error);
                        }}><Upload className="icon-xs" /> Importă din PowerPoint</button>

                        <div className="tpl-manager">
                            <label className="timer-label">Șabloane</label>
                            {/* PPT importat, încă nesalvat — rând temporar sus, ca să-l poți redeschide */}
                            {presName !== null && loadedFile === null && (
                                <div className="tpl-row tpl-row-transient">
                                    <button className="tpl-name" title="Continuă editarea" onClick={() => setOverlayOpen(true)}>
                                        <FileText className="icon-xs" /> {presName}
                                        <span className="tpl-badge tpl-badge-warn">nesalvat</span>
                                    </button>
                                </div>
                            )}
                            {templates.length === 0 && <p className="timer-hint">Niciun șablon încă — importă un PowerPoint sau salvează unul din editor.</p>}
                            {templates.map((t, i) => (
                                <div key={t.file}>
                                    <div className="tpl-row">
                                        <button
                                            className="tpl-name"
                                            title="Încarcă în previzualizare (apoi «Proiectează» sau «Editează»)"
                                            onClick={async () => {
                                                try {
                                                    const p = await window.electron.templates.load(t.file);
                                                    setPresentation(p, t.file);
                                                    setPresStatus('');
                                                } catch { setPresStatus('Nu am putut încărca șablonul.'); }
                                            }}
                                        >{t.name}{t.builtin && <span className="tpl-badge">implicit</span>}</button>
                                        <button className={`tpl-btn ${rowMenu === t.file ? 'active' : ''}`} title="Mai multe" onClick={() => setRowMenu(rowMenu === t.file ? null : t.file)}>
                                            <MoreHorizontal className="icon-xs" />
                                        </button>
                                    </div>
                                    {rowMenu === t.file && (
                                        <div className="tpl-actions">
                                            <button onClick={() => { setRowMenu(null); duplicateTemplate(t); }}><Copy className="icon-xs" /> Duplică</button>
                                            {t.builtin && <button onClick={() => { setRowMenu(null); resetBuiltinTpl(t); }}><RotateCcw className="icon-xs" /> Resetează la implicit</button>}
                                            <button disabled={i === 0} onClick={async () => {
                                                const files = templates.map(x => x.file);
                                                [files[i - 1], files[i]] = [files[i], files[i - 1]];
                                                await window.electron.templates.reorder(files); refreshTemplates();
                                            }}>↑ Mută sus</button>
                                            <button disabled={i === templates.length - 1} onClick={async () => {
                                                const files = templates.map(x => x.file);
                                                [files[i + 1], files[i]] = [files[i], files[i + 1]];
                                                await window.electron.templates.reorder(files); refreshTemplates();
                                            }}>↓ Mută jos</button>
                                            {confirmDelete === t.file ? (
                                                <button className="tpl-act-danger" onClick={() => {
                                                    setConfirmDelete(null); setRowMenu(null);
                                                    adminGate.require(async () => { await window.electron.templates.delete(t.file); refreshTemplates(); }, 'Ștergere șablon');
                                                }}>Sigur ștergi?</button>
                                            ) : (
                                                <button className="tpl-act-danger" onClick={() => setConfirmDelete(t.file)}><Trash2 className="icon-xs" /> Șterge</button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {presStatus && <p className="timer-hint">{presStatus}</p>}
                        {importToast && (
                            <p className="import-toast">
                                {importToast}
                                <button className="import-toast-x" onClick={() => setImportToast(null)} title="Închide">✕</button>
                            </p>
                        )}
                    </div>

                    <div className="rt-right">
                        <label className="timer-label">Previzualizare</label>
                        {presRef.current && slide ? (<>
                            <div className="rt-preview" style={{ background: canvasBgCss ?? projFallbackCss, color: textColor }}>
                                {slide.shapes.map((sh, i) => sh.imageSrc ? (
                                    <div key={i} className="rt-pv-shape" style={{ left: `${sh.x}%`, top: `${sh.y}%`, width: `${sh.w}%`, height: `${sh.h}%` }}>
                                        <img src={`localfile://${encodeURI(sh.imageSrc)}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    </div>
                                ) : (
                                    <div key={i} className="rt-pv-shape" style={{
                                        left: `${sh.x}%`, top: `${sh.y}%`, width: `${sh.w}%`, minHeight: `${sh.h}%`,
                                        ...(sh.fontScale ? { fontSize: `${sh.fontScale}em` } : {}),
                                        ...(sh.columns && sh.columns > 1 ? { columnCount: sh.columns, columnGap: '1.2em' } : {}),
                                        ...(sh.anchor ? { height: `${sh.h}%`, display: 'flex', flexDirection: 'column', justifyContent: sh.anchor === 'middle' ? 'center' : 'flex-end' } : {}),
                                    }} dangerouslySetInnerHTML={{ __html: sh.html }} />
                                ))}
                            </div>
                            <div className="rt-preview-nav">
                                <button className="btn-sm" disabled={curSlide === 0} onClick={() => goSlide(curSlide - 1)}>‹</button>
                                <span className="text-white/60 text-xs">slide {curSlide + 1} / {slideCount}</span>
                                <button className="btn-sm" disabled={curSlide >= slideCount - 1} onClick={() => goSlide(curSlide + 1)}>›</button>
                            </div>
                            <div className="timer-actions">
                                <button className="btn-project timer-start" onClick={() => setOverlayOpen(true)}><Edit3 className="icon-xs" /> Editează</button>
                                {!presProjected ? (
                                    <button className="btn-project" onClick={() => projectSlide(curSlide, true)}>Proiectează</button>
                                ) : (<>
                                    <span className="live-indicator">● LIVE</span>
                                    <button className="btn-sm timer-stop" onClick={() => { setPresProjected(false); window.electron.projection.close(); }}>Oprește</button>
                                </>)}
                            </div>
                        </>) : (
                            <div className="rt-preview rt-preview-empty">
                                <div className="rt-preview-center rt-preview-hint">
                                    Alege un șablon din stânga sau importă un PowerPoint ca să vezi previzualizarea aici.
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {overlayOpen && presRef.current && (
                <div className="pres-overlay" onKeyDown={onOverlayKeyDown}>
                    <div className="pres-overlay-header">
                        <span className="pres-overlay-title">
                            {presName}{dirty && <span className="pres-dirty"> • nesalvat</span>}
                        </span>
                        <div className="pres-toolbar">
                            {/* istoric */}
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('undo'); }} title="Anulează (Ctrl+Z)"><Undo2 className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('redo'); }} title="Refă (Ctrl+Y)"><Redo2 className="icon-xs" /></button>
                            <span className="pres-toolbar-sep" />
                            {/* mărime + culoare text (pe selecție) */}
                            <select className="pres-tb-select" title="Mărime text (selecție)" value="" onMouseDown={() => { /* selecția e deja memorată */ }}
                                onChange={e => { const v = e.target.value; if (v) withSavedSelection(() => applyFontSize(v)); }}>
                                <option value="" disabled>Mărime</option>
                                <option value="1">Foarte mic</option>
                                <option value="2">Mic</option>
                                <option value="3">Normal</option>
                                <option value="4">Mediu</option>
                                <option value="5">Mare</option>
                                <option value="6">Foarte mare</option>
                                <option value="7">Uriaș</option>
                            </select>
                            <label className="pres-tb-btn pres-tb-color" title="Culoare text (selecție)">
                                <Baseline className="icon-xs" />
                                <input type="color" onChange={e => withSavedSelection(() => applyColor(e.target.value))} />
                            </label>
                            <span className="pres-toolbar-sep" />
                            {/* stil text */}
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('bold'); }} title="Îngroșat (Ctrl+B)"><Bold className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('italic'); }} title="Înclinat (Ctrl+I)"><Italic className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('underline'); }} title="Subliniat (Ctrl+U)"><Underline className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); execCss('strikeThrough'); }} title="Tăiat"><Strikethrough className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('removeFormat'); }} title="Șterge formatarea"><Eraser className="icon-xs" /></button>
                            <span className="pres-toolbar-sep" />
                            {/* paragraf */}
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('justifyLeft'); }} title="Aliniere stânga (Ctrl+L)"><AlignLeft className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('justifyCenter'); }} title="Centrat (Ctrl+E)"><AlignCenter className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('justifyRight'); }} title="Aliniere dreapta (Ctrl+R)"><AlignRight className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('justifyFull'); }} title="Aliniere stânga-dreapta"><AlignJustify className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }} title="Listă cu buline"><List className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }} title="Listă numerotată"><ListOrdered className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); execCss('outdent'); }} title="Micșorează indentarea"><IndentDecrease className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); execCss('indent'); }} title="Mărește indentarea"><IndentIncrease className="icon-xs" /></button>
                            <span className="pres-toolbar-sep" />
                            {/* casetă (pe cea selectată) */}
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); setAnchor('top'); }} disabled={focusedShape == null} title="Text sus în casetă"><AlignVerticalJustifyStart className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); setAnchor('middle'); }} disabled={focusedShape == null} title="Text la mijloc"><AlignVerticalJustifyCenter className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); setAnchor('bottom'); }} disabled={focusedShape == null} title="Text jos în casetă"><AlignVerticalJustifyEnd className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); cycleColumns(); }} disabled={focusedShape == null} title="Coloane (1 → 2 → 3)"><Columns3 className="icon-xs" />{focusedShape != null && (slide?.shapes[focusedShape]?.columns ?? 1) > 1 ? slide?.shapes[focusedShape]?.columns : ''}</button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); bumpFont(0.15); }} disabled={focusedShape == null} title="Casetă: text mai mare">A+</button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); bumpFont(-0.15); }} disabled={focusedShape == null} title="Casetă: text mai mic">A−</button>
                            <span className="pres-toolbar-sep" />
                            {/* casete */}
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); addShape(); }} title="Casetă de text nouă"><Plus className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); duplicateShape(); }} disabled={focusedShape == null} title="Duplică caseta"><Copy className="icon-xs" /></button>
                            <button className="pres-tb-btn" onMouseDown={e => { e.preventDefault(); deleteShape(); }} disabled={focusedShape == null || (slide?.shapes.length ?? 0) <= 1} title="Șterge caseta"><Trash2 className="icon-xs" /></button>
                        </div>
                        <div className="pres-overlay-actions">
                            {!presProjected ? (
                                <button className="btn-project timer-start" onClick={() => projectSlide(curSlide, true)}>Proiectează</button>
                            ) : (
                                <>
                                    <span className="live-indicator">● LIVE</span>
                                    <button className="btn-sm timer-stop" onClick={() => { setPresProjected(false); window.electron.projection.close(); }}>Oprește</button>
                                </>
                            )}
                            <button className="btn-sm" onClick={attemptCloseOverlay} title="Închide editorul (Esc)">
                                Închide
                            </button>
                        </div>
                    </div>

                    <div className="pres-overlay-body">
                        <button
                            className="pres-arrow pres-arrow-left"
                            disabled={curSlide === 0}
                            onClick={() => goSlide(curSlide - 1)}
                            title="Slide anterior"
                        >‹</button>
                        <button
                            className="pres-arrow pres-arrow-right"
                            disabled={curSlide >= slideCount - 1}
                            onClick={() => goSlide(curSlide + 1)}
                            title="Slide următor"
                        >›</button>
                        <div
                            className="pres-canvas pres-canvas-big"
                            ref={canvasRef}
                            style={{ fontSize: canvasFont, background: canvasBgCss ?? projFallbackCss, color: textColor }}
                            onMouseDown={e => { if (e.target === e.currentTarget) setFocusedShape(null); }}
                        >
                            {slide?.shapes.map((sh, i) => (
                                <div
                                    key={`${presName}-${curSlide}-${i}`}
                                    className={`pres-shape ${focusedShape === i ? 'pres-shape-focused' : ''}`}
                                    style={{ left: `${sh.x}%`, top: `${sh.y}%`, width: `${sh.w}%`, minHeight: `${sh.h}%` }}
                                    onFocus={() => setFocusedShape(i)}
                                    onMouseDown={() => setFocusedShape(i)}
                                >
                                    {/* mânerele NU sunt în interiorul zonei editabile */}
                                    <div
                                        className="pres-grip pres-grip-move"
                                        title="Trage pentru a muta caseta"
                                        onMouseDown={e => onGripDown(i, 'move', e)}
                                    >⠿</div>
                                    <div
                                        className="pres-grip pres-grip-resize"
                                        title="Trage pentru a redimensiona"
                                        onMouseDown={e => onGripDown(i, 'resize', e)}
                                    />
                                    {sh.imageSrc ? (
                                        <img
                                            className="pres-shape-img"
                                            src={`localfile://${encodeURI(sh.imageSrc)}`}
                                            alt=""
                                            draggable={false}
                                        />
                                    ) : (
                                        <div
                                            className="pres-shape-inner"
                                            contentEditable
                                            suppressContentEditableWarning
                                            style={{
                                                ...(sh.fontScale ? { fontSize: `${sh.fontScale}em` } : {}),
                                                ...(sh.columns && sh.columns > 1 ? { columnCount: sh.columns, columnGap: '1.2em' } : {}),
                                                ...(sh.anchor ? { display: 'flex', flexDirection: 'column', justifyContent: sh.anchor === 'middle' ? 'center' : 'flex-end', height: '100%' } : {}),
                                            }}
                                            onInput={e => onShapeInput(i, e.currentTarget)}
                                            dangerouslySetInnerHTML={{ __html: sh.html }}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="pres-overlay-footer">
                        <div className="pres-nav">
                            <button className="btn-sm" disabled={curSlide === 0} onClick={() => goSlide(curSlide - 1)}>‹</button>
                            <span className="text-white/60 text-xs">slide {curSlide + 1} / {slideCount}</span>
                            <button className="btn-sm" disabled={curSlide >= slideCount - 1} onClick={() => goSlide(curSlide + 1)}>›</button>
                            <button className="btn-sm" onClick={() => {
                                const p = presRef.current!;
                                p.slides.splice(curSlide + 1, 0, { shapes: [{ x: 8, y: 12, w: 84, h: 76, html: '<p style="text-align:center">Text nou</p>' }] });
                                setSlideCount(p.slides.length);
                                setDirty(true);
                                goSlide(curSlide + 1);
                            }}>+ Slide</button>
                            <button className="btn-sm" disabled={slideCount <= 1} onClick={() => {
                                const p = presRef.current!;
                                p.slides.splice(curSlide, 1);
                                setSlideCount(p.slides.length);
                                setDirty(true);
                                const next = Math.min(curSlide, p.slides.length - 1);
                                goSlide(next);
                                if (presProjected) projectSlide(next, false);
                            }}>Șterge slide</button>
                        </div>

                        {/* fundal + culoare text (afectează ce iese pe ecran) */}
                        <div className="pres-settings">
                            <BackgroundPicker
                                bg={bgChoice}
                                existingLabel="Existent"
                                onChange={b => { setBgChoice(b); if (presProjected) setTimeout(() => projectSlide(curSlide, false), 0); }}
                            />
                            <div className="field">
                                <label className="timer-label">Culoare text</label>
                                <div className="color-row">
                                    <input
                                        type="color"
                                        className="color-input"
                                        value={/^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#ffffff'}
                                        onChange={e => { setTextColor(e.target.value); if (presProjected) setTimeout(() => projectSlide(curSlide, false), 0); }}
                                    />
                                    <span className="color-hex">{textColor}</span>
                                </div>
                                <span className="timer-hint">Se aplică textului fără culoare proprie (cele colorate din PPT rămân).</span>
                            </div>
                        </div>

                        <div className="pres-save">
                            {loadedFile && (
                                <button className="btn-project" disabled={!dirty} title="Salvează peste șablonul curent (cere parola)" onClick={onSaveOver}>
                                    Salvează
                                </button>
                            )}
                            <button className="btn-sm" title="Salvează o copie cu un nume nou" onClick={() => { setSaveName(loadedFile ? '' : (presName ?? '')); setSaveAsOpen(true); }}>
                                Salvează ca șablon nou…
                            </button>
                        </div>
                    </div>

                    {saveAsOpen && (
                        <div className="pres-saveas" onMouseDown={e => { if (e.target === e.currentTarget) setSaveAsOpen(false); }}>
                            <div className="pres-saveas-box">
                                <label className="timer-label">Nume pentru noul șablon</label>
                                <input
                                    className="timer-text-input"
                                    autoFocus
                                    type="text"
                                    placeholder="ex: Anunțuri duminică"
                                    value={saveName}
                                    onChange={e => setSaveName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') onSaveAs(); if (e.key === 'Escape') setSaveAsOpen(false); }}
                                />
                                <div className="editor-actions" style={{ marginTop: 10 }}>
                                    <button className="btn-project" disabled={!saveName.trim()} onClick={onSaveAs}>Salvează</button>
                                    <button className="btn-clear" onClick={() => setSaveAsOpen(false)}>Anulează</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function UpdateChecker() {
    const [checking, setChecking] = useState(false)
    const [downloading, setDownloading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [result, setResult] = useState<{ available: boolean; version?: string } | null>(null)
    const [ready, setReady] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const onProg = (data: { percent: number }) => setProgress(data.percent)
        const onDone = () => { setDownloading(false); setReady(true) }
        const onErr = (msg: string) => { setDownloading(false); setError(msg) }
        window.electron.update.onProgress(onProg)
        window.electron.update.onDownloaded(onDone)
        window.electron.update.onError(onErr)
        return () => {
            window.electron.update.offProgress()
            window.electron.update.offDownloaded()
            window.electron.update.offError()
        }
    }, [])

    const doCheck = async () => {
        setChecking(true)
        setResult(null)
        setError(null)
        setReady(false)
        try {
            const info = await window.electron.update.check()
            setResult(info)
        } catch {
            setError('Nu s-a putut verifica. Verifică conexiunea la internet.')
        }
        setChecking(false)
    }

    const doDownloadAndInstall = async () => {
        setDownloading(true)
        setProgress(0)
        setError(null)
        try {
            await window.electron.update.download()
        } catch {
            setDownloading(false)
            setError('Descărcarea a eșuat.')
        }
    }

    const doInstall = () => {
        window.electron.update.install()
    }

    return (
        <div className="text-sm text-white/60 leading-relaxed w-full">
            <p className="font-semibold text-white/80 mb-3 text-center">Actualizare aplicație</p>
            <div className="flex flex-col items-center gap-2">
                {!result && !checking && !downloading && !ready && (
                    <button className="btn-sm" onClick={doCheck}>
                        Verifică actualizări
                    </button>
                )}

                {checking && (
                    <p className="text-white/40 text-xs">Se verifică...</p>
                )}

                {result && !result.available && !downloading && !ready && (
                    <p className="text-green-400 text-xs">✓ Ai cea mai recentă versiune.</p>
                )}

                {result && result.available && !downloading && !ready && (
                    <div className="flex flex-col items-center gap-2">
                        <p className="text-yellow-400 text-xs">
                            Versiune nouă disponibilă: <strong>{result.version}</strong>
                        </p>
                        <button className="btn-sm" onClick={doDownloadAndInstall}>
                            Descarcă și instalează
                        </button>
                    </div>
                )}

                {downloading && (
                    <div className="flex flex-col items-center gap-2 w-full max-w-xs">
                        <p className="text-white/40 text-xs">Se descarcă... {progress.toFixed(0)}%</p>
                        <div className="w-full bg-white/10 rounded-full h-2">
                            <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                )}

                {ready && (
                    <div className="flex flex-col items-center gap-2">
                        <p className="text-green-400 text-xs">Actualizare descărcată! Aplicația va reporni.</p>
                        <button className="btn-sm" onClick={doInstall}>
                            Instalează și repornește
                        </button>
                    </div>
                )}

                {error && (
                    <p className="text-red-400 text-xs">{error}</p>
                )}
            </div>
        </div>
    )
}

function YtDlpSettings() {
    const [installed, setInstalled] = useState<boolean | null>(null);
    const [version, setVersion] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');

    useEffect(() => {
        (async () => {
            const inst = await window.electron.ytdlp.isInstalled();
            setInstalled(inst);
            if (inst) {
                const v = await window.electron.ytdlp.version();
                setVersion(v);
            }
        })();
    }, []);

    const install = async () => {
        setLoading(true);
        setStatus('Se descarcă yt-dlp...');
        try {
            await window.electron.ytdlp.install();
            setInstalled(true);
            const v = await window.electron.ytdlp.version();
            setVersion(v);
            setStatus('yt-dlp instalat cu succes!');
        } catch (err: any) {
            setStatus('Eroare: ' + (err.message ?? 'necunoscută'));
        }
        setLoading(false);
    };

    const update = async () => {
        setLoading(true);
        setStatus('Se actualizează yt-dlp...');
        try {
            await window.electron.ytdlp.update();
            const v = await window.electron.ytdlp.version();
            setVersion(v);
            setStatus('yt-dlp actualizat!');
        } catch (err: any) {
            setStatus('Eroare: ' + (err.message ?? 'necunoscută'));
        }
        setLoading(false);
    };

    return (
        <div className="text-sm text-white/60 leading-relaxed w-full">
            <p className="font-semibold text-white/80 mb-2">yt-dlp (YouTube)</p>
            {installed === null && <p className="text-white/40 text-xs">Se verifică...</p>}
            {installed === false && (
                <div className="flex flex-col items-center gap-2">
                    <p className="text-white/40 text-xs">yt-dlp nu este instalat</p>
                    <button
                        className="btn-sm"
                        onClick={install}
                        disabled={loading}
                    >
                        {loading ? 'Se instalează...' : 'Instalează yt-dlp'}
                    </button>
                </div>
            )}
            {installed === true && (
                <div className="flex flex-col items-center gap-2">
                    <p className="text-white/40 text-xs">Versiune: {version || 'se verifică…'}</p>
                    <button
                        className="btn-sm"
                        onClick={update}
                        disabled={loading}
                    >
                        {loading ? 'Se actualizează...' : 'Actualizează yt-dlp'}
                    </button>
                </div>
            )}
            {status && <p className="text-white/50 text-xs mt-1">{status}</p>}
        </div>
    );
}

function AudioOutputPicker({ settings, onSave }: {
    settings: AppSettings;
    onSave: (p: Partial<AppSettings>) => void;
}) {
    const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
    const [loaded, setLoaded] = useState(false);

    const loadDevices = async () => {
        try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const outputs = allDevices
                .filter(d => d.kind === 'audiooutput')
                .map(d => ({ deviceId: d.deviceId, label: d.label || `Dispozitiv ${d.deviceId.slice(0, 8)}` }));
            setDevices(outputs);
            setLoaded(true);
        } catch {
            setDevices([]);
            setLoaded(true);
        }
    };

    return (
        <div className="field">
            <label>Ieșire Audio (Video)</label>
            <div className="display-picker">
                <button className="btn-sm" onClick={loadDevices}>Detectează dispozitive</button>
                {loaded && (
                    <div className="display-list">
                        <button
                            className={`display-btn ${!settings.audioOutputDeviceId ? 'active' : ''}`}
                            onClick={() => onSave({ audioOutputDeviceId: '' })}
                        >
                            Implicit (sistem)
                        </button>
                        {devices.map(d => (
                            <button
                                key={d.deviceId}
                                className={`display-btn ${settings.audioOutputDeviceId === d.deviceId ? 'active' : ''}`}
                                onClick={() => onSave({ audioOutputDeviceId: d.deviceId })}
                            >
                                {d.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function DownloadFolderPicker({ settings, onSave }: {
    settings: AppSettings;
    onSave: (p: Partial<AppSettings>) => void;
}) {
    const [defaultFolder, setDefaultFolder] = useState('');

    useEffect(() => {
        window.electron.playlist.getDownloadFolder().then(f => setDefaultFolder(f));
    }, []);

    const currentFolder = settings.downloadFolder || defaultFolder;

    return (
        <div className="field">
            <label>Folder Descărcări YouTube</label>
            <div className="field-row">
                <span className="field-value" title={currentFolder}>
                    {currentFolder ? currentFolder.split('/').slice(-2).join('/') : 'Se detectează...'}
                </span>
                <button className="btn-sm" onClick={async () => {
                    const p = await window.electron.dialog.selectFolder();
                    if (p) onSave({ downloadFolder: p });
                }}>Schimbă...</button>
                {settings.downloadFolder && (
                    <button className="btn-sm" onClick={() => onSave({ downloadFolder: undefined })}>
                        Resetează
                    </button>
                )}
            </div>
            <p className="text-white/40 text-xs mt-1">
                Folderul în care se salvează videoclipurile descărcate de pe YouTube.
            </p>
        </div>
    );
}

function DisplayPicker({ settings, onSave }: {
    settings: AppSettings;
    onSave: (p: Partial<AppSettings>) => void;
}) {
    const [displays, setDisplays] = useState<any[]>([]);
    const [loaded, setLoaded] = useState(false);

    return (
        <div className="display-picker">
            <button className="btn-sm" onClick={async () => {
                const d = await window.electron.screen.getDisplays();
                setDisplays(d);
                setLoaded(true);
            }}>Detectează ecrane</button>
            {loaded && (
                <div className="display-list">
                    {displays.map((d: any) => (
                        <button
                            key={d.id}
                            className={`display-btn ${settings.projectionDisplayId === d.id ? 'active' : ''}`}
                            onClick={() => onSave({ projectionDisplayId: d.id })}
                        >
                            {d.label} ({d.width}×{d.height})
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default App;
