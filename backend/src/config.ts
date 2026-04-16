import dotenv from "dotenv";

dotenv.config();

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: toNumber(process.env.PORT, 4000),
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  postgresUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/clover",
  redisUrl: process.env.REDIS_URL,
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3.1",
  aiProvider: process.env.AI_PROVIDER || "groq"
};
