import { getGrantedPorts, connectAndFlash, ESPLoader, Transport } from './flasher.js';
import { printLabel as printLabelRenderer } from './printer.js';

// ─── State ─────────────────────────────────────────────────
let config = {};
let firmwareBuilds = []; // [{ label, files }] when scan returns kind: 'multi'
const devices = new Map();

// Chip → flash-address defaults. Bootloader differs across the family; partitions
// and firmware are the same on every modern ESP32 variant.
const CHIP_DEFAULTS = {
  esp32:   { bootloader: '0x1000', partitions: '0x8000', firmware: '0x10000' },
  esp32s2: { bootloader: '0x1000', partitions: '0x8000', firmware: '0x10000' },
  esp32s3: { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
  esp32c3: { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
  esp32c6: { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
  esp32h2: { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
};

// Map esptool-js chip descriptions to our dropdown values.
function chipDescriptionToValue(desc) {
  if (!desc) return null;
  const s = String(desc).toLowerCase();
  if (s.includes('esp32-s3') || s.includes('esp32s3')) return 'esp32s3';
  if (s.includes('esp32-s2') || s.includes('esp32s2')) return 'esp32s2';
  if (s.includes('esp32-c6') || s.includes('esp32c6')) return 'esp32c6';
  if (s.includes('esp32-c3') || s.includes('esp32c3')) return 'esp32c3';
  if (s.includes('esp32-h2') || s.includes('esp32h2')) return 'esp32h2';
  if (s.includes('esp32')) return 'esp32';
  return null;
}

// ─── DOM References (Program View) ────────────────────────
const firmwareSelect = document.getElementById('firmwareSelect');
const firmwareBuildsRow = document.getElementById('firmwareBuildsRow');
const browseFirmwareBtn = document.getElementById('browseFirmwareBtn');
const firmwareDirBtn = document.getElementById('firmwareDirBtn');
const detectChipBtn = document.getElementById('detectChipBtn');
const flashEnabledCheckboxes = {
  bootloader: document.getElementById('flashEnabled_bootloader'),
  partitions: document.getElementById('flashEnabled_partitions'),
  firmware: document.getElementById('flashEnabled_firmware'),
};
const firmwarePathSpans = {
  bootloader: document.getElementById('firmwarePath_bootloader'),
  partitions: document.getElementById('firmwarePath_partitions'),
  firmware: document.getElementById('firmwarePath_firmware'),
};
const deviceList = document.getElementById('deviceList');
const flashLog = document.getElementById('flashLog');
const progressBar = document.getElementById('progressBar');
const clearLogBtn = document.getElementById('clearLogBtn');
const settingsForm = document.getElementById('settingsForm');
const autoModeToggle = document.getElementById('autoModeToggle');
const printerStatus = document.getElementById('printerStatus');
const pipelineStepper = document.getElementById('pipelineStepper');
const labelPreview = document.getElementById('labelPreview');
const previewBtn = document.getElementById('previewBtn');
const printPreviewBtn = document.getElementById('printPreviewBtn');
const historyBody = document.getElementById('historyTable').querySelector('tbody');
const errorBanner = document.getElementById('errorBanner');
const errorText = document.getElementById('errorText');
const dismissError = document.getElementById('dismissError');
const profileSelect = document.getElementById('profileSelect');
const programLabelSelect = document.getElementById('programLabelSelect');
const programLoadLabelBtn = document.getElementById('programLoadLabelBtn');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const deleteProfileBtn = document.getElementById('deleteProfileBtn');
const serialEnabledToggle = document.getElementById('serialEnabledToggle');
const serialFields = document.getElementById('serialFields');
const serialDisabledHint = document.getElementById('serialDisabledHint');
const serialWriteToDeviceToggle = document.getElementById('serialWriteToDeviceToggle');
const serialDeviceFields = document.getElementById('serialDeviceFields');
const serialDeviceKeyInput = document.getElementById('serialDeviceKey');
const serialDeviceTypeSelect = document.getElementById('serialDeviceType');

// Post-Flash Config DOM references
const postFlashConfigToggle = document.getElementById('postFlashConfigToggle');
const postFlashConfigFields = document.getElementById('postFlashConfigFields');
const postFlashConfigHint = document.getElementById('postFlashConfigHint');
const postFlashConfigItems = document.getElementById('postFlashConfigItems');
const addConfigItemBtn = document.getElementById('addConfigItemBtn');
const postFlashBaudRate = document.getElementById('postFlashBaudRate');
const postFlashReadyTimeout = document.getElementById('postFlashReadyTimeout');
const postFlashInterCommandDelay = document.getElementById('postFlashInterCommandDelay');
const postFlashPingCommand = document.getElementById('postFlashPingCommand');
const postFlashReadyResponse = document.getElementById('postFlashReadyResponse');
const postFlashExpectedResponse = document.getElementById('postFlashExpectedResponse');
const postFlashCommandTemplate = document.getElementById('postFlashCommandTemplate');
const postFlashJsonFields = document.getElementById('postFlashJsonFields');
const postFlashNvsFields = document.getElementById('postFlashNvsFields');
const postFlashNvsNamespace = document.getElementById('postFlashNvsNamespace');
const postFlashNvsOffset = document.getElementById('postFlashNvsOffset');
const postFlashNvsSize = document.getElementById('postFlashNvsSize');
const postFlashModeTabs = document.querySelectorAll('.pfc-mode-tab');
const postFlashHelpBtn = document.getElementById('postFlashHelpBtn');
const postFlashHelpModal = document.getElementById('postFlashHelpModal');
const postFlashHelpClose = document.getElementById('postFlashHelpClose');
const postFlashHelpCloseFooter = document.getElementById('postFlashHelpCloseFooter');
let postFlashMode = 'json';

// ─── DOM References (Design View) ─────────────────────────
const designForm = document.getElementById('designForm');
const bodyLinesList = document.getElementById('bodyLinesList');
const addBodyLineBtn = document.getElementById('addBodyLineBtn');
const footerLinesList = document.getElementById('footerLinesList');
const addFooterLineBtn = document.getElementById('addFooterLineBtn');
const designPreviewBtn = document.getElementById('designPreviewBtn');
const designPrintBtn = document.getElementById('designPrintBtn');
const designLabelPreview = document.getElementById('designLabelPreview');
const saveTemplateBtn = document.getElementById('saveTemplateBtn');

// ─── Window Controls ───────────────────────────────────────
document.getElementById('btnMinimize').addEventListener('click', () => window.api.windowMinimize());
document.getElementById('btnMaximize').addEventListener('click', () => window.api.windowMaximize());
document.getElementById('btnClose').addEventListener('click', () => window.api.windowClose());

// ─── Tab System ────────────────────────────────────────────
const tabBtns = document.querySelectorAll('.tab-btn');
const programView = document.getElementById('programView');
const designView = document.getElementById('designView');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    programView.style.display = tab === 'program' ? 'flex' : 'none';
    designView.style.display = tab === 'design' ? 'flex' : 'none';
    if (tab === 'design') { refreshSavedTemplates(); }
  });
});

// ─── Init ──────────────────────────────────────────────────
async function init() {
  config = await window.api.getConfig();
  await rescanFirmwareDir({ silent: true });
  const history = await window.api.getHistory(50);

  // Populate label sizes from registry
  const labelSizes = await window.api.getLabelSizes();
  const labelSizeSelect = document.getElementById('designLabelSize');
  for (const s of labelSizes) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    labelSizeSelect.appendChild(opt);
  }

  populateSettingsForm();
  renderHistory(history);
  checkPrinterStatus();
  await refreshProfiles();
  await refreshProgramLabels();
  await scanPorts();

  navigator.serial.addEventListener('connect', onSerialConnect);
  navigator.serial.addEventListener('disconnect', onSerialDisconnect);
  window.api.onPortAdded(() => scanPorts());
  window.api.onPortRemoved(() => scanPorts());

  setInterval(checkPrinterStatus, 10_000);

  // Printer status is detected at print time via Web Serial
}

// ─── Known ESP USB chip names ──────────────────────────────
const CHIP_NAMES = { 0x303A: 'Espressif', 0x10C4: 'CP210x', 0x1A86: 'CH340', 0x0403: 'FTDI' };

function isEspDevice(info) {
  if (!info?.usbVendorId) return false;
  const vidHex = info.usbVendorId.toString(16).toUpperCase();
  return (config.espVidPids || []).some(v => (v.vid || v).toUpperCase() === vidHex);
}

function deviceLabel(info) {
  const chipName = CHIP_NAMES[info.usbVendorId] || 'Unknown';
  const pid = info.usbProductId?.toString(16)?.toUpperCase().padStart(4, '0') || '????';
  return `${chipName} (PID:${pid})`;
}

let portCounter = 0;
const portKeyMap = new WeakMap();
function getPortKey(port) {
  if (portKeyMap.has(port)) return portKeyMap.get(port);
  const key = `port-${portCounter++}`;
  portKeyMap.set(port, key);
  return key;
}

// ─── Serial Port Monitoring ────────────────────────────────
async function scanPorts() {
  const ports = await getGrantedPorts();
  devices.clear();
  for (const port of ports) {
    const info = port.getInfo();
    if (!isEspDevice(info)) continue;
    devices.set(getPortKey(port), { port, info });
  }
  renderDevices();
}

// Web Serial only fires `connect` for ports that have already been granted.
// A brand-new ESP plugged in for the first time stays invisible until we call
// requestPort() to grant it. The main-process select-serial-port handler
// round-robins through ungranted ESPs, so calling requestPort repeatedly
// discovers each device in turn. Stops when we get back a port we've already
// seen (everything plugged in is now granted).
async function discoverEspPorts({ silent = false } = {}) {
  const filters = (config.espVidPids || []).map(v => ({
    usbVendorId: parseInt(v.vid || v, 16),
  }));
  let added = 0;
  for (let i = 0; i < 8; i++) {
    let port;
    try {
      port = await navigator.serial.requestPort({ filters });
    } catch {
      // No more matching ports, or user aborted. Either way, we're done.
      break;
    }
    const key = getPortKey(port);
    if (devices.has(key)) break;
    const info = port.getInfo();
    if (!isEspDevice(info)) break;
    devices.set(key, { port, info });
    added++;
  }
  renderDevices();
  if (!silent) {
    if (added > 0) appendLog(`Discovered ${added} ESP device${added === 1 ? '' : 's'}.`);
    else appendLog('No new ESP devices found.');
  }
  return added;
}

// Picker modal — used when an action (Detect) needs the user to choose among
// multiple connected devices. Resolves to a device or null on cancel.
function pickEspDevice(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--fc-surface);border:1px solid var(--fc-border);border-radius:8px;padding:16px;min-width:320px;max-width:480px;';
    const title = document.createElement('div');
    title.style.cssText = 'color:var(--fc-text);font-size:14px;font-weight:600;margin-bottom:10px;';
    title.textContent = message;
    box.appendChild(title);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:12px;';
    for (const [, dev] of devices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.style.cssText = 'text-align:left;';
      btn.textContent = deviceLabel(dev.info);
      btn.addEventListener('click', () => { overlay.remove(); resolve(dev); });
      list.appendChild(btn);
    }
    box.appendChild(list);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-xs';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { overlay.remove(); resolve(null); });
    footer.appendChild(cancel);
    box.appendChild(footer);

    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });
    document.body.appendChild(overlay);
  });
}

function onSerialConnect(event) {
  const port = event.target;
  const info = port.getInfo();
  if (!isEspDevice(info)) return;
  const key = getPortKey(port);
  devices.set(key, { port, info });
  renderDevices();
  appendLog(`Device connected: ${deviceLabel(info)}`);
  if (config.autoMode) {
    setTimeout(() => {
      if (config.autoMode) flashDevice(key, { print: true }).catch(err => showError(err.message));
    }, 2000);
  }
}

function onSerialDisconnect(event) {
  const port = event.target;
  const info = port.getInfo();
  const key = getPortKey(port);
  devices.delete(key);
  renderDevices();
  if (isEspDevice(info)) appendLog(`Device disconnected: ${deviceLabel(info)}`);
}

// ─── Firmware ──────────────────────────────────────────────
const SLOTS = ['bootloader', 'partitions', 'firmware'];

function shortPath(p) {
  if (!p) return '—';
  const norm = p.replace(/\\/g, '/');
  const parts = norm.split('/');
  return parts.length <= 3 ? norm : '…/' + parts.slice(-3).join('/');
}

function refreshFirmwarePathDisplay() {
  const files = config.selectedFirmware?.files || {};
  for (const slot of SLOTS) {
    const span = firmwarePathSpans[slot];
    span.textContent = shortPath(files[slot]);
    span.title = files[slot] || '';
    span.classList.toggle('is-empty', !files[slot]);
  }
}

function refreshFlashEnabledCheckboxes() {
  const enabled = config.flashEnabled || { bootloader: true, partitions: true, firmware: true };
  for (const slot of SLOTS) {
    flashEnabledCheckboxes[slot].checked = !!enabled[slot];
  }
}

function refreshBuildsDropdown() {
  while (firmwareSelect.options.length > 1) firmwareSelect.remove(1);
  for (let i = 0; i < firmwareBuilds.length; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = firmwareBuilds[i].label;
    firmwareSelect.appendChild(opt);
  }
  firmwareBuildsRow.style.display = firmwareBuilds.length > 0 ? 'flex' : 'none';
}

async function applyScannedFiles(files, label) {
  // When scan or browse fills the slots, set checkboxes to track presence: a file
  // that's missing on disk gets unchecked so it's excluded from the flash without
  // surprising the user.
  const flashEnabled = {
    bootloader: !!files.bootloader,
    partitions: !!files.partitions,
    firmware: !!files.firmware,
  };
  const selectedFirmware = {
    name: label || (config.selectedFirmware?.name) || 'firmware',
    env: label || (config.selectedFirmware?.env) || 'firmware',
    category: 'custom',
    files,
  };
  config = await window.api.updateConfig({ selectedFirmware, flashEnabled });
  refreshFirmwarePathDisplay();
  refreshFlashEnabledCheckboxes();
}

async function rescanFirmwareDir({ silent = false } = {}) {
  if (!config.firmwareBaseDir) {
    firmwareBuilds = [];
    refreshBuildsDropdown();
    refreshFirmwarePathDisplay();
    return;
  }
  const result = await window.api.scanFirmwareDir(config.firmwareBaseDir);
  if (result.kind === 'multi') {
    firmwareBuilds = result.builds;
    refreshBuildsDropdown();
    if (!silent) appendLog(`Scan: ${firmwareBuilds.length} builds found in ${config.firmwareBaseDir}`);
  } else if (result.kind === 'single') {
    firmwareBuilds = [];
    refreshBuildsDropdown();
    await applyScannedFiles(result.files, config.selectedFirmware?.name);
    if (!silent) appendLog(`Scan: loaded ${shortPath(result.files.firmware)}`);
  } else {
    firmwareBuilds = [];
    refreshBuildsDropdown();
    refreshFirmwarePathDisplay();
    if (!silent) appendLog(`No firmware found under ${config.firmwareBaseDir}`);
  }
}

firmwareSelect.addEventListener('change', async () => {
  const idx = parseInt(firmwareSelect.value, 10);
  if (Number.isNaN(idx) || !firmwareBuilds[idx]) return;
  const build = firmwareBuilds[idx];
  await applyScannedFiles(build.files, build.label);
});

// Per-component checkbox handler: toggle whether to flash that slot.
for (const slot of SLOTS) {
  flashEnabledCheckboxes[slot].addEventListener('change', async () => {
    const flashEnabled = { ...config.flashEnabled, [slot]: flashEnabledCheckboxes[slot].checked };
    config = await window.api.updateConfig({ flashEnabled });
  });
}

// Per-component browse: replaces only that slot.
document.querySelectorAll('.component-browse').forEach(btn => {
  btn.addEventListener('click', async () => {
    const slot = btn.dataset.slot;
    const result = await window.api.selectFirmwareFile({ slot });
    if (!result) return;
    if (slot === 'firmware') {
      // Firmware-slot browse auto-fills siblings, just like the top-level Browse Files button.
      await applyScannedFiles(result.files, result.name);
      appendLog(`Firmware loaded: ${shortPath(result.files.firmware)}`);
    } else {
      const files = { ...(config.selectedFirmware?.files || {}), [slot]: result.path };
      await applyScannedFiles(files, config.selectedFirmware?.name);
      appendLog(`${slot} set: ${shortPath(result.path)}`);
    }
  });
});

// ─── Devices ───────────────────────────────────────────────
function renderDevices() {
  deviceList.textContent = '';
  if (devices.size === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state-sm';
    p.textContent = 'Plug in an ESP32...';
    deviceList.appendChild(p);
    return;
  }
  for (const [key, { info }] of devices) {
    const card = document.createElement('div');
    card.className = 'device-card';
    const infoDiv = document.createElement('div');
    infoDiv.className = 'device-info';
    const name = document.createElement('div');
    name.className = 'port-name';
    name.textContent = deviceLabel(info);
    infoDiv.append(name);
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:4px;';
    const btnFlashPrint = document.createElement('button');
    btnFlashPrint.className = 'btn btn-flash';
    btnFlashPrint.textContent = 'Flash & Print';
    btnFlashPrint.addEventListener('click', () => flashDevice(key, { print: true }));
    const btnFlashOnly = document.createElement('button');
    btnFlashOnly.className = 'btn btn-xs';
    btnFlashOnly.textContent = 'Flash Only';
    btnFlashOnly.addEventListener('click', () => flashDevice(key, { print: false }));
    btnGroup.append(btnFlashPrint, btnFlashOnly);
    card.append(infoDiv, btnGroup);
    deviceList.appendChild(card);
  }
}

// ─── Flash Device ──────────────────────────────────────────
let flashing = false;
let pendingPrint = true; // whether the current flash should trigger printing

async function flashDevice(deviceKey, { print = true } = {}) {
  if (flashing) { showError('Already flashing'); return; }
  const device = devices.get(deviceKey);
  if (!device) { showError('Device not found'); return; }
  const selected = config.selectedFirmware;
  const enabled = config.flashEnabled || { bootloader: true, partitions: true, firmware: true };
  const files = selected?.files || {};

  // Validate: every slot whose checkbox is on must have a file.
  const missing = SLOTS.filter(slot => enabled[slot] && !files[slot]);
  if (missing.length) {
    showError(`Missing file(s) for: ${missing.join(', ')}. Uncheck the row or pick a file.`);
    return;
  }
  // At least one slot must be enabled and present.
  if (!SLOTS.some(slot => enabled[slot] && files[slot])) {
    showError('Nothing selected to flash. Enable at least one component.');
    return;
  }

  flashing = true;
  pendingPrint = print;
  resetPipeline();
  flashLog.textContent = '';
  progressBar.style.width = '0%';
  hideError();
  let flashTransport = null;

  try {
    updatePipeline('reading-mac', 'active');
    appendLog(print ? 'Flash & Print starting...' : 'Flash Only starting...');

    // Reserve the next serial up front (without incrementing the counter)
    // so the same number can be written to the device (NVS/JSON) AND to
    // the label. The counter is committed later in postFlash on success.
    let reservedSerial = null;
    if (print && config.serialEnabled) {
      reservedSerial = await window.api.peekNextSerial();
      if (reservedSerial) appendLog(`Reserved serial: ${reservedSerial}`);
    }

    const fileArray = [];
    const addrMap = config.flashAddresses;
    for (const slot of SLOTS) {
      if (!enabled[slot] || !files[slot]) continue;
      const data = await window.api.readFirmwareFile(files[slot]);
      fileArray.push({ address: parseInt(addrMap[slot], 16), data: new Uint8Array(data) });
    }

    // Build the effective "items to write to the device" list. This is the
    // post-flash config items plus (optionally) the reserved serial number,
    // prepended so it's guaranteed to land first. Both the NVS and JSON
    // paths below consume this same list so the two modes stay symmetric.
    const pfcForFlash = config.postFlashConfig;
    const baseItems = (pfcForFlash?.enabled ? (pfcForFlash.items || []) : []);
    const serialItem = (reservedSerial && config.serialWriteToDevice) ? {
      key: config.serialDeviceKey || 'serial',
      value: reservedSerial,
      nvsType: config.serialDeviceType || 'string',
      templateString: '',
      autoIncrement: false, // serial numbering has its own counter; don't double-bump
    } : null;
    const effectiveItems = serialItem ? [serialItem, ...baseItems] : baseItems;
    const pfcMode = pfcForFlash?.mode || 'json';
    const willWriteToDevice = print && effectiveItems.length > 0;

    // NVS mode: generate a partition image and flash it alongside the firmware.
    let nvsItemsForLabel = null;
    if (willWriteToDevice && pfcMode === 'nvs') {
      appendLog('[config] Building NVS partition image...');
      const nvs = pfcForFlash?.nvs || {};
      const { offset, data } = await window.api.buildNvsImage({
        namespace: nvs.namespace || 'config',
        items: effectiveItems.map(i => ({ key: i.key, value: i.value, nvsType: i.nvsType })),
        partitionOffset: nvs.partitionOffset || '0x9000',
        partitionSize: nvs.partitionSize || '0x6000',
      });
      fileArray.push({ address: offset, data: new Uint8Array(data) });
      appendLog(`[config] NVS image queued at 0x${offset.toString(16)} (${data.byteLength} bytes).`);
      nvsItemsForLabel = effectiveItems.map(i => ({ key: i.key, value: i.value, success: true, response: 'nvs' }));
    }

    let macReceived = false;
    const flashResult = await connectAndFlash(device.port, fileArray, {
      baudRate: config.baudRate,
      onLog: (msg) => {
        appendLog(msg);
        if (!macReceived && msg.includes('MAC:')) {
          macReceived = true;
          updatePipeline('reading-mac', 'complete');
          updatePipeline('flashing', 'active');
        }
        if (msg.includes('Flash complete')) {
          updatePipeline('flashing', 'complete');
          updatePipeline('verifying', 'complete');
        }
      },
      onProgress: ({ percent }) => { progressBar.style.width = percent + '%'; },
    });
    const mac = flashResult.mac;
    flashTransport = flashResult.transport;

    appendLog(`MAC: ${mac}`);
    updatePipeline('verifying', 'complete');

    // Post-Flash Config
    //   mode='json': send JSON RPC over serial (main process, node serialport)
    //   mode='nvs':  already flashed as a partition image above, nothing more to do
    let configResults = nvsItemsForLabel;
    const pfc = config.postFlashConfig;
    if (willWriteToDevice && pfcMode === 'nvs') {
      updatePipeline('configuring', 'complete');
      appendLog('[config] NVS image flashed — no serial RPC needed.');
    }
    if (willWriteToDevice && pfcMode !== 'nvs') {
      updatePipeline('configuring', 'active');
      appendLog('[config] Sending post-flash configuration...');

      // Disconnect esptool transport so the COM port is free for node serialport
      if (flashTransport) {
        appendLog('[config] Releasing esptool connection...');
        try {
          await Promise.race([
            flashTransport.disconnect(),
            new Promise(r => setTimeout(r, 2000)),
          ]);
        } catch { /* ignore */ }
        flashTransport = null;
      }

      // Listen for real-time log messages from main process
      const removeLogListener = window.api.onConfigLog((msg) => appendLog(`[config] ${msg}`));

      try {
        const info = device.info;
        const vid = info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
        const pid = info.usbProductId.toString(16).toUpperCase().padStart(4, '0');

        configResults = await window.api.sendSerialConfig({
          vid,
          pid,
          items: effectiveItems.map(item => ({
            key: item.key,
            value: item.value,
            templateString: item.templateString,
          })),
          commandTemplate: pfc?.commandTemplate || '{"set":{"{{key}}":{{value}}}}',
          baudRate: pfc?.baudRate || 115200,
          timeout: pfc?.timeout || 5000,
          expectedResponse: pfc?.expectedResponse || 'success == true',
          pingCommand: pfc?.pingCommand || '{"ping":1}',
          readyResponse: pfc?.readyResponse || 'ready == true',
          readyTimeout: pfc?.readyTimeout || 15000,
          pingInterval: pfc?.pingInterval || 500,
          interCommandDelay: pfc?.interCommandDelay ?? 20,
        });
        updatePipeline('configuring', 'complete');
        appendLog('[config] All configuration commands succeeded.');
      } catch (err) {
        updatePipeline('configuring', 'error');
        appendLog('[config] ERROR: ' + err.message);
        throw err;
      } finally {
        removeLogListener();
      }
    }

    // Auto-increment values (applies to both JSON and NVS modes, after the
    // config has been successfully delivered to the device).
    if (print && pfc?.enabled && pfc.items?.length > 0) {
      let hasIncrements = false;
      const updatedItems = pfc.items.map(item => {
        if (item.autoIncrement && typeof item.value === 'number') {
          hasIncrements = true;
          return { ...item, value: item.value + 1 };
        }
        return item;
      });
      if (hasIncrements) {
        config = await window.api.updateConfig({
          postFlashConfig: { ...pfc, items: updatedItems },
        });
        populatePostFlashConfigForm();
      }
    }

    if (print) {
      const result = await window.api.postFlash({
        mac, port: deviceKey, firmware: selected.env || 'unknown',
        configResults: configResults || null,
        reservedSerial: reservedSerial || null,
      });
      if (result?.labelBase64) showLabelPreview(result.labelBase64);
    } else {
      // Flash only — skip serial/label/print, just record history
      await window.api.postFlash({ mac, port: deviceKey, firmware: selected.env || 'unknown', flashOnly: true });
      updatePipeline('complete', 'complete');
      appendLog('Flash complete (no print).');
    }
  } catch (err) {
    updatePipeline('reading-mac', 'error');
    if (isPortBusyError(err)) {
      const friendly = portBusyMessage(deviceLabel(device.info));
      appendLog('ERROR: ' + friendly);
      showError(friendly);
    } else {
      appendLog('ERROR: ' + err.message);
      showError(err.message);
    }
  } finally {
    // Always disconnect the transport so the port is released for next flash
    if (flashTransport) {
      try { await flashTransport.disconnect(); } catch { /* ignore */ }
    }
    flashing = false;
    const history = await window.api.getHistory(50);
    renderHistory(history);
  }
}

// ─── Pipeline Stepper (dynamic) ────────────────────────────
const ALL_STEPS = [
  { key: 'reading-mac', label: 'MAC' },
  { key: 'flashing', label: 'Flash' },
  { key: 'verifying', label: 'Verify' },
  { key: 'configuring', label: 'Config', conditional: () => config.postFlashConfig?.enabled && config.postFlashConfig?.items?.length > 0 },
  { key: 'assigning-serial', label: 'Serial', conditional: () => config.serialEnabled },
  { key: 'generating-label', label: 'Label' },
  { key: 'printing', label: 'Print' },
  { key: 'complete', label: 'Done' },
];
let activeSteps = []; // current visible step keys

function buildPipeline() {
  pipelineStepper.textContent = '';
  activeSteps = ALL_STEPS.filter(s => !s.conditional || s.conditional());
  activeSteps.forEach((step, i) => {
    if (i > 0) {
      const line = document.createElement('div');
      line.className = 'step-line';
      pipelineStepper.appendChild(line);
    }
    const el = document.createElement('div');
    el.className = 'step';
    el.dataset.step = step.key;
    const dot = document.createElement('span');
    dot.className = 'step-dot';
    const lbl = document.createElement('span');
    lbl.className = 'step-label';
    lbl.textContent = step.label;
    el.append(dot, lbl);
    pipelineStepper.appendChild(el);
  });
}

function resetPipeline() { pipelineStepper.querySelectorAll('.step').forEach(el => el.classList.remove('active', 'complete', 'error')); }

function updatePipeline(stepName, status) {
  const stepKeys = activeSteps.map(s => s.key);
  const stepIndex = stepKeys.indexOf(stepName);
  // If step not in current pipeline (e.g. serial disabled), skip silently
  if (stepIndex === -1) return;
  pipelineStepper.querySelectorAll('.step').forEach(el => {
    el.classList.remove('active', 'complete', 'error');
    const i = stepKeys.indexOf(el.dataset.step);
    if (i < stepIndex) el.classList.add('complete');
    else if (i === stepIndex) el.classList.add(status);
  });
}

// ─── Flash Log ─────────────────────────────────────────────
function appendLog(text) { flashLog.textContent += text + '\n'; flashLog.scrollTop = flashLog.scrollHeight; }
clearLogBtn.addEventListener('click', () => { flashLog.textContent = ''; progressBar.style.width = '0%'; });

// ─── Settings Form ─────────────────────────────────────────
function populateSettingsForm() {
  serialEnabledToggle.checked = config.serialEnabled || false;
  serialWriteToDeviceToggle.checked = config.serialWriteToDevice || false;
  serialDeviceKeyInput.value = config.serialDeviceKey || 'serial';
  serialDeviceTypeSelect.value = config.serialDeviceType || 'string';
  updateSerialFieldsVisibility();
  settingsForm.serialPrefix.value = config.serialPrefix || '';
  settingsForm.nextSerialNumber.value = config.nextSerialNumber || 1;
  settingsForm.chip.value = config.chip || 'esp32s3';
  settingsForm.baudRate.value = String(config.baudRate || 921600);
  settingsForm.flashAddr_bootloader.value = config.flashAddresses?.bootloader || '0x0';
  settingsForm.flashAddr_partitions.value = config.flashAddresses?.partitions || '0x8000';
  settingsForm.flashAddr_firmware.value = config.flashAddresses?.firmware || '0x10000';
  autoModeToggle.checked = config.autoMode || false;
  refreshFirmwarePathDisplay();
  refreshFlashEnabledCheckboxes();
  populatePostFlashConfigForm();
  buildPipeline();
}

// Chip change → apply that chip's address defaults to the three input fields.
// Inputs stay editable so an unusual board can still be flashed without changing
// the chip selection.
settingsForm.chip.addEventListener('change', () => {
  const defaults = CHIP_DEFAULTS[settingsForm.chip.value];
  if (!defaults) return;
  settingsForm.flashAddr_bootloader.value = defaults.bootloader;
  settingsForm.flashAddr_partitions.value = defaults.partitions;
  settingsForm.flashAddr_firmware.value = defaults.firmware;
});

// Common Windows error from Web Serial when the port is locked by another
// process or a stale handle. Surface a hint that's actually actionable.
function isPortBusyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('access denied')
      || msg.includes('failed to open')
      || msg.includes('the port is already open')
      || msg.includes('access_denied');
}

function portBusyMessage(label) {
  return `Port busy${label ? ` (${label})` : ''}. Close any other serial tools (Arduino IDE, PlatformIO Monitor, another BurnTag window) and try again. If it persists, unplug and replug the device.`;
}

// Detect: connect to a chosen ESP device, identify the chip, apply the chip's
// default addresses, then disconnect. One-shot — designed for a batch-burning
// station where you set this up once at the start of a run.
detectChipBtn.addEventListener('click', async () => {
  if (devices.size === 0) {
    appendLog('[detect] No connected ESP device found. Plug one in and click + Add Device.');
    showError('No connected ESP device found');
    return;
  }
  let chosen;
  if (devices.size === 1) {
    chosen = [...devices.values()][0];
  } else {
    chosen = await pickEspDevice('Detect chip from which device?');
    if (!chosen) return;
  }
  const label = deviceLabel(chosen.info);

  detectChipBtn.disabled = true;
  detectChipBtn.textContent = '...';
  appendLog(`[detect] Using ${label}`);
  try {
    const transport = new Transport(chosen.port, true);
    const loader = new ESPLoader({
      transport,
      baudrate: parseInt(settingsForm.baudRate.value, 10) || 921600,
      terminal: { clean() {}, writeLine: msg => appendLog(`[detect] ${msg}`), write: msg => appendLog(`[detect] ${msg}`) },
    });
    try {
      const desc = await loader.main();
      appendLog(`[detect] Chip: ${desc}`);
      const chipValue = chipDescriptionToValue(desc);
      if (chipValue) {
        settingsForm.chip.value = chipValue;
        const defaults = CHIP_DEFAULTS[chipValue];
        settingsForm.flashAddr_bootloader.value = defaults.bootloader;
        settingsForm.flashAddr_partitions.value = defaults.partitions;
        settingsForm.flashAddr_firmware.value = defaults.firmware;
        config = await window.api.updateConfig({
          chip: chipValue,
          flashAddresses: defaults,
        });
        appendLog(`[detect] Set chip to ${chipValue}, addresses to chip defaults.`);
      } else {
        appendLog(`[detect] Could not map "${desc}" to a known chip — leaving form unchanged.`);
      }
    } finally {
      try { await transport.disconnect(); } catch { /* ignore */ }
    }
  } catch (err) {
    if (isPortBusyError(err)) {
      const friendly = portBusyMessage(label);
      appendLog('[detect] ERROR: ' + friendly);
      showError(friendly);
    } else {
      appendLog('[detect] ERROR: ' + err.message);
      showError('Detect failed: ' + err.message);
    }
  } finally {
    detectChipBtn.disabled = false;
    detectChipBtn.textContent = 'Detect';
  }
});

// + Add Device — let the user grant any newly-plugged ESPs that the renderer
// hasn't seen yet. Each click can grant one new device thanks to the round-robin
// pick in main/index.js's select-serial-port handler.
document.getElementById('addDeviceBtn').addEventListener('click', () => {
  discoverEspPorts({ silent: false }).catch(err => showError('Add device failed: ' + err.message));
});

function updateSerialFieldsVisibility() {
  const enabled = serialEnabledToggle.checked;
  serialFields.style.display = enabled ? 'block' : 'none';
  serialDisabledHint.style.display = enabled ? 'none' : 'block';
  serialDeviceFields.style.display = enabled && serialWriteToDeviceToggle.checked ? 'block' : 'none';
}

serialEnabledToggle.addEventListener('change', async () => {
  config = await window.api.updateConfig({ serialEnabled: serialEnabledToggle.checked });
  updateSerialFieldsVisibility();
  buildPipeline();
});

serialWriteToDeviceToggle.addEventListener('change', async () => {
  config = await window.api.updateConfig({ serialWriteToDevice: serialWriteToDeviceToggle.checked });
  updateSerialFieldsVisibility();
});

// ─── Post-Flash Config ────────────────────────────────────
function populatePostFlashConfigForm() {
  const pfc = config.postFlashConfig || {};
  postFlashConfigToggle.checked = pfc.enabled || false;
  postFlashBaudRate.value = String(pfc.baudRate || 115200);
  postFlashReadyTimeout.value = pfc.readyTimeout || 15000;
  postFlashInterCommandDelay.value = pfc.interCommandDelay ?? 20;
  postFlashPingCommand.value = pfc.pingCommand || '{"ping":1}';
  postFlashReadyResponse.value = pfc.readyResponse || 'ready == true';
  postFlashExpectedResponse.value = pfc.expectedResponse || 'success == true';
  postFlashCommandTemplate.value = pfc.commandTemplate || '{"set":{"{{key}}":{{value}}}}';
  const nvs = pfc.nvs || {};
  postFlashNvsNamespace.value = nvs.namespace || 'config';
  postFlashNvsOffset.value = nvs.partitionOffset || '0x9000';
  postFlashNvsSize.value = nvs.partitionSize || '0x6000';
  setPostFlashMode(pfc.mode === 'nvs' ? 'nvs' : 'json');
  updatePostFlashConfigVisibility();
  postFlashConfigItems.textContent = '';
  const items = pfc.items || [];
  for (const item of items) {
    addConfigItemRow(item);
  }
}

function setPostFlashMode(mode) {
  postFlashMode = mode === 'nvs' ? 'nvs' : 'json';
  postFlashJsonFields.style.display = postFlashMode === 'json' ? 'block' : 'none';
  postFlashNvsFields.style.display = postFlashMode === 'nvs' ? 'block' : 'none';
  for (const tab of postFlashModeTabs) {
    tab.classList.toggle('active', tab.dataset.mode === postFlashMode);
  }
  // Update item rows so NVS type selector appears/hides.
  for (const row of postFlashConfigItems.querySelectorAll('.config-item')) {
    const typeSel = row.querySelector('[data-field="nvsType"]');
    if (typeSel) typeSel.closest('.config-item-row').style.display = postFlashMode === 'nvs' ? 'flex' : 'none';
    const tmpl = row.querySelector('[data-field="templateString"]');
    if (tmpl) tmpl.closest('.config-item-row').style.display = postFlashMode === 'json' ? 'flex' : 'none';
  }
}

for (const tab of postFlashModeTabs) {
  tab.addEventListener('click', () => setPostFlashMode(tab.dataset.mode));
}

function openPostFlashHelp() { postFlashHelpModal.classList.remove('hidden'); }
function closePostFlashHelp() { postFlashHelpModal.classList.add('hidden'); }
postFlashHelpBtn.addEventListener('click', openPostFlashHelp);
postFlashHelpClose.addEventListener('click', closePostFlashHelp);
postFlashHelpCloseFooter.addEventListener('click', closePostFlashHelp);
postFlashHelpModal.addEventListener('click', (e) => {
  if (e.target === postFlashHelpModal) closePostFlashHelp();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !postFlashHelpModal.classList.contains('hidden')) closePostFlashHelp();
});

function updatePostFlashConfigVisibility() {
  const enabled = postFlashConfigToggle.checked;
  postFlashConfigFields.style.display = enabled ? 'block' : 'none';
  postFlashConfigHint.style.display = enabled ? 'none' : 'block';
}

postFlashConfigToggle.addEventListener('change', async () => {
  const pfc = config.postFlashConfig || {};
  config = await window.api.updateConfig({
    postFlashConfig: { ...pfc, enabled: postFlashConfigToggle.checked },
  });
  updatePostFlashConfigVisibility();
  buildPipeline();
});

function addConfigItemRow(item = {}) {
  const el = document.createElement('div');
  el.className = 'config-item';

  // Key input
  const header = document.createElement('div');
  header.className = 'config-item-header';
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.value = item.key || '';
  keyInput.placeholder = 'Key (e.g. nodeId)';
  keyInput.dataset.field = 'key';
  header.appendChild(keyInput);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-remove';
  removeBtn.textContent = '\u00D7';
  removeBtn.addEventListener('click', () => el.remove());
  el.appendChild(removeBtn);

  // Value row
  const valueRow = document.createElement('div');
  valueRow.className = 'config-item-row';
  const valueLabel = document.createElement('span');
  valueLabel.style.cssText = 'font-size:10px;color:var(--fc-text-muted);min-width:35px;';
  valueLabel.textContent = 'Value';
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.value = item.value != null ? String(item.value) : '';
  valueInput.placeholder = 'e.g. 20';
  valueInput.dataset.field = 'value';
  valueRow.append(valueLabel, valueInput);

  // Template string row (JSON mode only)
  const templateRow = document.createElement('div');
  templateRow.className = 'config-item-row';
  templateRow.style.display = postFlashMode === 'json' ? 'flex' : 'none';
  const templateLabel = document.createElement('span');
  templateLabel.style.cssText = 'font-size:10px;color:var(--fc-text-muted);min-width:35px;';
  templateLabel.textContent = 'Cmd';
  const templateInput = document.createElement('input');
  templateInput.type = 'text';
  templateInput.className = 'config-item-template';
  templateInput.value = item.templateString || '';
  templateInput.placeholder = 'Override (blank = use global template)';
  templateInput.dataset.field = 'templateString';
  templateInput.style.flex = '1';
  templateRow.append(templateLabel, templateInput);

  // NVS type row (NVS mode only)
  const typeRow = document.createElement('div');
  typeRow.className = 'config-item-row';
  typeRow.style.display = postFlashMode === 'nvs' ? 'flex' : 'none';
  const typeLabel = document.createElement('span');
  typeLabel.style.cssText = 'font-size:10px;color:var(--fc-text-muted);min-width:35px;';
  typeLabel.textContent = 'Type';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'fc-select fc-select-sm';
  typeSelect.dataset.field = 'nvsType';
  const typeOptions = [
    { v: '', label: 'auto' },
    { v: 'u8', label: 'u8' },
    { v: 'u16', label: 'u16' },
    { v: 'u32', label: 'u32' },
    { v: 'i32', label: 'i32' },
    { v: 'string', label: 'string' },
  ];
  for (const o of typeOptions) {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.label;
    if ((item.nvsType || '') === o.v) opt.selected = true;
    typeSelect.appendChild(opt);
  }
  typeRow.append(typeLabel, typeSelect);

  // Auto Increment option
  const opts = document.createElement('div');
  opts.className = 'config-item-options';

  const autoLabel = document.createElement('label');
  autoLabel.className = 'config-item-option';
  const autoCb = document.createElement('input');
  autoCb.type = 'checkbox';
  autoCb.checked = item.autoIncrement || false;
  autoCb.dataset.field = 'autoIncrement';
  const autoText = document.createElement('span');
  autoText.textContent = 'Auto Increment';
  autoLabel.append(autoCb, autoText);

  // Label variable hint
  const varHint = document.createElement('span');
  varHint.className = 'config-var-hint';
  varHint.textContent = item.key ? `Use {config:${item.key}} in label` : '';
  keyInput.addEventListener('input', () => {
    varHint.textContent = keyInput.value.trim() ? `Use {config:${keyInput.value.trim()}} in label` : '';
  });

  opts.append(autoLabel, varHint);

  el.append(header, valueRow, templateRow, typeRow, opts);
  postFlashConfigItems.appendChild(el);
}

addConfigItemBtn.addEventListener('click', () => addConfigItemRow());

function collectPostFlashConfig() {
  const items = [];
  for (const el of postFlashConfigItems.querySelectorAll('.config-item')) {
    const key = el.querySelector('[data-field="key"]')?.value?.trim();
    if (!key) continue;
    const rawValue = el.querySelector('[data-field="value"]')?.value?.trim() || '';
    const nvsType = el.querySelector('[data-field="nvsType"]')?.value || '';
    // For NVS string type, always keep value as string; otherwise coerce numeric.
    let value;
    if (nvsType === 'string') {
      value = rawValue;
    } else {
      value = rawValue !== '' && !isNaN(Number(rawValue)) ? Number(rawValue) : rawValue;
    }
    items.push({
      key,
      value,
      templateString: el.querySelector('[data-field="templateString"]')?.value || '',
      nvsType,
      autoIncrement: el.querySelector('[data-field="autoIncrement"]')?.checked || false,
    });
  }
  return {
    enabled: postFlashConfigToggle.checked,
    mode: postFlashMode,
    baudRate: parseInt(postFlashBaudRate.value, 10) || 115200,
    timeout: config.postFlashConfig?.timeout || 5000,
    expectedResponse: postFlashExpectedResponse.value || 'success == true',
    commandTemplate: postFlashCommandTemplate.value || '{"set":{"{{key}}":{{value}}}}',
    pingCommand: postFlashPingCommand.value || '{"ping":1}',
    readyResponse: postFlashReadyResponse.value || 'ready == true',
    readyTimeout: parseInt(postFlashReadyTimeout.value, 10) || 15000,
    pingInterval: config.postFlashConfig?.pingInterval || 500,
    interCommandDelay: Math.max(0, parseInt(postFlashInterCommandDelay.value, 10) || 0),
    nvs: {
      namespace: postFlashNvsNamespace.value.trim() || 'config',
      partitionOffset: postFlashNvsOffset.value.trim() || '0x9000',
      partitionSize: postFlashNvsSize.value.trim() || '0x6000',
    },
    items,
  };
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const updates = {
    serialEnabled: serialEnabledToggle.checked,
    serialPrefix: settingsForm.serialPrefix.value,
    nextSerialNumber: parseInt(settingsForm.nextSerialNumber.value, 10),
    serialWriteToDevice: serialWriteToDeviceToggle.checked,
    serialDeviceKey: serialDeviceKeyInput.value.trim() || 'serial',
    serialDeviceType: serialDeviceTypeSelect.value,
    chip: settingsForm.chip.value,
    baudRate: parseInt(settingsForm.baudRate.value, 10),
    flashAddresses: {
      bootloader: settingsForm.flashAddr_bootloader.value,
      partitions: settingsForm.flashAddr_partitions.value,
      firmware: settingsForm.flashAddr_firmware.value,
    },
    flashEnabled: {
      bootloader: flashEnabledCheckboxes.bootloader.checked,
      partitions: flashEnabledCheckboxes.partitions.checked,
      firmware: flashEnabledCheckboxes.firmware.checked,
    },
    postFlashConfig: collectPostFlashConfig(),
  };
  config = await window.api.updateConfig(updates);
  populateSettingsForm();
});

autoModeToggle.addEventListener('change', async () => {
  config = await window.api.updateConfig({ autoMode: autoModeToggle.checked });
});

// Top-level browse: pick a firmware.bin and auto-fill the three slots from siblings.
browseFirmwareBtn.addEventListener('click', async () => {
  const result = await window.api.selectFirmwareFile({ slot: 'firmware' });
  if (!result) return;
  await applyScannedFiles(result.files, result.name);
  appendLog(`Firmware loaded: ${shortPath(result.files.firmware)}`);
});

// Smart-scan a directory. The main process picks single-folder, .pio/build/<env>,
// or legacy sensors|gateway tree based on what's there.
firmwareDirBtn.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (!dir) return;
  config = await window.api.updateConfig({ firmwareBaseDir: dir });
  await rescanFirmwareDir({ silent: false });
});

// ─── Profiles ──────────────────────────────────────────────
async function refreshProfiles() {
  const profiles = await window.api.listProfiles();
  while (profileSelect.options.length > 1) profileSelect.remove(1);
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    if (config.activeProfile === p.name) opt.selected = true;
    profileSelect.appendChild(opt);
  }
}

profileSelect.addEventListener('change', async () => {
  const name = profileSelect.value;
  if (!name) return;
  const updated = await window.api.loadProfile(name);
  if (updated) { config = updated; populateSettingsForm(); await rescanFirmwareDir({ silent: true }); }
});

// Simple modal dialogs (prompt/confirm not supported in Electron)
function showModal(message, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--fc-surface);border:1px solid var(--fc-border);border-radius:8px;padding:20px;min-width:320px;';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'color:var(--fc-text);margin-bottom:12px;font-size:14px;';
    lbl.textContent = message;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = defaultValue;
    inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--fc-bg);border:1px solid var(--fc-border);border-radius:4px;color:var(--fc-text);font-size:13px;margin-bottom:12px;';
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const cancel = document.createElement('button'); cancel.className = 'btn btn-xs'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { overlay.remove(); resolve(null); });
    const ok = document.createElement('button'); ok.className = 'btn btn-xs btn-primary'; ok.textContent = 'OK';
    ok.addEventListener('click', () => { overlay.remove(); resolve(inp.value); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { overlay.remove(); resolve(inp.value); } if (e.key === 'Escape') { overlay.remove(); resolve(null); } });
    btns.append(cancel, ok); box.append(lbl, inp, btns); overlay.appendChild(box); document.body.appendChild(overlay);
    inp.focus(); inp.select();
  });
}

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--fc-surface);border:1px solid var(--fc-border);border-radius:8px;padding:20px;min-width:300px;';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'color:var(--fc-text);margin-bottom:16px;font-size:14px;';
    lbl.textContent = message;
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const cancel = document.createElement('button'); cancel.className = 'btn btn-xs'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { overlay.remove(); resolve(false); });
    const ok = document.createElement('button'); ok.className = 'btn btn-xs btn-danger'; ok.textContent = 'Delete';
    ok.addEventListener('click', () => { overlay.remove(); resolve(true); });
    btns.append(cancel, ok); box.append(lbl, btns); overlay.appendChild(box); document.body.appendChild(overlay);
    ok.focus();
  });
}

saveProfileBtn.addEventListener('click', async () => {
  try {
    const name = await showModal('Profile name:', config.activeProfile || '');
    if (!name?.trim()) return;
    const data = {
      serialEnabled: serialEnabledToggle.checked,
      serialPrefix: settingsForm.serialPrefix.value,
      serialWriteToDevice: serialWriteToDeviceToggle.checked,
      serialDeviceKey: serialDeviceKeyInput.value.trim() || 'serial',
      serialDeviceType: serialDeviceTypeSelect.value,
      chip: settingsForm.chip.value,
      baudRate: parseInt(settingsForm.baudRate.value, 10),
      flashAddresses: {
        bootloader: settingsForm.flashAddr_bootloader.value,
        partitions: settingsForm.flashAddr_partitions.value,
        firmware: settingsForm.flashAddr_firmware.value,
      },
      flashEnabled: {
        bootloader: flashEnabledCheckboxes.bootloader.checked,
        partitions: flashEnabledCheckboxes.partitions.checked,
        firmware: flashEnabledCheckboxes.firmware.checked,
      },
      labelTemplate: config.labelTemplate,
      postFlashConfig: collectPostFlashConfig(),
    };
    await window.api.saveProfile(name.trim(), data);
    config.activeProfile = name.trim();
    await window.api.updateConfig({ activeProfile: name.trim() });
    await refreshProfiles();
    appendLog(`Profile "${name.trim()}" saved.`);
  } catch (err) {
    showError('Failed to save profile: ' + err.message);
  }
});

deleteProfileBtn.addEventListener('click', async () => {
  const name = profileSelect.value;
  if (!name) return;
  if (!(await showConfirm(`Delete profile "${name}"?`))) return;
  await window.api.deleteProfile(name);
  config.activeProfile = null;
  await refreshProfiles();
});

// Export current settings as a profile file
document.getElementById('exportProfileBtn').addEventListener('click', async () => {
  const data = {
    serialEnabled: config.serialEnabled,
    serialPrefix: config.serialPrefix,
    nextSerialNumber: config.nextSerialNumber,
    chip: config.chip,
    baudRate: config.baudRate,
    flashAddresses: config.flashAddresses,
    flashEnabled: config.flashEnabled,
    labelTemplate: config.labelTemplate,
    postFlashConfig: config.postFlashConfig,
  };
  const name = config.activeProfile || 'burntag-profile';
  const filePath = await window.api.exportConfig(data, `${name}.json`);
  if (filePath) appendLog(`Profile exported to ${filePath}`);
});

// Import a profile from file
document.getElementById('importProfileBtn').addEventListener('click', async () => {
  try {
    const data = await window.api.importConfig();
    if (!data) return;
    // Merge imported data into config
    const updates = {};
    for (const key of ['serialEnabled', 'serialPrefix', 'nextSerialNumber', 'serialWriteToDevice', 'serialDeviceKey', 'serialDeviceType', 'chip', 'baudRate', 'flashAddresses', 'flashEnabled', 'labelTemplate', 'postFlashConfig']) {
      if (key in data) updates[key] = data[key];
    }
    config = await window.api.updateConfig(updates);
    populateSettingsForm();
    await rescanFirmwareDir({ silent: true });
    appendLog('Profile imported.');
  } catch (err) {
    showError('Import failed: ' + err.message);
  }
});

// ─── Program-Side Label Template Selector ──────────────────
async function refreshProgramLabels() {
  const templates = await window.api.listLabelTemplates();
  while (programLabelSelect.options.length > 1) programLabelSelect.remove(1);
  for (const t of templates) {
    const opt = document.createElement('option');
    opt.value = t.name;
    opt.textContent = t.name;
    programLabelSelect.appendChild(opt);
  }
}

programLoadLabelBtn.addEventListener('click', async () => {
  const name = programLabelSelect.value;
  if (!name) return;
  const template = await window.api.loadLabelTemplate(name);
  if (template) {
    config = await window.api.updateConfig({ labelTemplate: template });
    appendLog(`Label template "${name}" loaded.`);
  }
});

// ─── Label Preview (Program View) ──────────────────────────
function getProgramPreviewVariables() {
  let serial = '';
  if (config.serialEnabled) {
    const prefix = settingsForm.serialPrefix.value || config.serialPrefix || '';
    const num = String(settingsForm.nextSerialNumber.value || config.nextSerialNumber || 0).padStart(6, '0');
    serial = prefix ? `${prefix}-${num}` : num;
  }
  // Build config items as key→value map for {config:KEY} template variables
  const configItems = {};
  const pfc = config.postFlashConfig;
  if (pfc?.enabled && pfc.items?.length > 0) {
    for (const item of pfc.items) {
      configItems[item.key] = item.value;
    }
  }
  return {
    serial,
    mac: '00:00:00:00:00:00',
    product: config.labelTemplate?.header?.text || '',
    configItems,
  };
}

previewBtn.addEventListener('click', async () => {
  const dataUrl = await window.api.previewLabel({ template: config.labelTemplate, variables: getProgramPreviewVariables() });
  showLabelPreview(dataUrl);
});

printPreviewBtn.addEventListener('click', async () => {
  try {
    printPreviewBtn.disabled = true; printPreviewBtn.textContent = 'Printing...';
    const vars = getProgramPreviewVariables();
    // Generate the label PNG via IPC (main process has sharp)
    const dataUrl = await window.api.previewLabel({ template: config.labelTemplate, variables: vars });
    showLabelPreview(dataUrl);
    // Convert data URL to bytes for the renderer-side printer
    // Convert base64 data URL to Uint8Array (CSP blocks fetch on data: URIs)
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const pngData = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) pngData[i] = binary.charCodeAt(i);
    // Print via Web Serial (renderer-side, using niimbluelib)
    const result = await printLabelRenderer(pngData, {
      density: 2,
      onLog: (msg) => appendLog(`[print] ${msg}`),
    });
    if (result?.success) {
      appendLog('Label printed.');
    } else {
      showError('Print failed: ' + (result?.error || 'Unknown error'));
    }
  } catch (err) {
    showError('Print failed: ' + err.message);
  } finally {
    printPreviewBtn.disabled = false; printPreviewBtn.textContent = 'Print';
  }
});

function showLabelPreview(dataUrl) {
  labelPreview.textContent = '';
  const img = document.createElement('img');
  img.src = dataUrl; img.alt = 'Label Preview';
  labelPreview.appendChild(img);
}

// ─── History ───────────────────────────────────────────────
function renderHistory(records) {
  historyBody.textContent = '';
  if (records.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4; td.className = 'empty-state-sm'; td.textContent = 'No history yet';
    tr.appendChild(td); historyBody.appendChild(tr);
    return;
  }
  for (const record of records) {
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.textContent = record.timestamp ? new Date(record.timestamp).toLocaleString() : '\u2014';
    const tdSerial = document.createElement('td'); tdSerial.textContent = record.serial || '\u2014';
    const tdMac = document.createElement('td'); tdMac.textContent = record.mac || '\u2014';
    const tdStatus = document.createElement('td'); tdStatus.textContent = record.status || '\u2014';
    tdStatus.className = record.status === 'success' ? 'status-success' : 'status-failed';
    tr.append(tdTime, tdSerial, tdMac, tdStatus);
    historyBody.appendChild(tr);
  }
}

// ─── Printer Status ────────────────────────────────────────
async function checkPrinterStatus() {
  try {
    const info = await window.api.getPrinterInfo();
    if (info?.connected) {
      printerStatus.className = 'status-indicator online';
      printerStatus.querySelector('.status-text').textContent = info.modelName || 'Printer';
    } else {
      const available = await window.api.getPrinterStatus();
      if (available) {
        await window.api.connectPrinter();
        const newInfo = await window.api.getPrinterInfo();
        printerStatus.className = 'status-indicator ' + (newInfo?.connected ? 'online' : 'offline');
        printerStatus.querySelector('.status-text').textContent = newInfo?.connected
          ? (newInfo.modelName || 'Printer')
          : 'Printer Offline';
      } else {
        printerStatus.className = 'status-indicator offline';
        printerStatus.querySelector('.status-text').textContent = 'No Printer';
      }
    }
  } catch { printerStatus.className = 'status-indicator offline'; }
}

// ─── Error Banner ──────────────────────────────────────────
function showError(message) { errorText.textContent = message; errorBanner.classList.remove('hidden'); setTimeout(hideError, 10_000); }
function hideError() { errorBanner.classList.add('hidden'); }
dismissError.addEventListener('click', hideError);

// ─── IPC Events ────────────────────────────────────────────
window.api.onStatus(({ step, port, done, mac, serial, labelBase64, needsPrint }) => {
  updatePipeline(step, done ? 'complete' : 'active');
  let msg = `[${step}] ${done ? 'Done' : 'Started'}`;
  if (mac) msg += ` \u2014 MAC: ${mac}`;
  if (serial) msg += ` \u2014 S/N: ${serial}`;
  appendLog(msg);
  if (labelBase64) showLabelPreview(labelBase64);

  // Auto-print: when label is ready, printing step signals needsPrint, and this flash wants printing
  if (needsPrint && labelBase64 && done && pendingPrint) {
    autoPrintLabel(labelBase64);
  }
});

async function autoPrintLabel(dataUrl) {
  try {
    appendLog('[print] Auto-printing label...');
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const pngData = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) pngData[i] = binary.charCodeAt(i);
    const result = await printLabelRenderer(pngData, {
      density: 2,
      onLog: (msg) => appendLog(`[print] ${msg}`),
    });
    if (result?.success) {
      updatePipeline('printing', 'complete');
      updatePipeline('complete', 'complete');
      appendLog('[print] Label printed successfully.');
    } else {
      updatePipeline('printing', 'error');
      showError('Auto-print failed: ' + (result?.error || 'Unknown error'));
    }
  } catch (err) {
    updatePipeline('printing', 'error');
    showError('Auto-print failed: ' + err.message);
  }
}

window.api.onError(({ error }) => {
  updatePipeline('reading-mac', 'error');
  appendLog('ERROR: ' + error);
  showError(error);
});

// ═══════════════════════════════════════════════════════════
//  LABEL DESIGNER
// ═══════════════════════════════════════════════════════════

function populateDesignForm() {
  const t = config.labelTemplate || {};

  // Hardware
  designForm.designPrinter.value = t.printer || 'niimbot-b21-pro';
  designForm.designLabelSize.value = t.labelSize || '50x30';
  designForm.designOrientation.value = t.orientation || 'landscape';

  // Header
  designForm.headerText.value = t.header?.text || '';
  designForm.headerFontSize.value = t.header?.fontSize || 32;
  designForm.headerFont.value = t.header?.fontFamily || 'Arial';
  designForm.headerAlign.value = t.header?.align || 'left';
  designForm.headerInverted.checked = t.header?.inverted !== false;
  designForm.headerSeparator.checked = t.header?.separator || false;

  // Body lines
  bodyLinesList.textContent = '';
  const lines = t.lines || [];
  for (const line of lines) addBodyLine(line.template || '', line.fontSize || 18, line.bold || false);

  // QR
  designForm.qrEnabled.checked = t.qr?.enabled !== false;
  designForm.qrSize.value = t.qr?.size || 200;
  // Logo preview
  const logoPreview = document.getElementById('headerLogoPreview');
  logoPreview.textContent = '';
  if (t.header?.logoDataUrl) {
    showLogoPreview(t.header.logoDataUrl);
  }
  designForm.qrUrlTemplate.value = t.qr?.urlTemplate || '';
  designForm.qrErrorCorrection.value = t.qr?.errorCorrection || 'M';

  // Footer
  footerLinesList.textContent = '';
  const footerLines = t.footer?.lines || [];
  for (const line of footerLines) addFooterLine(line);
  designForm.footerFontSize.value = t.footer?.fontSize || 14;
  designForm.footerAlign.value = t.footer?.align || 'left';
  designForm.footerSeparator.checked = t.footer?.separatorLine !== false;
}

// ─── Body Lines ────────────────────────────────────────────
function addBodyLine(template, fontSize, bold) {
  const row = document.createElement('div');
  row.className = 'template-line-row';
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = template; inp.placeholder = 'Line template...';
  const fs = document.createElement('input'); fs.type = 'number'; fs.value = fontSize; fs.min = 8; fs.max = 72; fs.title = 'Font size';
  const boldLabel = document.createElement('label');
  boldLabel.style.cssText = 'display:flex;align-items:center;gap:2px;font-size:11px;color:var(--fc-text-muted);cursor:pointer;white-space:nowrap;';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = bold;
  const boldText = document.createElement('span'); boldText.textContent = 'B';
  boldText.style.fontWeight = 'bold';
  boldLabel.append(cb, boldText);
  const x = document.createElement('button'); x.type = 'button'; x.className = 'btn btn-remove'; x.textContent = '\u00D7';
  x.addEventListener('click', () => row.remove());
  row.append(inp, fs, boldLabel, x);
  bodyLinesList.appendChild(row);
}
addBodyLineBtn.addEventListener('click', () => addBodyLine('', 18, false));

// ─── Footer Lines ──────────────────────────────────────────
function addFooterLine(text) {
  const row = document.createElement('div');
  row.className = 'template-line-row';
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = text; inp.placeholder = 'Footer text...';
  const x = document.createElement('button'); x.type = 'button'; x.className = 'btn btn-remove'; x.textContent = '\u00D7';
  x.addEventListener('click', () => row.remove());
  row.append(inp, x);
  footerLinesList.appendChild(row);
}
addFooterLineBtn.addEventListener('click', () => addFooterLine(''));

// ─── Collect Template from Form ────────────────────────────
function collectTemplate() {
  const lines = [];
  for (const row of bodyLinesList.querySelectorAll('.template-line-row')) {
    const textInput = row.querySelector('input[type="text"]');
    const numInput = row.querySelector('input[type="number"]');
    const boldInput = row.querySelector('input[type="checkbox"]');
    const template = textInput?.value || '';
    const fontSize = parseInt(numInput?.value, 10) || 18;
    const bold = boldInput?.checked || false;
    if (template.trim()) lines.push({ template, fontSize, bold });
  }

  const footerLines = [];
  for (const row of footerLinesList.querySelectorAll('.template-line-row')) {
    const text = row.querySelector('input[type="text"]').value.trim();
    if (text) footerLines.push(text);
  }

  return {
    printer: designForm.designPrinter.value,
    labelSize: designForm.designLabelSize.value,
    orientation: designForm.designOrientation.value,
    header: {
      text: designForm.headerText.value,
      fontSize: parseInt(designForm.headerFontSize.value, 10) || 32,
      fontFamily: designForm.headerFont.value,
      align: designForm.headerAlign.value,
      inverted: designForm.headerInverted.checked,
      separator: designForm.headerSeparator.checked,
    },
    lines,
    lineSpacing: 4,
    qr: {
      enabled: designForm.qrEnabled.checked,
      size: parseInt(designForm.qrSize.value, 10) || 200,
      position: 'right', // auto: right in landscape, center-below in portrait
      urlTemplate: designForm.qrUrlTemplate.value,
      errorCorrection: designForm.qrErrorCorrection.value,
    },
    footer: {
      lines: footerLines,
      fontSize: parseInt(designForm.footerFontSize.value, 10) || 14,
      align: designForm.footerAlign.value,
      separatorLine: designForm.footerSeparator.checked,
    },
  };
}

function getDesignPreviewVariables() {
  let serial = '';
  if (config.serialEnabled) {
    const prefix = config.serialPrefix || '';
    const num = String(config.nextSerialNumber || 0).padStart(6, '0');
    serial = prefix ? `${prefix}-${num}` : num;
  }
  const configItems = {};
  const pfc = config.postFlashConfig;
  if (pfc?.enabled && pfc.items?.length > 0) {
    for (const item of pfc.items) {
      configItems[item.key] = item.value;
    }
  }
  return {
    serial,
    mac: '00:00:00:00:00:00',
    fccIds: config.fccIds || [],
    product: designForm.headerText.value || '',
    configItems,
  };
}

// ─── Design Preview ────────────────────────────────────────
designPreviewBtn.addEventListener('click', async () => {
  const template = collectTemplate();
  const variables = getDesignPreviewVariables();
  const dataUrl = await window.api.previewLabel({ template, variables });
  showDesignPreview(dataUrl);
});

designPrintBtn.addEventListener('click', async () => {
  try {
    designPrintBtn.disabled = true; designPrintBtn.textContent = 'Printing...';
    const template = collectTemplate();
    const variables = getDesignPreviewVariables();
    const dataUrl = await window.api.previewLabel({ template, variables });
    showDesignPreview(dataUrl);
    // Convert base64 data URL to Uint8Array (CSP blocks fetch on data: URIs)
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const pngData = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) pngData[i] = binary.charCodeAt(i);
    const result = await printLabelRenderer(pngData, {
      density: 2,
      onLog: (msg) => appendLog(`[print] ${msg}`),
    });
    if (result?.success) {
      appendLog('Label printed from designer.');
    } else {
      showError('Print failed: ' + (result?.error || 'Unknown error'));
    }
  } catch (err) {
    showError('Print failed: ' + err.message);
  } finally {
    designPrintBtn.disabled = false; designPrintBtn.textContent = 'Print';
  }
});

function showDesignPreview(dataUrl) {
  designLabelPreview.textContent = '';
  const img = document.createElement('img');
  img.src = dataUrl; img.alt = 'Label Preview';
  designLabelPreview.appendChild(img);
}

// ─── Saved Label Templates ─────────────────────────────────
const savedTemplateSelect = document.getElementById('savedTemplateSelect');
const loadTemplateBtn = document.getElementById('loadTemplateBtn');
const deleteTemplateBtn = document.getElementById('deleteTemplateBtn');
const newTemplateBtn = document.getElementById('newTemplateBtn');

async function refreshSavedTemplates() {
  const templates = await window.api.listLabelTemplates();
  while (savedTemplateSelect.options.length > 1) savedTemplateSelect.remove(1);
  for (const t of templates) {
    const opt = document.createElement('option');
    opt.value = t.name;
    opt.textContent = `${t.name} (${t.headerText || 'no header'})`;
    savedTemplateSelect.appendChild(opt);
  }
}

saveTemplateBtn.addEventListener('click', async () => {
  try {
    const template = collectTemplate();
    // Save as active template in config
    config = await window.api.updateConfig({ labelTemplate: template });
    // Also save to template library
    const name = await showModal('Save template as:', template.header?.text || 'My Label');
    if (!name?.trim()) return;
    await window.api.saveLabelTemplate(name.trim(), template);
    await refreshSavedTemplates();
    await refreshProgramLabels();
    appendLog(`Template "${name.trim()}" saved.`);
  } catch (err) {
    showError('Failed to save template: ' + err.message);
  }
});

loadTemplateBtn.addEventListener('click', async () => {
  const name = savedTemplateSelect.value;
  if (!name) return;
  const template = await window.api.loadLabelTemplate(name);
  if (template) {
    config = await window.api.updateConfig({ labelTemplate: template });
    populateDesignForm();
    scheduleAutoPreview();
  }
});

deleteTemplateBtn.addEventListener('click', async () => {
  const name = savedTemplateSelect.value;
  if (!name) return;
  if (!(await showConfirm(`Delete template "${name}"?`))) return;
  await window.api.deleteLabelTemplate(name);
  await refreshSavedTemplates();
});

newTemplateBtn.addEventListener('click', () => {
  config.labelTemplate = {
    printer: 'niimbot-b21-pro', labelSize: '50x30', orientation: 'landscape',
    header: { text: '', fontSize: 32, fontFamily: 'Arial', align: 'left', inverted: true, separator: false },
    lines: [],
    lineSpacing: 4,
    qr: { enabled: false, size: 200, position: 'right', urlTemplate: '', errorCorrection: 'M' },
    footer: { lines: [], fontSize: 14, separatorLine: false },
  };
  populateDesignForm();
  scheduleAutoPreview();
});

// Export current label template to file
document.getElementById('exportTemplateBtn').addEventListener('click', async () => {
  const template = collectTemplate();
  const name = template.header?.text || 'label-template';
  const filePath = await window.api.exportConfig(template, `${name}.json`);
  if (filePath) appendLog(`Template exported to ${filePath}`);
});

// Import a label template from file
document.getElementById('importTemplateBtn').addEventListener('click', async () => {
  try {
    const template = await window.api.importConfig();
    if (!template) return;
    config = await window.api.updateConfig({ labelTemplate: template });
    populateDesignForm();
    scheduleAutoPreview();
    appendLog('Label template imported.');
  } catch (err) {
    showError('Import failed: ' + err.message);
  }
});

// ─── Auto-Preview on Design Form Changes ───────────────────
let autoPreviewTimer = null;
function scheduleAutoPreview() {
  clearTimeout(autoPreviewTimer);
  autoPreviewTimer = setTimeout(async () => {
    try {
      const template = collectTemplate();
      const variables = getDesignPreviewVariables();
      const dataUrl = await window.api.previewLabel({ template, variables });
      showDesignPreview(dataUrl);
    } catch { /* ignore preview errors during typing */ }
  }, 400); // debounce 400ms
}

// Listen to all input changes in the design form
designForm.addEventListener('input', scheduleAutoPreview);
designForm.addEventListener('change', scheduleAutoPreview);

// ─── First Launch: Redirect to Label Design if no header set ─
function checkFirstLaunch() {
  const t = config.labelTemplate;
  if (!t?.header?.text) {
    // No label configured yet — switch to design tab (blank form)
    tabBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="design"]').classList.add('active');
    programView.style.display = 'none';
    designView.style.display = 'flex';
    refreshSavedTemplates();
  }
}

// ─── Start ─────────────────────────────────────────────────
init().then(() => checkFirstLaunch()).catch(err => appendLog('Init error: ' + err.message));
