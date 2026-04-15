# Labels

BurnTag generates labels from user-designed templates and prints them on Niimbot thermal printers. The designer is in the **Label Design** tab; saved designs are reusable across profiles.

## Template structure

A label template is a plain JSON object with these top-level fields:

```js
{
  printer: "niimbot-b21-pro",    // model key from printer-registry.js
  labelSize: "50x30",             // size ID from LABEL_SIZES
  orientation: "landscape",       // "landscape" | "portrait"
  header: { /* see below */ },
  lines: [ /* body lines */ ],
  lineSpacing: 4,                 // vertical gap between body lines (px, pre-DPI-scale)
  qr: { /* see below */ },
  footer: { /* see below */ }
}
```

Saved templates are stored by name in `data/label-templates.json`.

### `header`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | string | `""` | Header text (supports template variables). Empty → no header. |
| `fontSize` | number | `32` | Pre-scale font size in px. |
| `fontFamily` | string | `"Arial"` | Font family; fallbacks to `sans-serif`. |
| `inverted` | boolean | `true` | White-on-black (inverted) vs black-on-white. |
| `separator` | boolean | `false` | Draw a horizontal line under the header. |
| `align` | string | `"left"` | `"left"` \| `"center"` \| `"right"`. |
| `logoDataUrl` | string | — | Optional `data:image/...` URL for a logo rendered on the left. |

### `lines` (body)

Each item renders as one line of text:

```js
{
  template: "MAC: {mac}",    // supports template variables
  fontSize: 18,               // px (pre-scale)
  bold: false,
  mono: true                  // true → Consolas monospace; false → Arial
}
```

### `qr`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Render a QR code. |
| `size` | number | `200` | Pre-scale QR width/height in px. |
| `urlTemplate` | string | — | Template resolved to a URL/string and encoded. Empty/unset → no QR. |
| `errorCorrection` | string | `"M"` | QR error correction — `"L"`, `"M"`, `"Q"`, or `"H"`. |

QR positioning:
- **Landscape** → top-right corner.
- **Portrait** → centered below body text, above footer.

### `footer`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `lines` | string[] | `[]` | Plain text lines (no per-line options). |
| `fontSize` | number | `14` | Pre-scale font size in px. |
| `separatorLine` | boolean | `false` | Draw a horizontal line above the footer. |
| `align` | string | `"left"` | `"left"` \| `"center"` \| `"right"`. |

---

## Template variables

Template variables work in any text field (`header.text`, `lines[].template`, `qr.urlTemplate`, `footer.lines[]`). Syntax: `{name}`.

Source: [main/label-generator.js](../main/label-generator.js) `resolveTemplate()`.

| Variable | Value |
| --- | --- |
| `{serial}` | Assigned serial number (empty if disabled). |
| `{mac}` | Colon-separated MAC — `AA:BB:CC:DD:EE:FF`. |
| `{mac_clean}` | *(not currently implemented — see note below)*. |
| `{date}` | Flash date as ISO date — `2026-04-15`. |
| `{product}` | Resolves to the current `header.text` (product name). |
| `{fcc_ids}` | All FCC IDs joined with `,` — e.g. `ESP32: 2A-FC-ESP32, BT: 2A-BT-01`. |
| `{fcc_line_1}`, `{fcc_line_2}`, … | Individual FCC entries, 1-indexed. Empty if no such entry. |
| `{config:KEY}` | Value from `postFlashConfig.items` with matching `key`. Unresolved keys render as `{config:KEY}` (literal). |

> **Note:** `{mac_clean}` was planned but isn't in the current resolver. If you need a MAC without separators, use `{config:...}` to emit it as its own config value, or add a case to `resolveTemplate`.

### FCC IDs

`config.fccIds` is an array of `{ chip, id }` entries. Rendering:

```js
fccIds = [
  { chip: "ESP32", id: "2A-FC-ESP32" },
  { chip: "BT",    id: "2A-BT-01" }
]
```

- `{fcc_ids}` → `ESP32: 2A-FC-ESP32, BT: 2A-BT-01`
- `{fcc_line_1}` → `ESP32 : 2A-FC-ESP32`
- `{fcc_line_2}` → `BT : 2A-BT-01`
- `{fcc_line_3}` → *(empty)*

Entries with an empty `chip` field render as just the ID.

---

## Rendering pipeline

Source: [main/label-generator.js](../main/label-generator.js).

1. Resolve label dimensions from `printer-registry.js` (DPI × mm → pixels).
2. Build an SVG string with header, body lines, footer, and (optionally) a composited PNG QR code.
3. Render the SVG with `sharp` at exact pixel dimensions — **no resize**. DPI scaling happens at the SVG layer (font sizes are multiplied by `dpi / 300`), not post-render.
4. If a QR is enabled, generate it via `qrcode` and composite it onto the rendered PNG.
5. Return a PNG `Buffer`.

### DPI scaling

All pre-scale sizes (font, QR, margins) are multiplied by `dpi / 300` before rendering. This means:

- At **300 DPI** (B21 Pro), a pre-scale `fontSize: 32` renders at 32 px.
- At **203 DPI** (B21, B1, D11), the same value renders at ~21 px.

Design once, render correctly across models.

### Bleed compensation

The inverted-header background rect is oversized by 4 px on each side to guarantee edge-to-edge coverage — thermal printers can misalign by a pixel or two, and a clean rectangle with a visible white gap looks worse than one that overflows slightly.

### Debug output

Every rendered label is also saved to `data/label-<mac>.svg` and `data/label-<mac>.png` for inspection (toggle with `DEBUG_SAVE` in `label-generator.js`). Preview renders use `label-preview.svg` / `label-preview.png`.

---

## Printer / size registry

Source: [main/printer-registry.js](../main/printer-registry.js).

### Printers

```js
PRINTERS = {
  "niimbot-b21-pro": { name: "Niimbot B21 Pro", dpi: 300, maxWidthPx: 592 },
  "niimbot-b21":     { name: "Niimbot B21",     dpi: 203, maxWidthPx: 384 },
  "niimbot-b1":      { name: "Niimbot B1",      dpi: 203, maxWidthPx: 384 },
  "niimbot-d11":     { name: "Niimbot D11",     dpi: 203, maxWidthPx: 96  }
}
```

### Label sizes

```js
LABEL_SIZES = [
  { id: "50x30", widthMm: 50, heightMm: 30 },
  { id: "80x50", widthMm: 80, heightMm: 50 },
  { id: "40x30", widthMm: 40, heightMm: 30 },
  { id: "40x20", widthMm: 40, heightMm: 20 },
  { id: "30x20", widthMm: 30, heightMm: 20 },
  { id: "25x15", widthMm: 25, heightMm: 15 },
  { id: "20x20", widthMm: 20, heightMm: 20 },
  { id: "14x28", widthMm: 14, heightMm: 28 }
]
```

Pixel dimensions are computed as:

```js
pxFromMm(mm, dpi) = round(mm / 25.4 × dpi)
```

and clamped to a multiple of 8 (Niimbot printers require 8-pixel-aligned widths). Orientation flips width ↔ height.

---

## Printing

Source: [main/label-printer.js](../main/label-printer.js).

### Connection lifecycle

- Opens a single persistent `PrinterClient` (niimbotjs) on first use.
- Probes device type (`getInfo(8)`) and software version (`getInfo(9)`) to identify the model.
- Stays open for the lifetime of the app. On error, the client is torn down and reconnected on the next print.

### Print settings

| Setting | Default | Notes |
| --- | --- | --- |
| `density` | `2` | Niimbot print density (1–5 for most models; higher = darker). |

### Model detection

Maps the device type code to a name:

| Code | Model |
| --- | --- |
| 785 | B21 Pro |
| 768 | B21 |
| 256 | B1 |
| 512 | D11 |
| 514 | D110 |

Unknown codes appear as `Unknown (<code>)`.

### Known issues (handled)

The included [`patch-niimbotjs.js`](../scripts/patch-niimbotjs.js) post-install hook patches `niimbotjs` to fix:

1. Midpoint offset overflow on wide (>255 px) images — common on B21 Pro.
2. Packet read timeout (B21 Pro is slower to ACK than B21 / B1).
3. Mismatched response codes (B21 Pro sometimes returns unexpected code).
4. Fault-tolerant print sequence — wraps each sub-command in try/catch so one skipped step doesn't abort the whole print.
5. Status polling — fixes every-other-print failures caused by stale `progress1`/`progress2` values from the previous print. Only `page >= 1` now terminates the poll.

See [niimbot-patches.md](niimbot-patches.md) for the why-each-patch-exists details.

---

## Design workflow

1. Open **Label Design** tab.
2. Pick printer, size, orientation.
3. Configure header / body / QR / footer.
4. Click **Preview** → app renders with sample variables (`FC-000001`, dummy MAC, today's date).
5. Click **Print Test** to send to the printer with the preview values.
6. **Save** with a name to reuse.
7. Return to **Program** tab, pick the template from the dropdown.

Saved templates are per-name JSON files in `data/label-templates.json` and can be exported/imported via the Settings export/import flow.
