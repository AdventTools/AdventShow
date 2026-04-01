
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
}

export interface UrgentTickerData {
  message: string;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  speed: number; // px/sec
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
}

export interface IElectronAPI {
  db: {
    getAllHymns: (categoryId?: number) => Promise<Hymn[]>;
    getHymn: (number: string) => Promise<Hymn | undefined>;
    searchHymns: (query: string, categoryId?: number) => Promise<Hymn[]>;
    getHymnWithSections: (id: number) => Promise<HymnWithSections | null>;
    createHymnWithSections: (payload: CreateHymnInput) => Promise<number>;
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
    open: (sections: HymnSection[], hymnTitle: string, hymnNumber: string) => Promise<void>;
    navigate: (sections: HymnSection[], index: number, hymnTitle: string, hymnNumber: string) => Promise<void>;
    showUrgentTicker: (payload: UrgentTickerData) => Promise<void>;
    hideUrgentTicker: () => Promise<void>;
    close: () => Promise<void>;
    sendKeyRequest: (action: 'prev' | 'next' | 'close') => Promise<void>;
    onSlide: (cb: (data: ProjectionSlideData) => void) => void;
    offSlide: () => void;
    onUrgentTicker: (cb: (data: UrgentTickerData | null) => void) => void;
    offUrgentTicker: () => void;
    onControllerSync: (cb: (data: { currentIndex: number }) => void) => void;
    offControllerSync: () => void;
    onClosed: (cb: () => void) => void;
    offClosed: () => void;
  };
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
