<p align="center">
  <img src="BurnTag.png" alt="BurnTag" width="480">
</p>

# BurnTag

**ESP32 Flash & Label Station** — an Electron desktop app that flashes ESP32 firmware over Web Serial, assigns serial numbers, writes post-flash device config, and prints a matching label to a Niimbot thermal printer, all in one pass.

Built for small-batch production programming: plug a board in, get a flashed, configured, serialized device and a printed label in one action — or enable Auto Mode and just keep plugging boards in.

---

## Table of Contents

- [Features](#features)
- [Supported Hardware](#supported-hardware)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
  - [Flash Modes](#flash-modes)
  - [Firmware Layout](#firmware-layout)
  - [Post-Flash Configuration](#post-flash-configuration)
  - [Serial Numbers](#serial-numbers)
  - [Labels](#labels)
  - [Profiles](#profiles)
  - [History](#history)
- [Configuration Reference](#configuration-reference)
- [Architecture](#architecture)
- [IPC API](#ipc-api)
- [Development](#development)
- [Building](#building)
- [Troubleshooting](#troubleshooting)
- [Further Documentation](#further-documentation)

---

## Features

- **One-shot programming pipeline** — MAC read → firmware flash (MD5 verified) → post-flash config → serial assignment → label generation → label print, with live pipeline progress.
- **Pure-JS flashing via Web Serial** — uses [esptool-js](https://github.com/espressif/esptool-js), no Python toolchain required.
- **Two post-flash config modes**
  - **JSON RPC over serial** — send commands to running firmware via configurable JSON templates and validate responses.
  - **NVS partition image** — build an ESP-IDF-compatible NVS partition in memory and flash it alongside firmware (no running firmware needed).
- **Serial number management** — prefix + incrementing counter, peek-then-commit so the same serial is baked into the device and printed on the label.
- **Built-in label designer** — WYSIWYG editor with header/body/footer, QR codes, FCC IDs, and template variables (`{serial}`, `{mac}`, `{date}`, `{config:KEY}`, etc.).
- **Niimbot printer support** — direct USB control of B21 Pro, B21, B1, and D11 via `niimbotjs` with patches for B21 Pro quirks.
- **Auto Mode** — plug in an ESP32, app auto-flashes and prints. Toggleable from the header or the system tray.
- **Profiles** — save a full programming config (chip, baud, flash addresses, label template, serial scheme) per product and switch with one click.
- **History log** — append-only JSONL record of every flash with MAC, serial, firmware, timestamp, and status.
- **PlatformIO-aware firmware scanner** — auto-discovers builds under a `sensors/` + `gateway/` directory structure.
- **Runs in system tray** — minimize to tray, Auto-Program toggle in tray menu.

---

## Supported Hardware

### ESP chips
Any chip supported by esptool-js, detected automatically or selected manually:

- ESP32
- ESP32-S2
- ESP32-S3
- ESP32-C3
- ESP32-C6
- ESP32-H2

### USB-to-serial bridges
Auto-selected via VID filter — configurable in settings. Defaults:

| Chip | VID |
| --- | --- |
| Native USB Serial/JTAG (S3, C3, C6, H2) | `303A` |
| CP210x (Silicon Labs) | `10C4` |
| CH340 / CH341 (WCH) | `1A86` |
| FTDI | `0403` |

### Niimbot label printers
All connect via USB (VID `3513` PID `0002`):

| Model | DPI | Max width |
| --- | --- | --- |
| B21 Pro | 300 | 592 px |
| B21 | 203 | 384 px |
| B1 | 203 | 384 px |
| D11 | 203 | 96 px |

Included label sizes: 50×30, 80×50, 40×30, 40×20, 30×20, 25×15, 20×20, 14×28 mm.

---

## Requirements

- **Windows 10/11** (primary target; app ships as an NSIS installer). The renderer-side Web Serial path is cross-platform, but the persistent Niimbot printer connection and post-flash serial config are validated on Windows.
- **Node.js ≥ 22** (for development only — the packaged app bundles its own runtime).
- **USB drivers** for your ESP board's USB-to-serial bridge (CP210x, CH340, or native USB — install from the chip vendor if the device doesn't enumerate).
- **A Niimbot printer** plugged in via USB (optional — the app works fine in Flash Only mode without one).

---

## Installation

### Packaged installer (end users)

1. Grab the latest `BurnTag Setup <version>.exe` from your distribution channel.
2. Run it. It installs per-user (no admin required) via NSIS, one-click.
3. Launch **BurnTag** from the Start menu.

### From source

```bash
git clone <repo-url> burntag
cd burntag
npm install
npm start
```

`npm install` runs `scripts/patch-niimbotjs.js` automatically to apply B21 Pro compatibility patches to `niimbotjs`. If you see printer timeouts or every-other-print failures, that patch didn't run — re-install deps.

If you hit `NODE_MODULE_VERSION` errors from `serialport` or `sharp`, run:

```bash
npm run rebuild
```

---

## Quick Start

1. **Set the firmware base directory.** In **Settings**, point **Firmware base directory** at your PlatformIO projects root (see [Firmware Layout](#firmware-layout)). BurnTag scans it for builds.
2. **Pick a firmware build** from the dropdown.
3. *(Optional)* Enable **Serial Numbers** and set a prefix + starting number.
4. *(Optional)* Enable **Post-flash Config** in JSON or NVS mode and add key/value items.
5. *(Optional)* Open the **Label Design** tab, design a label, save it as a template.
6. Plug in an ESP32. Click **Flash & Print** — or turn on **Auto Mode** and just keep plugging boards in.

---

## Usage

### Flash Modes

| Mode | What runs |
| --- | --- |
| **Flash Only** | MAC read → firmware flash → MD5 verify. No serial, no config, no label. |
| **Flash & Print** | Full pipeline: MAC → flash → verify → post-flash config → assign + commit serial → generate label → print label → append history record. |
| **Auto Mode** | On Web Serial `connect` event for a filtered ESP device, waits 2 seconds, then runs Flash & Print automatically. Toggle in header or tray. |

The pipeline view in the UI shows each step turning active → complete as it runs, and the flash log streams esptool output and config exchanges live.

### Firmware Layout

BurnTag discovers firmware using a fixed PlatformIO-style convention under the configured base directory:

```
<firmwareBaseDir>/
├── sensors/
│   └── <device-name>/
│       └── .pio/build/
│           ├── <env-1>/
│           │   ├── bootloader.bin     (optional)
│           │   ├── partitions.bin     (optional)
│           │   └── firmware.bin       (required)
│           └── <env-2>/...
└── gateway/
    └── <device-name>/
        └── .pio/build/<env>/...
```

Only `sensors/` and `gateway/` are scanned as top-level categories. Each discovered build appears in the firmware dropdown as `category/device [env]`. The scanner uses `firmware.bin` presence as the marker for a valid build.

You can also browse for an arbitrary `.bin` via **Browse custom firmware** — it auto-detects sibling `bootloader.bin` and `partitions.bin` in the same directory.

**Flash addresses** (configurable in Settings, ESP32 defaults shown):

| File | Address |
| --- | --- |
| bootloader.bin | `0x0` |
| partitions.bin | `0x8000` |
| firmware.bin | `0x10000` |

For ESP32-S3/C3 use `0x0` for bootloader (same); for ESP32-S2 use `0x1000`. Adjust to match your target.

### Post-Flash Configuration

Two mutually exclusive modes for baking per-device config in:

#### JSON RPC mode (runtime config)

Works if your firmware implements a JSON command interface over the USB serial port.

Flow:

1. esptool transport is released, node-serialport opens the same port at the configured baud (default `115200`).
2. **DTR is asserted HIGH** — required for ESP32-C3/S3 HWCDC, which gates TX on host DTR.
3. The **ping command** (default `{"ping":1}`) is sent every `pingInterval` ms until a response matches `readyResponse` (default `ready == true`) or `readyTimeout` (default 15 s) expires.
4. For each item, `commandTemplate` is rendered with `{{key}}` and `{{value}}` substitutions and sent. Example default:
   ```
   {"set":{"{{key}}":{{value}}}}
   ```
5. Each response is validated against `expectedResponse` (default `success == true`). Supports nested paths (e.g. `config.status == "ok"`).

Per-item override: an item may set its own `templateString` to override the global `commandTemplate`.

#### NVS partition mode (flash-time config)

Generates an ESP-IDF-compatible **NVS v2 partition image** in memory and flashes it at `partitionOffset` alongside firmware. No running firmware required. Supported types:

- `u8` / `i8` / `u16` / `i16` / `u32` / `i32`
- `string`

Types are auto-inferred from JS values if not specified. Default namespace `config`, offset `0x9000`, size `0x6000` (24 KB — fits the ESP-IDF default NVS partition).

### Serial Numbers

- Format: `PREFIX-NNNNNN` (zero-padded 6 digits) by default — e.g., `FC-000042`.
- **Peek-then-commit**: the renderer reserves the next serial *before* flashing (so it can be written into the NVS/JSON items and rendered on the label), and the counter is only committed after a successful flash. Failed flashes don't burn numbers.
- Optional `serialWriteToDevice` flag writes the serial into the device under `serialDeviceKey` (default `serial`) with optional explicit `serialDeviceType` for NVS.

### Labels

The **Label Design** tab is a WYSIWYG designer with:

- **Printer + size + orientation** picker (portrait/landscape)
- **Header** — text, font size/family, alignment, inverted (white-on-black), separator line, optional logo
- **Body** — multiple text lines with per-line font size, bold, monospace, alignment
- **Footer** — text lines + optional separator
- **QR code** — size, URL template, error correction level
- **Template variables** in any text field:

| Variable | Resolves to |
| --- | --- |
| `{serial}` | Assigned serial number |
| `{mac}` | Device MAC (colon-separated) |
| `{mac_clean}` | MAC without separators |
| `{date}` | Flash date (ISO) |
| `{product}` | Firmware name |
| `{fcc_ids}` | All FCC IDs joined |
| `{fcc_line_1}`, `{fcc_line_2}`, … | Individual FCC ID entries |
| `{config:KEY}` | Value of any post-flash config item by key |

Render path: template → SVG → PNG (via `sharp`) → Niimbot. The generator bakes in 8 px bleed compensation so edge content isn't clipped.

Templates are saved by name to `data/label-templates.json`. Use **Print Test** to validate a design without flashing a real device.

### Profiles

A **profile** is a named bundle of these fields:

- `serialPrefix`, `serialWriteToDevice`, `serialDeviceKey`, `serialDeviceType`
- `chip`, `baudRate`, `flashAddresses`
- `labelTemplate` (the full current design)

Use **Save as Profile** after configuring a product, then one-click load from the sidebar when switching between products on the bench. Stored in `data/profiles.json`.

### History

Every flash is appended to `data/history.jsonl` (one JSON record per line). Fields:

```json
{
  "timestamp": "2026-04-15T10:30:00.000Z",
  "mac": "AA:BB:CC:DD:EE:FF",
  "serial": "FC-000042",
  "firmware": "sensors/temp-sensor [release]",
  "status": "success",
  "error": null,
  "flashOnly": false
}
```

The **History** panel shows the last 50 records. Tail the JSONL file for anything older.

---

## Configuration Reference

Runtime config lives at `data/config.json` (bundled with a default copy on first install). Defaults from [main/config.js](main/config.js).

### Top-level

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `firmwareBaseDir` | string | `"../firmware"` | Root directory scanned for PlatformIO builds. |
| `selectedFirmware` | object\|null | `null` | Current firmware selection (`{ name, env, category, files }`). |
| `chip` | string | `"auto"` | Chip type — `"auto"`, `"esp32"`, `"esp32s3"`, `"esp32c3"`, etc. |
| `baudRate` | number | `921600` | Flash baud. |
| `flashAddresses` | object | `{ bootloader: "0x0", partitions: "0x8000", firmware: "0x10000" }` | Flash offsets. |
| `autoMode` | boolean | `false` | Auto flash & print on device connect. |
| `espVidPids` | array | see below | VID filter for ESP device auto-selection. |
| `serialEnabled` | boolean | `false` | Enable serial assignment. |
| `serialPrefix` | string | `"FC"` | Serial prefix. |
| `nextSerialNumber` | number | `1` | Next counter value (committed after success). |
| `serialWriteToDevice` | boolean | `false` | Write serial into device (via NVS/JSON). |
| `serialDeviceKey` | string | `"serial"` | Key used on-device. |
| `serialDeviceType` | string | `""` | NVS type override — `""` (auto/string), `u32`, etc. |
| `fccIds` | array | `[]` | Array of `{ chip, id }` for label FCC lines. |
| `activeProfile` | string\|null | `null` | Currently loaded profile name. |
| `postFlashConfig` | object | see below | Post-flash config settings. |
| `labelTemplate` | object | see below | Current label design. |

Default `espVidPids`:
```json
[
  { "vid": "303A", "name": "ESP USB Serial/JTAG" },
  { "vid": "10C4", "name": "CP210x" },
  { "vid": "1A86", "name": "CH340" },
  { "vid": "0403", "name": "FTDI" }
]
```

### `postFlashConfig`

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Run post-flash config step. |
| `mode` | string | `"json"` | `"json"` or `"nvs"`. |
| `baudRate` | number | `115200` | Post-flash serial baud (JSON mode). |
| `timeout` | number | `5000` | Per-command response timeout (ms). |
| `expectedResponse` | string | `"success == true"` | Success-condition expression. |
| `commandTemplate` | string | `{"set":{"{{key}}":{{value}}}}` | Command template. |
| `pingCommand` | string | `{"ping":1}` | Handshake ping. |
| `readyResponse` | string | `"ready == true"` | Handshake success condition. |
| `readyTimeout` | number | `15000` | Handshake overall timeout (ms). |
| `pingInterval` | number | `500` | Ping retry interval (ms). |
| `interCommandDelay` | number | `20` | Delay between successful config writes (ms); `0` disables. |
| `nvs.namespace` | string | `"config"` | NVS namespace. |
| `nvs.partitionOffset` | string | `"0x9000"` | NVS partition flash offset. |
| `nvs.partitionSize` | string | `"0x6000"` | NVS partition size. |
| `items` | array | `[]` | Items to write (see below). |

Item shape (both modes accept the common fields; NVS-only fields are ignored in JSON mode and vice versa):

```js
{
  key: "wifi_ssid",
  value: "FactoryNet",
  // JSON mode only:
  templateString: "",          // override commandTemplate per-item
  // NVS mode only:
  nvsType: "string"            // u8|i8|u16|i16|u32|i32|string (optional; auto-inferred)
}
```

### `labelTemplate`

See the [Labels](#labels) section for the full field set. Key fields:

| Key | Description |
| --- | --- |
| `printer` | Printer key (e.g., `"niimbot-b21-pro"`). |
| `labelSize` | Size ID (e.g., `"50x30"`). |
| `orientation` | `"landscape"` or `"portrait"`. |
| `header` | `{ text, fontSize, fontFamily, inverted, separator, alignment, logo }`. |
| `lines` | Array of body line objects. |
| `lineSpacing` | Vertical gap between body lines (px). |
| `qr` | `{ enabled, size, urlTemplate, errorCorrection }`. |
| `footer` | `{ lines, fontSize, separatorLine, alignment }`. |

---

## Architecture

```
┌──────────────────────────────┐
│  Renderer (Chromium)         │
│  ┌─────────────────────┐     │
│  │ app.js              │ ── Web Serial (esptool-js) ──► ESP32
│  │  ├─ flasher.js      │                                  │
│  │  └─ UI / pipeline   │                                  │
│  └─────────┬───────────┘                                  │
│            │ window.api (IPC via preload)                 │
└────────────┼───────────────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────────────┐
│  Main (Node.js)                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ipc-handlers.js — IPC surface                        │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ programmer.js — post-flash orchestrator              │  │
│  │ serial-config.js ── node-serialport ──► ESP32 (JSON) │  │
│  │ nvs-image.js — in-memory NVS partition builder       │  │
│  │ serial-number.js — peek / commit counter             │  │
│  │ label-generator.js — template → SVG → PNG (sharp)    │  │
│  │ label-printer.js ── niimbotjs ──► Niimbot printer    │  │
│  │ printer-registry.js — printer/size tables            │  │
│  │ firmware-scanner.js — PlatformIO scanner             │  │
│  │ history.js / profiles.js / label-templates.js        │  │
│  │ config.js — data/config.json load/save               │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Why two serial paths?** esptool-js uses Web Serial in the renderer for flashing (it needs the raw low-level signal control esptool-js provides). Post-flash JSON config uses node-serialport in main because Windows COM ports behave more reliably there (especially DTR assertion for HWCDC) and it avoids re-requesting Web Serial permissions.

### Key modules

| File | Role |
| --- | --- |
| [main/index.js](main/index.js) | Electron entry, window/tray, Web Serial permission handlers. |
| [main/ipc-handlers.js](main/ipc-handlers.js) | All IPC handler registrations. |
| [main/programmer.js](main/programmer.js) | Post-flash pipeline orchestrator (EventEmitter). |
| [main/firmware-scanner.js](main/firmware-scanner.js) | PlatformIO directory scanner. |
| [main/serial-config.js](main/serial-config.js) | JSON-RPC-over-serial post-flash config. |
| [main/nvs-image.js](main/nvs-image.js) | NVS v2 partition image builder. |
| [main/label-generator.js](main/label-generator.js) | Template → SVG → PNG rendering. |
| [main/label-printer.js](main/label-printer.js) | Persistent Niimbot connection, print queue. |
| [main/printer-registry.js](main/printer-registry.js) | Printer and label-size tables. |
| [renderer/js/flasher.js](renderer/js/flasher.js) | esptool-js Web Serial wrapper. |
| [renderer/js/app.js](renderer/js/app.js) | UI, device list, pipeline, auto mode. |
| [preload/preload.js](preload/preload.js) | Context-isolated IPC bridge (`window.api`). |
| [scripts/patch-niimbotjs.js](scripts/patch-niimbotjs.js) | Postinstall Niimbot patches (see [docs/niimbot-patches.md](docs/niimbot-patches.md)). |

---

## IPC API

All exposed on `window.api` in the renderer. See [preload/preload.js](preload/preload.js) for the authoritative list.

**Config** — `getConfig()`, `updateConfig(updates)`, `exportConfig(data, defaultName)`, `importConfig()`

**Firmware** — `getFirmware()`, `readFirmwareFile(path)`, `selectDirectory()`, `selectFirmwareFile()`

**Flashing pipeline** — `peekNextSerial()`, `postFlash({ mac, port, firmware, flashOnly, configResults, reservedSerial })`, `sendSerialConfig(opts)`, `buildNvsImage(opts)`

**Labels** — `previewLabel({ template, variables })`, `printLabel({ pngBase64, density })`, `getPrinterStatus()`, `getPrinterInfo()`, `connectPrinter()`

**Registry** — `getPrinterTypes()`, `getLabelSizes()`

**Templates** — `listLabelTemplates()`, `saveLabelTemplate(name, template)`, `loadLabelTemplate(name)`, `deleteLabelTemplate(name)`

**Profiles** — `listProfiles()`, `saveProfile(name, data)`, `loadProfile(name)`, `deleteProfile(name)`

**Events** — `onStatus(cb)`, `onError(cb)`, `onPortAdded(cb)`, `onPortRemoved(cb)`, `onConfigLog(cb)`

**Window** — `windowMinimize()`, `windowMaximize()`, `windowClose()`

---

## Development

```bash
npm install          # Install deps + run niimbotjs patch
npm run dev          # Launch with DevTools open
npm test             # Run vitest suite
npm run test:watch   # Watch mode
npm run rebuild      # electron-rebuild (after Node/Electron upgrades)
```

### Project layout

```
burntag/
├── main/           # Electron main process
├── preload/        # IPC bridge
├── renderer/       # UI (HTML/CSS/JS, no framework)
├── data/           # Runtime data (config, templates, profiles, history, debug labels)
├── scripts/        # postinstall patches
├── __tests__/      # vitest tests for main-process modules
└── dist/           # electron-builder output
```

### Tests

Vitest covers main-process logic:

- [`config.test.js`](__tests__/config.test.js) — config defaults and merging
- [`firmware-scanner.test.js`](__tests__/firmware-scanner.test.js) — PlatformIO scanner
- [`history.test.js`](__tests__/history.test.js) — JSONL history
- [`label-generator.test.js`](__tests__/label-generator.test.js) — template rendering
- [`nvs-image.test.js`](__tests__/nvs-image.test.js) — NVS partition builder
- [`profiles.test.js`](__tests__/profiles.test.js) — profile save/load
- [`serial-number.test.js`](__tests__/serial-number.test.js) — peek/commit counter

Renderer and printer I/O aren't covered by unit tests — validate those with the UI.

---

## Building

```bash
npm run build        # Windows NSIS installer → dist/
npm run build:dir    # Unpacked build for smoke testing
```

Build config is in [`package.json`](package.json) under `"build"`:

- App ID: `com.freshcontrols.burntag`
- Product name: `BurnTag`
- Target: Windows NSIS, one-click, per-user install
- Bundled: `main/**`, `preload/**`, `renderer/**`, pruned `node_modules/**`
- Extra resources: `data/config.json` (seeds defaults on first run)

Output lands in `dist/` as `BurnTag Setup <version>.exe`.

---

## Troubleshooting

**Device doesn't appear in the device list.**
Check that the VID is in `espVidPids`. Add it in Settings if you're using an unusual USB bridge. Windows may also need a driver for CP210x or CH340 — install from the chip vendor.

**Auto Mode fires but flashing times out.**
The 2 s delay after the Web Serial `connect` event may not be long enough for your USB bridge's driver to fully initialize. Increase the delay in [renderer/js/app.js](renderer/js/app.js) (`setTimeout(..., 2000)`), or use manual Flash & Print.

**Post-flash JSON config hangs on handshake.**
Confirm your firmware responds to the `pingCommand` with a message matching `readyResponse`. For ESP32-C3/S3 over HWCDC, the app asserts DTR HIGH automatically — no action needed. If the port moved to a different COM after reset, reconnect and retry.

**Every other print fails / no print at all.**
Re-run `npm install` to make sure [`scripts/patch-niimbotjs.js`](scripts/patch-niimbotjs.js) applied. The patch fixes B21 Pro status polling that otherwise sees stale progress values from the previous print.

**MD5 verification fails.**
Usually means a USB cable that can't sustain 921600 baud. Drop `baudRate` to 460800 or 230400 in Settings.

**NVS image doesn't take effect.**
Confirm your firmware's partition table places NVS at the offset/size configured in `postFlashConfig.nvs` (defaults match the ESP-IDF default partition table).

---

## Further Documentation

Deeper docs in [`docs/`](docs/):

- [docs/architecture.md](docs/architecture.md) — main-vs-renderer split, why two serial paths, pipeline sequencing
- [docs/firmware-layout.md](docs/firmware-layout.md) — PlatformIO scanner rules and custom-firmware flow
- [docs/post-flash-config.md](docs/post-flash-config.md) — JSON RPC and NVS modes in detail
- [docs/labels.md](docs/labels.md) — template variables, renderer internals, printer quirks
- [docs/profiles.md](docs/profiles.md) — what a profile saves and how it loads
- [docs/niimbot-patches.md](docs/niimbot-patches.md) — what `patch-niimbotjs.js` changes and why

---

## License

Proprietary — internal to Fresh Controls. Do not redistribute.
