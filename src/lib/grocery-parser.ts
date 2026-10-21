export type ParsedGroceryLine = { raw: string; name: string; count: number };

const BULLET = /^\s*[-*•]\s*/;
const PRICE = /\s*(?:[—–:]|\s-)\s*\$?\s*\d+(?:[.,]\d{1,2})?\s*$/;
// "×2" may touch the name; a plain "x 2" needs a space so "Trail mix 2" stays intact.
const MULTIPLIER = /(?:\s*×|\s+[xX])\s*(\d{1,2})\s*$/;

/** Turns a pasted grocery email ("- Banana — $2.66", "Yogourt ×2") into item lines. */
export function parseGroceryText(text: string): ParsedGroceryLine[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bulleted = lines.some((line) => BULLET.test(line));
  return lines.flatMap((raw) => {
    // With a bulleted list, anything un-bulleted is the store/total header.
    if (bulleted && !BULLET.test(raw)) return [];
    let name = raw.replace(BULLET, "").replace(PRICE, "").trim();
    let count = 1;
    const multiplier = name.match(MULTIPLIER);
    if (multiplier) {
      count = Math.max(1, Number(multiplier[1]));
      name = name.slice(0, multiplier.index).trim();
    }
    return name ? [{ raw, name, count }] : [];
  });
}
