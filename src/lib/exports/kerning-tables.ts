export interface IndexedPair { left: number; right: number; delta: number }

function words(values: number[]) {
  const data = new Uint8Array(values.length * 2);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value));
  return data;
}

const tag = (a: string) => [a.charCodeAt(0) * 256 + a.charCodeAt(1), a.charCodeAt(2) * 256 + a.charCodeAt(3)];

export function kerningTables(pairs: IndexedPair[]) {
  if (!pairs.length) return {};
  const sorted = [...pairs].sort((a, b) => a.left - b.left || a.right - b.right);
  const groups = new Map<number, IndexedPair[]>();
  for (const pair of sorted) {
    const set = groups.get(pair.left) ?? [];
    set.push(pair);
    groups.set(pair.left, set);
  }

  // GPOS PairPos format 1 with a first-glyph coverage and per-glyph pair sets.
  const pairOffsets: number[] = [];
  const pairSets: number[] = [];
  const headerLength = 10 + groups.size * 2;
  for (const set of groups.values()) {
    pairOffsets.push(headerLength + pairSets.length * 2);
    pairSets.push(set.length, ...set.flatMap(pair => [pair.right, pair.delta]));
  }
  const coverageOffset = headerLength + pairSets.length * 2;
  const pairPositioning = [
    1, coverageOffset, 4, 0, groups.size, ...pairOffsets, ...pairSets, 1, groups.size, ...groups.keys(),
  ];
  const scriptList = [1, ...tag("DFLT"), 8, 4, 0, 0, 0xffff, 1, 0];
  const featureList = [1, ...tag("kern"), 8, 0, 1, 0];
  const lookupList = [1, 4, 2, 0, 1, 8, ...pairPositioning];
  const GPOS = words([
    1, 0, 10, 10 + scriptList.length * 2, 10 + (scriptList.length + featureList.length) * 2,
    ...scriptList, ...featureList, ...lookupList,
  ]);
  const exponent = Math.floor(Math.log2(sorted.length));
  const searchRange = 2 ** exponent * 6;
  const kern = words([
    0, 1, 0, 14 + sorted.length * 6, 1, sorted.length,
    searchRange, exponent, sorted.length * 6 - searchRange,
    ...sorted.flatMap(pair => [pair.left, pair.right, pair.delta]),
  ]);
  return { GPOS, kern };
}
