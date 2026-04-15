# Profiles

A **profile** is a named bundle of BurnTag settings for a specific product. Switching profiles flips the app's entire programming config in one click, so you can move between product SKUs on the same bench without re-entering firmware paths, serial schemes, or label designs.

Source: [main/profiles.js](../main/profiles.js). Storage: `data/profiles.json`.

## What a profile saves

Exactly these fields, taken from the top-level config at save time:

| Field | From config | Purpose |
| --- | --- | --- |
| `serialPrefix` | `config.serialPrefix` | Serial number prefix. |
| `serialWriteToDevice` | `config.serialWriteToDevice` | Whether to write serial into NVS/JSON. |
| `serialDeviceKey` | `config.serialDeviceKey` | Key used on-device. |
| `serialDeviceType` | `config.serialDeviceType` | NVS type override. |
| `chip` | `config.chip` | Chip type (`auto`, `esp32`, etc.). |
| `baudRate` | `config.baudRate` | Flash baud. |
| `flashAddresses` | `config.flashAddresses` | Bootloader/partitions/firmware offsets. |
| `labelTemplate` | `config.labelTemplate` | Full current label design (deep-cloned). |

## What a profile does **not** save

- `nextSerialNumber` (the counter) — profile switches never reset or reuse serial counters.
- `firmwareBaseDir`, `selectedFirmware` — firmware selection is cross-profile so you can reflash a different product without losing the active profile.
- `postFlashConfig` — post-flash items live at the top level, not per-profile. (This may change; file an issue if per-profile post-flash config matters for your workflow.)
- `autoMode`, `espVidPids`, `fccIds` — app-wide settings.

## File format

`data/profiles.json` is a single object keyed by profile name:

```json
{
  "Temp Sensor v2": {
    "settings": {
      "serialPrefix": "TS",
      "serialWriteToDevice": true,
      "serialDeviceKey": "serial",
      "serialDeviceType": "",
      "chip": "esp32s3",
      "baudRate": 921600,
      "flashAddresses": { "bootloader": "0x0", "partitions": "0x8000", "firmware": "0x10000" },
      "labelTemplate": { "printer": "niimbot-b21-pro", "labelSize": "50x30", "orientation": "landscape", ... }
    },
    "updatedAt": "2026-04-15T10:30:00.000Z"
  },
  "Gateway Main": {
    "settings": { ... },
    "updatedAt": "2026-04-14T16:20:00.000Z"
  }
}
```

Writes are atomic: new content goes to `profiles.json.tmp`, then rename.

## Operations

All via `window.api` from the renderer:

| Call | Effect |
| --- | --- |
| `listProfiles()` | Returns `[{ name, chip, fccCount, updatedAt }, ...]` for the sidebar list. |
| `saveProfile(name, data)` | Picks out `PROFILE_KEYS` from `data` and writes under `name`. Overwrites if exists. |
| `loadProfile(name)` | Returns `{ settings, updatedAt }` or `null`. The renderer applies `settings` into `config` via `updateConfig`. |
| `deleteProfile(name)` | Removes the entry and rewrites the file. |

`activeProfile` on the top-level config tracks the currently loaded profile name (just for UI display).

## Workflow

1. Configure everything for a product: chip, flash addresses, serial scheme, label template.
2. Click **Save as Profile** in the sidebar, give it a name.
3. Switch to a different product's setup, save it as a separate profile.
4. Toggle between them with the profile list in the sidebar.

## Backup and sharing

Profiles are plain JSON — copy `data/profiles.json` between machines to share. The app also supports config export/import via **Settings → Export Config** / **Import Config**, which includes profiles alongside other settings.

## Troubleshooting

**Profile won't load.**
Profile names are keys in a JSON object — a malformed `profiles.json` breaks all profiles. `readStore` returns `{}` on any parse error and silently suppresses it, so if profiles stop appearing, check the file for syntax errors.

**Label template didn't come with the profile.**
Confirm the template was present in `config.labelTemplate` at save time. The profile grabs a snapshot — editing a label template after saving a profile does not update the profile.

**`fccCount` shows 0 but FCC IDs are set.**
`listProfiles` reads `store[name].settings?.fccIds` — FCC IDs aren't in `PROFILE_KEYS`, so they're not stored per-profile and this field will always read as 0 from saved profiles. This is a minor UI quirk (the list view exposes the field but the save flow doesn't populate it).
