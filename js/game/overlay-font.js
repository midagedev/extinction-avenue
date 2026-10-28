// Damage-number font size, in device pixels. Rounded so the canvas `font` string is reused.
// A distinct fractional size on every number, every frame, is cached by Safari (font + glyphs) until the
// tab is hidden. The page then gets slower the longer you play, and backgrounding Safari makes it fast again.

function overlayFontPx(k, size, pop) {
  return Math.max(8, Math.round(17 * k * size * pop));
}

function overlayFont(k, size, pop, weight) {
  return `${weight} ${overlayFontPx(k, size, pop)}px 'Bebas Neue', 'Anton', Impact, sans-serif`;
}

export { overlayFontPx, overlayFont };
