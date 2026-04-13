/**
 * Pinecone client singleton — reused across requests in the same process.
 */

import { Pinecone } from "@pinecone-database/pinecone";

let _client: Pinecone | null = null;

function getClient(): Pinecone {
  if (!_client) {
    _client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  }
  return _client;
}

export function getPineconeIndex() {
  const indexName = process.env.PINECONE_INDEX_NAME || "harsh-persona-index";
  return getClient().index(indexName);
}

export interface PineconeMatch {
  id: string;
  score?: number;
  metadata?: Record<string, string | number | boolean>;
}

export async function similaritySearch(
  queryVector: number[],
  topK = 6,
  filter?: Record<string, unknown>
): Promise<PineconeMatch[]> {
  const index = getPineconeIndex();
  const result = await index.query({
    vector: queryVector,
    topK,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });
  return (result.matches || []) as PineconeMatch[];
}
