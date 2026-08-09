export function buildSpreads(pageCount: number, doublePage: boolean): number[][] {
  if (!doublePage) {
    return Array.from({ length: pageCount }, (_, i) => [i]);
  }
  const spreads: number[][] = [];
  if (pageCount > 0) spreads.push([0]);
  let i = 1;
  while (i < pageCount) {
    if (i + 1 < pageCount) {
      spreads.push([i, i + 1]);
      i += 2;
    } else {
      spreads.push([i]);
      i += 1;
    }
  }
  return spreads;
}

export function findSpreadIndex(spreads: number[][], pageIndex: number): number {
  const found = spreads.findIndex((spread) => spread.includes(pageIndex));
  return found === -1 ? 0 : found;
}
