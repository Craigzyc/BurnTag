import { ipcMain, BrowserWindow, dialog } from 'electron';
import { saveConfig } from './config.js';
import { scanFirmwareDir } from './firmware-scanner.js';
import { readHistory } from './history.js';
import { generateLabel } from './label-generator.js';
import { isPrinterAvailable, printLabel, getPrinterInfo, connectPrinter } from './label-printer.js';
import { listProfiles, saveProfile, loadProfile, deleteProfile } from './profiles.js';
import { listLabelTemplates, saveLabelTemplate, loadLabelTemplate, deleteLabelTemplate } from './label-templates.js';
import { sendSerialConfig } from './serial-config.js';
import { buildNvsImage } from './nvs-image.js';
import { peekNextSerial } from './serial-number.js';
import { PRINTERS, LABEL_SIZES } from './printer-registry.js';
import fs from 'node:fs';
import path from 'node:path';

export function registerIpcHandlers({ config, configPath, historyPath, profilesPath, templatesPath, programmer }) {
  ipcMain.handle('get-config', () => config);

  // Peek at the next serial WITHOUT incrementing the counter. Renderer uses
  // this at the start of a flash so the same serial lands on both the label
  // and the device (NVS image or JSON config). The counter is only committed
  // later in post-flash once the full pipeline has succeeded.
  ipcMain.handle('peek-next-serial', () => {
    return config.serialEnabled ? peekNextSerial(config) : null;
  });

  ipcMain.handle('update-config', (_event, updates) => {
    Object.assign(config, updates);
    if (updates.flashAddresses) {
      config.flashAddresses = { ...config.flashAddresses, ...updates.flashAddresses };
    }
    if (updates.flashEnabled) {
      config.flashEnabled = { ...config.flashEnabled, ...updates.flashEnabled };
    }
    if (updates.labelTemplate) {
      config.labelTemplate = { ...config.labelTemplate, ...updates.labelTemplate };
    }
    if (updates.postFlashConfig) {
      config.postFlashConfig = { ...config.postFlashConfig, ...updates.postFlashConfig };
    }
    saveConfig(config, configPath);
    programmer.updateConfig(config);
    return config;
  });

  // Smart-scan a directory: returns { kind: 'single'|'multi'|'empty', files?, builds? }.
  // 'single' = the dir directly contains firmware.bin; 'multi' = .pio/build envs or legacy
  // sensors/gateway tree; 'empty' = nothing found.
  ipcMain.handle('scan-firmware-dir', (_event, dir) => {
    const target = dir || config.firmwareBaseDir;
    if (!target) return { kind: 'empty' };
    const resolved = path.isAbsolute(target)
      ? target
      : path.resolve(import.meta.dirname, '..', target);
    return scanFirmwareDir(resolved);
  });

  ipcMain.handle('get-history', (_event, limit) => {
    return readHistory(historyPath, limit || 100);
  });

  // Read .bin file contents (returns ArrayBuffer for esptool-js)
  ipcMain.handle('read-firmware-file', (_event, filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Firmware file not found: ${filePath}`);
    }
    const buffer = fs.readFileSync(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });

  // Post-flash: serial assignment, label gen, print (or flash-only)
  ipcMain.handle('post-flash', async (_event, { mac, port, firmware, flashOnly, configResults, reservedSerial }) => {
    if (flashOnly) {
      return programmer.recordFlashOnly({ mac, port, firmware });
    }
    return programmer.completePostFlash({ mac, port, firmware, configResults, reservedSerial });
  });

  // Label preview — template-driven
  ipcMain.handle('preview-label', async (_event, { template, variables }) => {
    const t = template || config.labelTemplate;
    const buf = await generateLabel(t, variables || {});
    return `data:image/png;base64,${buf.toString('base64')}`;
  });

  // Print label via main process (niimbotjs + node serialport)
  ipcMain.handle('print-label', async (_event, { pngBase64, density }) => {
    try {
      const buf = Buffer.from(pngBase64, 'base64');
      return await printLabel(buf, { density: density || 2 });
    } catch (err) {
      return { success: false, error: err?.message || 'Print error' };
    }
  });

  ipcMain.handle('get-printer-status', () => isPrinterAvailable());
  ipcMain.handle('get-printer-info', () => getPrinterInfo());
  ipcMain.handle('connect-printer', () => connectPrinter());

  // Printer/label registries
  ipcMain.handle('get-printer-types', () => PRINTERS);
  ipcMain.handle('get-label-sizes', () => LABEL_SIZES);

  // ─── Label Templates ───────────────────────────────────────
  ipcMain.handle('list-label-templates', () => listLabelTemplates(templatesPath));

  ipcMain.handle('save-label-template', (_event, { name, template }) => {
    saveLabelTemplate(templatesPath, name, template);
    return listLabelTemplates(templatesPath);
  });

  ipcMain.handle('load-label-template', (_event, name) => {
    return loadLabelTemplate(templatesPath, name);
  });

  ipcMain.handle('delete-label-template', (_event, name) => {
    deleteLabelTemplate(templatesPath, name);
    return listLabelTemplates(templatesPath);
  });

  // ─── Profiles ─────────────────────────────────────────────
  ipcMain.handle('list-profiles', () => listProfiles(profilesPath));

  ipcMain.handle('save-profile', (_event, { name, data }) => {
    saveProfile(profilesPath, name, data);
    return listProfiles(profilesPath);
  });

  ipcMain.handle('load-profile', (_event, name) => {
    const profile = loadProfile(profilesPath, name);
    if (!profile) return null;
    Object.assign(config, profile.settings);
    config.activeProfile = name;
    saveConfig(config, configPath);
    programmer.updateConfig(config);
    return config;
  });

  ipcMain.handle('delete-profile', (_event, name) => {
    deleteProfile(profilesPath, name);
    if (config.activeProfile === name) {
      config.activeProfile = null;
      saveConfig(config, configPath);
    }
    return listProfiles(profilesPath);
  });

  // ─── Dialogs ──────────────────────────────────────────────
  ipcMain.handle('select-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // Browse for a single firmware component .bin. When slot === 'firmware' (or omitted),
  // also auto-detects sibling bootloader/partitions in the same folder. For other slots,
  // just returns { slot, path } so the caller updates only that row.
  ipcMain.handle('select-firmware-file', async (event, opts = {}) => {
    const slot = opts.slot || 'firmware';
    const win = BrowserWindow.fromWebContents(event.sender);
    const titles = {
      firmware: 'Select Firmware Binary',
      bootloader: 'Select Bootloader Binary',
      partitions: 'Select Partitions Binary',
    };
    const result = await dialog.showOpenDialog(win, {
      title: titles[slot] || 'Select Binary',
      filters: [
        { name: 'Binary Files', extensions: ['bin'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];

    if (slot !== 'firmware') {
      return { slot, path: filePath };
    }

    // Firmware slot: auto-detect siblings.
    const dir = path.dirname(filePath);
    const name = path.basename(dir);
    const bootloaderPath = path.join(dir, 'bootloader.bin');
    const partitionsPath = path.join(dir, 'partitions.bin');

    return {
      slot: 'firmware',
      name,
      env: name,
      category: 'custom',
      files: {
        firmware: filePath,
        bootloader: fs.existsSync(bootloaderPath) ? bootloaderPath : null,
        partitions: fs.existsSync(partitionsPath) ? partitionsPath : null,
      },
    };
  });

  // ─── Post-Flash Serial Config ──────────────────────────────
  ipcMain.handle('send-serial-config', async (event, opts) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const onLog = (msg) => {
      win?.webContents.send('config:log', msg);
    };
    return sendSerialConfig({ ...opts, onLog });
  });

  // ─── Build NVS Partition Image ─────────────────────────────
  // Called by the renderer for NVS-mode post-flash config. Returns an
  // ArrayBuffer + target flash offset that the renderer appends to the
  // esptool-js file list, so the NVS blob is programmed alongside the
  // firmware in one shot.
  ipcMain.handle('build-nvs-image', (_event, { namespace, items, partitionOffset, partitionSize }) => {
    const size = parseInt(partitionSize, 16);
    const offset = parseInt(partitionOffset, 16);
    if (isNaN(size) || isNaN(offset)) {
      throw new Error(`Invalid NVS partitionOffset "${partitionOffset}" or partitionSize "${partitionSize}"`);
    }
    const buf = buildNvsImage({ namespace, items, partitionSize: size });
    return {
      offset,
      data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  });

  // ─── Export / Import ───────────────────────────────────────
  ipcMain.handle('export-config', async (event, { data, defaultName }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Configuration',
      defaultPath: defaultName || 'burntag-config.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return result.filePath;
  });

  ipcMain.handle('import-config', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Configuration',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    return JSON.parse(raw);
  });

  // ─── Window Controls ──────────────────────────────────────
  ipcMain.handle('window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });

  ipcMain.handle('window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
