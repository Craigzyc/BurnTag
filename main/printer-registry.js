/**
 * Printer type registry and label size definitions.
 * Used by the label designer and printer module.
 */

export const PRINTERS = {
  'niimbot-b21': {
    name: 'Niimbot B21',
    dpi: 203,
    maxWidthPx: 384,
    vid: '3513',
    pid: '0002',
  },
  'niimbot-b21-pro': {
    name: 'Niimbot B21 Pro',
    dpi: 300,
    maxWidthPx: 592,
    vid: '3513',
    pid: '0002',
  },
  'niimbot-b1': {
    name: 'Niimbot B1',
    dpi: 203,
    maxWidthPx: 384,
    vid: '3513',
    pid: '0002',
  },
  'niimbot-d11': {
    name: 'Niimbot D11',
    dpi: 203,
    maxWidthPx: 96,
    vid: '3513',
    pid: '0002',
  },
};

export const LABEL_SIZES = [
  { id: '80x50', name: '80 × 50 mm', width: 80, height: 50 },
  { id: '50x30', name: '50 × 30 mm', width: 50, height: 30 },
  { id: '40x30', name: '40 × 30 mm', width: 40, height: 30 },
  { id: '50x25', name: '50 × 25 mm', width: 50, height: 25 },
  { id: '40x20', name: '40 × 20 mm', width: 40, height: 20 },
  { id: '30x20', name: '30 × 20 mm', width: 30, height: 20 },
  { id: '50x50', name: '50 × 50 mm', width: 50, height: 50 },
  { id: '40x40', name: '40 × 40 mm', width: 40, height: 40 },
];

/**
 * Calculate pixel dimensions from mm and DPI.
 * Rounds to nearest multiple of 8 for bit-packing compatibility.
 */
export function mmToPixels(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

export function mmToPixelsAligned(mm, dpi) {
  const px = mmToPixels(mm, dpi);
  return Math.ceil(px / 8) * 8;
}

/**
 * Bleed: extra pixels added to ensure edge-to-edge printing.
 * Thermal printers can't guarantee the exact boundary, so a small
 * oversize ensures header backgrounds and borders fill the label.
 */
const BLEED_PX = 8;

/**
 * Get label pixel dimensions for a printer + label size combo.
 * Width is clamped to the printer's max print head width.
 * A small bleed is added to height for edge-to-edge coverage.
 */
export function getLabelDimensions(printerKey, labelSizeId, orientation = 'landscape') {
  const printer = PRINTERS[printerKey];
  const labelSize = LABEL_SIZES.find(s => s.id === labelSizeId);
  if (!printer || !labelSize) return null;

  let widthMm = labelSize.width;
  let heightMm = labelSize.height;

  if (orientation === 'portrait') {
    [widthMm, heightMm] = [heightMm, widthMm];
  }

  // Clamp width to printer's max print head width
  const rawWidth = mmToPixelsAligned(widthMm, printer.dpi);
  const widthPx = Math.min(rawWidth, printer.maxWidthPx);

  // Add vertical bleed for edge-to-edge coverage
  const heightPx = mmToPixelsAligned(heightMm, printer.dpi) + BLEED_PX;

  return {
    widthPx,
    heightPx,
    dpi: printer.dpi,
    widthMm,
    heightMm,
  };
}

/**
 * Get the default label template.
 */
export function getDefaultTemplate() {
  return {
    printer: 'niimbot-b21-pro',
    labelSize: '50x30',
    orientation: 'landscape',

    header: {
      text: '',
      fontSize: 32,
      fontFamily: 'Arial',
      inverted: true,  // true = white text on black bg (thermal default)
      separator: false, // line under header (auto-shown when inverted is off)
    },

    lines: [],
    lineSpacing: 4,

    qr: {
      enabled: true,
      size: 200,
      position: 'right',
      urlTemplate: '',
      errorCorrection: 'M',
    },

    footer: {
      lines: [],
      fontSize: 14,
      separatorLine: true,
    },
  };
}
