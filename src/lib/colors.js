// Colours for categories and accounts: an 8-hue palette validated for the dark UI
// (lightness band, colour-blind separation between neighbours, >= 3:1 contrast).
export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']

// First palette colour not already used (so new items differ from existing ones);
// once all eight are taken, cycles by count.
export function nextColor(used) {
  const taken = new Set(used.filter(Boolean).map((c) => c.toLowerCase()))
  return PALETTE.find((c) => !taken.has(c)) || PALETTE[used.length % PALETTE.length]
}

// A household's colour (saved on the row; older rows fall back to their position).
export const householdColor = (h, households = []) =>
  h?.color || PALETTE[Math.max(0, households.findIndex((x) => x.id === h?.id)) % PALETTE.length]
