import { strToU8 } from "fflate";
import { compress } from "wawoff2";
import { studioDocument } from "../foundry/studio-source";
import { exportSlug, ExportInputError, type ExportArtifact, type ExportRequest } from "./contracts";
import { buildReactPack, buildSpecimen, buildSprite } from "./svg-artifacts";
import { buildTrueType } from "./true-type";

export async function compileExport(input: ExportRequest): Promise<ExportArtifact> {
  let document: ReturnType<typeof studioDocument>;
  try {
    document = studioDocument({
      id: input.collectionId ?? "export", ownerId: "export", name: input.name, kind: input.kind,
      glyphs: input.glyphs, metrics: input.metrics, kerning: input.kerning,
    });
  } catch (error) {
    throw new ExportInputError(error instanceof Error ? error.message : "The draft contains an invalid outline or metric.");
  }

  const name = exportSlug(input.name);
  const xml = "image/svg+xml";
  let result: ExportArtifact;
  switch (input.format) {
    case "svg":
      result = { filename: name + "-sprite.svg", contentType: xml, bytes: Uint8Array.from(strToU8(buildSprite(document))) };
      break;
    case "specimen":
      result = { filename: name + "-specimen.svg", contentType: xml, bytes: Uint8Array.from(strToU8(buildSpecimen(document, input.name, input.text))) };
      break;
    case "react":
      result = { filename: name + "-react.zip", contentType: "application/zip", bytes: Uint8Array.from(buildReactPack(document, input.name, input.text)) };
      break;
    case "ttf":
      result = { filename: name + ".ttf", contentType: "font/ttf", bytes: buildTrueType(document, input.name) };
      break;
    case "woff2":
      result = { filename: name + ".woff2", contentType: "font/woff2",
        bytes: Uint8Array.from(await compress(buildTrueType(document, input.name))) };
      break;
  }
  if (result.bytes.byteLength > 3_000_000) throw new ExportInputError("The export exceeds the 3 MB artifact limit.");
  return result;
}
