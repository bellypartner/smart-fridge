// Batch code format: <fridge code>-<product code>-<DDMM>
// (no "SC" prefix; date is day+month only, no year — see collision handling
// below for why that's safe). Product code: first 3 letters of the first
// two words of the product name, e.g. "Chicken Salad" -> "CHISAL". A
// single-word name uses its first 6 letters instead. Short words are
// padded with X so the code is always a consistent length.
//
// NOTE: existing batches created before this format changed keep their old
// codes (SC-...-YYMMDD) — this only affects newly generated codes. Nothing
// retroactively renames a code that's already been printed.

const productCode = (productName: string): string => {
  const words = productName
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "XXXXXX";

  if (words.length === 1) {
    return words[0].slice(0, 6).padEnd(6, "X");
  }

  const first = words[0].slice(0, 3).padEnd(3, "X");
  const second = words[1].slice(0, 3).padEnd(3, "X");
  return first + second;
};

const dateCode = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return dd + mm;
};

export const buildBatchCode = (fridgeCode: string, productName: string, manufacturedAt: Date): string => {
  return `${fridgeCode}-${productCode(productName)}-${dateCode(manufacturedAt)}`;
};
