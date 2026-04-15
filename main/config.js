import fs from 'node:fs';
import path from 'node:path';
import { getDefaultTemplate } from './printer-registry.js';

export function getDefaults() {
  return {
    serialEnabled: false,
    serialPrefix: 'FC',
    nextSerialNumber: 1,
    // When true, also write the generated serial to the device using the
    // current postFlashConfig mode (JSON RPC or NVS partition). The label
    // gets the serial either way; this flag just extends it to the chip.
    serialWriteToDevice: false,
    // Key the firmware will read the serial from (JSON command key, or NVS
    // namespace key). Defaults to "serial" to match common firmware habits.
    serialDeviceKey: 'serial',
    // NVS type when writing the serial in NVS mode. Empty = auto-infer
    // (string). Use "string" to keep the full "FC-000001" format, or a
    // numeric type if you want just the integer part (then set an empty
    // prefix so formatSerial returns just the number).
    serialDeviceType: '',
    fccIds: [],  // [{ chip: 'ESP32-S3', id: '2XXXXX-YYYYY' }, ...]
    activeProfile: null,
    firmwareBaseDir: process.env.FIRMWARE_BASE_DIR || '../firmware',
    selectedFirmware: null,
    flashAddresses: { bootloader: '0x0', partitions: '0x8000', firmware: '0x10000' },
    chip: 'auto',
    baudRate: 921600,
    autoMode: false,
    postFlashConfig: {
      enabled: false,
      mode: 'json', // 'json' (serial RPC) or 'nvs' (flash an NVS partition image)
      baudRate: 115200,
      timeout: 5000,
      expectedResponse: 'success == true',
      commandTemplate: '{"set":{"{{key}}":{{value}}}}',
      // JSON-mode handshake: send `pingCommand` until firmware replies with
      // something matching `readyResponse`. Replaces the old fixed bootDelay.
      pingCommand: '{"ping":1}',
      readyResponse: 'ready == true',
      readyTimeout: 15000,
      pingInterval: 500,
      // Delay between successful config writes. Some firmwares need a breath
      // between back-to-back NVS commits; 20 ms is enough for most.
      interCommandDelay: 20,
      // NVS-mode settings: partition is flashed alongside firmware.
      nvs: {
        namespace: 'config',
        partitionOffset: '0x9000',
        partitionSize: '0x6000',
      },
      items: [],
      // items shape (json): { key, value, templateString, autoIncrement }
      // items shape (nvs):  { key, value, nvsType: 'u8'|'u16'|'u32'|'i32'|'string', autoIncrement }
      // Use {config:key} in label template body lines to display values.
    },
    labelTemplate: getDefaultTemplate(),
    espVidPids: [
      { vid: '303A', description: 'Espressif' },
      { vid: '10C4', description: 'CP210x' },
      { vid: '1A86', description: 'CH340' },
      { vid: '0403', description: 'FTDI' },
    ],
  };
}

export function loadConfig(filePath) {
  const defaults = getDefaults();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const saved = JSON.parse(raw);
    return {
      ...defaults,
      ...saved,
      flashAddresses: { ...defaults.flashAddresses, ...saved.flashAddresses },
      labelTemplate: { ...defaults.labelTemplate, ...saved.labelTemplate },
      postFlashConfig: { ...defaults.postFlashConfig, ...saved.postFlashConfig },
    };
  } catch {
    return defaults;
  }
}

export function saveConfig(config, filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
  fs.renameSync(tmpPath, filePath);
}
