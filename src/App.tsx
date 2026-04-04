import {
    Book,
    ChevronLeft,
    ChevronRight,
    Download,
    FolderOpen,
    Monitor,
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
            // Skip if following a strofa (already inserted above)
            const idx = sections.indexOf(sec);
            if (idx > 0 && sections[idx - 1].type === 'strofa') continue;
            result.push({ text: sec.text, type: 'refren', label: 'Refren' });
        }
    }
    return result;
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

    // ── Refs ──
    const refSearchRef = useRef<HTMLInputElement>(null);

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
    }, []);

    // ── Clear preview ──
    const clearPreview = useCallback(() => {
        setPreviewType(null);
        setPreviewSections([]);
        setPreviewTitle('');
        setPreviewNumber('');
        setProjSlideIndex(0);
    }, []);

    // ── Projection control ──
    const startProjection = useCallback(async () => {
        if (!previewSections.length) return;
        const secs = previewSections.map(s => ({ text: s.text, type: s.type as 'strofa' | 'refren' } as HymnSection));
        await window.electron.projection.open(secs, previewTitle, previewNumber);
        setProjecting(true);
        setProjSlideIndex(0);
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

    // Auto-preview when verses load
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

    // ── Global keyboard ──
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
            if (modalOpen) return;

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
                    startProjection();
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
    }, [projecting, previewSections, modalOpen, stopProjection, clearPreview, startProjection]);

    // ── Bible reference search (e.g. "Geneza 1") ──
    useEffect(() => {
        if (tab !== 'biblia' || !refSearch.trim()) return;
        const ref = refSearch.trim();
        const match = ref.match(/^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
        if (!match) return;
        const bookName = match[1].toLowerCase();
        const chapter = parseInt(match[2]);
        const book = books.find(b => {
            const n = normalizeDiacritics(b.name);
            const a = normalizeDiacritics(b.abbreviation);
            const q = normalizeDiacritics(bookName);
            return n === q || a === q || n.startsWith(q) || a.startsWith(q);
        });
        if (book) {
            selectBook(book).then(() => {
                if (chapter) selectChapter(chapter);
            });
        }
    }, [refSearch, tab, books, selectBook, selectChapter]);

    // ── Search Enter/Esc handler ──
    const onSearchKeydown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (projecting) {
                // next slide is handled by ProjectorController
            } else if (previewSections.length > 0) {
                startProjection();
            } else if (tab === 'imnuri') {
                if (selectedHymnId) {
                    previewHymn(selectedHymnId);
                } else if (hymns.length > 0) {
                    previewHymn(hymns[0].id);
                }
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setRefSearch('');
            setContentSearch('');
            (document.activeElement as HTMLElement)?.blur();
        }
    }, [projecting, previewSections, startProjection, tab, selectedHymnId, hymns, previewHymn]);

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
                            placeholder={tab === 'imnuri' ? 'Nr. / Titlu imn...' : 'Carte Capitol:Verset...'}
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

                {/* Settings */}
                <button className="header-btn" onClick={() => setModalOpen('settings')} title="Setări">
                    <Settings className="icon-sm" />
                </button>

                <div className="kbd-hints">
                    <kbd>/</kbd>
                    <span>caută</span>
                    <kbd>Enter</kbd>
                    <span>proiectează</span>
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
                        />
                    ) : bibleSearchResults ? (
                        <BibleSearchResultsList
                            results={bibleSearchResults}
                            selectedIdx={selectedVerseIdx}
                            onSelect={setSelectedVerseIdx}
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

            {/* ── Settings Modal ── */}
            {modalOpen === 'settings' && (
                <SettingsModal
                    onClose={() => setModalOpen(null)}
                    onCategoriesChanged={loadCategories}
                    onHymnsChanged={loadHymns}
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
    hymns, categories, activeCategoryId, selectedHymnId, onSelect,
}: {
    hymns: Hymn[];
    categories: Category[];
    activeCategoryId?: number;
    selectedHymnId: number | null;
    onSelect: (id: number) => void;
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
                <div className="hymn-list">
                    {hymns.map(hymn => {
                        const snippetLine = getSnippetFirstLine(hymn.snippet);
                        return (
                            <div
                                key={hymn.id}
                                className={`hymn-item ${selectedHymnId === hymn.id ? 'selected' : ''}`}
                                onClick={() => onSelect(hymn.id)}
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
    onStartProjection, onStopProjection, onClearPreview, onNavigateSlide,
}: {
    previewType: 'hymn' | 'bible' | null;
    previewSections: { text: string; type: string; label: string }[];
    previewTitle: string;
    previewNumber: string;
    projecting: boolean;
    projSlideIndex: number;
    onStartProjection: () => void;
    onStopProjection: () => void;
    onClearPreview: () => void;
    onNavigateSlide: (idx: number) => void;
}) {
    const bodyRef = useRef<HTMLDivElement>(null);

    // Scroll current slide into view when projecting
    useEffect(() => {
        if (projecting && bodyRef.current) {
            const cur = bodyRef.current.querySelector('.preview-section.current');
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
                            <div><kbd>Esc</kbd> oprește / curăță</div>
                            <div><kbd>/</kbd> caută rapid</div>
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
                {projecting && (
                    <span className="slide-counter">{projSlideIndex + 1}/{previewSections.length}</span>
                )}
            </div>
            <div className="preview-body" ref={bodyRef}>
                {previewSections.map((sec, i) => {
                    let cls = 'preview-section';
                    if (projecting && i === projSlideIndex) cls += ' current';
                    else if (projecting && i === projSlideIndex + 1) cls += ' next';

                    return (
                        <div
                            key={i}
                            className={cls}
                            onClick={() => { if (projecting) onNavigateSlide(i); }}
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
                        <button className="btn-project" onClick={onStartProjection}>
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
                                <label>Opacitate: {((settings.bgOpacity ?? 1) * 100).toFixed(0)}%</label>
                                <input
                                    type="range" min="0" max="1" step="0.05"
                                    value={settings.bgOpacity ?? 1}
                                    onChange={e => saveSettings({ bgOpacity: parseFloat(e.target.value) })}
                                />
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
