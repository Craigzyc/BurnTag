export function formatSerial(prefix, number) {
  const num = String(number).padStart(6, '0');
  return prefix ? `${prefix}-${num}` : num;
}

export function getNextSerial(config) {
  const serial = formatSerial(config.serialPrefix, config.nextSerialNumber);
  config.nextSerialNumber++;
  return serial;
}

/**
 * Return the serial that WILL be assigned next, without incrementing the
 * counter. Used by the renderer to bake the serial into the NVS image or
 * JSON config commands before the flash runs, so the same number ends up
 * on the label and on the device.
 */
export function peekNextSerial(config) {
  return formatSerial(config.serialPrefix, config.nextSerialNumber);
}
