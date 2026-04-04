import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  db: {
    getAllHymns: (categoryId?: number) => ipcRenderer.invoke('db:get-all-hymns', categoryId),
    getHymn: (number: string) => ipcRenderer.invoke('db:get-hymn', number),
    searchHymns: (query: string, categoryId?: number) => ipcRenderer.invoke('db:search-hymns', query, categoryId),
    getHymnWithSections: (id: number) => ipcRenderer.invoke('db:get-hymn-with-sections', id),
    createHymnWithSections: (payload: {
      number: string;
      title: string;
      categoryId?: number;
      sections: { type: 'strofa' | 'refren'; text: string }[];
    }) => ipcRenderer.invoke('db:create-hymn-with-sections', payload),
    importPresentations: (dirPath: string, categoryId?: number) => ipcRenderer.invoke('db:import-presentations', dirPath, categoryId),
    importPresentationFiles: (filePaths: string[], categoryId?: number) => ipcRenderer.invoke('db:import-presentation-files', filePaths, categoryId),
    clearAll: () => ipcRenderer.invoke('db:clear-all'),
    getCategories: () => ipcRenderer.invoke('db:get-categories'),
    createCategory: (name: string) => ipcRenderer.invoke('db:create-category', name),
    updateCategory: (id: number, name: string) => ipcRenderer.invoke('db:update-category', id, name),
    deleteCategory: (id: number) => ipcRenderer.invoke('db:delete-category', id),
    exportDb: (destPath: string) => ipcRenderer.invoke('db:export', destPath),
    exportJsonBackup: (destPath: string) => ipcRenderer.invoke('db:export-json-backup', destPath),
    importJsonBackup: (filePath: string) => ipcRenderer.invoke('db:import-json-backup', filePath),
  },

  hymn: {
    update: (id: number, number: string, title: string) =>
      ipcRenderer.invoke('hymn:update', id, number, title),
    setCategory: (id: number, categoryId?: number) =>
      ipcRenderer.invoke('hymn:set-category', id, categoryId),
    delete: (id: number) => ipcRenderer.invoke('hymn:delete', id),
  },

  section: {
    add: (hymnId: number, type: 'strofa' | 'refren', text: string) =>
      ipcRenderer.invoke('section:add', hymnId, type, text),
    update: (id: number, type: 'strofa' | 'refren', text: string) =>
      ipcRenderer.invoke('section:update', id, type, text),
    delete: (id: number) => ipcRenderer.invoke('section:delete', id),
    reorder: (sections: { id: number; order_index: number }[]) =>
      ipcRenderer.invoke('section:reorder', sections),
  },

  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
    selectPresentationFiles: () => ipcRenderer.invoke('dialog:select-presentation-files'),
    saveFile: (defaultName: string) => ipcRenderer.invoke('dialog:save-file', defaultName),
    saveJsonFile: (defaultName: string) => ipcRenderer.invoke('dialog:save-json-file', defaultName),
    selectJsonFile: () => ipcRenderer.invoke('dialog:select-json-file'),
    pickMedia: (mediaType: 'image' | 'video') => ipcRenderer.invoke('dialog:pick-media', mediaType),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  },

  screen: {
    getDisplays: () => ipcRenderer.invoke('screen:get-displays'),
  },

  bible: {
    getBooks: () => ipcRenderer.invoke('bible:get-books'),
    getChapters: (bookId: number) => ipcRenderer.invoke('bible:get-chapters', bookId),
    getVerses: (bookId: number, chapter: number) =>
      ipcRenderer.invoke('bible:get-verses', bookId, chapter),
    search: (query: string, bookId?: number) =>
      ipcRenderer.invoke('bible:search', query, bookId),
    getVerseRange: (bookId: number, chapter: number, startVerse: number, endVerse: number) =>
      ipcRenderer.invoke('bible:get-verse-range', bookId, chapter, startVerse, endVerse),
  },

  projection: {
    open: (sections: any[], hymnTitle: string, hymnNumber: string) =>
      ipcRenderer.invoke('projection:open', sections, hymnTitle, hymnNumber),
    navigate: (sections: any[], index: number, hymnTitle: string, hymnNumber: string) =>
      ipcRenderer.invoke('projection:navigate', sections, index, hymnTitle, hymnNumber),
    close: () => ipcRenderer.invoke('projection:close'),
    sendKeyRequest: (action: 'prev' | 'next' | 'close') =>
      ipcRenderer.invoke('projection:key-request', action),
    onSlide: (cb: (data: any) => void) =>
      ipcRenderer.on('projection:slide', (_e, data) => cb(data)),
    offSlide: () => ipcRenderer.removeAllListeners('projection:slide'),
    onControllerSync: (cb: (data: { currentIndex: number }) => void) =>
      ipcRenderer.on('projection:controller-sync', (_e, data) => cb(data)),
    offControllerSync: () => ipcRenderer.removeAllListeners('projection:controller-sync'),
    onClosed: (cb: () => void) =>
      ipcRenderer.on('projection:closed', () => cb()),
    offClosed: () => ipcRenderer.removeAllListeners('projection:closed'),
  },
})
