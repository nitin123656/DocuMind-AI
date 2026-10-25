import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { timeout: 12000 },
});

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
      console.warn(`Embedding model ${m.name} failed: ${err.message}. Trying next...`);
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

  const modelsToTry = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
  let lastError;

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
      });
      return response.text;
    } catch (err) {
      console.warn(`Model ${modelName} failed: ${err.message}. Trying next...`);
      lastError = err;
    }
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError.message}`);
}