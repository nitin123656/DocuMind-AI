import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

// Fix for pdf-parse
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ==========================================
// 1. DATABASE MODEL (DocuMind)
// ==========================================
const documentChunkSchema = new mongoose.Schema({
  documentId: { type: String, required: true, index: true },
  fileName: { type: String, required: true },
  chunkIndex: { type: Number, required: true },
  text: { type: String, required: true },
  embedding: { type: [Number], required: true },
}, { timestamps: true });
const DocumentChunk = mongoose.model("DocumentChunk", documentChunkSchema);

// ==========================================
// 2. HELPERS (RAG)
// ==========================================
function splitTextIntoChunks(text, chunkSize = 700, overlap = 120) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    chunks.push(cleaned.slice(start, Math.min(start + chunkSize, cleaned.length)));
    start += chunkSize - overlap;
  }
  return chunks;
}

async function generateEmbedding(text) {
  // Fallback models for embeddings
  const models = [
    { name: "gemini-embedding-001", config: {} }, 
    { name: "gemini-embedding-2", config: { outputDimensionality: 768 } }
  ];
  for (const m of models) {
    try {
      const res = await ai.models.embedContent({ model: m.name, contents: text, config: m.config });
      return res.embeddings[0].values;
    } catch (e) { console.warn(`Embedding ${m.name} failed: ${e.message}`); }
  }
  throw new Error("All embedding models failed.");
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i]; normA += vecA[i] ** 2; normB += vecB[i] ** 2;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ==========================================
// 3. ROUTES (DocuMind)
// ==========================================
app.post("/api/p1/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file attached." });
    
    const rawText = req.file.mimetype === "application/pdf" 
      ? (await pdfParse(req.file.buffer)).text 
      : req.file.buffer.toString("utf-8");
      
    const documentId = crypto.randomUUID();
    const chunks = splitTextIntoChunks(rawText);
    
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      await DocumentChunk.create({ 
        documentId, 
        fileName: req.file.originalname, 
        chunkIndex: i, 
        text: chunks[i], 
        embedding 
      });
    }
    res.json({ documentId, fileName: req.file.originalname, totalChunks: chunks.length });
  } catch (err) { 
    console.error("Upload Error:", err);
    res.status(500).json({ error: err.message }); 
  }
});

app.post("/api/p1/ask", async (req, res) => {
  try {
    const { documentId, question } = req.body;
    if (!documentId || !question) return res.status(400).json({ error: "Missing documentId or question." });

    const qEmb = await generateEmbedding(question);
    const chunks = await DocumentChunk.find({ documentId }).lean();
    
    // Calculate similarity and get top 4 chunks
    const top = chunks
      .map(c => ({ ...c, score: cosineSimilarity(qEmb, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    
    // Build prompt
    const contextBlock = top.map((c, idx) => `[Source ${idx + 1}]: ${c.text}`).join("\n\n");
    const prompt = `You are DocuMind AI, a helpful study assistant.
Answer the student's question using ONLY the document excerpts below.
Cite sources as [Source 1], [Source 2] at the end of sentences that use them.
If the answer is not in the excerpts, say clearly that the document doesn't cover it.

EXCERPTS:
${contextBlock}

STUDENT QUESTION:
${question}`;
    
    // Call Gemini with fallbacks
    const models = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
    let aiRes;
    for (const m of models) {
      try {
        aiRes = await ai.models.generateContent({ model: m, contents: prompt });
        break;
      } catch (e) { console.warn(`Model ${m} failed: ${e.message}`); }
    }
    if (!aiRes) throw new Error("All Gemini models failed due to high demand.");

    res.json({ 
      answer: aiRes.text, 
      sources: top.map((c, i) => ({ 
        sourceNumber: i + 1, 
        chunkIndex: c.chunkIndex + 1, 
        similarity: Number(c.score.toFixed(3)) 
      })) 
    });
  } catch (err) { 
    console.error("Ask Error:", err);
    res.status(500).json({ error: err.message }); 
  }
});

// ==========================================
// 4. START SERVER
// ==========================================
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`🚀 DocuMind Server running on http://localhost:${port}`));
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ DB error:", err.message));