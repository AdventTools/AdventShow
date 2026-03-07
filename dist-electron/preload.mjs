"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electron", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  },
  db: {
    getAllHymns: (categoryId) => electron.ipcRenderer.invoke("db:get-all-hymns", categoryId),
    getHymn: (number) => electron.ipcRenderer.invoke("db:get-hymn", number),
    searchHymns: (query, categoryId) => electron.ipcRenderer.invoke("db:search-hymns", query, categoryId),
    getHymnWithSections: (id) => electron.ipcRenderer.invoke("db:get-hymn-with-sections", id),
    importPPTX: (dirPath, categoryId) => electron.ipcRenderer.invoke("db:import-pptx", dirPath, categoryId),
    importPPTXFiles: (filePaths, categoryId) => electron.ipcRenderer.invoke("db:import-pptx-files", filePaths, categoryId),
    clearAll: () => electron.ipcRenderer.invoke("db:clear-all"),
    getCategories: () => electron.ipcRenderer.invoke("db:get-categories"),
    createCategory: (name) => electron.ipcRenderer.invoke("db:create-category", name),
    updateCategory: (id, name) => electron.ipcRenderer.invoke("db:update-category", id, name),
    deleteCategory: (id) => electron.ipcRenderer.invoke("db:delete-category", id),
    exportDb: (destPath) => electron.ipcRenderer.invoke("db:export", destPath)
  },
  hymn: {
    update: (id, number, title) => electron.ipcRenderer.invoke("hymn:update", id, number, title),
    delete: (id) => electron.ipcRenderer.invoke("hymn:delete", id)
  },
  section: {
    add: (hymnId, type, text) => electron.ipcRenderer.invoke("section:add", hymnId, type, text),
    update: (id, type, text) => electron.ipcRenderer.invoke("section:update", id, type, text),
    delete: (id) => electron.ipcRenderer.invoke("section:delete", id),
    reorder: (sections) => electron.ipcRenderer.invoke("section:reorder", sections)
  },
  dialog: {
    selectFolder: () => electron.ipcRenderer.invoke("dialog:select-folder"),
    selectPPTXFiles: () => electron.ipcRenderer.invoke("dialog:select-pptx-files"),
    saveFile: (defaultName) => electron.ipcRenderer.invoke("dialog:save-file", defaultName),
    pickMedia: (mediaType) => electron.ipcRenderer.invoke("dialog:pick-media", mediaType)
  },
  settings: {
    get: () => electron.ipcRenderer.invoke("settings:get"),
    set: (patch) => electron.ipcRenderer.invoke("settings:set", patch)
  },
  screen: {
    getDisplays: () => electron.ipcRenderer.invoke("screen:get-displays")
  },
  projection: {
    open: (sections, hymnTitle, hymnNumber) => electron.ipcRenderer.invoke("projection:open", sections, hymnTitle, hymnNumber),
    navigate: (sections, index, hymnTitle, hymnNumber) => electron.ipcRenderer.invoke("projection:navigate", sections, index, hymnTitle, hymnNumber),
    close: () => electron.ipcRenderer.invoke("projection:close"),
    sendKeyRequest: (action) => electron.ipcRenderer.invoke("projection:key-request", action),
    onSlide: (cb) => electron.ipcRenderer.on("projection:slide", (_e, data) => cb(data)),
    offSlide: () => electron.ipcRenderer.removeAllListeners("projection:slide"),
    onControllerSync: (cb) => electron.ipcRenderer.on("projection:controller-sync", (_e, data) => cb(data)),
    offControllerSync: () => electron.ipcRenderer.removeAllListeners("projection:controller-sync"),
    onClosed: (cb) => electron.ipcRenderer.on("projection:closed", () => cb()),
    offClosed: () => electron.ipcRenderer.removeAllListeners("projection:closed")
  }
});
