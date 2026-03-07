import {
  Check,
  FolderOpen,
  Monitor,
  Music2,
  PencilLine,
  Plus, Search, Settings,
  Tag, X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminPage } from './AdminPage';
import './App.css';
import { SearchPage } from './SearchPage';
import { Category } from './vite-env';

type Page = 'search' | 'admin';

function App() {
  const [page, setPage] = useState<Page>('search');
  const [version] = useState(() => {
    try { return ((import.meta as any).env?.VITE_APP_VERSION as string) ?? '0.0.0'; } catch { return '0.0.0'; }
  });

  const [adminTab, setAdminTab] = useState<'categorii' | 'import' | 'proiectie' | 'editor'>('categorii');
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<number | undefined>(undefined);

  const loadCategories = useCallback(async () => {
    const cats = await window.electron.db.getCategories();
    setCategories(cats);
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  // Relay Enter from topbar search → SearchPage
  const searchEnterRef = useRef<() => void>(() => {});

  const createCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    await window.electron.db.createCategory(name);
    setNewCatName('');
    setAddingCat(false);
    loadCategories();
  };

  return (
    <div data-theme="night" className="h-screen flex flex-col bg-[#0f1117]">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 h-12 flex items-center bg-[#151822] border-b border-white/5 px-4 gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-4">
          <Music2 className="w-5 h-5 text-primary" />
          <span className="font-bold text-sm text-white tracking-wide">Proiectie Imnuri</span>
        </div>

        <div className="flex-1" />

        {/* Search input — only on search page */}
        {page === 'search' && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchEnterRef.current(); }}
              placeholder="Caută imn..."
              className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-8 py-1.5 text-sm text-white/80 placeholder-white/20 outline-none focus:border-primary/50 transition-all w-56"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Admin tab buttons — only on admin page */}
        {page === 'admin' && (
          <div className="flex items-center gap-1">
            {([
              { id: 'categorii' as const,  icon: <FolderOpen className="w-3.5 h-3.5" />,    label: 'Categorii' },
              { id: 'import' as const,    icon: <Plus className="w-3.5 h-3.5" />,         label: 'Import'    },
              { id: 'editor' as const,    icon: <PencilLine className="w-3.5 h-3.5" />,    label: 'Editor'    },
              { id: 'proiectie' as const, icon: <Monitor className="w-3.5 h-3.5" />,       label: 'Proiecție' },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setAdminTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${adminTab === t.id
                  ? 'bg-primary text-primary-content'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        )}

        {/* Add button / Admin toggle */}
        <div className="flex items-center gap-2 ml-2">

          <button
            onClick={() => setPage(page === 'admin' ? 'search' : 'admin')}
            title={page === 'admin' ? 'Înapoi la căutare' : 'Admin'}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${page === 'admin' ? 'bg-primary/20 text-primary' : 'text-white/30 hover:text-white/60 hover:bg-white/5'}`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Body: sidebar + main ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar — categories */}
        <aside className="w-48 flex flex-col bg-[#151822] border-r border-white/5 flex-shrink-0">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-[10px] font-bold text-white/25 tracking-widest uppercase">Categorii</span>
            <button
              onClick={() => setAddingCat(v => !v)}
              title="Categorie nouă"
              className="w-5 h-5 flex items-center justify-center rounded text-white/25 hover:text-white/60 hover:bg-white/8 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {addingCat && (
            <div className="px-3 pb-2 flex gap-1">
              <input
                autoFocus
                type="text"
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createCategory(); if (e.key === 'Escape') setAddingCat(false); }}
                placeholder="Nume categorie..."
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 outline-none focus:border-primary/50 min-w-0"
              />
              <button onClick={createCategory} className="px-2 py-1 bg-primary rounded text-xs font-bold text-primary-content">
                <Check className="w-3 h-3" />
              </button>
            </div>
          )}

          <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {/* "Toate" */}
            <button
              onClick={() => setActiveCategoryId(undefined)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2
                ${activeCategoryId === undefined
                  ? 'bg-primary text-primary-content font-semibold shadow shadow-primary/20'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
            >
              <Music2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Toate</span>
            </button>

            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2
                  ${activeCategoryId === cat.id
                    ? 'bg-primary text-primary-content font-semibold shadow shadow-primary/20'
                    : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
              >
                <Tag className={`w-3 h-3 flex-shrink-0 ${activeCategoryId === cat.id ? 'text-primary-content' : 'text-white/25'}`} />
                <span className="truncate flex-1">{cat.name}</span>
                {cat.hymn_count !== undefined && cat.hymn_count > 0 && (
                  <span className={`text-xs flex-shrink-0 ${activeCategoryId === cat.id ? 'text-primary-content/70' : 'text-white/20'}`}>
                    {cat.hymn_count}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="px-4 py-3 text-[10px] text-white/15 border-t border-white/5">
            v{version}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          {page === 'search' && (
            <SearchPage
              query={searchQuery}
              onQueryChange={setSearchQuery}
              activeCategoryId={activeCategoryId}
              categories={categories}
              onEnterKeyRef={searchEnterRef}
            />
          )}
          {page === 'admin' && (
            <AdminPage activeTab={adminTab} onTabChange={setAdminTab} onCategoriesChanged={loadCategories} />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
