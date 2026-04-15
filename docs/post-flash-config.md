# Post-Flash Configuration

After firmware is flashed, BurnTag can write per-device configuration into the board. Two modes are available — pick whichever matches your firmware's design:

| Mode | When to use | Requires running firmware? | How it writes |
| --- | --- | --- | --- |
| **JSON RPC** | Your firmware listens for JSON commands over USB serial | Yes | node-serialport sends JSON lines to the running device |
| **NVS partition** | Your firmware reads config from the ESP-IDF NVS namespace | No | An NVS partition image is built in memory and flashed alongside firmware |

Both modes use the same `items` array — the same key/value list works in either mode (you'd just need to change how your firmware reads it).

Enable in **Settings → Post-Flash Config**, pick a mode, add items.

---

## JSON RPC mode

Source: [main/serial-config.js](../main/serial-config.js).

### Flow

1. **esptool-js releases the port.** Renderer disconnects its Web Serial transport so node-serialport can take over the COM.
2. **Hard reset via DTR pulse.** Main process opens the port briefly, pulses `DTR HIGH → LOW` (RTS held low) to force the chip out of the download stub into user firmware. This is more reliable than esptool-js's Web Serial `hardReset` on Windows for ESP32-C3/S3 USB Serial/JTAG.
3. **USB re-enumeration.** Native USB chips re-enumerate as a new device after reset. BurnTag waits 2 s, then scans `SerialPort.list()` until a port with the matching VID/PID appears (may come back on the same COM or a different one).
4. **Port open + DTR assert.** Opens the port at `baudRate`, then calls `port.set({ dtr: true, rts: false })`. **Required** for ESP32-C3/S3 HWCDC — the firmware's USB CDC layer gates TX on host DTR. Without this step, the device's output is silently dropped on Windows.
5. **Ping / handshake loop.** Sends `pingCommand` every `pingInterval` ms. Each incoming line is parsed; if it's a JSON object and matches `readyResponse`, the handshake succeeds. If `readyTimeout` elapses first, the pipeline fails with a clear error pointing at the firmware's ping handler.
6. **Send each command.** For each item, render the command template with `{{key}}` and `{{value}}` substitutions, write a line, wait up to `timeout` ms for a matching response. Validate against `expectedResponse`. Fail fast on first rejection.
7. **Close port.** Port is freed for any subsequent connections (e.g., the next device).

### Template substitution

The default `commandTemplate` is:

```
{"set":{"{{key}}":{{value}}}}
```

Applied per item, `{{value}}` is formatted as:

- String values → JSON-quoted (`"hello"`)
- Numbers / booleans / anything else → stringified without quotes

So `{ key: "wifi_ssid", value: "FactoryNet" }` becomes:

```json
{"set":{"wifi_ssid":"FactoryNet"}}
```

And `{ key: "timeout_ms", value: 500 }` becomes:

```json
{"set":{"timeout_ms":500}}
```

### Batch commands

If `commandTemplate` contains `{{items}}` (instead of `{{key}}`/`{{value}}`), BurnTag batches all items into a single command. Items are rendered as `"key1":value1,"key2":value2` and substituted in. Example template:

```
{"config":{{{items}}}}
```

Items with a per-item `templateString` override are always sent separately — they don't join the batch.

### Response validation

`expectedResponse` supports three syntaxes:

1. **Comparison expression** — `success == true`, `status == "ok"`, `result === 1`, `config.status != null`
   - Nested paths with `.` are supported (e.g., `data.result == 1`).
   - Supported operators: `==`, `===`, `!=`, `!==`.
   - Literal values: `true`, `false`, `null`, `undefined`, numbers, single- or double-quoted strings.
2. **JSON object** — `{"success":true}` does a shallow match against the response.
3. **Substring** — anything else is treated as a substring check on the raw response line.

The firmware can print debug noise alongside JSON responses; the parser only considers lines that start with `{` and end with `}` for matching. Everything else is logged but skipped.

### Required firmware contract

Your firmware needs to:

1. Respond to `pingCommand` with a JSON object that matches `readyResponse`. Typical implementation:
   ```cpp
   // Pseudocode
   if (line == "{\"ping\":1}") {
     Serial.println("{\"ready\":true}");
   }
   ```
2. Handle each configured command and respond with a JSON object matching `expectedResponse`:
   ```cpp
   if (line.startsWith("{\"set\":")) {
     // parse key/value, persist to NVS/EEPROM/etc.
     Serial.println("{\"success\":true}");
   }
   ```
3. Use `Serial.println` (or the native USB Serial equivalent) — the parser is line-based and expects each JSON object on its own line.

### Settings reference

| Setting | Default | Notes |
| --- | --- | --- |
| `baudRate` | `115200` | Baud for the post-flash port; match your firmware's serial setup. |
| `timeout` | `5000` ms | Max wait for a response to each command. |
| `expectedResponse` | `success == true` | Validation expression. |
| `commandTemplate` | `{"set":{"{{key}}":{{value}}}}` | Can contain `{{key}}`, `{{value}}`, or `{{items}}`. |
| `pingCommand` | `{"ping":1}` | Sent every `pingInterval` until `readyResponse` is received. |
| `readyResponse` | `ready == true` | Same expression syntax as `expectedResponse`. |
| `readyTimeout` | `15000` ms | Total timeout for the ping handshake. |
| `pingInterval` | `500` ms | Ping cadence during handshake. |
| `interCommandDelay` | `20` ms | Delay between successful writes — gives the firmware a breath between back-to-back commits. Set to `0` to send as fast as responses arrive. |

---

## NVS partition mode

Source: [main/nvs-image.js](../main/nvs-image.js).

### How it works

BurnTag builds an **ESP-IDF-compatible NVS v2 partition image** entirely in memory, then prepends it to the esptool file array so it's flashed in the same pass as firmware. No post-flash serial roundtrip, no handshake, no firmware-side code needed — the chip reads it out of NVS on first boot exactly as it would any other flashed config.

### Supported types

Pick with `nvsType` per item, or let BurnTag auto-infer from the JS value:

| Type | JS input | NVS encoding |
| --- | --- | --- |
| `u8` | number 0–255 | 1 byte unsigned |
| `i8` | number -128–127 | 1 byte signed |
| `u16` | number 0–65535 | 2 bytes unsigned |
| `i16` | number -32768–32767 | 2 bytes signed |
| `u32` | number 0–2³²-1 | 4 bytes unsigned |
| `i32` | number -2³¹–2³¹-1 | 4 bytes signed |
| `string` | any string | length-prefixed + CRC32, multi-entry chunked |

Auto-inference: integers default to `u32` or `i32` based on sign; strings become `string`. If you need a specific width, set `nvsType` explicitly — for example, reading a `u8` on the device won't find a `u32` entry even if the value fits.

### Settings reference

| Setting | Default | Notes |
| --- | --- | --- |
| `namespace` | `"config"` | All items go in a single namespace. |
| `partitionOffset` | `"0x9000"` | Flash offset — must match the `nvs` entry in your firmware's partition table. |
| `partitionSize` | `"0x6000"` | 24 KB = ESP-IDF default. |

### Required firmware contract

Your firmware needs to:

1. Have an `nvs` partition at the configured offset and size in `partitions.csv` (the ESP-IDF default already does this).
2. Read each key using `nvs_get_<type>` with matching namespace and type:
   ```cpp
   nvs_handle_t h;
   nvs_open("config", NVS_READONLY, &h);
   char ssid[33];
   size_t len = sizeof(ssid);
   nvs_get_str(h, "wifi_ssid", ssid, &len);
   ```

### Trade-offs vs JSON mode

| | JSON mode | NVS mode |
| --- | --- | --- |
| Firmware must be running | ✅ yes | ❌ no |
| Adds ~10–30 s to flash time | ✅ (handshake + commands) | ❌ (same pass as firmware) |
| Requires firmware-side JSON handler | ✅ yes | ❌ no |
| Can configure non-NVS targets (RAM, runtime) | ✅ yes | ❌ no |
| Works if firmware is broken / won't boot | ❌ no | ✅ yes |
| Survives firmware reflashes | Depends on how firmware persists values | ✅ yes — separate partition |

Use NVS for factory config (WiFi creds, calibration data, device IDs). Use JSON for runtime-only settings or when you need to trigger firmware logic beyond simple key/value writes.

---

## Troubleshooting

**JSON handshake fails / "Device did not respond to ping".**
- Verify firmware is actually running (check for boot log output — it appears in the flash log as raw RX chunks).
- On ESP32-C3/S3: confirm DTR assertion worked (look for `DTR asserted (HIGH), RTS held LOW` in the log).
- Try a longer `readyTimeout` if the device does slow startup work before accepting commands.
- Confirm the firmware prints the expected ready response literally — comparison is exact (`ready == true` needs `"ready":true` in the JSON, not `"status":"ready"`).

**Commands time out.**
- Firmware might be writing responses without a newline terminator. The parser is line-based (`\n` or `\r\n`).
- Response validation might be failing silently — check the flash log for `Response: ...` lines and the `checkResponse` logic in `serial-config.js` to see why a response doesn't match.

**NVS items don't show up on device.**
- Check your `partitions.csv` — the offset and size must match `postFlashConfig.nvs` exactly.
- Confirm the namespace on-device matches (`config` by default).
- Confirm the type on-device matches what BurnTag wrote (call `nvs_get_u32` for a `u32`, etc.).

**Port not found after reset.**
- Some USB-serial bridges need longer than 2 s to re-enumerate. The initial wait is hardcoded in `findEspPort` — increase it if needed.
- Windows sometimes holds onto the old port for a few seconds after reset; the 15 s timeout usually covers this.
