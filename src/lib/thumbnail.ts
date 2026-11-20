import type { CollectionInput } from "./collections";
import { specimens } from "./specimens";

const xmlCharacters: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
};

export function createThumbnail({ name, kind }: CollectionInput) {
  const label = Array.from(name).slice(0, 32).join("").replace(/[&<>"']/g, character => xmlCharacters[character]);
  const specimen = specimens[kind === "typeface" ? 0 : 3];
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 168">',
    `<rect width="400" height="168" fill="${specimen.ink}"/>`,
    `<path d="M0 115H400 M107 0V138 M293 0V138" stroke="${specimen.color}" opacity=".25"/>`,
    `<path fill="${specimen.color}" fill-rule="evenodd" transform="translate(132 3) scale(.56)" d="${specimen.path}"/>`,
    `<text x="200" y="148" text-anchor="middle" fill="${specimen.color}" font-family="sans-serif" font-size="12">${label}</text>`,
    "</svg>",
  ].join("");
}
