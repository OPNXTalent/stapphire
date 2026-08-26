function channel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const normalized = hex.trim().replace(/^#/, '');
  const value = normalized.length === 3 ? normalized.split('').map((part) => part + part).join('') : normalized;
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return 0.2126 * channel(parseInt(value.slice(0, 2), 16)) + 0.7152 * channel(parseInt(value.slice(2, 4), 16)) + 0.0722 * channel(parseInt(value.slice(4, 6), 16));
}

export function contrastRatio(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  if (a === null || b === null) return 1;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableHeaderText(background: string) {
  const dark = '#172033';
  const light = '#ffffff';
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}
