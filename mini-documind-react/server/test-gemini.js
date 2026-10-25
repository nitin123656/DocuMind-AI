import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const response = await ai.models.generateContent({
model: "gemini-3.8-flash", // 👈 Back to the recommended model  
  contents: "Reply with exactly: Hello from Gemini!",
});

console.log(response.text);