# Firmware Section Redesign

Date: 2026-04-30

## Goals

1. Fix the packaged-build bug where **Browse .bin** opens the picker but the selection never appears.
2. Consolidate firmware-related UI (chip, addresses, files) into a single sidebar section.
3. Drive flash addresses from the selected chip with editable defaults.
4. Allow per-component selection of bootloader / partitions / firmware: independent browse, independent enable/disable, smart auto-detection.
5. Add a one-shot **Detect** button that reads the chip from a connected device and locks in the chip + address defaults.
6. Replace the rigid `sensors/` + `gateway/` PlatformIO walker with a smart scanner.

## Non-Goals

- No changes to post-flash config, serial numbering, label design, or printer logic.
- No changes to the actual `connectAndFlash` mechanics in `flasher.js`.
- No multi-device chip detection — Detect uses the first connected ESP port.

## Bug Fix: persist runtime data outside `app.asar`

### Root cause

`main/index.js` resolves `DATA_DIR` via `path.join(import.meta.dirname, '..', 'data')`. In the packaged build, that lands inside `resources/app.asar/data/`, which is read-only. `saveConfig` throws on the rename, the `update-config` IPC handler propagates the rejection, and the renderer's `await window.api.updateConfig({ selectedFirmware: result })` rejects before the dropdown / info code runs. So the picker works but nothing visibly updates.

### Fix

Move runtime state to Electron's user-data path:

- `app.getPath('userData')/config.json`
- `app.getPath('userData')/history.jsonl`
- `app.getPath('userData')/profiles.json`
- `app.getPath('userData')/label-templates.json`

On first launch, if `config.json` is missing in user-data, copy `process.resourcesPath/data/config.json` (already shipped via `extraResources`) to seed it. Other files start empty.

Dev mode (detected via `app.isPackaged === false`) keeps using the in-tree `data/` directory so the existing development workflow is undisturbed. This avoids the user-data path becoming polluted with dev-only artifacts.

## Sidebar Layout

### Removed

- Standalone **Flash Addresses** fieldset.
- Standalone **Chip / Baud** row above flash addresses.

### Replaced with: single "Firmware" fieldset

```
┌─ Firmware ──────────────────────────────────────────┐
│ [Scan Dir] [Browse Files...]   Builds: [▾] [Load]   │
│                                                      │
│ ☑ Bootloader  [0x1000]  …/bootloader.bin  [Browse]  │
│ ☑ Partitions  [0x8000]  …/partitions.bin  [Browse]  │
│ ☑ Firmware    [0x10000] …/firmware.bin    [Browse]  │
│                                                      │
│ Chip [ESP32-S3 ▾] [Detect]   Baud [921600 ▾]        │
└──────────────────────────────────────────────────────┘
```

The **Builds** dropdown is hidden by default; it appears only when a Scan Dir returns multiple builds (PlatformIO multi-env or nested layout).

### Sidebar width

Bumped from `270px` to `320px`. Per-component rows use a flex layout: `[checkbox] [address ~70px] [path 1fr, ellipsis] [Browse btn]`.

## Chip Selection & Address Defaults

### Chip dropdown

`Auto` is removed. Options: `ESP32`, `ESP32-S2`, `ESP32-S3`, `ESP32-C3`, `ESP32-C6`, `ESP32-H2`.

Existing configs with `chip: "auto"` are migrated on load to `esp32s3` (the most common modern default). A one-line log entry notes the migration.

### CHIP_DEFAULTS

```js
const CHIP_DEFAULTS = {
  esp32:    { bootloader: '0x1000', partitions: '0x8000', firmware: '0x10000' },
  esp32s2:  { bootloader: '0x1000', partitions: '0x8000', firmware: '0x10000' },
  esp32s3:  { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
  esp32c3:  { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
  esp32c6:  { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
  esp32h2:  { bootloader: '0x0',    partitions: '0x8000', firmware: '0x10000' },
};
```

Changing the chip dropdown writes the chip's defaults into the three address inputs. Inputs remain editable so a one-off non-standard board can still be flashed without changing the chip.

### Detect button

Next to the chip dropdown. Behavior:

1. Find the first connected ESP port (granted, with a known VID).
2. Open a `Transport`, instantiate an `ESPLoader`, call `loader.main()` to read the chip identifier.
3. Map the result to one of the chip dropdown values.
4. Set the chip dropdown, apply that chip's `CHIP_DEFAULTS` to the address fields, persist via `update-config`.
5. Disconnect.

Failure paths (no device, multiple devices, connect failure) log to the flash output panel and leave the form unchanged. Multiple devices are tolerated by picking the first one and logging which one was used.

## Per-Component File Selection

### Data model

New: `config.flashEnabled = { bootloader: boolean, partitions: boolean, firmware: boolean }`. Default `{ true, true, true }`.

`config.selectedFirmware.files` keeps its current shape `{ bootloader, partitions, firmware }` where any value can be null.

### UI behavior

- Each component row has its own checkbox, address input, path display, and Browse button.
- Browse on a row opens a file picker scoped to that slot only (replaces just that path; does not auto-detect siblings).
- Checkbox unchecked → that component is excluded from `fileArray` in `flashDevice` even if a path is set. The path is preserved.
- A row whose checkbox is on but path is empty causes a validation message before flashing starts.
- After Scan Dir or Browse Files... fills the slots, each checkbox is set based on whether that file was found (found → checked; missing → unchecked, path empty).

### Flash assembly

`flashDevice` builds `fileArray` by iterating the three components and skipping any where `flashEnabled[component] === false` or `files[component]` is null. Addresses come from `config.flashAddresses`, which is now whatever the user has in the form (chip-default or hand-edited).

## Smart Scan Dir

Rewrites `main/firmware-scanner.js` exports.

### New API

```js
scanFirmwareDir(dir) → {
  kind: 'single' | 'multi' | 'empty',
  // when kind === 'single':
  files?: { bootloader: string|null, partitions: string|null, firmware: string|null },
  // when kind === 'multi':
  builds?: [{ label: string, files: { bootloader, partitions, firmware } }, ...],
}
```

### Logic

1. **Single-build folder** — if `dir` contains `firmware.bin` directly, return `kind: 'single'` with sibling `bootloader.bin` / `partitions.bin` (null when missing).
2. **PlatformIO multi-env** — else, look for `dir/.pio/build/<env>/firmware.bin`. Each env becomes one entry in `builds` with label `[env]`.
3. **Legacy nested layout** — else, walk `dir/<category>/<device>/.pio/build/<env>/firmware.bin`. Each match becomes one entry labeled `category/device [env]`.
4. **Empty** — none of the above turns up anything.

The renderer:
- `kind: 'single'` → fills the three slots immediately, sets checkboxes by file presence, hides Builds dropdown.
- `kind: 'multi'` → shows Builds dropdown populated with the labels; user picks one and the slots fill, checkboxes set by presence.
- `kind: 'empty'` → logs `No firmware found under <dir>`, leaves form unchanged.

### IPC

- `select-directory` (existing) for the picker.
- `scan-firmware-dir` (new) replaces the old `get-firmware`. Returns the structured result above.
- `select-firmware-file` (existing) accepts an optional `slot` argument (`'bootloader' | 'partitions' | 'firmware'`). When `slot === 'firmware'` (or omitted, for backward compat), it auto-detects siblings as today. For other slots, it returns just `{ slot, path }` with no sibling detection.

`browseFirmwareBtn` (the existing top-level "Browse Files...") continues to call without a slot and behaves like today. The new per-row Browse buttons pass their slot.

## Files Affected

### Modified

- [main/index.js](../../../main/index.js) — change `DATA_DIR` to use `app.getPath('userData')` when packaged; seed from `process.resourcesPath/data/`.
- [main/config.js](../../../main/config.js) — chip migration `auto` → `esp32s3`; default `flashEnabled`.
- [main/ipc-handlers.js](../../../main/ipc-handlers.js) — replace `get-firmware`; widen `select-firmware-file` to take a slot; new `scan-firmware-dir`; ensure `update-config` accepts `flashEnabled`.
- [main/firmware-scanner.js](../../../main/firmware-scanner.js) — rewrite to the new `scanFirmwareDir` API.
- [preload/preload.js](../../../preload/preload.js) — expose new IPC names; add slot arg.
- [renderer/index.html](../../../renderer/index.html) — replace the three sidebar fieldsets (Firmware, Chip/Baud row, Flash Addresses) with the single Firmware fieldset described above.
- [renderer/js/app.js](../../../renderer/js/app.js) — chip change → defaults; Detect handler; per-component checkboxes wired into `flashDevice`; new scan flow; remove the standalone Flash Addresses + Chip/Baud handlers.
- [renderer/css/style.css](../../../renderer/css/style.css) — sidebar width 320px; new component-row styles.

### Untouched

- `flasher.js` — internal flash logic stays as-is; only the `fileArray` it receives changes.
- Post-flash config, serial numbering, label design.

## Migration

- On config load: if `chip === 'auto'`, set to `esp32s3` and log once.
- On config load: if `flashEnabled` is missing, default it to `{ bootloader: true, partitions: true, firmware: true }`.
- Existing `flashAddresses` values are preserved as-is.
- Profiles saved before the change are loaded as-is; chip migration applies the same way.

## Testing

- Dev: Browse Files… → all three slots fill, all three checkboxes on.
- Dev: Browse Files… → uncheck Bootloader → flash → flash log shows only partitions + firmware regions written.
- Dev: Scan Dir on a single `.pio/build/<env>/` → slots fill from that folder.
- Dev: Scan Dir on a project with multiple envs → Builds dropdown populated; picking one fills slots.
- Dev: Scan Dir on legacy `sensors/<device>/.pio/build/<env>/` → builds list grouped as `category/device [env]`.
- Dev: change chip → addresses update to that chip's defaults; manual edit persists for that session until chip is changed again.
- Dev: Detect with one ESP plugged in → chip + addresses update; with no ESP plugged in → flash log shows the failure.
- Built: Browse Files… → selection appears in the dropdown / info text and survives a relaunch.
