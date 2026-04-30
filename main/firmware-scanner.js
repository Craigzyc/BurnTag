import fs from 'node:fs';
import path from 'node:path';

const LEGACY_CATEGORIES = ['sensors', 'gateway'];

function buildFiles(envPath) {
  const firmware = path.join(envPath, 'firmware.bin');
  if (!fs.existsSync(firmware)) return null;
  const bootloader = path.join(envPath, 'bootloader.bin');
  const partitions = path.join(envPath, 'partitions.bin');
  return {
    bootloader: fs.existsSync(bootloader) ? bootloader : null,
    partitions: fs.existsSync(partitions) ? partitions : null,
    firmware,
  };
}

function scanPlatformIoEnvs(dir) {
  const buildDir = path.join(dir, '.pio', 'build');
  if (!fs.existsSync(buildDir)) return [];
  const builds = [];
  for (const env of fs.readdirSync(buildDir, { withFileTypes: true })) {
    if (!env.isDirectory()) continue;
    const files = buildFiles(path.join(buildDir, env.name));
    if (files) builds.push({ label: `[${env.name}]`, files });
  }
  return builds;
}

function scanLegacyTree(dir) {
  const builds = [];
  for (const category of LEGACY_CATEGORIES) {
    const categoryDir = path.join(dir, category);
    if (!fs.existsSync(categoryDir)) continue;
    for (const device of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      if (!device.isDirectory()) continue;
      const envs = scanPlatformIoEnvs(path.join(categoryDir, device.name));
      for (const build of envs) {
        builds.push({ label: `${category}/${device.name} ${build.label}`, files: build.files });
      }
    }
  }
  return builds;
}

export function scanFirmwareDir(dir) {
  if (!dir || !fs.existsSync(dir)) return { kind: 'empty' };

  const direct = buildFiles(dir);
  if (direct) return { kind: 'single', files: direct };

  const envs = scanPlatformIoEnvs(dir);
  if (envs.length > 0) return { kind: 'multi', builds: envs };

  const legacy = scanLegacyTree(dir);
  if (legacy.length > 0) return { kind: 'multi', builds: legacy };

  return { kind: 'empty' };
}
