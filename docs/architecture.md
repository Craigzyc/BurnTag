# Architecture

BurnTag is an Electron app split into three process contexts (main, preload, renderer) with two independent serial connection paths to hardware.

## High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (Chromium)                                         │
│                                                             │
│  app.js ─────────────────────────────┐                      │
│    • device list, pipeline UI         │ window.api (IPC)    │
│    • event listeners for ports        │                      │
│  flasher.js ─── esptool-js ──────┐    │                      │
│    • Web Serial flash path       │    │                      │
│  printer.js ─────────────────────┼────┤                      │
│    • IPC delegate (not Web Serial)│    │                      │
└──────────────────────────────────┼────┼──────────────────────┘
                                   │    │
           Web Serial (low-level)  │    │  IPC (contextBridge)
                                   │    │
                                   ▼    ▼
                              ┌────┴────────────────┐
                              │ ESP32 bootloader    │
                              └─────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Main (Node.js)                                              │
│                                                             │
│  ipc-handlers.js   ←──── all window.api calls land here     │
│       │                                                      │
│       ├─► programmer.js ── post-flash orchestrator           │
│       │      ├─ serial-number.js (peek / commit counter)     │
│       │      ├─ label-generator.js → sharp → PNG             │
│       │      └─ history.js (JSONL append)                    │
│       │                                                      │
│       ├─► serial-config.js ── node-serialport ──┐            │
│       │     (JSON RPC post-flash config)         │            │
│       │                                          ▼            │
│       ├─► label-printer.js ── niimbotjs ──► Niimbot USB      │
│       │     (persistent printer connection)                  │
│       │                                                      │
│       ├─► firmware-scanner.js  (PlatformIO directory walk)   │
│       ├─► nvs-image.js          (in-memory NVS v2 builder)   │
│       ├─► label-templates.js / profiles.js                   │
│       └─► config.js             (data/config.json load/save) │
└─────────────────────────────────────────────────────────────┘
```

## Why two serial paths?

Firmware flashing and post-flash JSON RPC config both talk to the ESP32 over the same USB-to-serial port, but through two different APIs:

| Concern | Path | Why |
| --- | --- | --- |
| **Flashing** | Web Serial (renderer) via `esptool-js` | esptool-js is written against Web Serial and needs tight DTR/RTS sequence control for the bootloader handshake. The Electron renderer has Web Serial with custom permission handlers that auto-select ESP devices by VID. |
| **Post-flash JSON config** | node-serialport (main) | Windows COM port behavior is more predictable in Node than in Chromium's Web Serial layer — especially DTR assertion, which is required for ESP32-C3/S3 HWCDC to deliver bytes. Re-using Web Serial after a flash would also re-prompt permissions and fight with Chromium's port lifecycle. |
| **Label printing** | node-serialport via `niimbotjs` (main) | Niimbot B21 Pro is a composite USB device that Web Serial doesn't handle reliably. Printing stays in main as a persistent connection that lasts the lifetime of the app. |

The renderer's [printer.js](../renderer/js/printer.js) is a thin IPC delegate — it just base64-encodes the PNG and forwards to `window.api.printLabel`.

## The flash pipeline

A full **Flash & Print** runs these steps, in order:

| # | Step | Where | Notes |
| --- | --- | --- | --- |
| 1 | Reading MAC | renderer (esptool-js) | Happens as part of `loader.main()` chip detect + stub upload. |
| 2 | Flashing firmware | renderer (esptool-js) | `writeFlash` with compression and MD5 verify. |
| 3 | Verifying | renderer | MD5 match is done inline by esptool-js during write. |
| 4 | Assigning serial | main (programmer.js) | Only if `serialEnabled`. Renderer peeked earlier; main commits. |
| 5 | Generating label | main (label-generator.js) | Template → SVG → PNG via `sharp`. |
| 6 | Printing label | main (label-printer.js) | Renderer signals `needsPrint`; it calls `window.api.printLabel` with the PNG. |
| 7 | Complete | both | History record appended; pipeline marked done. |

**Post-flash config** slots between steps 3 and 4:

- **JSON mode**: renderer hands the port back (disconnects esptool transport), main opens it via node-serialport, runs handshake + commands.
- **NVS mode**: the NVS partition image is prepended to the esptool `fileArray` in step 2 — it's flashed as a normal region. No serial roundtrip.

**Flash Only** runs only steps 1–3, then jumps to step 7 and records a history entry with `flashOnly: true`.

## Serial reservation protocol

The renderer needs the serial number *before* flashing (to bake it into NVS/JSON items and render it on the label), but the counter should only increment on success. The protocol:

1. Renderer calls `peekNextSerial()` — returns the formatted next serial (e.g. `FC-000042`) **without** mutating config.
2. Renderer embeds that value in `effectiveItems` (NVS or JSON) and keeps it aside for label rendering.
3. Flash runs.
4. Renderer calls `postFlash({ reservedSerial, ... })`.
5. `programmer.completePostFlash` calls `getNextSerial(cfg)` which reads *and* increments the counter, then persists config. It also sanity-checks that the committed serial equals `reservedSerial`.
6. On any earlier failure, the counter is untouched — the next successful flash reuses the same number.

This is why `peek` and `getNext` live in the same module — they share the format function but only one mutates state.

## Web Serial permission handling

`main/index.js` installs three handlers on the default session to make Web Serial work silently inside Electron:

- **`select-serial-port`** — auto-picks the first port whose VID matches the ESP filter list (or Niimbot VID `3513` if the request came unfiltered, which the app interprets as a print request). Skips the browser's built-in picker dialog.
- **`setDevicePermissionHandler`** — grants serial access for any matching VID without prompting the user.
- **`setPermissionCheckHandler`** — allows the `serial` permission class.

The ESP VID list is pulled from `config.espVidPids` so users can add bridges without rebuilding.

## System tray & Auto Mode

The app minimizes to the system tray instead of quitting on window close (`app.isQuitting` flag distinguishes true quit from close-to-tray). The tray menu has a synced **Auto-Program** checkbox that mirrors `config.autoMode`.

Auto Mode in the renderer:

```js
navigator.serial.addEventListener('connect', (event) => {
  // ...filter by VID...
  if (config.autoMode) {
    setTimeout(() => flashDevice(key, { print: true }), 2000);
  }
});
```

The 2-second delay gives the USB-serial driver time to enumerate the port before esptool tries to sync. On slow systems or unusual bridges, this may need to be longer.

## Module map

See the [README Architecture section](../README.md#key-modules) for the authoritative module list. Every module in `main/` is a single-purpose, exported-functions-only module — the only class is `Programmer` in [programmer.js](../main/programmer.js), which needs to emit events to the renderer as the post-flash pipeline progresses.
