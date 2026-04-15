const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (updates) => ipcRenderer.invoke('update-config', updates),

  // Firmware
  getFirmware: () => ipcRenderer.invoke('get-firmware'),

  // Read .bin file contents (returns ArrayBuffer for esptool-js)
  readFirmwareFile: (filePath) => ipcRenderer.invoke('read-firmware-file', filePath),

  // Peek the next serial number without incrementing (used to bake the
  // serial into the device's NVS image or JSON config before flashing).
  peekNextSerial: () => ipcRenderer.invoke('peek-next-serial'),

  // Post-flash: serial assignment, label gen, print
  postFlash: (data) => ipcRenderer.invoke('post-flash', data),

  // Post-flash serial config (main process, node serialport)
  sendSerialConfig: (opts) => ipcRenderer.invoke('send-serial-config', opts),
  // Build an NVS partition image (main process) for NVS-mode post-flash config.
  // Returns { offset, data: ArrayBuffer } to append to the esptool-js flash list.
  buildNvsImage: (opts) => ipcRenderer.invoke('build-nvs-image', opts),
  onConfigLog: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('config:log', handler);
    return () => ipcRenderer.removeListener('config:log', handler);
  },

  // History
  getHistory: (limit) => ipcRenderer.invoke('get-history', limit),

  // Label preview + print
  previewLabel: (data) => ipcRenderer.invoke('preview-label', data),
  printLabel: (data) => ipcRenderer.invoke('print-label', data),

  // Printer
  getPrinterStatus: () => ipcRenderer.invoke('get-printer-status'),
  getPrinterInfo: () => ipcRenderer.invoke('get-printer-info'),
  connectPrinter: () => ipcRenderer.invoke('connect-printer'),
  getPrinterTypes: () => ipcRenderer.invoke('get-printer-types'),
  getLabelSizes: () => ipcRenderer.invoke('get-label-sizes'),

  // Label Templates (saved designs)
  listLabelTemplates: () => ipcRenderer.invoke('list-label-templates'),
  saveLabelTemplate: (name, template) => ipcRenderer.invoke('save-label-template', { name, template }),
  loadLabelTemplate: (name) => ipcRenderer.invoke('load-label-template', name),
  deleteLabelTemplate: (name) => ipcRenderer.invoke('delete-label-template', name),

  // Profiles (device programming config)
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  saveProfile: (name, data) => ipcRenderer.invoke('save-profile', { name, data }),
  loadProfile: (name) => ipcRenderer.invoke('load-profile', name),
  deleteProfile: (name) => ipcRenderer.invoke('delete-profile', name),

  // Dialogs
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFirmwareFile: () => ipcRenderer.invoke('select-firmware-file'),
  exportConfig: (data, defaultName) => ipcRenderer.invoke('export-config', { data, defaultName }),
  importConfig: () => ipcRenderer.invoke('import-config'),

  // Window controls (frameless)
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),

  // Events from main process
  onStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('programmer:status', handler);
    return () => ipcRenderer.removeListener('programmer:status', handler);
  },
  onError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('programmer:error', handler);
    return () => ipcRenderer.removeListener('programmer:error', handler);
  },
  onPortAdded: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('port:added', handler);
    return () => ipcRenderer.removeListener('port:added', handler);
  },
  onPortRemoved: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('port:removed', handler);
    return () => ipcRenderer.removeListener('port:removed', handler);
  },
});
