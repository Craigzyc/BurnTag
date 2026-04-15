import sharp from 'sharp';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { getLabelDimensions, getDefaultTemplate } from './printer-registry.js';

// Debug: save SVG and PNG to data/ folder for inspection
const DEBUG_SAVE = true;
const DEBUG_DIR = path.join(import.meta.dirname, '..', 'data');

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replace template variables in a string.
 */
export function resolveTemplate(templateStr, variables) {
  return templateStr.replace(/\{([\w:]+)\}/g, (match, key) => {
    if (key === 'serial') return variables.serial || '';
    if (key === 'mac') return variables.mac || '00:00:00:00:00:00';
    if (key === 'date') return new Date().toISOString().slice(0, 10);
    if (key === 'product') return variables.product || '';
    if (key === 'fcc_ids') {
      return (variables.fccIds || [])
        .map(e => e.chip ? `${e.chip}: ${e.id}` : e.id)
        .join(', ');
    }
    const fccMatch = key.match(/^fcc_line_(\d+)$/);
    if (fccMatch) {
      const idx = parseInt(fccMatch[1], 10) - 1;
      const entry = (variables.fccIds || [])[idx];
      if (!entry) return '';
      return entry.chip ? `${entry.chip} : ${entry.id}` : entry.id;
    }
    // Post-flash config values: {config:key}
    const configMatch = key.match(/^config:(\w+)$/);
    if (configMatch) {
      const configKey = configMatch[1];
      const configItems = variables.configItems || {};
      return configKey in configItems ? String(configItems[configKey]) : match;
    }
    return match;
  });
}

export function buildQrUrl(urlTemplate, variables) {
  const raw = resolveTemplate(urlTemplate, variables);
  try { return new URL(raw).toString(); } catch { return raw; }
}

/**
 * Generate a label PNG buffer from a template and variables.
 */
export async function generateLabel(template, variables = {}) {
  const t = template || getDefaultTemplate();

  const dims = getLabelDimensions(t.printer, t.labelSize, t.orientation);
  if (!dims) throw new Error(`Invalid printer/label: ${t.printer} / ${t.labelSize}`);

  const W = dims.widthPx;
  const H = dims.heightPx;
  const scale = dims.dpi / 300;
  const margin = Math.round(W * 0.04);
  const isPortrait = (t.orientation === 'portrait');

  // ─── Header ────────────────────────────────────────────
  const header = t.header || {};
  const headerFontSize = Math.round((header.fontSize || 32) * scale);
  const headerHeight = header.text ? Math.round(headerFontSize * 2.1) : 0;
  const headerTextY = Math.round(headerHeight * 0.68);
  const inverted = header.inverted !== false;
  const bgColor = inverted ? '#000000' : 'white';
  const fgColor = inverted ? '#FFFFFF' : '#000000';

  let headerSvg = '';
  if (header.text) {
    const align = header.align || 'left';

    // If logo is provided (base64 data URI), include it
    const logoSvg = header.logoDataUrl
      ? `<image x="${margin}" y="${Math.round(headerHeight * 0.15)}" height="${Math.round(headerHeight * 0.7)}" href="${header.logoDataUrl}"/>`
      : '';
    const logoOffset = header.logoDataUrl ? Math.round(headerHeight * 0.8) : 0;

    // Compute text x position and anchor based on alignment
    let textX, textAnchor;
    if (align === 'center') {
      textX = Math.round(W / 2);
      textAnchor = 'middle';
    } else if (align === 'right') {
      textX = W - margin;
      textAnchor = 'end';
    } else {
      textX = margin + logoOffset;
      textAnchor = 'start';
    }

    // Background rect: oversized to ensure edge-to-edge coverage
    const bgRect = inverted
      ? `<rect x="-4" y="-4" width="${W + 8}" height="${headerHeight + 4}" fill="${bgColor}"/>`
      : '';

    // Separator line under header (user-controlled via checkbox)
    const separatorLine = header.separator
      ? `<line x1="0" y1="${headerHeight}" x2="${W}" y2="${headerHeight}" stroke="${inverted ? '#FFFFFF' : '#000000'}" stroke-width="1.5"/>`
      : '';

    headerSvg = `
    ${bgRect}
    ${logoSvg}
    <text x="${textX}" y="${headerTextY}" text-anchor="${textAnchor}"
      font-family="${escapeXml(header.fontFamily || 'Arial')},sans-serif"
      font-weight="bold" font-size="${headerFontSize}"
      fill="${fgColor}">${escapeXml(header.text)}</text>
    ${separatorLine}`;
  }

  // ─── Body Lines ────────────────────────────────────────
  const lines = t.lines || [];
  const lineSpacing = Math.round((t.lineSpacing || 4) * scale);
  let bodyY = headerHeight + Math.round(20 * scale);

  let bodyLinesSvg = '';
  for (const line of lines) {
    const text = resolveTemplate(line.template || '', variables);
    if (!text) continue;
    const fs = Math.round((line.fontSize || 18) * scale);
    bodyY += fs;
    const weight = line.bold ? 'font-weight="bold"' : '';
    const fontFam = line.mono !== false ? 'Consolas,monospace' : 'Arial,sans-serif';
    bodyLinesSvg += `
    <text x="${margin}" y="${bodyY}" font-family="${fontFam}" font-size="${fs}" ${weight} fill="black">${escapeXml(text)}</text>`;
    bodyY += lineSpacing;
  }

  // ─── Footer ────────────────────────────────────────────
  const footer = t.footer || {};
  const footerLines = footer.lines || [];
  const footerFontSize = Math.round((footer.fontSize || 14) * scale);
  const footerLineHeight = Math.round(footerFontSize * 1.4);
  const footerTotalHeight = footerLines.length * footerLineHeight + Math.round(10 * scale);
  const separatorY = H - footerTotalHeight - Math.round(8 * scale);

  let footerSvg = '';
  if (footer.separatorLine) {
    footerSvg += `\n    <line x1="${margin}" y1="${separatorY}" x2="${W - margin}" y2="${separatorY}" stroke="black" stroke-width="0.75"/>`;
  }
  const footerAlign = footer.align || 'left';
  let footerTextX, footerAnchor;
  if (footerAlign === 'center') {
    footerTextX = Math.round(W / 2);
    footerAnchor = 'middle';
  } else if (footerAlign === 'right') {
    footerTextX = W - margin;
    footerAnchor = 'end';
  } else {
    footerTextX = margin;
    footerAnchor = 'start';
  }
  let footerY = separatorY + Math.round(18 * scale);
  for (const line of footerLines) {
    footerSvg += `
    <text x="${footerTextX}" y="${footerY}" text-anchor="${footerAnchor}" font-family="Arial,sans-serif" font-size="${footerFontSize}" fill="black">${escapeXml(line)}</text>`;
    footerY += footerLineHeight;
  }

  // ─── Compose SVG ───────────────────────────────────────
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    ${headerSvg}
    ${bodyLinesSvg}
    ${footerSvg}
  </svg>`;

  // Debug: save SVG for inspection
  const debugName = (variables.mac || 'preview').replace(/:/g, '-');
  if (DEBUG_SAVE) {
    try {
      if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
      fs.writeFileSync(path.join(DEBUG_DIR, `label-${debugName}.svg`), svg);
      console.log(`[label] Saved SVG: label-${debugName}.svg (${W}x${H})`);
    } catch {}
  }

  // Render SVG at exact pixel dimensions — no resize
  let result = await sharp(Buffer.from(svg)).png().toBuffer();

  // ─── QR Code ───────────────────────────────────────────
  const qr = t.qr || {};
  const qrUrlTemplate = qr.urlTemplate || '';
  if (qr.enabled !== false && qrUrlTemplate) {
    const qrSize = Math.round((qr.size || 200) * scale);
    const qrUrl = buildQrUrl(qrUrlTemplate, variables);

    const qrBuffer = await QRCode.toBuffer(qrUrl, {
      width: qrSize,
      margin: 1,
      errorCorrectionLevel: qr.errorCorrection || 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    const pad = Math.round(W * 0.03);
    let qrLeft, qrTop;

    if (isPortrait) {
      // Portrait: QR centered below the body text, above footer
      qrLeft = Math.round((W - qrSize) / 2);
      qrTop = Math.min(bodyY + Math.round(10 * scale), separatorY - qrSize - Math.round(10 * scale));
    } else {
      // Landscape: QR top-right
      qrLeft = W - qrSize - pad;
      qrTop = headerHeight + Math.round(14 * scale);
    }

    result = await sharp(result)
      .composite([{ input: qrBuffer, left: qrLeft, top: qrTop }])
      .png()
      .toBuffer();
  }

  // Debug: save final PNG for inspection
  if (DEBUG_SAVE) {
    try {
      const meta = await sharp(result).metadata();
      fs.writeFileSync(path.join(DEBUG_DIR, `label-${debugName}.png`), result);
      console.log(`[label] Saved PNG: label-${debugName}.png (${meta.width}x${meta.height})`);
    } catch {}
  }

  return result;
}
