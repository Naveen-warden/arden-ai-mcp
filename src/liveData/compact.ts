type JsonObject = Record<string, unknown>;

export type CompactArdenData = {
  kind: "empty" | "scalar" | "object" | "array";
  itemCount?: number;
  displayedItemCount?: number;
  collectionPath?: string;
  fields: string[];
  records: unknown[];
  metadata: Record<string, unknown>;
  text: string;
  notes: string[];
};

const ARRAY_KEYS = [
  "data",
  "docs",
  "results",
  "items",
  "records",
  "rows",
  "list",
  "bookings",
  "users",
  "payments",
  "requests",
];
const META_KEY_PATTERN = /^(total|count|page|limit|per.?page|has|next|prev|status|message|success|offset|cursor)/i;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateString(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function simplifyValue(value: unknown, depth: number, maxStringChars: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateString(value, maxStringChars);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (depth <= 0) return `[${value.length} items]`;
    return value.slice(0, 3).map((item) => simplifyValue(item, depth - 1, maxStringChars));
  }
  if (isObject(value)) {
    if (depth <= 0) return "{...}";
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, item]) => [key, simplifyValue(item, depth - 1, maxStringChars)]),
    );
  }

  return String(value);
}

function findCollection(value: unknown, path = "root", depth = 0): { path: string; items: unknown[] } | undefined {
  if (Array.isArray(value)) return { path, items: value };
  if (!isObject(value) || depth > 3) return undefined;

  for (const key of ARRAY_KEYS) {
    const child = value[key];
    if (Array.isArray(child)) return { path: `${path}.${key}`, items: child };
  }

  let best: { path: string; items: unknown[] } | undefined;

  for (const [key, child] of Object.entries(value)) {
    const match = findCollection(child, `${path}.${key}`, depth + 1);
    if (!match) continue;
    if (!best || match.items.length > best.items.length) best = match;
  }

  return best;
}

function collectFields(records: unknown[]) {
  const fields = new Set<string>();

  for (const record of records) {
    if (!isObject(record)) continue;
    for (const key of Object.keys(record)) fields.add(key);
  }

  return Array.from(fields).slice(0, 40);
}

function collectMetadata(value: unknown) {
  if (!isObject(value)) return {};

  const metadata: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) continue;
    if (isObject(item)) {
      const nestedMeta = collectMetadata(item);
      for (const [nestedKey, nestedValue] of Object.entries(nestedMeta)) {
        metadata[`${key}.${nestedKey}`] = nestedValue;
      }
      continue;
    }

    if (META_KEY_PATTERN.test(key)) metadata[key] = item;
  }

  return metadata;
}

function formatRecord(record: unknown) {
  if (!isObject(record)) return String(record);

  return Object.entries(record)
    .slice(0, 10)
    .map(([key, value]) => `${key}: ${typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(", ");
}

export function compactArdenData(
  data: unknown,
  options: { maxRecords?: number; maxStringChars?: number; maxDepth?: number } = {},
): CompactArdenData {
  const maxRecords = options.maxRecords ?? 5;
  const maxStringChars = options.maxStringChars ?? 180;
  const maxDepth = options.maxDepth ?? 2;
  const notes: string[] = [];

  if (data === null || data === undefined) {
    return {
      kind: "empty",
      fields: [],
      records: [],
      metadata: {},
      text: "The API returned no data.",
      notes,
    };
  }

  const collection = findCollection(data);
  const metadata = collectMetadata(data);

  if (collection) {
    const records = collection.items
      .slice(0, maxRecords)
      .map((item) => simplifyValue(item, maxDepth, maxStringChars));
    const fields = collectFields(collection.items);
    if (collection.items.length > maxRecords) {
      notes.push(`Only the first ${maxRecords} records are shown from ${collection.items.length} returned items.`);
    }

    const lines = [
      `Returned ${collection.items.length} record${collection.items.length === 1 ? "" : "s"}${collection.path !== "root" ? ` from ${collection.path}` : ""}.`,
      fields.length ? `Fields include: ${fields.slice(0, 20).join(", ")}.` : "No object fields were detected.",
      Object.keys(metadata).length ? `Metadata: ${JSON.stringify(metadata)}.` : undefined,
      ...records.map((record, index) => `${index + 1}. ${formatRecord(record)}`),
    ].filter((line): line is string => Boolean(line));

    return {
      kind: "array",
      itemCount: collection.items.length,
      displayedItemCount: records.length,
      collectionPath: collection.path,
      fields,
      records,
      metadata,
      text: lines.join("\n"),
      notes,
    };
  }

  if (isObject(data)) {
    const simplified = simplifyValue(data, maxDepth, maxStringChars);
    const fields = Object.keys(data).slice(0, 40);

    return {
      kind: "object",
      displayedItemCount: 1,
      fields,
      records: [simplified],
      metadata,
      text: [
        "The API returned one object.",
        fields.length ? `Fields include: ${fields.slice(0, 20).join(", ")}.` : undefined,
        formatRecord(simplified),
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
      notes,
    };
  }

  return {
    kind: "scalar",
    displayedItemCount: 1,
    fields: [],
    records: [simplifyValue(data, maxDepth, maxStringChars)],
    metadata,
    text: `The API returned: ${String(data)}`,
    notes,
  };
}
