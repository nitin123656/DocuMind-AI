import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import crypto from "crypto";

// Import our models and helpers
import DocumentChunk from "./models/DocumentChunk.js";
import {
  splitTextIntoChunks,
  generateEmbedding,
  cosineSimilarity,
  generateGroundedAnswer,
} from "./utils/ragHelper.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// ROUTES
// ==========================================

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    mongo: mongoose.connection.readyState === 1 ? "connected" : "not connected",
    time: new Date().toISOString(),
  });
});

// PROJECT 1: UPLOAD + EMBED
app.post("/api/p1/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Attach a PDF or TXT file." });

    let rawText;
    if (req.file.mimetype === "application/pdf") {
      const parser = new PDFParse({ data: req.file.buffer });
      try {
        rawText = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else {
      rawText = req.file.buffer.toString("utf-8");
    }

    const documentId = crypto.randomUUID();
    const chunks = splitTextIntoChunks(rawText);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      await DocumentChunk.create({
        documentId,
        fileName: req.file.originalname,
        chunkIndex: i,
        text: chunks[i],
        embedding,
      });
    }

    res.json({ documentId, fileName: req.file.originalname, totalChunks: chunks.length });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PROJECT 1: ASK
app.post("/api/p1/ask", async (req, res) => {
  try {
    const { documentId, question } = req.body;
    if (!documentId || !question) {
      return res.status(400).json({ error: "documentId and question are required" });
    }

    const questionEmbedding = await generateEmbedding(question);
    const allChunks = await DocumentChunk.find({ documentId }).lean();

    const topChunks = allChunks
      .map((c) => ({ ...c, score: cosineSimilarity(questionEmbedding, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const answer = await generateGroundedAnswer(question, topChunks);

    res.json({
      answer,
      sources: topChunks.map((c, i) => ({
        sourceNumber: i + 1,
        chunkIndex: c.chunkIndex + 1,
        similarity: Number(c.score.toFixed(3)),
        excerpt: c.text.slice(0, 150) + "...",
      })),
    });
  } catch (err) {
    console.error("Ask error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// START SERVER & CONNECT DB
// ==========================================

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));