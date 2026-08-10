import { pipeline } from "@xenova/transformers";
import type { FeatureExtractionPipeline } from "@xenova/transformers";

export const EMBEDDING_MODEL = "Xenova/bge-small-en";
const MAX_EMBEDDING_INPUT_CHARS = 500;

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

function getExtractor() {
  extractorPromise ??= pipeline("feature-extraction", EMBEDDING_MODEL);
  return extractorPromise;
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) return [];

  const extractor = await getExtractor();
  const tensor = await extractor(texts.map((text) => text.slice(0, MAX_EMBEDDING_INPUT_CHARS)), {
    pooling: "mean",
    normalize: true,
    truncation: true,
    max_length: 512,
  } as Parameters<FeatureExtractionPipeline>[1] & {
    truncation: boolean;
    max_length: number;
  });

  return tensor.tolist() as number[][];
}

export async function embedText(text: string) {
  const [embedding] = await embedTexts([text]);
  if (!embedding?.length) throw new Error("Failed to create embedding");
  return embedding;
}
