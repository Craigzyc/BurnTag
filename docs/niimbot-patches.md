# niimbotjs Patches

BurnTag ships with a post-install script ([`scripts/patch-niimbotjs.js`](../scripts/patch-niimbotjs.js)) that patches `niimbotjs` to fix Niimbot B21 Pro compatibility issues. The script runs automatically on `npm install` via the `postinstall` hook in `package.json`.

If you skip `npm install` or install deps without hooks, the printer will produce timeouts, mismatched responses, or every-other-print failures.

## Why patch at all?

`niimbotjs` is written against the original B21 and B1 printers. The B21 Pro is functionally similar but differs in enough small ways that the unpatched library either fails outright on some prints or works exactly once before breaking.

Rather than fork `niimbotjs`, BurnTag applies five small, idempotent string-replacement patches to the installed file each time deps are reinstalled. If the patches are already applied, the script exits cleanly with `niimbotjs already patched`.

## The five patches

Target file: `node_modules/niimbotjs/dist/lib/printer.js`.

### 1. Clamp midpoint offsets to UInt8

**Problem:** For label widths >255 px, `niimbotjs` writes `midPoint - left` into a single UInt8 header field — but the raw subtraction can exceed 255, causing `writeUInt8` to throw `RangeError`. B21 Pro labels (592 px max) regularly trip this.

**Fix:**
```js
header.writeUInt8(midPoint - left, 2)
// becomes
header.writeUInt8(Math.min(255, midPoint - left), 2)
```
(And the same for the `right` offset.)

Safe because the B21 Pro's bitmap rendering interprets any value ≥255 as "full width" — clamping only loses precision in unreachable edge cases.

### 2. Reduce packet read interval

**Problem:** The library polls for packets at 100 ms intervals during transfers. B21 Pro is fast enough that tight operations complete between polls, and the library reports timeouts or dropped responses on commands that actually succeeded.

**Fix:**
```js
const PACKET_READ_INTERVAL = 100;
// becomes
const PACKET_READ_INTERVAL = 50;
```

Halving the interval effectively doubles the sample rate without meaningful CPU overhead.

### 3. Accept mismatched response codes

**Problem:** Many B21 Pro commands return a slightly different response code than the library expects. The unpatched behavior logs a warning and drops the packet — but the response payload is still valid, and discarding it means the caller hangs waiting for a response that already arrived.

**Fix:**
```js
default: {
  warnLog(`Expected response code ${responseCode} but received ${packet.type}!`);
}
// becomes
default: {
  // B21 Pro patch: accept mismatched response codes
  warnLog(`Expected response code ${responseCode} but received ${packet.type}!`);
  return packet;
}
```

Still logs a warning for diagnostic value, but returns the packet so the caller can parse it.

### 4. Fault-tolerant print method

**Problem:** The unpatched `print()` method runs a fixed sequence of sub-commands (`setLabelDensity`, `setLabelType`, image transfer, `startPrint`, `endPrint`, etc.). On B21 Pro, some sub-commands silently fail or return unexpected codes — and a single failure aborts the entire print.

**Fix:** Wraps each sub-command in a `tryCmd` helper that logs but doesn't throw:

```js
const tryCmd = async (name, fn) => {
  try { await fn(); console.log(`[niimbotjs] ${name} OK`); }
  catch (e) { console.warn(`[niimbotjs] ${name} failed: ${e.message}, continuing...`); }
};
yield tryCmd('setLabelDensity', () => this.setLabelDensity(density));
// ... same wrapping for each subsequent sub-command
```

The printer tolerates skipped optional commands just fine. This makes the print flow robust to transient protocol quirks without masking real failures — successful prints still log `OK` for every step; partial failures log `failed: ...` but continue.

### 5. Fix status polling exit condition

**Problem:** After sending a print, `niimbotjs` polls the printer's status until completion. The original exit condition is:

```js
if (status.page >= 1 || (status.progress1 >= 100 && status.progress2 >= 100)) break;
```

On B21 Pro, the `progress1` / `progress2` fields carry **stale values from the previous print** at the start of the next one. So the second print's polling loop exits immediately on a reading of `100/100` left over from the first print — before any bytes are actually sent to the printer. The result: every other print silently produces a blank label (or no output at all).

**Fix:** Drop the progress-based exit condition entirely — `page >= 1` is the only reliable signal that a new page has started.

```js
if (status.page >= 1) break;
```

This is the single most important patch — without it, the app appears to work on the first print of every session and then fail mysteriously forever after.

## When to re-run

The script is idempotent and runs automatically after `npm install`. You only need to run it manually if:

- You installed with `npm install --ignore-scripts` (then: `node scripts/patch-niimbotjs.js`).
- You manually edited `node_modules/niimbotjs/dist/lib/printer.js` and want to re-apply.
- You replaced `niimbotjs` outside of npm (`npm rebuild` alone won't re-run postinstall).

The script's guards (`if (!content.includes(...))`) prevent double-patching.

## Upstream status

These are local patches, not PRs against `niimbotjs`. If the upstream library adds B21 Pro support natively, the guards will detect that and skip — but the patches should be removed from this project at that point. The current patch script lists all five patches and counts how many were applied; if that count is ever 0 on a clean `npm install`, it's time to remove the patch script and update the `niimbotjs` dependency.
