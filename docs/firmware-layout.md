# Firmware Layout

BurnTag's firmware scanner is a smart-scan: point it at any folder and it figures out what kind of layout it is. You can also bypass the scanner entirely by browsing for an arbitrary `firmware.bin`, or by browsing for any one of the three component files independently.

## Scanner rules

Source: [main/firmware-scanner.js](../main/firmware-scanner.js).

`scanFirmwareDir(dir)` returns `{ kind, files? | builds? }` and tries three layouts in order:

1. **Single-build folder** (`kind: 'single'`) — `dir` directly contains `firmware.bin`. Sibling `bootloader.bin` / `partitions.bin` are auto-included if present, null otherwise.
2. **PlatformIO multi-env** (`kind: 'multi'`) — `dir/.pio/build/<env>/firmware.bin` exists for one or more envs. Each env becomes one entry labeled `[env]`.
3. **Legacy nested layout** (`kind: 'multi'`) — `dir/<category>/<device>/.pio/build/<env>/firmware.bin` (where category is `sensors` or `gateway`). Each match is labeled `category/device [env]`.
4. **Empty** (`kind: 'empty'`) — none of the above turned anything up.

Each component (boot, partitions, firmware) is independently selectable in the sidebar — checkbox toggles whether it's flashed, and the per-row Browse button replaces just that file.

## Expected layout

```
<firmwareBaseDir>/
├── sensors/
│   ├── temp-sensor/
│   │   └── .pio/build/
│   │       ├── esp32-release/
│   │       │   ├── bootloader.bin
│   │       │   ├── partitions.bin
│   │       │   └── firmware.bin
│   │       └── esp32-debug/
│   │           └── firmware.bin      ← bootloader/partitions reused from a previous flash
│   └── humidity-sensor/
│       └── .pio/build/
│           └── esp32s3-release/
│               ├── bootloader.bin
│               ├── partitions.bin
│               └── firmware.bin
└── gateway/
    └── main-gateway/
        └── .pio/build/
            └── esp32c3-release/
                ├── bootloader.bin
                ├── partitions.bin
                └── firmware.bin
```

This matches the default layout PlatformIO produces for multi-environment projects. Each environment in your `platformio.ini` becomes one build in the BurnTag firmware dropdown.

## UI display format

Each discovered build appears in the firmware dropdown as:

```
<category>/<device> [<env>]
```

For the tree above that would be:

- `sensors/temp-sensor [esp32-release]`
- `sensors/temp-sensor [esp32-debug]`
- `sensors/humidity-sensor [esp32s3-release]`
- `gateway/main-gateway [esp32c3-release]`

## Configuring the base directory

Set in **Settings → Firmware base directory**, or directly in `data/config.json`:

```json
{
  "firmwareBaseDir": "C:\\Projects\\my-firmware"
}
```

Relative paths are resolved relative to the app's working directory (usually the app install dir). Absolute paths are recommended.

## Custom firmware (bypass the scanner)

If your firmware lives outside the `sensors/`/`gateway/` convention, use **Browse custom firmware**. Pick any `firmware.bin` and BurnTag will:

1. Use that file for the firmware address slot.
2. Look for `bootloader.bin` and `partitions.bin` *in the same directory* and auto-include them if present.
3. Save the selection as `selectedFirmware` in config.

The entry appears in the firmware dropdown as a pinned custom selection. You can still switch back to a scanned build any time.

## Flash addresses

Lives inside the **Firmware** sidebar fieldset alongside the file selectors. Selecting a chip from the dropdown writes that chip's defaults into the three address inputs:

| Chip | bootloader | partitions | firmware |
| --- | --- | --- | --- |
| ESP32 | `0x1000` | `0x8000` | `0x10000` |
| ESP32-S2 | `0x1000` | `0x8000` | `0x10000` |
| ESP32-S3 / C3 / C6 / H2 | `0x0` | `0x8000` | `0x10000` |

The fields stay editable so an unusual board can be flashed without changing the chip dropdown. The **Detect** button connects to a plugged-in device once, identifies the chip, and applies that chip's defaults — useful at the start of a batch run.

## NVS partition

If you use **NVS post-flash config mode**, a fourth region is flashed at the configured NVS partition offset (default `0x9000`). Make sure your firmware's partition table reserves that range for NVS — the ESP-IDF default `partitions.csv`:

```csv
# Name,   Type, SubType, Offset,  Size
nvs,      data, nvs,     0x9000,  0x6000
phy_init, data, phy,     0xf000,  0x1000
factory,  app,  factory, 0x10000, 1M
```

matches BurnTag's NVS defaults exactly. See [post-flash-config.md](post-flash-config.md#nvs-partition-mode) for NVS details.

## Troubleshooting

**Firmware dropdown is empty.**
- Verify `firmwareBaseDir` points at the right place.
- Confirm the directory contains a `sensors/` or `gateway/` subfolder (those two names are hardcoded).
- Confirm at least one `<device>/.pio/build/<env>/firmware.bin` exists under one of those categories.

**A build is missing from the dropdown.**
- The scanner requires `firmware.bin`. If a build produced only `app.bin` (name mismatch), rename it or update the scanner. An env without `firmware.bin` is skipped silently.

**Wrong addresses flashed.**
- Check **Settings → Flash Addresses** against your target chip. The defaults target ESP32 — ESP32-S2 in particular needs `0x1000` for bootloader.
