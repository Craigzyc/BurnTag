/**
 * Renderer-side printer stub.
 * Actual printing is done via IPC to main process (niimbotjs + node serialport).
 * Web Serial doesn't work reliably with B21 Pro's composite USB device.
 */

export async function printLabel(pngData, { density = 2, onLog } = {}) {
  onLog?.('Sending to printer via main process...');
  // Convert Uint8Array to base64 for IPC transfer
  let base64 = '';
  const bytes = new Uint8Array(pngData);
  for (let i = 0; i < bytes.length; i++) {
    base64 += String.fromCharCode(bytes[i]);
  }
  base64 = btoa(base64);

  const result = await window.api.printLabel({ pngBase64: base64, density });
  if (result?.success) {
    onLog?.('Print complete!');
  } else {
    onLog?.(`Print error: ${result?.error}`);
  }
  return result;
}
