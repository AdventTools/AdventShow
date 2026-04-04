import {
    Book,
    ChevronLeft,
    ChevronRight,
    Download,
    Edit3,
    FolderOpen,
    Lock,
    Monitor,
    Plus,
    Play,
    Search,
    Settings,
    Square,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { ProjectorController } from './ProjectorController';
import type {
    AppSettings,
    BibleBook,
    BibleVerse,
    Category,
    Hymn,
    HymnSection,
} from './vite-env';

// ── Constants ────────────────────────────────────────────────────────────────

const MASTER_PASSWORD = 'ProiectieMaster2025!';
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
    let s = snippet.replace(/^\d+\.\s*/, '');
    const nl = s.indexOf('\n');
    if (nl > 0) s = s.substring(0, nl);
    return s.trim();
}

function expandHymnSections(sections: HymnSection[]) {
    const refren = sections.find(s => s.type === 'refren');
    const result: { text: string; type: string; label: string }[] = [];
    let stanzaNum = 0;
    for (const sec of sections) {
        if (sec.type === 'strofa') {
            stanzaNum++;
            result.push({ text: sec.text, type: 'strofa', label: `Strofa ${stanzaNum}` });
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
 * Returns the best-matching book or null.
 */
function matchBibleBook(query: string, booksList: BibleBook[]): BibleBook | null {
    const q = normalizeDiacritics(query).replace(/\s+/g, '');
    if (!q) return null;

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

        if (score > 0) scored.push({ book, score });
    }

    scored.sort((a, b) => b.score - a.score || a.book.book_order - b.book.book_order);
    return scored.length > 0 ? scored[0].book : null;
}

type Tab = 'imnuri' | 'biblia';

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

    // ── Modal state ──
    const [modalOpen, setModalOpen] = useState<string | null>(null);

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

    // Keep ref in sync
    useEffect(() => { projSlideIndexRef.current = projSlideIndex; }, [projSlideIndex]);

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
        });
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

    // ── Bible content search ──
    useEffect(() => {
        if (tab !== 'biblia') return;
        const cq = contentSearch.trim();
        if (cq.length >= 3) {
            const doSearch = async () => {
                const norm = normalizeDiacritics(cq);
                const results = await window.electron.bible.search(norm, selectedBookId ?? undefined);
                let results2: BibleVerse[] = [];
                if (norm !== cq.toLowerCase()) {
                    results2 = await window.electron.bible.search(cq, selectedBookId ?? undefined);
                }
                const seen = new Set<string>();
                const merged: BibleVerse[] = [];
                for (const r of [...results, ...results2]) {
                    const key = `${r.book_id}:${r.chapter}:${r.verse}`;
                    if (!seen.has(key)) { seen.add(key); merged.push(r); }
                }
                setBibleSearchResults(merged);
            };
            const t = setTimeout(doSearch, 300);
            return () => clearTimeout(t);
        } else {
            setBibleSearchResults(null);
        }
    }, [contentSearch, tab, selectedBookId]);

    // ── Preview hymn ──
    const previewHymn = useCallback(async (id: number) => {
        const data = await window.electron.db.getHymnWithSections(id);
        if (!data || !data.sections.length) return;
        const expanded = expandHymnSections(data.sections);
        setPreviewType('hymn');
        setPreviewSections(expanded);
        setPreviewTitle(data.title);
        setPreviewNumber(String(data.number));
        setProjSlideIndex(0);
        setSelectedHymnId(id);

        // If projecting, fluid hymn switch
        if (projecting) {
            const secs = expanded.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection));
            await window.electron.projection.updateHymn(secs, data.title, String(data.number), 0);
            setProjSlideIndex(0);
        }
    }, [projecting]);

    // ── Preview bible search result ──
    const previewBibleResult = useCallback(async (verse: BibleVerse) => {
        if (!verse.book_id || !verse.chapter) return;
        // Load all verses from this chapter
        const vrs = await window.electron.bible.getVerses(verse.book_id, verse.chapter);
        const book = books.find(b => b.id === verse.book_id);
        const secs = vrs.map(v => ({
            text: v.text,
            type: 'verse',
            label: `v. ${v.verse}`,
        }));
        setPreviewType('bible');
        setPreviewSections(secs);
        setPreviewTitle(`${book?.name ?? verse.book_name ?? ''} ${verse.chapter}`);
        setPreviewNumber(book?.abbreviation ?? verse.abbreviation ?? '');
        // Find the index of the clicked verse
        const idx = vrs.findIndex(v => v.verse === verse.verse);
        setProjSlideIndex(Math.max(0, idx));
    }, [books]);

    // ── Clear preview ──
    const clearPreview = useCallback(() => {
        setPreviewType(null);
        setPreviewSections([]);
        setPreviewTitle('');
        setPreviewNumber('');
        setProjSlideIndex(0);
    }, []);

    // ── Projection control ──
    const startProjection = useCallback(async (startIndex = 0) => {
        if (!previewSections.length) return;
        const secs = previewSections.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection));
        await window.electron.projection.open(secs, previewTitle, previewNumber, startIndex);
        setProjecting(true);
        setProjSlideIndex(startIndex);
    }, [previewSections, previewTitle, previewNumber]);

    const navigateSlide = useCallback(async (newIdx: number) => {
        if (!projecting) return;
        const n = previewSections.length;
        if (newIdx < 0 || newIdx >= n) return;
        setProjSlideIndex(newIdx);
        const secs = previewSections.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection));
        await window.electron.projection.navigate(secs, newIdx, previewTitle, previewNumber);
    }, [projecting, previewSections, previewTitle, previewNumber]);

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
        setTab(newTab);
        setRefSearch('');
        setContentSearch('');
        setBibleSearchResults(null);
        if (!projecting) clearPreview();
    }, [projecting, clearPreview]);

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

    // Auto-preview when verses load (from sidebar/chapter click, NOT from reference search)
    useEffect(() => {
        if (verses.length > 0 && selectedChapter) {
            const book = books.find(b => b.id === selectedBookId);
            const secs = verses.map(v => ({
                text: v.text,
                type: 'verse',
                label: `v. ${v.verse}`,
            }));
            setPreviewType('bible');
            setPreviewSections(secs);
            setPreviewTitle(`${book?.name ?? ''} ${selectedChapter}`);
            setPreviewNumber(book?.abbreviation ?? '');
            setProjSlideIndex(0);
        }
    }, [verses, selectedChapter, books, selectedBookId]);

    // ── Load Bible reference (Enter-triggered, BibleShow-style) ──
    const loadBibleReference = useCallback(async (): Promise<boolean> => {
        const input = refSearch.trim();
        if (!input) return false;

        const ref = parseBibleReference(input);
        if (!ref) return false;

        const book = matchBibleBook(ref.bookQuery, books);
        if (!book) return false;

        if (!ref.chapter) {
            // Only book matched → select book, show chapters
            await selectBook(book);
            return true;
        }

        // Load chapter verses
        const vrs = await window.electron.bible.getVerses(book.id, ref.chapter);
        if (!vrs.length) return false;

        // Build preview sections
        const secs = vrs.map((v: BibleVerse) => ({
            text: v.text,
            type: 'verse',
            label: `v. ${v.verse}`,
        }));
        setPreviewType('bible');
        setPreviewSections(secs);
        setPreviewTitle(`${book.name} ${ref.chapter}`);
        setPreviewNumber(book.abbreviation);

        // Set verse index
        const verseIdx = ref.verse
            ? vrs.findIndex((v: BibleVerse) => v.verse === ref.verse)
            : 0;
        setProjSlideIndex(Math.max(0, verseIdx));

        // Update sidebar state for visual consistency
        setSelectedBookId(book.id);
        setSelectedBookName(book.name);
        setSelectedChapter(ref.chapter);
        setVerses(vrs);
        setSelectedVerseIdx(Math.max(0, verseIdx));
        setBibleSearchResults(null);

        return true;
    }, [refSearch, books, selectBook]);

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
                if (projecting) {
                    stopProjection();
                } else if (previewSections.length > 0) {
                    clearPreview();
                } else if (inInput) {
                    (document.activeElement as HTMLElement)?.blur();
                }
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
                } else if (tab === 'biblia' && previewSections.length > 0) {
                    if (e.key === 'ArrowDown') {
                        setProjSlideIndex(prev => Math.min(prev + 1, previewSections.length - 1));
                    } else {
                        setProjSlideIndex(prev => Math.max(prev - 1, 0));
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
        stopProjection, clearPreview, startProjection, tab, hymns, selectedHymnId, previewHymn]);

    // ── Search Enter/Esc/Arrow handler ──
    const onSearchKeydown = useCallback(async (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (projecting) {
                // Already projecting — do nothing (ProjectorController handles slide nav)
                return;
            }
            if (previewSections.length > 0) {
                // Preview exists → second Enter → project from current slide
                startProjection(projSlideIndex);
                return;
            }
            // No preview → first Enter → load into preview
            if (tab === 'imnuri') {
                if (selectedHymnId) {
                    previewHymn(selectedHymnId);
                } else if (hymns.length > 0) {
                    previewHymn(hymns[0].id);
                }
            } else if (tab === 'biblia') {
                await loadBibleReference();
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            if (projecting) {
                stopProjection();
            } else if (previewSections.length > 0) {
                clearPreview();
            } else {
                setRefSearch('');
                setContentSearch('');
                (document.activeElement as HTMLElement)?.blur();
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
            } else if (tab === 'biblia' && previewSections.length > 0) {
                setProjSlideIndex(prev => Math.min(prev + 1, previewSections.length - 1));
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
            } else if (tab === 'biblia' && previewSections.length > 0) {
                setProjSlideIndex(prev => Math.max(prev - 1, 0));
            }
            return;
        }
    }, [projecting, previewSections, projSlideIndex, startProjection, tab,
        selectedHymnId, hymns, previewHymn, loadBibleReference, stopProjection,
        clearPreview, navigateSlide]);

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
                </div>

                {/* Search boxes */}
                <div className="search-area">
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
            <div className="main-area">
                {/* Sidebar */}
                <aside className="sidebar">
                    {tab === 'imnuri' ? (
                        <SidebarCategories
                            categories={categories}
                            activeCategoryId={activeCategoryId}
                            onSelect={setActiveCategoryId}
                        />
                    ) : (
                        <SidebarBibleBooks
                            books={books}
                            selectedBookId={selectedBookId}
                            onSelect={selectBook}
                        />
                    )}
                </aside>

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
                    ) : bibleSearchResults ? (
                        <BibleSearchResultsList
                            results={bibleSearchResults}
                            selectedIdx={selectedVerseIdx}
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
                    onSave={async (pw) => {
                        const hash = hashPassword(pw);
                        setAdminPasswordHash(hash);
                        await window.electron.settings.set({ adminPasswordHash: hash });
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
    books, selectedBookId, onSelect,
}: {
    books: BibleBook[];
    selectedBookId: number | null;
    onSelect: (book: BibleBook) => void;
}) {
    const vt = books.filter(b => b.testament === 'VT');
    const nt = books.filter(b => b.testament === 'NT');

    return (
        <>
            <div className="sidebar-title">Cărți</div>
            <div className="sidebar-list">
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
                                    {snippetLine && <span className="hymn-snippet">{snippetLine}</span>}
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
        <div className="content-inner">
            <div className="bible-breadcrumb">
                <button className="crumb-btn" onClick={onBackToChapters}>{selectedBookName}</button>
                {selectedChapter && (
                    <>
                        <span className="sep">›</span>
                        <span>Capitolul {selectedChapter}</span>
                    </>
                )}
            </div>

            {!selectedChapter ? (
                <>
                    <div className="content-status">{chapters.length} capitole</div>
                    <div className="chapter-grid">
                        {chapters.map(ch => (
                            <button key={ch} className="chapter-btn" onClick={() => onSelectChapter(ch)}>
                                {ch}
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <>
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
                </>
            )}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Bible Search Results
// ═════════════════════════════════════════════════════════════════════════════

function BibleSearchResultsList({
    results, selectedIdx, onSelect,
}: {
    results: BibleVerse[];
    selectedIdx: number;
    onSelect: (idx: number) => void;
}) {
    return (
        <div className="content-inner">
            <div className="content-status">{results.length} rezultate</div>
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
// Preview Panel
// ═════════════════════════════════════════════════════════════════════════════

function PreviewPanel({
    previewType, previewSections, previewTitle, previewNumber,
    projecting, projSlideIndex,
    onStartProjection, onStopProjection, onClearPreview, onNavigateSlide, onSelectSlide,
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
}) {
    const bodyRef = useRef<HTMLDivElement>(null);

    // Scroll current/selected slide into view
    useEffect(() => {
        if (bodyRef.current) {
            const cur = bodyRef.current.querySelector('.preview-section.current, .preview-section.selected');
            if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [projSlideIndex, projecting]);

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
                            <div className="sec-text">{sec.text}</div>
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
                            <button className="btn-nav" onClick={() => onNavigateSlide(projSlideIndex - 1)} disabled={projSlideIndex <= 0}>
                                <ChevronLeft className="icon-xs" />
                            </button>
                            <button className="btn-nav" onClick={() => onNavigateSlide(projSlideIndex + 1)} disabled={projSlideIndex >= previewSections.length - 1}>
                                <ChevronRight className="icon-xs" />
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <button className="btn-project" onClick={() => onStartProjection()}>
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
                                        <option value="strofa">Strofă</option>
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
                                <Plus className="icon-xs" /> Strofă
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

function PasswordSetupModal({ onSave }: { onSave: (pw: string) => void }) {
    const [pw, setPw] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleSave = () => {
        if (pw.length < 4) { setError('Parola trebuie să aibă cel puțin 4 caractere.'); return; }
        if (pw !== confirm) { setError('Parolele nu se potrivesc.'); return; }
        onSave(pw);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-dialog modal-sm">
                <div className="modal-header">
                    <h3><Lock className="icon-sm" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Configurare Parolă Admin</h3>
                </div>
                <div className="modal-body">
                    <p className="setup-hint">
                        Setați o parolă de administrare pentru a proteja editarea imnurilor.
                        Aceasta va fi necesară pentru modificări după 24 de ore de la crearea unui imn.
                    </p>
                    <div className="field">
                        <label>Parolă nouă</label>
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
    const [activeTab, setActiveTab] = useState<'projection' | 'import' | 'admin'>('projection');
    const [settings, setSettings] = useState<AppSettings>({});
    const [importStatus, setImportStatus] = useState('');

    useEffect(() => {
        window.electron.settings.get().then(s => setSettings(s));
    }, []);

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
                        {(['projection', 'import', 'admin'] as const).map(t => (
                            <button
                                key={t}
                                className={`stab ${activeTab === t ? 'active' : ''}`}
                                onClick={() => setActiveTab(t)}
                            >
                                {t === 'projection' ? 'Proiecție' : t === 'import' ? 'Import / Export' : 'Admin'}
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
                        </div>
                    )}

                    {activeTab === 'import' && (
                        <div className="settings-content">
                            <div className="field">
                                <label>Import din folder (PPTX)</label>
                                <button className="btn-action" onClick={async () => {
                                    const folder = await window.electron.dialog.selectFolder();
                                    if (!folder) return;
                                    setImportStatus('Se importă...');
                                    const result = await window.electron.db.importPresentations(folder);
                                    onCategoriesChanged();
                                    onHymnsChanged();
                                    setImportStatus(`Import: ${result.success} reușite, ${result.failed} eșuate`);
                                }}>
                                    <FolderOpen className="icon-xs" /> Import din folder
                                </button>
                            </div>
                            <div className="field">
                                <label>Import fișiere PPTX</label>
                                <button className="btn-action" onClick={async () => {
                                    const files = await window.electron.dialog.selectPresentationFiles();
                                    if (!files?.length) return;
                                    setImportStatus('Se importă...');
                                    const result = await window.electron.db.importPresentationFiles(files);
                                    onCategoriesChanged();
                                    onHymnsChanged();
                                    setImportStatus(`Import: ${result.success} reușite, ${result.failed} eșuate`);
                                }}>
                                    <Upload className="icon-xs" /> Import fișiere
                                </button>
                            </div>
                            <div className="field">
                                <label>Export / Import JSON Backup</label>
                                <div className="field-row">
                                    <button className="btn-action" onClick={async () => {
                                        const p = await window.electron.dialog.saveJsonFile('backup-imnuri.json');
                                        if (p) {
                                            const r = await window.electron.db.exportJsonBackup(p);
                                            setImportStatus(`Export reușit: ${r.hymns} imnuri, ${r.sections} secțiuni`);
                                        }
                                    }}>
                                        <Download className="icon-xs" /> Export JSON
                                    </button>
                                    <button className="btn-action" onClick={async () => {
                                        const p = await window.electron.dialog.selectJsonFile();
                                        if (p) {
                                            await window.electron.db.importJsonBackup(p);
                                            onCategoriesChanged();
                                            onHymnsChanged();
                                            setImportStatus('Import JSON reușit!');
                                        }
                                    }}>
                                        <Upload className="icon-xs" /> Import JSON
                                    </button>
                                </div>
                            </div>
                            <div className="field">
                                <label>Export Baza de Date</label>
                                <button className="btn-action" onClick={async () => {
                                    const p = await window.electron.dialog.saveFile('hymns-backup.db');
                                    if (p) {
                                        await window.electron.db.exportDb(p);
                                        setImportStatus('Baza de date exportată!');
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
                            <div className="field danger">
                                <label>Zonă Periculoasă</label>
                                <button className="btn-danger" onClick={async () => {
                                    if (confirm('ATENȚIE: Aceasta va șterge TOATE imnurile! Sigur?')) {
                                        if (confirm('Ultima confirmare: TOATE datele vor fi pierdute!')) {
                                            await window.electron.db.clearAll();
                                            onCategoriesChanged();
                                            onHymnsChanged();
                                        }
                                    }
                                }}>
                                    <Trash2 className="icon-xs" /> Șterge toate imnurile
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
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
