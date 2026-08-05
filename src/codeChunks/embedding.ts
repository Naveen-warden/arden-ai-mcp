import { pipeline } from "@xenova/transformers";
import type { FeatureExtractionPipeline } from "@xenova/transformers";

export const EMBEDDING_MODEL = "Xenova/bge-small-en";

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

function getExtractor() {
  extractorPromise ??= pipeline("feature-extraction", EMBEDDING_MODEL);
  return extractorPromise;
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) return [];

  const extractor = await getExtractor();
  const tensor = await extractor(texts, {
    pooling: "mean",
    normalize: true,
  });

  return tensor.tolist() as number[][];
}

export async function embedText(text: string) {
  const [embedding] = await embedTexts([text]);
  if (!embedding?.length) throw new Error("Failed to create embedding");
  return embedding;
}
