import type { StudioSnapshot } from "./sync-contract";

function fingerprint(value: unknown) {
  return JSON.stringify(value, (_, child: unknown) => child && typeof child === "object" && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : child);
}

export const sameSnapshot = (a: StudioSnapshot, b: StudioSnapshot) => fingerprint(a) === fingerprint(b);

export function mergeStudioSnapshots(base: StudioSnapshot, local: StudioSnapshot, remote: StudioSnapshot,
  prefer: "local" | "remote" = "local") {
  const conflicts: string[] = [];
  function choose<T>(name: string, before: T, mine: T, theirs: T) {
    const a = fingerprint(before);
    const b = fingerprint(mine);
    const c = fingerprint(theirs);
    if (b === a) return theirs;
    if (c === a || b === c) return mine;
    conflicts.push(name);
    return prefer === "local" ? mine : theirs;
  }

  function mergeList<T>(before: T[], mine: T[], theirs: T[], key: (item: T) => string, label: (id: string) => string) {
    const keyed = (items: T[]) => new Map(items.map(item => [key(item), item]));
    const a = keyed(before);
    const b = keyed(mine);
    const c = keyed(theirs);
    const ids = [...new Set([...a.keys(), ...b.keys(), ...c.keys()])].sort();
    return ids.flatMap(id => {
      const item = choose(label(id), a.get(id), b.get(id), c.get(id));
      return item === undefined ? [] : [item];
    });
  }

  const glyphs = mergeList(base.glyphs, local.glyphs, remote.glyphs, glyph => glyph.key, id => "Glyph " + id);
  const pairId = (pair: StudioSnapshot["kerning"][number]) => JSON.stringify([pair.left, pair.right]);
  const pairs = mergeList(base.kerning, local.kerning, remote.kerning, pairId, id => "Pair " + (JSON.parse(id) as string[]).join(" / "));
  const preferred = prefer === "local" ? local : remote;
  const glyphKeys = new Set(glyphs.map(glyph => glyph.key));
  const kerning = pairs.filter(pair => {
    const missing = [pair.left, pair.right].filter(key => !glyphKeys.has(key));
    if (!missing.length) return true;
    conflicts.push("Pair " + pair.left + " / " + pair.right);
    const rescue = missing.flatMap(key => preferred.glyphs.filter(glyph => glyph.key === key));
    if (rescue.length !== missing.length || !preferred.kerning.some(candidate => pairId(candidate) === pairId(pair))) return false;
    for (const glyph of rescue) {
      if (!glyphKeys.has(glyph.key)) glyphs.push(glyph);
      glyphKeys.add(glyph.key);
    }
    return true;
  });
  glyphs.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

  const metrics = { ...base.metrics };
  for (const key of Object.keys(metrics) as (keyof typeof metrics)[]) {
    metrics[key] = choose("Guide metric " + key, base.metrics[key], local.metrics[key], remote.metrics[key]);
  }
  // Two individually valid metric changes can break the overall guide ordering.
  if (metrics.xHeight > metrics.capHeight || metrics.capHeight > metrics.ascender) {
    conflicts.push("Optical guide order");
    Object.assign(metrics, {
      xHeight: preferred.metrics.xHeight, capHeight: preferred.metrics.capHeight, ascender: preferred.metrics.ascender,
    });
  }
  return { snapshot: { metrics, glyphs, kerning }, conflicts: [...new Set(conflicts)] };
}
