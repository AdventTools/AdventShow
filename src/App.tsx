import {
    AlertCircle,
    Book,
    ChevronLeft,
    ChevronRight,
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

type Tab = 'imnuri' | 'biblia' | 'video';

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

    // ── Preview state ──
    const [previewType, setPreviewType] = useState<'hymn' | 'bible' | null>(null);
    const [previewSections, setPreviewSections] = useState<{ text: string; type: string; label: string }[]>([]);
    const [previewTitle, setPreviewTitle] = useState('');
    const [previewNumber, setPreviewNumber] = useState('');

    // ── Projection state ──
    const [projecting, setProjecting] = useState(false);
    const [projSlideIndex, setProjSlideIndex] = useState(0);

    // ── Update state ──
    const [updateInfo, setUpdateInfo] = useState<{
        available: boolean; version?: string;
    } | null>(null);
    const [updateDownloading, setUpdateDownloading] = useState(false);
    const [updateProgress, setUpdateProgress] = useState(0);
    const [updateReady, setUpdateReady] = useState(false);
    const [updateError, setUpdateError] = useState<string | null>(null);

    // ── Video state ──
    const [videoStatus, setVideoStatus] = useState<{
        currentTime: number; duration: number; paused: boolean;
    } | null>(null);
    const [videoName, setVideoName] = useState('');
    const [videoUrl, setVideoUrl] = useState('');
    const [videoLoading, setVideoLoading] = useState(false);
    const [videoConverting, setVideoConverting] = useState(false);
    const [videoVolume, setVideoVolume] = useState(1);
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
    });
    const tabRef = useRef<Tab>('imnuri');

    // Keep ref in sync
    useEffect(() => { projSlideIndexRef.current = projSlideIndex; }, [projSlideIndex]);

    // Mark search as "new" whenever refSearch changes
    useEffect(() => { searchConsumedRef.current = false; }, [refSearch]);

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

    // Check for updates on mount + listen for auto-updater events
    useEffect(() => {
        window.electron.update.check()
            .then(info => { if (info.available) setUpdateInfo(info) })
            .catch(() => { /* silently ignore */ });

        window.electron.update.onAvailable((data) => {
            setUpdateInfo({ available: true, version: data.version });
        });
        window.electron.update.onProgress((data) => {
            setUpdateProgress(data.percent);
        });
        window.electron.update.onDownloaded(() => {
            setUpdateDownloading(false);
            setUpdateReady(true);
        });
        window.electron.update.onError((msg) => {
            setUpdateDownloading(false);
            setUpdateError(msg);
        });

        return () => {
            window.electron.update.offAvailable();
            window.electron.update.offProgress();
            window.electron.update.offDownloaded();
            window.electron.update.offError();
        };
    }, []);

    // Video status listener
    useEffect(() => {
        window.electron.video.onStatus((data) => setVideoStatus(data));
        window.electron.video.onConverting((converting) => setVideoConverting(converting));
        return () => {
            window.electron.video.offStatus();
            window.electron.video.offConverting();
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

        // If projecting, fluid hymn switch — show title slide first
        if (projecting) {
            const secs = expanded.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection));
            await window.electron.projection.updateHymn(secs, data.title, String(data.number), -1, 'hymn');
            setProjSlideIndex(-1);
        }
    }, [projecting]);

    // ── Preview bible search result ──
    const previewBibleResult = useCallback(async (verse: BibleVerse) => {
        if (!verse.book_id || !verse.chapter) return;
        const book = books.find(b => b.id === verse.book_id);
        // Show ONLY the clicked verse in preview
        const sec = {
            text: verse.text,
            type: 'verse',
            label: `v. ${verse.verse}`,
        };
        setPreviewType('bible');
        setPreviewSections([sec]);
        setPreviewTitle(`${book?.name ?? verse.book_name ?? ''} ${verse.chapter}:${verse.verse}`);
        setPreviewNumber(book?.abbreviation ?? verse.abbreviation ?? '');
        setProjSlideIndex(0);
    }, [books]);

    // ── Clear preview ──
    const clearPreview = useCallback(() => {
        setPreviewType(null);
        setPreviewSections([]);
        setPreviewTitle('');
        setPreviewNumber('');
        setProjSlideIndex(0);
        setSelectedHymnId(null);
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
    }, [previewSections, previewTitle, previewNumber, previewType]);

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
    }, []);

    // Listen for projection closed
    useEffect(() => {
        window.electron.projection.onClosed(() => {
            setProjecting(false);
            setProjSlideIndex(0);
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
        const chs = await window.electron.bible.getChapters(book.id);
        setChapters(chs);
    }, []);

    const selectChapter = useCallback(async (ch: number) => {
        if (!selectedBookId) return;
        setSelectedChapter(ch);
        const vrs = await window.electron.bible.getVerses(selectedBookId, ch);
        setVerses(vrs);
        setSelectedVerseIdx(0);
    }, [selectedBookId]);

    // When a chapter is selected and verses load, show the first verse in preview
    useEffect(() => {
        if (skipAutoPreviewRef.current) {
            skipAutoPreviewRef.current = false;
            return;
        }
        if (verses.length > 0 && selectedChapter) {
            const book = books.find(b => b.id === selectedBookId);
            const v = verses[0];
            setPreviewType('bible');
            setPreviewSections([{
                text: v.text,
                type: 'verse',
                label: `v. ${v.verse}`,
            }]);
            setPreviewTitle(`${book?.name ?? ''} ${selectedChapter}:${v.verse}`);
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
        try {
            const result = await window.electron.video.prepare(filePath);
            if (result.error) {
                console.error('Video prepare error:', result.error);
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
            console.error('Video prepare failed:', err);
        }
        setVideoLoading(false);
    }, []);

    const videoStartPlayback = useCallback(async (url: string, name: string) => {
        setVideoName(name);
        setVideoUrl(url);
        setVideoStatus({ currentTime: 0, duration: 0, paused: true });
        await window.electron.video.startPlayback(url, name);
    }, []);

    const videoPlay = useCallback(() => window.electron.video.play(), []);
    const videoPause = useCallback(() => window.electron.video.pause(), []);
    const videoStop = useCallback(() => {
        window.electron.video.stop();
        setVideoStatus(null);
        setVideoName('');
        setVideoUrl('');
    }, []);
    const videoSeek = useCallback((time: number) => window.electron.video.seek(time), []);
    const videoSetVolume = useCallback((vol: number) => {
        setVideoVolume(vol);
        window.electron.video.volume(vol);
    }, []);

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
        const result = await window.electron.playlist.getFileUrl(id);
        if (result.error || !result.url) {
            console.error('Playlist file error:', result.error);
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
        setVerses(vrs);

        if (ref.verse) {
            // Full reference (book + chapter + verse) → show ONLY that verse in preview
            const verseIdx = vrs.findIndex((v: BibleVerse) => v.verse === ref.verse);
            const idx = Math.max(0, verseIdx);
            const v = vrs[idx];
            setPreviewType('bible');
            setPreviewSections([{ text: v.text, type: 'verse', label: `v. ${v.verse}` }]);
            setPreviewTitle(`${book.name} ${ref.chapter}:${v.verse}`);
            setPreviewNumber(book.abbreviation);
            setProjSlideIndex(0);
            setSelectedVerseIdx(idx);
        } else {
            // Chapter only → show first verse in preview
            const v = vrs[0];
            setPreviewType('bible');
            setPreviewSections([{ text: v.text, type: 'verse', label: `v. ${v.verse}` }]);
            setPreviewTitle(`${book.name} ${ref.chapter}:${v.verse}`);
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

    // ── Global keyboard ──
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
            if (modalOpen || hymnEditor || passwordModal || needsPasswordSetup) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
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

            if (e.key === 'Enter' && !inInput) {
                e.preventDefault();
                if (projecting) {
                    // handled by ProjectorController
                } else if (previewSections.length > 0) {
                    startProjection(projSlideIndexRef.current);
                }
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
                    const v = verses[newIdx];
                    if (v) {
                        const book = books.find(b => b.id === selectedBookId);
                        setPreviewType('bible');
                        setPreviewSections([{ text: v.text, type: 'verse', label: `v. ${v.verse}` }]);
                        setPreviewTitle(`${book?.name ?? ''} ${selectedChapter}:${v.verse}`);
                        setPreviewNumber(book?.abbreviation ?? '');
                        setProjSlideIndex(0);
                    }
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
        stopProjection, clearPreview, startProjection, tab, hymns, selectedHymnId, previewHymn,
        videoStatus, videoStop, verses, selectedVerseIdx, books, selectedBookId, selectedChapter]);

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
    const onSearchKeydown = useCallback(async (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();

            // Check if user has a new/unconsumed search query
            const isNewSearch = refSearch.trim().length > 0 && !searchConsumedRef.current;

            if (tab === 'imnuri') {
                if (isNewSearch) {
                    // New/changed search → always load first result from current list
                    if (projecting) await stopProjection();
                    if (hymns.length > 0) {
                        searchConsumedRef.current = true;
                        await previewHymn(hymns[0].id);
                    }
                } else if (previewSections.length > 0 && !projecting) {
                    // Preview exists, search consumed → project
                    startProjection(projSlideIndex);
                } else if (!previewSections.length && hymns.length > 0) {
                    // No preview yet (e.g. after clearing) → load first result
                    searchConsumedRef.current = true;
                    await previewHymn(hymns[0].id);
                }
                // If projecting and no new search → do nothing (ProjectorController handles)
                return;
            }

            if (tab === 'biblia') {
                if (isNewSearch) {
                    // Try to load bible reference from search
                    if (projecting) await stopProjection();
                    const loaded = await loadBibleReference();
                    if (loaded) searchConsumedRef.current = true;
                } else if (contentSearch.trim().length >= 3) {
                    // Content search in Bible — triggered on Enter
                    await doBibleContentSearch();
                } else if (previewSections.length > 0 && !projecting) {
                    // No new search, preview exists → project
                    startProjection(projSlideIndex);
                }
                return;
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (projecting) {
                navigateSlide(projSlideIndex + 1);
            } else if (tab === 'imnuri') {
                const currentIdx = hymns.findIndex(h => h.id === selectedHymnId);
                const nextIdx = currentIdx < hymns.length - 1 ? currentIdx + 1 : 0;
                if (hymns[nextIdx]) previewHymn(hymns[nextIdx].id);
            } else if (tab === 'biblia' && verses.length > 0) {
                const newIdx = Math.min(selectedVerseIdx + 1, verses.length - 1);
                setSelectedVerseIdx(newIdx);
                const v = verses[newIdx];
                if (v) {
                    const book = books.find(b => b.id === selectedBookId);
                    setPreviewType('bible');
                    setPreviewSections([{ text: v.text, type: 'verse', label: `v. ${v.verse}` }]);
                    setPreviewTitle(`${book?.name ?? ''} ${selectedChapter}:${v.verse}`);
                    setPreviewNumber(book?.abbreviation ?? '');
                    setProjSlideIndex(0);
                }
            }
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (projecting) {
                navigateSlide(projSlideIndex - 1);
            } else if (tab === 'imnuri') {
                const currentIdx = hymns.findIndex(h => h.id === selectedHymnId);
                const nextIdx = currentIdx > 0 ? currentIdx - 1 : hymns.length - 1;
                if (hymns[nextIdx]) previewHymn(hymns[nextIdx].id);
            } else if (tab === 'biblia' && verses.length > 0) {
                const newIdx = Math.max(selectedVerseIdx - 1, 0);
                setSelectedVerseIdx(newIdx);
                const v = verses[newIdx];
                if (v) {
                    const book = books.find(b => b.id === selectedBookId);
                    setPreviewType('bible');
                    setPreviewSections([{ text: v.text, type: 'verse', label: `v. ${v.verse}` }]);
                    setPreviewTitle(`${book?.name ?? ''} ${selectedChapter}:${v.verse}`);
                    setPreviewNumber(book?.abbreviation ?? '');
                    setProjSlideIndex(0);
                }
            }
            return;
        }
    }, [projecting, previewSections, projSlideIndex, startProjection, tab,
        selectedHymnId, hymns, previewHymn, loadBibleReference, stopProjection,
        navigateSlide, contentSearch, doBibleContentSearch,
        verses, selectedVerseIdx, books, selectedBookId, selectedChapter]);

    // ── Close context menu on click elsewhere ──
    useEffect(() => {
        if (!contextMenu) return;
        const handler = () => setContextMenu(null);
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, [contextMenu]);

    // ── Is "Imnuri Speciale" active? ──
    const isSpecialCategory = categories.find(c => c.id === activeCategoryId)?.name === 'Imnuri Speciale';

    // ══════════════════════════════════════════════════════════════════════════
    // RENDER
    // ══════════════════════════════════════════════════════════════════════════

    return (
        <div className="app-root">
            {/* ── Header ── */}
            <header className="header">
                <div className="header-logo">
                    <Monitor className="icon-sm text-indigo-400" />
                    <span>Proiecție</span>
                    {projecting && <span className="live-badge">● LIVE</span>}
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
                </div>

                {/* Search boxes */}
                <div className="search-area">
                    {tab !== 'video' && (<>
                        <div className="search-box">
                            <Search className="search-icon" />
                            <input
                                ref={refSearchRef}
                                type="text"
                                value={refSearch}
                                onChange={e => setRefSearch(e.target.value)}
                                onKeyDown={onSearchKeydown}
                                placeholder={tab === 'imnuri' ? 'Nr. / Titlu imn...' : 'ex: deu 12 12, ps 23, gen 1:3'}
                            />
                        </div>
                        <div className="search-box search-box-wide">
                            <Search className="search-icon" />
                            <input
                                type="text"
                                value={contentSearch}
                                onChange={e => setContentSearch(e.target.value)}
                                onKeyDown={onSearchKeydown}
                                placeholder={tab === 'imnuri' ? 'Caută în text...' : 'Caută în Biblie...'}
                            />
                        </div>
                    </>)}
                </div>

                {/* Add hymn button (only for Imnuri Speciale) */}
                {tab === 'imnuri' && isSpecialCategory && (
                    <button
                        className="header-btn add-btn"
                        onClick={() => setHymnEditor({
                            mode: 'add',
                            number: '',
                            title: '',
                            sections: [{ type: 'strofa', text: '' }],
                            categoryId: activeCategoryId,
                        })}
                        title="Adaugă imn"
                    >
                        <Plus className="icon-sm" />
                    </button>
                )}

                {/* Settings */}
                <button className="header-btn" onClick={() => setModalOpen('settings')} title="Setări">
                    <Settings className="icon-sm" />
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
                className="main-area"
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
                            }}
                        />
                    ) : (
                        <SidebarVideoFilter
                            filter={videoFilter}
                            onFilter={setVideoFilter}
                            youtubePlaylist={youtubePlaylist}
                        />
                    )}
                    {/* Update banner */}
                    {(updateInfo?.available || updateReady) && (
                        <div className="update-banner">
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
                                        {updateProgress}%
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
                                        setUpdateError(null);
                                        window.electron.update.download();
                                    }}
                                >
                                    Actualizează
                                </button>
                            )}
                        </div>
                    )}
                </aside>

                {/* Resize handle: sidebar | content */}
                <div className="resize-handle" onMouseDown={() => onResizeMouseDown('sidebar')} />

                {/* Content */}
                <div className="content">
                    {tab === 'imnuri' ? (
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
                            videoLoading={videoLoading}
                            videoConverting={videoConverting}
                            youtubePlaylist={youtubePlaylist}
                            youtubeProgress={youtubeProgress}
                            videoFilter={videoFilter}
                            onPickFile={loadVideoFile}
                            onPlay={videoPlay}
                            onPause={videoPause}
                            onStop={videoStop}
                            onSeek={videoSeek}
                            onVolume={videoSetVolume}
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
                                const v = verses[idx];
                                if (v) {
                                    const book = books.find(b => b.id === selectedBookId);
                                    setPreviewType('bible');
                                    setPreviewSections([{ text: v.text, type: 'verse', label: `v. ${v.verse}` }]);
                                    setPreviewTitle(`${book?.name ?? selectedBookName} ${selectedChapter}:${v.verse}`);
                                    setPreviewNumber(book?.abbreviation ?? '');
                                    setProjSlideIndex(0);
                                }
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
                        projSlideIndex={projSlideIndex}
                        onStartProjection={startProjection}
                        onStopProjection={stopProjection}
                        onClearPreview={clearPreview}
                        onNavigateSlide={navigateSlide}
                        onSelectSlide={(i) => setProjSlideIndex(i)}
                        videoUrl={videoUrl}
                        videoStatus={videoStatus}
                        videoName={videoName}
                    />
                </div>
            </div>

            {/* ── Controller (bottom bar when projecting) ── */}
            {projecting && previewSections.length > 0 && (
                <ProjectorController
                    sections={previewSections.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection))}
                    hymnTitle={previewTitle}
                    hymnNumber={previewNumber}
                    onClose={stopProjection}
                    onNavigate={navigateSlide}
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
            {modalOpen === 'settings' && (
                <SettingsModal
                    onClose={() => setModalOpen(null)}
                    onCategoriesChanged={loadCategories}
                    onHymnsChanged={loadHymns}
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
                />
            )}

            {/* ── First Launch Password Setup ── */}
            {needsPasswordSetup && (
                <PasswordSetupModal
                    onSave={async (pw, folder) => {
                        const hash = hashPassword(pw);
                        setAdminPasswordHash(hash);
                        const patch: Partial<AppSettings> = { adminPasswordHash: hash };
                        if (folder) patch.downloadFolder = folder;
                        await window.electron.settings.set(patch);
                        setNeedsPasswordSetup(false);
                    }}
                />
            )}
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
                                    {snippetLine && <span className="hymn-snippet">— {snippetLine}</span>}
                                </div>
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
    videoName, videoStatus, videoVolume, videoLoading, videoConverting,
    youtubePlaylist, youtubeProgress, videoFilter,
    onPickFile, onPlay, onPause, onStop,
    onSeek, onVolume,
    onYoutubeAdd, onYoutubeRemove, onYoutubeDelete, onYoutubePlay, onYoutubeRetry, onYoutubeUpdateTitle,
}: {
    videoName: string;
    videoStatus: { currentTime: number; duration: number; paused: boolean } | null;
    videoVolume: number;
    videoLoading: boolean;
    videoConverting: boolean;
    youtubePlaylist: YouTubeEntry[];
    youtubeProgress: Record<string, number>;
    videoFilter: VideoFilter;
    onPickFile: () => void;
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    onSeek: (time: number) => void;
    onVolume: (vol: number) => void;
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
                    </div>
                    <div className="video-seekbar-container">
                        <span className="video-time">{formatTime(currentTime)}</span>
                        <input
                            type="range"
                            className="video-seekbar"
                            min={0}
                            max={duration || 1}
                            step={0.1}
                            value={currentTime}
                            onChange={(e) => onSeek(Number(e.target.value))}
                        />
                        <span className="video-time">{formatTime(duration)}</span>
                    </div>
                    <div className="video-buttons">
                        <button
                            className="video-btn video-btn-main"
                            onClick={isPaused ? onPlay : onPause}
                            title={isPaused ? 'Redă' : 'Pauză'}
                        >
                            {isPaused
                                ? <Play className="icon-sm" />
                                : <Pause className="icon-sm" />
                            }
                        </button>
                        <button className="video-btn" onClick={onStop} title="Oprește">
                            <Square className="icon-sm" />
                        </button>
                        <div className="video-volume-group">
                            <Volume2 className="icon-sm opacity-50" />
                            <input
                                type="range"
                                className="video-volume-slider"
                                min={0}
                                max={1}
                                step={0.05}
                                value={videoVolume}
                                onChange={(e) => onVolume(Number(e.target.value))}
                            />
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
                    <p className="video-dropzone-title">Se convertește video-ul...</p>
                    <p className="video-dropzone-sub">Formatul nu e suportat nativ. Se convertește în MP4.</p>
                </div>
            </div>
        );
    }

    // ── Idle / Prepared state ──
    return (
        <div className="content-inner video-controller">
            {/* ── Add sources row ── */}
            <div className="video-section">
                <div className="video-section-header">
                    <Film className="icon-sm opacity-60" />
                    <span>Adaugă video în playlist</span>
                </div>

                {/* Local file picker */}
                <div className="video-dropzone-compact" onClick={onPickFile}>
                    {videoLoading ? (
                        <Loader className="icon-sm animate-spin opacity-50" />
                    ) : (
                        <Upload className="icon-sm opacity-40" />
                    )}
                    <span>{videoLoading ? 'Se încarcă...' : 'Adaugă fișier local (MP4, MKV, AVI, MOV...)'}</span>
                </div>

                {/* YouTube URL input */}
                {ytdlpInstalled === false && (
                    <div className="video-youtube-install">
                        <p className="text-white/60 text-sm mb-2">
                            Pentru videoclipuri YouTube, este nevoie de yt-dlp.
                        </p>
                        <button
                            className="video-youtube-btn"
                            onClick={installYtDlp}
                            disabled={ytdlpBusy}
                        >
                            {ytdlpBusy ? 'Se instalează...' : 'Instalează yt-dlp'}
                        </button>
                    </div>
                )}

                {ytdlpInstalled !== false && (
                    <div className="video-youtube-input-row">
                        <input
                            type="text"
                            className="video-youtube-input"
                            placeholder="https://www.youtube.com/watch?v=..."
                            value={ytUrl}
                            onChange={(e) => setYtUrl(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') addYouTube(); }}
                        />
                        <button
                            className="video-youtube-btn"
                            onClick={addYouTube}
                            disabled={ytAdding || !ytUrl.trim()}
                        >
                            {ytAdding ? <Loader className="icon-sm animate-spin" /> : <Plus className="icon-sm" />}
                            <span>{ytAdding ? 'Se adaugă...' : 'YouTube'}</span>
                        </button>
                    </div>
                )}

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
// Preview Panel
// ═════════════════════════════════════════════════════════════════════════════

function PreviewPanel({
    previewType, previewSections, previewTitle, previewNumber,
    projecting, projSlideIndex,
    onStartProjection, onStopProjection, onClearPreview, onNavigateSlide, onSelectSlide,
    videoUrl, videoStatus, videoName,
}: {
    previewType: 'hymn' | 'bible' | null;
    previewSections: { text: string; type: string; label: string }[];
    previewTitle: string;
    previewNumber: string;
    projecting: boolean;
    projSlideIndex: number;
    onStartProjection: (startIndex?: number) => void;
    onStopProjection: () => void;
    onClearPreview: () => void;
    onNavigateSlide: (idx: number) => void;
    onSelectSlide: (idx: number) => void;
    videoUrl: string;
    videoStatus: { currentTime: number; duration: number; paused: boolean } | null;
    videoName: string;
}) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const previewVideoRef = useRef<HTMLVideoElement>(null);

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

    // Sync preview video with projection video status
    useEffect(() => {
        const v = previewVideoRef.current;
        if (!v || !videoStatus) return;
        // Sync play/pause state
        if (videoStatus.paused && !v.paused) v.pause();
        else if (!videoStatus.paused && v.paused) v.play().catch(() => { });
        // Sync time if drift > 1s
        if (Math.abs(v.currentTime - videoStatus.currentTime) > 1) {
            v.currentTime = videoStatus.currentTime;
        }
    }, [videoStatus]);

    // Load/unload preview video source
    useEffect(() => {
        const v = previewVideoRef.current;
        if (!v) return;
        if (videoUrl) {
            v.src = videoUrl;
            v.load();
        } else {
            v.pause();
            v.src = '';
        }
    }, [videoUrl]);

    // If video is active, show video preview
    if (videoUrl) {
        const fmt = (t: number) => {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        };
        return (
            <div className="preview-panel projecting">
                <div className="preview-header">
                    <span className="label">● VIDEO</span>
                    <span className="title">{videoName}</span>
                </div>
                <div className="preview-body" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
                    <video
                        ref={previewVideoRef}
                        muted
                        playsInline
                        style={{ width: '100%', flex: 1, minHeight: 0, objectFit: 'contain', background: '#000' }}
                    />
                    <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center' }}>
                        {videoStatus
                            ? `${fmt(videoStatus.currentTime)} / ${fmt(videoStatus.duration)}${videoStatus.paused ? ' — Pauză' : ' — Redare'}`
                            : 'Se încarcă…'}
                    </div>
                </div>
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
        <div className={`preview-panel ${projecting ? 'projecting' : ''}`}>
            <div className="preview-header">
                <span className="label">{projecting ? '● LIVE' : 'Previzualizare'}</span>
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
                                if (projecting) {
                                    onNavigateSlide(i);
                                } else {
                                    // Click to select verse/section in preview
                                    onSelectSlide(i);
                                }
                            }}
                            onDoubleClick={() => {
                                if (!projecting) {
                                    onStartProjection(i);
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
                {projecting ? (
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
            onSave();
        } catch (err: any) {
            setError(err?.message ?? 'Eroare la salvare');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-dialog modal-wide">
                <div className="modal-header">
                    <h3>{editor.mode === 'add' ? 'Adaugă Imn' : 'Editează Imn'}</h3>
                    <button className="modal-close" onClick={onClose}><X className="icon-sm" /></button>
                </div>
                <div className="modal-body">
                    <div className="hymn-editor">
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
                                    <button
                                        className="btn-sm danger"
                                        onClick={() => removeSection(i)}
                                        disabled={sections.length <= 1}
                                    >
                                        <X className="icon-xs" />
                                    </button>
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

function PasswordModal({
    title, hash, onSuccess, onCancel,
}: {
    title: string;
    hash: string;
    onSuccess: () => void;
    onCancel: () => void;
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

function PasswordSetupModal({ onSave }: { onSave: (pw: string, downloadFolder?: string) => void }) {
    const [pw, setPw] = useState('');
    const [confirm, setConfirm] = useState('');
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
    }, []);

    const handleSave = () => {
        if (pw.length < 4) { setError('Parola trebuie să aibă cel puțin 4 caractere.'); return; }
        if (pw !== confirm) { setError('Parolele nu se potrivesc.'); return; }
        if (!downloadFolder) { setError('Selectează un folder pentru descărcări video.'); return; }
        onSave(pw, downloadFolder !== defaultFolder ? downloadFolder : undefined);
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
// Settings Modal
// ═════════════════════════════════════════════════════════════════════════════

function SettingsModal({ onClose, onCategoriesChanged, onHymnsChanged }: {
    onClose: () => void;
    onCategoriesChanged: () => void;
    onHymnsChanged: () => void;
}) {
    const [activeTab, setActiveTab] = useState<'projection' | 'import' | 'about'>('projection');
    const [settings, setSettings] = useState<AppSettings>({});
    const [importStatus, setImportStatus] = useState('');

    useEffect(() => {
        window.electron.settings.get().then(s => setSettings(s));
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
                        {(['projection', 'import', 'about'] as const).map(t => (
                            <button
                                key={t}
                                className={`stab ${activeTab === t ? 'active' : ''}`}
                                onClick={() => setActiveTab(t)}
                            >
                                {t === 'projection' ? 'Proiecție' : t === 'import' ? 'Imnuri — Import / Export' : 'Despre'}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'projection' && (
                        <div className="settings-content">
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
                                <button className="btn-action" onClick={async () => {
                                    const folder = await window.electron.dialog.selectFolder();
                                    if (!folder) return;
                                    setImportStatus('Se importă imnurile...');
                                    const result = await window.electron.db.importPresentations(folder);
                                    onCategoriesChanged();
                                    onHymnsChanged();
                                    setImportStatus(`Import imnuri: ${result.success} reușite, ${result.failed} eșuate`);
                                }}>
                                    <FolderOpen className="icon-xs" /> Alege folder cu PPTX
                                </button>
                            </div>
                            <div className="field">
                                <label>Import imnuri din fișiere PPTX individuale</label>
                                <button className="btn-action" onClick={async () => {
                                    const files = await window.electron.dialog.selectPresentationFiles();
                                    if (!files?.length) return;
                                    setImportStatus('Se importă imnurile...');
                                    const result = await window.electron.db.importPresentationFiles(files);
                                    onCategoriesChanged();
                                    onHymnsChanged();
                                    setImportStatus(`Import imnuri: ${result.success} reușite, ${result.failed} eșuate`);
                                }}>
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
                                    <button className="btn-action" onClick={async () => {
                                        const p = await window.electron.dialog.selectJsonFile();
                                        if (p) {
                                            await window.electron.db.importJsonBackup(p);
                                            onCategoriesChanged();
                                            onHymnsChanged();
                                            setImportStatus('Import imnuri din JSON reușit!');
                                        }
                                    }}>
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

                    {activeTab === 'about' && (
                        <div className="settings-content">
                            <div className="flex flex-col items-center gap-4 py-6 text-center">
                                <h2 className="text-2xl font-black text-primary tracking-wide">AdventShow</h2>
                                <p className="text-white/50 text-sm">Versiunea {import.meta.env.VITE_APP_VERSION ?? '1.1.0'}</p>
                                <p className="text-white/70 text-sm leading-relaxed max-w-md">
                                    Aplicație gratuită și open-source pentru proiecția imnurilor și versetelor biblice în biserici adventiste.
                                </p>
                                <div className="border-t border-white/10 w-full my-2" />
                                <div className="text-sm text-white/60 leading-relaxed max-w-md">
                                    <p className="font-semibold text-white/80 mb-2">Ce include</p>
                                    <ul className="text-left list-disc list-inside space-y-1">
                                        <li><strong>922 imnuri</strong> din colecția „Imnuri Creștine", organizate pe categorii</li>
                                        <li><strong>Biblia Cornilescu</strong> completă — 66 cărți, 31.102 versete</li>
                                        <li>Proiecție fullscreen pe ecran secundar cu fundal personalizabil</li>
                                        <li>Redare video (fișiere locale + YouTube) pe proiecție</li>
                                        <li>Import/Export imnuri, editor integrat, căutare inteligentă</li>
                                        <li>Verificare automată de actualizări</li>
                                    </ul>
                                </div>
                                <div className="border-t border-white/10 w-full my-2" />
                                <div className="text-sm text-white/60 leading-relaxed">
                                    <p className="font-semibold text-white/80 mb-2">Dezvoltatori</p>
                                    <div className="flex flex-col gap-2">
                                        <div>
                                            <p className="text-white/80 font-medium">Ovidius Zanfir</p>
                                            <p className="text-white/40 text-xs">Autor original — concept, interfață, baza de date cu imnuri</p>
                                        </div>
                                        <div>
                                            <p className="text-white/80 font-medium">Samy Balasa</p>
                                            <p className="text-white/40 text-xs">Redare video, YouTube, auto-update, Biblia Cornilescu, funcționalități noi</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="border-t border-white/10 w-full my-2" />
                                <div className="text-sm text-white/60 leading-relaxed">
                                    <p className="font-semibold text-white/80 mb-1">Organizație</p>
                                    <a
                                        href="https://github.com/AdventTools"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline"
                                    >
                                        github.com/AdventTools
                                    </a>
                                </div>
                                <div className="text-sm text-white/60 leading-relaxed">
                                    <p className="font-semibold text-white/80 mb-1">Cod sursă</p>
                                    <a
                                        href="https://github.com/AdventTools/AdventShow"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline"
                                    >
                                        github.com/AdventTools/AdventShow
                                    </a>
                                </div>
                                <div className="border-t border-white/10 w-full my-2" />
                                <YtDlpSettings />
                                <div className="border-t border-white/10 w-full my-2" />
                                <p className="text-white/30 text-xs">
                                    Distribuit gratuit. Biblia Cornilescu — text în domeniu public.
                                </p>
                                <p className="text-white/20 text-[10px]">
                                    Electron · React · TypeScript · TailwindCSS · DaisyUI
                                </p>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
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
                    <p className="text-white/40 text-xs">Versiune: {version || '...'}</p>
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
