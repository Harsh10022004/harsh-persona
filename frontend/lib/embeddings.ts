/**
 * Embeddings via HuggingFace Inference API.
 * Model: sentence-transformers/all-mpnet-base-v2 (768-dim)
 * Same model used in Python ingestion → consistent vector space.
 */

const HF_URL =
  "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-mpnet-base-v2/pipeline/feature-extraction";

export async function embedText(text: string): Promise<number[]> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN not set in .env");

  // Retry up to 3 times — HF returns 503 while the model is loading (cold start)
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ inputs: text }),
    });
    if (res.status !== 503) break;
    // Model is loading — wait and retry
    await new Promise((r) => setTimeout(r, 8000));
  }

  if (!res || !res.ok) {
    const err = await res?.text() ?? "no response";
    throw new Error(`HuggingFace embedding error ${res?.status}: ${err}`);
  }

  const data = await res.json();

  // Handle all possible HF response shapes:
  // Shape A: [0.1, 0.2, ...]          → flat 768-dim vector
  // Shape B: [[0.1, 0.2, ...]]        → wrapped sentence embedding
  // Shape C: [[tok1], [tok2], ...]    → token-level, need mean pool
  if (typeof data[0] === "number") {
    // Shape A
    return data as number[];
  }
  if (Array.isArray(data[0]) && typeof data[0][0] === "number") {
    if (data.length === 1) {
      // Shape B — single sentence embedding
      return data[0] as number[];
    }
    // Shape C — token embeddings, mean pool
    return meanPool(data as number[][]);
  }
  // Nested: [[[...]]] — take inner array and mean pool
  if (Array.isArray(data[0]) && Array.isArray(data[0][0])) {
    return meanPool(data[0] as number[][]);
  }

  throw new Error(`Unexpected HF response shape: ${JSON.stringify(data).slice(0, 100)}`);
}

function meanPool(tokenEmbeddings: number[][]): number[] {
  const dim = tokenEmbeddings[0].length;
  const result = new Array<number>(dim).fill(0);
  for (const emb of tokenEmbeddings) {
    for (let i = 0; i < dim; i++) result[i] += emb[i];
  }
  return result.map((v) => v / tokenEmbeddings.length);
}
