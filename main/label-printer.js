import sharp from 'sharp';
import { SerialPort } from 'serialport';

const NIIMBOT_VID = '3513';
const NIIMBOT_PID = '0002';

let persistentClient = null;
let printerInfo = null;

/**
 * Get or create a persistent printer connection.
 * Opens once, stays open for the lifetime of the app.
 */
async function getClient() {
  if (persistentClient) return persistentClient;

  const { PrinterClient } = await import('niimbotjs');
  const client = new PrinterClient();

  console.log('[printer] Opening persistent connection...');
  await client.open();

  // Drain any initial data
  await new Promise(r => setTimeout(r, 300));
  try { let c; do { c = client.serial.read(); } while (c); } catch {}

  // Known Niimbot model IDs
  const MODEL_NAMES = {
    785: 'B21 Pro',
    768: 'B21',
    256: 'B1',
    512: 'D11',
    514: 'D110',
  };

  // Get printer info
  try {
    const deviceType = await client.getInfo(8); // InfoCode.DEVICE_TYPE = 8
    const swVersion = await client.getInfo(9);  // InfoCode.SOFTWARE_VERSION = 9
    const modelName = MODEL_NAMES[deviceType] || `Unknown (${deviceType})`;
    printerInfo = { deviceType, modelName, swVersion, connected: true };
    console.log(`[printer] Connected: ${modelName} (type=${deviceType}, sw=${swVersion})`);
  } catch (e) {
    printerInfo = { connected: true, modelName: 'Niimbot', error: e.message };
    console.log(`[printer] Connected (info fetch failed: ${e.message})`);
  }

  persistentClient = client;
  return client;
}

/**
 * Print a PNG buffer using the persistent connection.
 */
export async function printLabel(imageBuffer, { density = 2 } = {}) {
  try {
    const client = await getClient();
    const image = sharp(imageBuffer);
    const meta = await image.metadata();
    console.log(`[print] Sending ${meta.width}x${meta.height} at density ${density}...`);

    await client.print(image, { density });
    console.log('[print] Done.');
    return { success: true };
  } catch (err) {
    console.error('[print] Error:', err?.message || err);
    // Reset connection on error so next print reconnects
    try { persistentClient?.close(); } catch {}
    persistentClient = null;
    printerInfo = null;
    return { success: false, error: err?.message || 'Print error' };
  }
}

/**
 * Check if a Niimbot printer is connected (USB scan, no port open).
 */
export async function isPrinterAvailable() {
  try {
    const ports = await SerialPort.list();
    return ports.some(
      p => p.vendorId?.toLowerCase() === NIIMBOT_VID && p.productId?.toLowerCase() === NIIMBOT_PID,
    );
  } catch {
    return false;
  }
}

/**
 * Get info about the connected printer.
 */
export function getPrinterInfo() {
  console.log('[printer] Current printer info:', printerInfo);
  return printerInfo;
}

/**
 * Try to establish the persistent connection proactively.
 * Called at app startup.
 */
export async function connectPrinter() {
  try {
    const available = await isPrinterAvailable();
    if (!available) {
      printerInfo = null;
      return null;
    }
    await getClient();
    return printerInfo;
  } catch (e) {
    console.log('[printer] Auto-connect failed:', e.message);
    printerInfo = null;
    return null;
  }
}
