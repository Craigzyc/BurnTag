import { EventEmitter } from 'node:events';
import { getNextSerial } from './serial-number.js';
import { generateLabel } from './label-generator.js';
import { appendRecord } from './history.js';
import { saveConfig } from './config.js';

/**
 * Check if a label template references {serial} in any text field.
 */
function templateUsesSerial(template) {
  if (!template) return false;
  const texts = [
    ...(template.lines || []).map(l => l.template || ''),
    template.qr?.urlTemplate || '',
    ...(template.footer?.lines || []),
  ];
  return texts.some(t => t.includes('{serial}'));
}

/**
 * Handles post-flash steps: serial assignment, label generation.
 * Printing is handled renderer-side via niimbluelib + Web Serial.
 */
export class Programmer extends EventEmitter {
  #config;
  #configPath;
  #historyPath;

  constructor({ config, configPath, historyPath }) {
    super();
    this.#config = config;
    this.#configPath = configPath;
    this.#historyPath = historyPath;
  }

  updateConfig(config) {
    this.#config = config;
  }

  async completePostFlash({ mac, port, firmware, configResults, reservedSerial }) {
    const record = { port, mac, status: 'in-progress', startedAt: new Date().toISOString() };
    const cfg = this.#config;

    try {
      let serial = null;

      // Serial assignment — only if enabled. If the renderer already peeked
      // the next serial (to bake it into the device), we commit that same
      // number here by incrementing the counter once.
      if (cfg.serialEnabled) {
        this.#emitStatus('assigning-serial', port, { step: 4, total: 7 });
        serial = getNextSerial(cfg);
        if (reservedSerial && reservedSerial !== serial) {
          // Shouldn't happen under normal single-flash operation; warn if it does.
          console.warn(`[programmer] Reserved serial ${reservedSerial} differs from committed ${serial}`);
        }
        saveConfig(cfg, this.#configPath);
        record.serial = serial;
        this.#emitStatus('assigning-serial', port, { serial, done: true });
      } else if (templateUsesSerial(cfg.labelTemplate)) {
        throw new Error('Label template uses {serial} but serial numbering is disabled. Enable serial numbering or remove {serial} from the template.');
      }

      // Build config items as key→value map for {config:KEY} label variables
      const configItems = {};
      if (configResults) {
        for (const result of configResults) {
          configItems[result.key] = result.value;
        }
      } else if (cfg.postFlashConfig?.items) {
        for (const item of cfg.postFlashConfig.items) {
          configItems[item.key] = item.value;
        }
      }

      // Generate label
      this.#emitStatus('generating-label', port, { step: 5, total: 7 });
      const labelBuffer = await generateLabel(cfg.labelTemplate, {
        serial: serial || '',
        mac,
        product: cfg.labelTemplate?.header?.text || 'Device',
        configItems,
      });
      const labelBase64 = `data:image/png;base64,${labelBuffer.toString('base64')}`;
      record.labelGenerated = true;
      this.#emitStatus('generating-label', port, { labelBase64, done: true });

      // Print — handled by renderer, we just signal it's ready
      this.#emitStatus('printing', port, { step: 6, total: 7, labelBase64, needsPrint: true, done: true });

      // Complete
      record.status = 'success';
      record.serial = serial;
      record.firmware = firmware || 'unknown';
      appendRecord(record, this.#historyPath);
      this.#emitStatus('complete', port, { serial, mac, labelBase64, step: 7, total: 7 });

      return { serial, mac, labelBase64 };
    } catch (err) {
      record.status = 'failed';
      record.error = err.message;
      appendRecord(record, this.#historyPath);
      this.emit('error', { port, error: err.message });
      throw err;
    }
  }

  /**
   * Record a flash-only operation (no serial, label, or print).
   */
  recordFlashOnly({ mac, port, firmware }) {
    const record = {
      port,
      mac,
      status: 'success',
      firmware: firmware || 'unknown',
      flashOnly: true,
      startedAt: new Date().toISOString(),
    };
    appendRecord(record, this.#historyPath);
    this.#emitStatus('complete', port, { mac, step: 7, total: 7 });
    return { mac };
  }

  #emitStatus(step, port, data = {}) {
    this.emit('status', { step, port, ...data });
  }
}
