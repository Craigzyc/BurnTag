import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { loadConfig, saveConfig } from './config.js';
import { Programmer } from './programmer.js';
import { registerIpcHandlers } from './ipc-handlers.js';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.jsonl');
const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');
const TEMPLATES_PATH = path.join(DATA_DIR, 'label-templates.json');

let mainWindow;
let tray;

function createWindow(config) {
  // Build VID list for serial port filtering
  const espVids = (config.espVidPids || []).map(v => v.vid || v);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    title: 'BurnTag \u2014 Flash & Label Station',
    backgroundColor: '#111827',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(import.meta.dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Remove default application menu
  Menu.setApplicationMenu(null);

  // ─── Web Serial Permissions (bypass browser picker) ────────
  const NIIMBOT_VID = '3513';

  const normalizeVid = (vid) => {
    if (!vid) return '';
    return (typeof vid === 'number' ? vid.toString(16) : String(vid)).toUpperCase();
  };

  const isEspVid = (vid) => {
    const hex = normalizeVid(vid);
    return espVids.some(v => hex === v.toUpperCase() || hex.padStart(4, '0') === v.toUpperCase());
  };

  const isNiimbotVid = (vid) => {
    const hex = normalizeVid(vid);
    return hex === NIIMBOT_VID || hex === '0' + NIIMBOT_VID;
  };

  const isKnownDevice = (vid) => isEspVid(vid) || isNiimbotVid(vid);

  // Auto-select serial ports for both ESP flashing and Niimbot printing.
  //
  // When ESP flasher calls requestPort({filters: ESP VIDs}):
  //   → portList only contains ESP devices → pick ESP
  //
  // When niimbluelib calls requestPort() with NO filters:
  //   → portList contains ALL devices → pick Niimbot (it's a print request)
  //
  mainWindow.webContents.session.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();

    const hasNiimbot = portList.some(p => isNiimbotVid(p.vendorId));
    const hasEsp = portList.some(p => isEspVid(p.vendorId));

    if (hasNiimbot && hasEsp) {
      // Unfiltered request (both present) — likely a print request
      const niimbot = portList.find(p => isNiimbotVid(p.vendorId));
      callback(niimbot.portId);
    } else if (hasEsp) {
      // Filtered to ESP only — flash request
      const esp = portList.find(p => isEspVid(p.vendorId));
      callback(esp.portId);
    } else if (hasNiimbot) {
      // Only Niimbot — print request
      const niimbot = portList.find(p => isNiimbotVid(p.vendorId));
      callback(niimbot.portId);
    } else {
      callback(portList[0]?.portId || '');
    }
  });

  // Grant serial permission for both ESP and Niimbot devices
  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'serial') return false;
    const vid = details.device?.vendorId;
    if (!vid) return true;  // No VID info — allow (initial grant)
    return isKnownDevice(vid);
  });

  // Allow serial permission check for our local app
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    return true;
  });

  // ─── Serial port connect/disconnect events → renderer ──────
  mainWindow.webContents.session.on('serial-port-added', (_event, port) => {
    send('port:added', port);
  });

  mainWindow.webContents.session.on('serial-port-removed', (_event, port) => {
    send('port:removed', port);
  });

  mainWindow.loadFile(path.join(import.meta.dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// Helper to send IPC to renderer
function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

app.whenReady().then(() => {
  const config = loadConfig(CONFIG_PATH);

  // Programmer handles post-flash steps (serial assignment, label gen, printing)
  const programmer = new Programmer({
    config,
    configPath: CONFIG_PATH,
    historyPath: HISTORY_PATH,
  });

  createWindow(config);

  // Register IPC handlers
  registerIpcHandlers({
    config,
    configPath: CONFIG_PATH,
    historyPath: HISTORY_PATH,
    profilesPath: PROFILES_PATH,
    templatesPath: TEMPLATES_PATH,
    programmer,
  });

  // Forward programmer events to renderer
  programmer.on('status', data => send('programmer:status', data));
  programmer.on('error', data => send('programmer:error', data));

  // System tray
  const trayIcon = nativeImage.createFromPath(
    path.join(import.meta.dirname, '..', 'renderer', 'assets', 'logo.svg'),
  );
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Auto-Program',
      type: 'checkbox',
      checked: config.autoMode,
      click: (item) => {
        config.autoMode = item.checked;
        saveConfig(config, CONFIG_PATH);
        send('config:updated', config);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.setToolTip('BurnTag — Flash & Label Station');
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on('window-all-closed', () => {
  // Don't quit — keep in tray
});
