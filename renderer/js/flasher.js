/**
 * Renderer-side flasher using esptool-js + Web Serial API.
 * Handles steps 1-3: read MAC, flash firmware, verify (MD5).
 * Runs entirely in the renderer process — no Python dependency.
 */
import { ESPLoader, Transport } from '../../node_modules/esptool-js/bundle.js';

export { ESPLoader, Transport };

/**
 * Request a serial port matching the given VID filter.
 * Electron's session.on('select-serial-port') handles auto-selection
 * so no browser picker dialog appears.
 * @param {string[]} vidFilter - array of vendor IDs like ['303A', '10C4']
 * @returns {Promise<SerialPort>}
 */
export async function requestPort(vidFilter) {
  const filters = vidFilter.map(vid => ({
    usbVendorId: parseInt(vid, 16),
  }));
  return navigator.serial.requestPort({ filters });
}

/**
 * Get all already-granted serial ports.
 * @returns {Promise<SerialPort[]>}
 */
export async function getGrantedPorts() {
  return navigator.serial.getPorts();
}

/**
 * Connect to an ESP device, read MAC, flash firmware, verify via MD5.
 * Always cleans up the transport on success or failure.
 *
 * @param {SerialPort} port - Web Serial port object
 * @param {Array<{ address: number, data: string }>} fileArray - firmware data
 * @param {object} options
 * @param {number} options.baudRate - flash baud rate (default 921600)
 * @param {(msg: string) => void} options.onLog - log callback
 * @param {(pct: { percent: number }) => void} options.onProgress - progress callback
 * @returns {Promise<string>} MAC address
 */
export async function connectAndFlash(port, fileArray, { baudRate = 921600, onLog, onProgress }) {
  const transport = new Transport(port, true);

  const terminal = {
    clean() { },
    writeLine(data) { onLog?.(data); },
    write(data) { onLog?.(data); },
  };

  const loader = new ESPLoader({
    transport,
    baudrate: baudRate,
    terminal,
  });

  try {
    // Connect, detect chip, upload stub, change baud, read MAC
    // main() does all of this including logging MAC via terminal
    onLog?.('Connecting to ESP device...');
    const chipDescription = await loader.main();
    onLog?.(`Chip: ${chipDescription}`);

    // Read MAC via the chip-specific method (not on loader directly)
    const mac = await loader.chip.readMac(loader);
    onLog?.(`MAC: ${mac}`);

    // Flash firmware with MD5 verification
    onLog?.('Flashing firmware...');
    await loader.writeFlash({
      fileArray,
      flashMode: 'dio',
      flashFreq: '40m',
      flashSize: 'keep',
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        const percent = Math.round((written / total) * 100);
        onProgress?.({ percent, fileIndex });
      },
    });

    onLog?.('Flash complete. Verify passed (MD5).');

    // Hard reset after flash
    await loader.after('hard_reset');
    onLog?.('Device reset.');
    await loader.transport.setRTS(true);  // Connects to EN/Reset usually
    await new Promise(resolve => setTimeout(resolve, 100));
    await loader.transport.setRTS(false);
    // Don't disconnect — keep the transport alive so we can reuse the
    // serial connection for post-flash config. The caller is responsible
    // for calling transport.disconnect() when done.
    const macStr = typeof mac === 'string' ? mac.toUpperCase() : String(mac).toUpperCase();
    return { mac: macStr, transport };
  } catch (err) {
    // Always close the transport on error so the port can be reused
    try { await transport.disconnect(); } catch { /* ignore cleanup errors */ }
    throw err;
  }
}
