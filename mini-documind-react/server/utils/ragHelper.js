import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    timeout: 30000,
    retryOptions: {
      attempts: 1,
      initialDelay: 1,
      maxDelay: 2,
    },
  },
});

function getErrorDetails(error) {
  if (!(error instanceof Error)) return { value: error };

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.status,
    cause: error.cause ? getErrorDetails(error.cause) : undefined,
    stack: error.stack,
  };
}

function isRetryableGeminiError(error) {
  if (!(error instanceof Error)) return false;

  const status = Number(error.status ?? error.code);
  const retryableNetworkCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
    "ABORT_ERR",
  ]);

  return (
    status === 429 ||
    status >= 500 ||
    error.name === "AbortError" ||
    retryableNetworkCodes.has(error.code) ||
    isRetryableGeminiError(error.cause)
  );
}

// ── 1. Split long text into overlapping chunks ──
export function splitTextIntoChunks(text, chunkSize = 700, overlap = 120) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    chunks.push(cleaned.slice(start, Math.min(start + chunkSize, cleaned.length)));
    start += chunkSize - overlap;
  }
  return chunks;
}

// ── 2. Turn text into a 768-number vector (with fallback models) ──
export async function generateEmbedding(text) {
  const modelsToTry = [
    { name: "gemini-embedding-001", config: {} },
    { name: "gemini-embedding-2", config: { outputDimensionality: 768 } },
    { name: "text-embedding-004", config: {} }
  ];
  
  let lastError;

  for (const m of modelsToTry) {
    try {
      const response = await ai.models.embedContent({
        model: m.name,
        contents: text,
        config: m.config
      });
      return response.embeddings[0].values;
    } catch (err) {
      console.error(
        `Embedding model ${m.name} failed; trying next:`,
        JSON.stringify(getErrorDetails(err), null, 2),
      );
      lastError = err;
    }
  }

  throw new Error(`All embedding models failed. Last error: ${lastError.message}`);
}

// ── 3. Cosine similarity: how "close" are two vectors? ──
export function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── 4. Ask Gemini to answer ONLY from the given chunks ──
export async function generateGroundedAnswer(question, topChunks) {
  const contextBlock = topChunks
    .map((c, idx) => `[Source ${idx + 1} | Chunk #${c.chunkIndex + 1}]: ${c.text}`)
    .join("\n\n");

  const prompt = `You are DocuMind AI, a helpful study assistant.
Answer the student's question using ONLY the document excerpts below.
Cite sources as [Source 1], [Source 2] at the end of sentences that use them.
If the answer is not in the excerpts, say clearly that the document doesn't cover it.

DOCUMENT EXCERPTS:
${contextBlock}

STUDENT QUESTION:
${question}`;

  const modelsToTry = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
  const maxAttempts = 2;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let shouldRetry = false;

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
        });
        return response.text;
      } catch (err) {
        console.error(
          `Attempt ${attempt} - Gemini model ${modelName} failed:`,
          JSON.stringify(getErrorDetails(err), null, 2),
        );
        lastError = err;
        shouldRetry ||= isRetryableGeminiError(err);
      }
    }

    if (!shouldRetry || attempt === maxAttempts) break;

    console.warn("All Gemini models failed with a transient error. Retrying in 2 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError.message}`);
}