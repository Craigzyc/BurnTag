/**
 * Patch niimbotjs for B21 Pro compatibility:
 * 1. Clamp midpoint offsets to UInt8 max (wide image support)
 * 2. Increase packet read timeout (B21 Pro is slow to respond)
 * 3. Accept mismatched response codes
 * 4. Make print commands fault-tolerant (B21 Pro ignores some commands)
 */
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.join(
  import.meta.dirname, '..', 'node_modules', 'niimbotjs', 'dist', 'lib', 'printer.js',
);

if (!fs.existsSync(filePath)) {
  console.log('niimbotjs not installed yet, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf-8');
let patchCount = 0;

// Patch 1: Clamp midpoint offsets
if (content.includes('header.writeUInt8(midPoint - left, 2)') && !content.includes('Math.min(255')) {
  content = content.replace('header.writeUInt8(midPoint - left, 2)', 'header.writeUInt8(Math.min(255, midPoint - left), 2)');
  content = content.replace('header.writeUInt8(midPoint - right, 3)', 'header.writeUInt8(Math.min(255, midPoint - right), 3)');
  patchCount++;
}

// Patch 2: Increase timeouts
if (content.includes('const PACKET_READ_INTERVAL = 100;')) {
  content = content.replace('const PACKET_READ_INTERVAL = 100;', 'const PACKET_READ_INTERVAL = 50;');
  patchCount++;
}

// Patch 3: Accept mismatched response codes
if (!content.includes('// B21 Pro patch: accept mismatched')) {
  content = content.replace(
    /default: \{\s*warnLog\(`Expected response code \$\{responseCode\} but received \$\{packet\.type\}!`\);\s*\}/,
    `default: {\n                            // B21 Pro patch: accept mismatched response codes\n                            warnLog(\`Expected response code \${responseCode} but received \${packet.type}!\`);\n                            return packet;\n                        }`,
  );
  patchCount++;
}

// Patch 4: Fault-tolerant print method
if (!content.includes('tryCmd')) {
  content = content.replace(
    /this\.print = \(sharpImage_1.*?\n\s*yield this\.setLabelDensity\(density\);/s,
    `this.print = (sharpImage_1, _a) => __awaiter(this, [sharpImage_1, _a], void 0, function* (sharpImage, { density }) {
            const tryCmd = async (name, fn) => {
                try { await fn(); console.log(\`[niimbotjs] \${name} OK\`); }
                catch (e) { console.warn(\`[niimbotjs] \${name} failed: \${e.message}, continuing...\`); }
            };
            yield tryCmd('setLabelDensity', () => this.setLabelDensity(density));`,
  );
  patchCount++;
}

// Patch 5: Fix status polling — only use page>=1 as exit condition
// Stale p1=100/p2=100 from previous print causes every-other-print failure
if (content.includes('status.progress1 >= 100 && status.progress2 >= 100')) {
  content = content.replace(
    /if \(status\.page >= 1 \|\| \(status\.progress1 >= 100 && status\.progress2 >= 100\)\) break;/,
    'if (status.page >= 1) break;',
  );
  patchCount++;
}

if (patchCount > 0) {
  fs.writeFileSync(filePath, content);
  console.log(`Patched niimbotjs (${patchCount} patches applied)`);
} else {
  console.log('niimbotjs already patched');
}
