/**
 * Post-flash serial configuration sender (main process).
 * Uses Node.js serialport to send JSON config commands to the device
 * after programming. Runs in the main process for reliable COM port access.
 *
 * Flow:
 *   1. Wait for device to (re-)enumerate on USB after reset.
 *   2. Open the port and assert DTR=HIGH exactly once (RTS stays LOW).
 *      On ESP32-C3/S3 native USB Serial/JTAG (VID 303A PID 1001-1002) the
 *      firmware's HWCDC layer gates TX on host DTR assertion: if DTR is LOW,
 *      every byte the firmware tries to send is silently dropped. Windows'
 *      node-serialport default leaves DTR de-asserted, which is why the
 *      previous version saw nothing. We assert DTR ONCE — no toggling —
 *      because the reset-into-download pattern requires opposite edges on
 *      DTR and RTS; a lone LOW→HIGH DTR edge with RTS held LOW is just
 *      "normal run" and does not trigger a chip reset.
 *   3. Ping/handshake loop: repeatedly send `pingCommand` until the device
 *      replies with something matching `readyResponse`. This replaces the
 *      previous fixed `bootDelay`, which could be either too short (device
 *      not yet up) or too long (wasted wall-clock time).
 *   4. Send each configured command in sequence; validate response against
 *      `expectedResponse`; fail fast on first rejection.
 */
import { SerialPort, ReadlineParser } from 'serialport';

/**
 * Find the ESP device's COM port by scanning serial ports for matching VID/PID.
 * For native USB devices that re-enumerate after reset, waits for the old port
 * to disappear then waits for the new one to appear.
 */
async function findEspPort(vid, pid, timeoutMs, log) {
  const targetVid = vid.toUpperCase();
  const targetPid = pid.toUpperCase();

  // Give the OS a moment to re-enumerate the device after the post-flash reset.
  log(`Waiting 2s for USB re-enumeration...`);
  await new Promise(r => setTimeout(r, 2000));

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastPortList = '';

  while (Date.now() < deadline) {
    attempt++;
    const ports = await SerialPort.list();
    const portSummary = ports.map(p => `${p.path}[${p.vendorId || '?'}:${p.productId || '?'}]`).join(', ');

    if (portSummary !== lastPortList) {
      console.log(`[serial-config] Port scan #${attempt}: ${portSummary || 'none'}`);
      lastPortList = portSummary;
    }

    for (const p of ports) {
      const pVid = (p.vendorId || '').toUpperCase();
      const pPid = (p.productId || '').toUpperCase();
      if (pVid === targetVid && pPid === targetPid) {
        log(`Found device on ${p.path} (${p.manufacturer || 'unknown'}) — attempt ${attempt}`);
        console.log('[serial-config] Matched port details:', JSON.stringify(p, null, 2));
        return p;
      }
    }

    if (attempt === 1) {
      log(`Scanning for device VID:${targetVid} PID:${targetPid}...`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error(`Device VID:${targetVid} PID:${targetPid} not found after ${attempt} attempts (${timeoutMs}ms).`);
}

/**
 * Issue an esptool-compatible hard-reset pulse via DTR/RTS.
 *
 * For ESP32-C3/S3 running the native USB Serial/JTAG peripheral (VID 303A),
 * the reset is triggered by a falling edge on DTR while RTS is held LOW —
 * this matches esptool-js's `hardReset(usingUsbOtg=true)` sequence. After
 * this call the chip's USB device disconnects and re-enumerates, so the
 * caller must re-scan for the port before opening it again.
 */
async function pulseUsbJtagReset(portPath, baudRate, log) {
  log(`Pulsing DTR reset on ${portPath}...`);
  const rp = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  await new Promise((resolve, reject) => rp.open(err => err ? reject(err) : resolve()));
  try {
    // Start: DTR=HIGH, RTS=LOW (normal run state).
    await new Promise(r => rp.set({ dtr: true, rts: false }, () => r()));
    await new Promise(r => setTimeout(r, 100));
    // Trigger: DTR falls HIGH→LOW with RTS still LOW → chip resets and
    // reboots from flash into user firmware.
    await new Promise(r => rp.set({ dtr: false, rts: false }, () => r()));
    await new Promise(r => setTimeout(r, 100));
  } finally {
    // Close may error if USB already disconnected — that's expected, ignore.
    await new Promise(r => rp.close(() => r()));
  }
  log(`Reset pulse complete — waiting for USB re-enumeration...`);
}

/**
 * Send post-flash configuration commands to a device over serial.
 *
 * @param {object} options
 * @param {string} options.vid - USB Vendor ID (hex string)
 * @param {string} options.pid - USB Product ID (hex string)
 * @param {Array<{key: string, value: string|number, templateString: string}>} options.items
 * @param {string} options.commandTemplate - global command template with {{key}}/{{value}}/{{items}}
 * @param {number} options.baudRate - serial baud rate (default 115200)
 * @param {number} options.timeout - ms to wait for each response (default 5000)
 * @param {string} options.expectedResponse - expression to validate success
 * @param {string} options.pingCommand - line sent during handshake (default '{"ping":1}')
 * @param {string} options.readyResponse - expression that signals firmware is ready (default 'ready == true')
 * @param {number} options.readyTimeout - total ms to wait for the ready handshake (default 15000)
 * @param {number} options.pingInterval - ms between ping attempts (default 500)
 * @param {number} options.interCommandDelay - ms to wait between successful commands (default 20)
 * @param {(msg: string) => void} options.onLog - log callback
 * @returns {Promise<Array<{key: string, value: string|number, success: boolean, response: string}>>}
 */
export async function sendSerialConfig({
  vid, pid, items, commandTemplate, baudRate = 115200,
  timeout = 5000, expectedResponse = 'success == true',
  pingCommand = '{"ping":1}', readyResponse = 'ready == true',
  readyTimeout = 15000, pingInterval = 500, interCommandDelay = 20, onLog,
}) {
  const log = (msg) => {
    console.log(`[serial-config] ${msg}`);
    onLog?.(msg);
  };

  if (!items || items.length === 0) return [];

  const portInfo = await findEspPort(vid, pid, 15000, log);

  // Force a hard reset via DTR pulse before handshaking. esptool-js's
  // loader.after('hard_reset') in the renderer is unreliable on ESP32-C3/S3
  // native USB Serial/JTAG — Chromium's Web Serial setSignals() doesn't
  // always translate to USB CDC SET_CONTROL_LINE_STATE reliably, so the chip
  // often stays in the download-stub instead of booting user firmware. Doing
  // it here (node-serialport → Win32 serial APIs) is much more consistent.
  await pulseUsbJtagReset(portInfo.path, baudRate, log);

  // The reset causes the USB Serial/JTAG peripheral to re-enumerate, so
  // re-find the port (may come back on the same COM number, may not).
  const freshPortInfo = await findEspPort(vid, pid, 15000, log);
  const comPort = freshPortInfo.path;
  log(`Opening ${comPort} at ${baudRate} baud...`);

  const port = new SerialPort({ path: comPort, baudRate, autoOpen: false, dataBits: 8, parity: 'none', stopBits: 1 });

  return new Promise((resolve, reject) => {
    const results = [];
    let commandQueue = [];
    let currentItem = null;
    let responseTimer = null;
    let handshakeDone = false;
    let handshakeDeadline = 0;
    let pingTimer = null;
    let settled = false;

    const isBatch = commandTemplate.includes('{{items}}');

    if (isBatch) {
      const batchItems = [];
      for (const item of items) {
        if (item.templateString) {
          commandQueue.push({
            items: [item],
            command: renderItemTemplate(item.templateString, item.key, item.value),
          });
        } else {
          batchItems.push(item);
        }
      }
      if (batchItems.length > 0) {
        const fragment = batchItems.map(i => `"${i.key}":${formatValue(i.value)}`).join(',');
        commandQueue.unshift({
          items: batchItems,
          command: commandTemplate.replace(/\{\{items\}\}/g, fragment),
        });
      }
    } else {
      for (const item of items) {
        const tmpl = item.templateString || commandTemplate;
        commandQueue.push({
          items: [item],
          command: renderItemTemplate(tmpl, item.key, item.value),
        });
      }
    }

    function cleanup() {
      clearTimeout(responseTimer);
      clearTimeout(pingTimer);
      try { port.close(); } catch { /* ignore */ }
    }

    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }

    function done(value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    function writeLine(line) {
      const writeData = line + '\n';
      console.log(`[serial-config] Writing ${writeData.length} bytes: ${JSON.stringify(writeData)}`);
      port.write(writeData, (err) => {
        if (err) return fail(new Error(`Write failed: ${err.message}`));
        port.drain((drainErr) => {
          if (drainErr) console.log(`[serial-config] Drain error: ${drainErr.message}`);
        });
      });
    }

    function sendPing() {
      if (handshakeDone || settled) return;
      if (Date.now() > handshakeDeadline) {
        return fail(new Error(
          `Device did not respond to ping within ${readyTimeout}ms. ` +
          `Verify firmware is running and listening on USB Serial for "${pingCommand}".`
        ));
      }
      log(`Ping → ${pingCommand}`);
      writeLine(pingCommand);
      pingTimer = setTimeout(sendPing, pingInterval);
    }

    function sendNext() {
      if (commandQueue.length === 0) {
        log('All configuration commands succeeded.');
        return done(results);
      }

      currentItem = commandQueue.shift();
      log(`Sending: ${currentItem.command}`);
      writeLine(currentItem.command);

      responseTimer = setTimeout(() => {
        log(`Response timeout for "${currentItem.items[0].key}" (no matching JSON received)`);
        for (const item of currentItem.items) {
          results.push({ key: item.key, value: item.value, success: false, response: '(no response - timeout)' });
        }
        fail(new Error(`Device did not respond to config "${currentItem.items[0].key}" within ${timeout}ms`));
      }, timeout);
    }

    // Line-based parsing: the firmware uses Arduino Serial.println() which
    // terminates every message with \r\n. ReadlineParser hands us one line
    // per event, so each line is either a complete JSON response or boot-log
    // noise — much simpler than scanning for brace pairs across chunks.
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    parser.on('data', (raw) => {
      log(`Raw RX chunk: ${JSON.stringify(raw)}`);
      const line = raw.replace(/\r$/, '').trim();
      if (!line) return;
      log(`RX: ${line}`);

      // Quick filter: only lines that look like JSON objects are candidates
      // for ready/response matching. Everything else (Arduino debug logs,
      // "Available commands: ..." banner, etc.) is noise we log and skip.
      const looksLikeJson = line.startsWith('{') && line.endsWith('}');

      if (!handshakeDone) {
        if (looksLikeJson && checkResponse(line, readyResponse)) {
          handshakeDone = true;
          clearTimeout(pingTimer);
          log(`Ready: ${line}`);
          setTimeout(sendNext, 50);
        }
        return;
      }

      if (!looksLikeJson) return;

      // Handshake is done — this line is a response to the current command.
      clearTimeout(responseTimer);
      log(`Response: ${line}`);
      const success = checkResponse(line, expectedResponse);
      for (const item of currentItem.items) {
        if (!success) log(`Config "${item.key}" failed: ${line}`);
        else log(`Config "${item.key}" = ${item.value} OK`);
        results.push({ key: item.key, value: item.value, success, response: line });
      }
      if (!success) {
        return fail(new Error(`Device rejected config "${currentItem.items[0].key}": ${line}`));
      }
      // Give the firmware a breath between back-to-back writes. Skippable by
      // setting interCommandDelay to 0; skipped anyway when the queue is empty
      // since sendNext() short-circuits to the resolve path.
      if (interCommandDelay > 0 && commandQueue.length > 0) {
        setTimeout(sendNext, interCommandDelay);
      } else {
        sendNext();
      }
    });

    port.on('error', (err) => {
      log(`Serial error: ${err.message}`);
      fail(err);
    });

    port.open((err) => {
      if (err) return fail(new Error(`Failed to open ${comPort}: ${err.message}`));
      log(`[serial-config] Port ${comPort} opened successfully`);
      log(`[serial-config] Port state: readable=${port.readable}, writable=${port.writable}, isOpen=${port.isOpen}`);

      // node-serialport's constructor option `dtr` is not universally honored
      // across platforms/versions, so explicitly call set() after open. This
      // produces a single LOW→HIGH DTR edge with RTS held LOW — the "normal
      // run" state on ESP32-C3/S3 USB Serial/JTAG, which does NOT trigger the
      // reset/download pattern (that needs opposite edges on DTR and RTS).
      // Required for HWCDC output to flow back to the host on Windows.
      port.set({ dtr: true, rts: false }, (setErr) => {
        if (setErr) log(`Warning: could not set DTR: ${setErr.message}`);
        else log(`DTR asserted (HIGH), RTS held LOW`);
        log(`${comPort} opened. Waiting for firmware ready...`);
        handshakeDeadline = Date.now() + readyTimeout;
        sendPing();
      });
    });
  });
}

function renderItemTemplate(templateStr, key, value) {
  return templateStr
    .replace(/\{\{key\}\}/g, key)
    .replace(/\{\{value\}\}/g, formatValue(value));
}

function formatValue(value) {
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/**
 * Check if a response matches the expected success condition.
 * Supports expressions like: success == true, success == 'ok', status == 1
 */
function checkResponse(response, expectedResponse) {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return false;

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      const normalized = jsonMatch[0].replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
      try { parsed = JSON.parse(normalized); } catch { return false; }
    }

    const exprMatch = expectedResponse.match(/^\s*([a-zA-Z0-9_.]+)\s*(==|===|!=|!==)\s*(.+)\s*$/);
    if (exprMatch) {
      const [, path, operator, rawExpected] = exprMatch;
      const actualValue = getNestedValue(parsed, path);
      const expectedValue = parseExpectedValue(rawExpected.trim());
      switch (operator) {
        case '==':  return actualValue == expectedValue;
        case '===': return actualValue === expectedValue;
        case '!=':  return actualValue != expectedValue;
        case '!==': return actualValue !== expectedValue;
      }
    }

    try {
      const expectedObj = JSON.parse(expectedResponse);
      return shallowMatch(parsed, expectedObj);
    } catch {
      return response.includes(expectedResponse);
    }
  } catch {
    return false;
  }
}

function getNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function parseExpectedValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === 'undefined') return undefined;
  const strMatch = raw.match(/^['"](.*)['"]$/);
  if (strMatch) return strMatch[1];
  const num = Number(raw);
  if (!isNaN(num)) return num;
  return raw;
}

function shallowMatch(actual, expected) {
  if (typeof expected !== 'object' || expected === null) return actual === expected;
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) return false;
  }
  return true;
}
