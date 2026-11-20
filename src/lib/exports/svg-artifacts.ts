import { strToU8, zipSync } from "fflate";
import { layoutText } from "../foundry/text-layout";
import type { GlyphFoundryState } from "../foundry/types";
import { pathBounds } from "../vector/bezier";
import { serializePath } from "../vector/svg";
import { ExportInputError, exportSlug } from "./contracts";

const escapeXml = (value: string) => value
  .replace(/[\p{Cc}\p{Cs}]/gu, "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

function icons(document: GlyphFoundryState) {
  const entries = Object.values(document.glyphs).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return entries.flatMap(({ key, contours }, index) => {
    const bounds = pathBounds(contours);
    if (!bounds || !contours.some(contour => contour.segments.length)) return [];
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const pad = Math.max(width, height) / 16;
    const id = "glyph-" + exportSlug(key) + "-" + (index + 1);
    const component = id.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join("");
    return [{ id, key, component, path: serializePath(contours),
      viewBox: [bounds.minX - pad, bounds.minY - pad, width + pad * 2, height + pad * 2].join(" ") }];
  });
}

export function buildSprite(document: GlyphFoundryState) {
  const entries = icons(document);
  if (!entries.length) throw new ExportInputError("Draw an outline before exporting an SVG sprite.");
  const symbols = entries.map(icon =>
    `<symbol id="${icon.id}" viewBox="${icon.viewBox}"><title>${escapeXml(icon.key)}</title><path fill="currentColor" fill-rule="nonzero" d="${icon.path}"/></symbol>`);
  return '<svg xmlns="http://www.w3.org/2000/svg">\n' + symbols.join("\n") + "\n</svg>\n";
}

export function buildReactPack(document: GlyphFoundryState, name: string, text?: string) {
  const entries = icons(document);
  if (!entries.length) throw new ExportInputError("Draw an outline before exporting a React icon pack.");
  const files: Record<string, Uint8Array> = {
    "README.md": strToU8("# Glyph icon pack\n\nCopy the icons directory and index.ts into your React project. Import the named components from index.ts. Each component accepts SVG props and an optional title.\n\nThe sprite.svg file exposes the same glyphs as SVG symbols.\n"),
    "sprite.svg": strToU8(buildSprite(document)),
    "specimen.svg": strToU8(buildSpecimen(document, name, text)),
    "index.ts": strToU8(entries.map(icon => `export { ${icon.component} } from "./icons/${icon.component}";`).join("\n") + "\n"),
  };
  for (const icon of entries) {
    files[`icons/${icon.component}.tsx`] = strToU8(
      `import type { SVGProps } from "react";\n\n` +
      `export function ${icon.component}({ title, ...props }: SVGProps<SVGSVGElement>) {\n` +
      `  return (\n` +
      `    <svg width="1em" height="1em" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} {...props} viewBox="${icon.viewBox}" xmlns="http://www.w3.org/2000/svg">\n` +
      `      {title && <title>{title}</title>}\n` +
      `      <path fill="currentColor" fillRule="nonzero" d="${icon.path}" />\n` +
      `    </svg>\n  );\n}\n`,
    );
  }
  return zipSync(files, { level: 6, mtime: new Date("2020-01-01T00:00:00.000Z") });
}

function typefaceSpecimen(document: GlyphFoundryState, text?: string) {
  const keys = Object.keys(document.glyphs);
  const display = text?.trim() || keys.slice(0, 36).join("");
  const lines = layoutText(document, display);
  const { unitsPerEm, ascender, descender, capHeight } = document.metrics;
  const left = Math.min(0, ...lines.map(line => line.bounds.minX));
  const right = Math.max(unitsPerEm, ...lines.map(line => line.bounds.maxX));
  const scale = Math.min(72 / unitsPerEm, 1120 / Math.max(1, right - left));
  const step = Math.max(unitsPerEm, ascender - descender) * 1.24;
  const top = Math.min(-ascender, ...lines.map((line, row) => line.bounds.minY + row * step));
  const bottom = Math.max(-descender, ...lines.map((line, row) => line.bounds.maxY + row * step));
  const defs = new Map<string, string>();
  const outlines = lines.flatMap((line, row) => line.glyphs.map(glyph => {
    const id = "u" + glyph.key.codePointAt(0)!.toString(16);
    if (glyph.glyph?.contours.length && !defs.has(id)) {
      defs.set(id, `<path id="${id}" d="${serializePath(glyph.glyph.contours)}"/>`);
    }
    const shape = glyph.glyph?.contours.length
      ? `<use href="#${id}"/>`
      : glyph.missing ? `<rect x="${glyph.advanceWidth * .12}" y="${-capHeight * .9}" width="${glyph.advanceWidth * .68}" height="${capHeight * .9}" fill="none" stroke="currentColor" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : "";
    return shape ? `<g transform="translate(${glyph.x} ${row * step})">${shape}</g>` : "";
  }));
  return { width: 1200, height: Math.max(170, Math.ceil((bottom - top) * scale + 132)),
    content: `<defs>${[...defs.values()].join("")}</defs><g transform="translate(36 96) scale(${scale}) translate(${-left} ${-top})">${outlines.join("")}</g>` };
}

function iconSpecimen(document: GlyphFoundryState) {
  const entries = icons(document);
  const content = entries.map((icon, index) => {
    const x = 32 + index % 8 * 142;
    const y = 100 + Math.floor(index / 8) * 100;
    return `<g><title>${escapeXml(icon.key)}</title><rect x="${x}" y="${y}" width="130" height="88" rx="3" fill="#f0e6e6"/><svg x="${x + 37}" y="${y + 16}" width="55" height="55" viewBox="${icon.viewBox}"><path d="${icon.path}"/></svg></g>`;
  }).join("");
  return { width: 1200, height: Math.max(190, 106 + Math.ceil(entries.length / 8) * 100), content };
}

export function buildSpecimen(document: GlyphFoundryState, name: string, text?: string) {
  if (!Object.values(document.glyphs).some(glyph => glyph.contours.some(contour => contour.segments.length))) {
    throw new ExportInputError("Draw an outline before exporting a specimen.");
  }
  const { width, height, content } = document.kind === "typeface" ? typefaceSpecimen(document, text) : iconSpecimen(document);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" color="#4b273b" fill="currentColor">`,
    `<title>${escapeXml(name)}</title><rect width="100%" height="100%" fill="#faf5eb"/>`,
    `<text x="36" y="62" font-size="36" font-family="Georgia,serif">${escapeXml(name)}</text>`,
    `<path d="M36 80H1164" stroke="#b99aaa"/>`, content, "</svg>",
  ].join("");
}
