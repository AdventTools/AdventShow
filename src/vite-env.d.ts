/// <reference types="vite/client" />

export interface HymnSection {
  id: number;
  hymn_id: number;
  order_index: number;
  type: 'strofa' | 'refren';
  text: string;
}

export interface Category {
  id: number;
  name: string;
  is_builtin: number;
  hymn_count?: number;
}

export interface Hymn {
  id: number;
  number: string;
  title: string;
  search_text?: string;
  category_id?: number | null;
  section_count?: number;
  snippet?: string;
  created_at?: string;
}

export interface BibleBook {
  id: number;
  name: string;
  abbreviation: string;
  testament: 'VT' | 'NT';
  book_order: number;
  chapter_count: number;
}

export interface BibleVerse {
  verse: number;
  text: string;
  book_id?: number;
  chapter?: number;
  book_name?: string;
  abbreviation?: string;
}

export interface HymnWithSections extends Hymn {
  sections: HymnSection[];
}

export interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

export interface HymnSectionInput {
  type: 'strofa' | 'refren';
  text: string;
}

export interface CreateHymnInput {
  number: string;
  title: string;
  categoryId?: number;
  sections: HymnSectionInput[];
}

export interface BackupSummary {
  categories: number;
  hymns: number;
  sections: number;
}

export interface ProjectionSlideData {
  sections: HymnSection[];
  currentIndex: number;
  hymnTitle: string;
  hymnNumber: string;
  contentType?: 'hymn' | 'bible';
  bibleRef?: string;  // e.g. "Deuteronomul 12:5"
}

export interface DisplayInfo {
  id: number;
  label: string;
  isPrimary: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
}

export type BgType = 'color' | 'image' | 'video';

export interface AppSettings {
  projectionDisplayId?: number;
  bgType?: BgType;
  bgColor?: string;        // hex, e.g. '#0a0a1a'
  bgImagePath?: string;    // absolute path on disk
  bgVideoPath?: string;    // absolute path on disk
  bgOpacity?: number;      // 0–1, opacity of the media layer (default 1)
  hymnNumberColor?: string; // hex, e.g. '#9fb3ff'
  contentTextColor?: string; // hex, e.g. '#ffffff'
  adminPasswordHash?: string; // bcrypt-like hash or empty
  projectionFontSize?: number; // font size multiplier, default 1.2
  audioOutputDeviceId?: string; // audio output device id for video playback
  debugLog?: boolean; // enable detailed debug logging to file
  windowBounds?: { x: number; y: number; width: number; height: number };
  downloadFolder?: string; // custom download folder for YouTube videos
  sidebarWidth?: number; // pixels, default 200 (deprecated — use layoutWidths)
  previewWidth?: number; // pixels, default 640 (deprecated — use layoutWidths)
  layoutWidths?: {
    imnuri?: { sidebarWidth: number; previewWidth: number };
    biblia?: { sidebarWidth: number; previewWidth: number };
    video?: { sidebarWidth: number; previewWidth: number };
  };
}

export interface YouTubeEntry {
  id: string;
  url: string;
  title: string;
  fileName: string;
  status: 'downloading' | 'ready' | 'error';
  error?: string;
  addedAt: string;
  localUrl?: string; // present for local file entries in unified playlist
}

export interface IElectronAPI {
  db: {
    getAllHymns: (categoryId?: number) => Promise<Hymn[]>;
    getAllHymnsWithSnippets: (categoryId?: number) => Promise<Hymn[]>;
    getHymn: (number: string) => Promise<Hymn | undefined>;
    searchHymns: (query: string, categoryId?: number) => Promise<Hymn[]>;
    searchHymnsContent: (query: string, categoryId?: number) => Promise<Hymn[]>;
    getHymnWithSections: (id: number) => Promise<HymnWithSections | null>;
    createHymnWithSections: (payload: CreateHymnInput) => Promise<number>;
    updateHymnWithSections: (id: number, payload: { number: string; title: string; sections: { type: 'strofa' | 'refren'; text: string }[] }) => Promise<void>;
    importPresentations: (dirPath: string, categoryId?: number) => Promise<ImportResult>;
    importPresentationFiles: (filePaths: string[], categoryId?: number) => Promise<ImportResult>;
    clearAll: () => Promise<void>;
    getCategories: () => Promise<Category[]>;
    createCategory: (name: string) => Promise<Category>;
    updateCategory: (id: number, name: string) => Promise<void>;
    deleteCategory: (id: number) => Promise<void>;
    exportDb: (destPath: string) => Promise<void>;
    exportJsonBackup: (destPath: string) => Promise<BackupSummary>;
    importJsonBackup: (filePath: string) => Promise<BackupSummary>;
  };
  hymn: {
    update: (id: number, number: string, title: string) => Promise<void>;
    setCategory: (id: number, categoryId?: number) => Promise<void>;
    delete: (id: number) => Promise<void>;
  };
  section: {
    add: (hymnId: number, type: 'strofa' | 'refren', text: string) => Promise<void>;
    update: (id: number, type: 'strofa' | 'refren', text: string) => Promise<void>;
    delete: (id: number) => Promise<void>;
    reorder: (sections: { id: number; order_index: number }[]) => Promise<void>;
  };
  bible: {
    getBooks: () => Promise<BibleBook[]>;
    getChapters: (bookId: number) => Promise<number[]>;
    getVerses: (bookId: number, chapter: number) => Promise<BibleVerse[]>;
    search: (query: string, bookId?: number, chapter?: number) => Promise<BibleVerse[]>;
    getVerseRange: (bookId: number, chapter: number, startVerse: number, endVerse: number) => Promise<BibleVerse[]>;
    hasData: () => Promise<boolean>;
  };
  dialog: {
    selectFolder: () => Promise<string | undefined>;
    selectPresentationFiles: () => Promise<string[] | undefined>;
    saveFile: (defaultName: string) => Promise<string | undefined>;
    saveJsonFile: (defaultName: string) => Promise<string | undefined>;
    selectJsonFile: () => Promise<string | undefined>;
    pickMedia: (mediaType: 'image' | 'video') => Promise<string | undefined>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    set: (patch: Partial<AppSettings>) => Promise<void>;
  };
  screen: {
    getDisplays: () => Promise<DisplayInfo[]>;
  };
  projection: {
    open: (sections: HymnSection[], hymnTitle: string, hymnNumber: string, startIndex?: number, contentType?: 'hymn' | 'bible', bibleRef?: string) => Promise<void>;
    navigate: (sections: HymnSection[], index: number, hymnTitle: string, hymnNumber: string, contentType?: 'hymn' | 'bible', bibleRef?: string) => Promise<void>;
    updateHymn: (sections: HymnSection[], hymnTitle: string, hymnNumber: string, startIndex?: number, contentType?: 'hymn' | 'bible', bibleRef?: string) => Promise<void>;
    close: () => Promise<void>;
    sendKeyRequest: (action: 'prev' | 'next' | 'close') => Promise<void>;
    onSlide: (cb: (data: ProjectionSlideData) => void) => void;
    offSlide: () => void;
    onControllerSync: (cb: (data: { currentIndex: number }) => void) => void;
    offControllerSync: () => void;
    onClosed: (cb: () => void) => void;
    offClosed: () => void;
    signalReady: () => void;
  };
  update: {
    check: () => Promise<{ available: boolean; version?: string; isDelta?: boolean }>;
    download: () => Promise<void>;
    install: () => void;
    onProgress: (cb: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => void;
    offProgress: () => void;
    onDownloaded: (cb: (data: { version: string }) => void) => void;
    offDownloaded: () => void;
    onError: (cb: (msg: string) => void) => void;
    offError: () => void;
  };
  video: {
    pickFile: () => Promise<string | undefined>;
    prepare: (filePath: string) => Promise<{ url?: string; name?: string; converted?: boolean; error?: string }>;
    startPlayback: (url: string, name: string) => Promise<void>;
    load: (filePath: string) => Promise<{ url?: string; name?: string; converted?: boolean; error?: string }>;
    play: () => Promise<void>;
    pause: () => Promise<void>;
    stop: () => Promise<void>;
    seek: (time: number) => Promise<void>;
    volume: (vol: number) => Promise<void>;
    loadUrl: (url: string) => Promise<{ url: string; name: string }>;
    onStatus: (cb: (data: { currentTime: number; duration: number; paused: boolean }) => void) => void;
    offStatus: () => void;
    onLoad: (cb: (url: string, name: string) => void) => void;
    offLoad: () => void;
    onPlay: (cb: () => void) => void;
    offPlay: () => void;
    onPause: (cb: () => void) => void;
    offPause: () => void;
    onStop: (cb: () => void) => void;
    offStop: () => void;
    onSeek: (cb: (time: number) => void) => void;
    offSeek: () => void;
    onVolume: (cb: (vol: number) => void) => void;
    offVolume: () => void;
    onConverting: (cb: (converting: boolean) => void) => void;
    offConverting: () => void;
    onConvertProgress: (cb: (line: string) => void) => void;
    offConvertProgress: () => void;
    sendStatus: (data: { currentTime: number; duration: number; paused: boolean }) => void;
  };
  ytdlp: {
    isInstalled: () => Promise<boolean>;
    install: () => Promise<{ success: boolean; error?: string }>;
    version: () => Promise<string>;
    update: () => Promise<{ success: boolean; version?: string; error?: string }>;
    getStreamUrl: (videoUrl: string) => Promise<{ url: string; error?: string }>;
  };
  youtube: {
    getPlaylist: () => Promise<YouTubeEntry[]>;
    add: (url: string, title?: string) => Promise<{ entry?: YouTubeEntry; error?: string }>;
    updateTitle: (id: string, title: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    delete: (id: string) => Promise<void>;
    reorder: (orderedIds: string[]) => Promise<void>;
    retryDownload: (id: string) => Promise<void>;
    getFileUrl: (id: string) => Promise<{ url?: string; name?: string; error?: string }>;
    onProgress: (cb: (id: string, percent: number, line: string) => void) => void;
    offProgress: () => void;
    onStatus: (cb: (id: string, status: string, error: string) => void) => void;
    offStatus: () => void;
  };
  playlist: {
    addLocal: (url: string, name: string) => Promise<{ entry?: YouTubeEntry; error?: string }>;
    getFileUrl: (id: string) => Promise<{ url?: string; name?: string; error?: string }>;
    getFilePath: (id: string) => Promise<string | null>;
    revealInFolder: (filePath: string) => Promise<void>;
    getDownloadFolder: () => Promise<string>;
  };
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
