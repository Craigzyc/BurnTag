# Firmware Layout

BurnTag's firmware scanner is opinionated — it expects a specific PlatformIO-style directory structure under the configured base directory. You can also bypass the scanner entirely by browsing for an arbitrary `firmware.bin`.

## Scanner rules

Source: [main/firmware-scanner.js](../main/firmware-scanner.js).

The scanner walks `<firmwareBaseDir>` looking for two fixed top-level categories:

- `sensors/`
- `gateway/`

Any other top-level folders are ignored. Inside each category:

- Every direct subfolder is treated as a **device** (name = folder name).
- Each device is checked for `.pio/build/<env-name>/` subdirectories.
- Each env directory is considered a **build** if it contains `firmware.bin`. Presence of `firmware.bin` is the sole marker — missing it, the env is skipped.
- `bootloader.bin` and `partitions.bin` in the same env directory are included if present; otherwise the relevant slots are flashed only if the user has their own custom addresses.

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

Configurable per user in **Settings → Flash Addresses**. Defaults are ESP32-standard:

| File | Default offset |
| --- | --- |
| bootloader.bin | `0x0` |
| partitions.bin | `0x8000` |
| firmware.bin | `0x10000` |

Chip-specific adjustments:

| Chip | bootloader offset |
| --- | --- |
| ESP32 | `0x1000` *(some boards — check your datasheet)* |
| ESP32-S2 | `0x1000` |
| ESP32-S3 / C3 / C6 / H2 | `0x0` |

The partition and firmware addresses are normally the same across ESP32 variants, but always verify against your chip's ROM layout.

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
