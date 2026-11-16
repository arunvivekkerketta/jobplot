// WCAG 2.1 contrast ratio for two hex colours.
// Usage: node scripts/contrast.mjs #737373 #ffffff

function channels(hex) {
  const value = hex.replace("#", "");
  if (value.length !== 6) throw new Error(`expected #rrggbb, got ${hex}`);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

if (process.argv[1] && process.argv[1].endsWith("contrast.mjs")) {
  const [foreground = "#737373", background = "#ffffff"] = process.argv.slice(2);
  const ratio = contrastRatio(foreground, background);
  console.log(
    `${foreground} on ${background}: ${ratio.toFixed(2)}:1 (UI boundary needs 3.0:1)`,
  );
  process.exit(ratio >= 3 ? 0 : 1);
}
