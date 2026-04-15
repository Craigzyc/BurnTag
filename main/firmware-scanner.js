import fs from 'node:fs';
import path from 'node:path';

const CATEGORIES = ['sensors', 'gateway'];

export function scanFirmwareDirs(baseDir) {
  const results = [];
  for (const category of CATEGORIES) {
    const categoryDir = path.join(baseDir, category);
    if (!fs.existsSync(categoryDir)) continue;
    for (const entry of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        results.push({
          name: entry.name,
          category,
          path: path.join(categoryDir, entry.name),
        });
      }
    }
  }
  return results;
}

export function findBinFiles(firmwareDir) {
  const buildDir = path.join(firmwareDir, '.pio', 'build');
  if (!fs.existsSync(buildDir)) return [];

  const builds = [];
  for (const env of fs.readdirSync(buildDir, { withFileTypes: true })) {
    if (!env.isDirectory()) continue;
    const envPath = path.join(buildDir, env.name);
    const firmware = path.join(envPath, 'firmware.bin');
    if (!fs.existsSync(firmware)) continue;

    const bootloader = path.join(envPath, 'bootloader.bin');
    const partitions = path.join(envPath, 'partitions.bin');
    builds.push({
      env: env.name,
      files: {
        bootloader: fs.existsSync(bootloader) ? bootloader : null,
        firmware,
        partitions: fs.existsSync(partitions) ? partitions : null,
      },
    });
  }
  return builds;
}

export function scanAll(baseDir) {
  return scanFirmwareDirs(baseDir).map(dir => ({
    ...dir,
    builds: findBinFiles(dir.path),
  }));
}
