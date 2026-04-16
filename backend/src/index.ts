import bcrypt from "bcryptjs";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { generateAssistantReply } from "./ai";
import { config } from "./config";
import { pool, query } from "./db";
import { extractMemorySnippets, rankRelevantMemories } from "./memory";

type AuthRequest = Request & { user?: { id: string; isAdmin: boolean } };

const app = express();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 180, standardHeaders: true, legacyHeaders: false });
const nwsHeaders = {
  Accept: "application/geo+json",
  "User-Agent": "CloverChat/1.0 (weather integration)"
};

const weatherIntentPattern =
  /\b(weather|forecast|temperature|rain|snow|wind|humidity|storm|sunny|cloudy|hot|cold)\b/i;

const parseCoordinates = (input: string) => {
  const match = input.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < 18 || latitude > 72 || longitude < -179 || longitude > -60) return null;
  return { latitude, longitude };
};

const fetchNwsWeatherReply = async (input: string) => {
  if (!weatherIntentPattern.test(input)) return null;
  const coordinates = parseCoordinates(input);
  if (!coordinates) {
    return "I can check weather via the free NWS API. Please include coordinates in your message (for example: weather at 38.8977,-77.0365).";
  }

  const pointsResponse = await fetch(`https://api.weather.gov/points/${coordinates.latitude},${coordinates.longitude}`, {
    headers: nwsHeaders
  });
  if (!pointsResponse.ok) {
    return "I couldn't reach NWS for that location right now. Please try again in a moment.";
  }

  const pointData = (await pointsResponse.json()) as { properties?: { forecast?: string; relativeLocation?: { properties?: { city?: string; state?: string } } } };
  const forecastUrl = pointData.properties?.forecast;
  if (!forecastUrl) {
    return "I couldn't find an NWS forecast grid for that location.";
  }

  const forecastResponse = await fetch(forecastUrl, { headers: nwsHeaders });
  if (!forecastResponse.ok) {
    return "I found the location, but NWS forecast data is unavailable right now.";
  }

  const forecastData = (await forecastResponse.json()) as {
    properties?: { periods?: Array<{ name?: string; shortForecast?: string; detailedForecast?: string; temperature?: number; temperatureUnit?: string; windSpeed?: string; windDirection?: string }> };
  };
  const period = forecastData.properties?.periods?.[0];
  if (!period) {
    return "NWS returned no forecast periods for that location.";
  }

  const city = pointData.properties?.relativeLocation?.properties?.city;
  const state = pointData.properties?.relativeLocation?.properties?.state;
  const location = city && state ? `${city}, ${state}` : `${coordinates.latitude},${coordinates.longitude}`;
  const temperature =
    typeof period.temperature === "number" && period.temperatureUnit ? `${period.temperature}°${period.temperatureUnit}` : "N/A";
  const wind = [period.windSpeed, period.windDirection].filter(Boolean).join(" ").trim() || "N/A";
  const summary = period.shortForecast || period.detailedForecast || "Forecast unavailable";

  return `Weather for ${location} (${period.name || "Current"}): ${summary}. Temperature: ${temperature}. Wind: ${wind}. Source: NWS.`;
};

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));
app.use("/api", apiLimiter);

const ensureSchema = async () => {
  await query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      disabled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source_session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      action TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(
    `INSERT INTO users (email, password_hash, name, is_admin)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (email) DO NOTHING`,
    ["admin@clover.local", await bcrypt.hash("admin123", 10), "Clover Admin"]
  );
};

const tokenFor = (id: string, isAdmin: boolean) => jwt.sign({ id, isAdmin }, config.jwtSecret, { expiresIn: "7d" });

const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as { id: string; isAdmin: boolean };
    req.user = { id: payload.id, isAdmin: payload.isAdmin };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const adminOnly = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
};

app.get("/api/health", async (_req, res) => {
  const now = await query<{ now: string }>("SELECT NOW()::text as now");
  res.json({ ok: true, dbTime: now[0]?.now });
});

app.post("/api/auth/signup", authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(6), name: z.string().min(2) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
  }
  const { email, password, name } = parsed.data;

  try {
    const rows = await query<{ id: string; is_admin: boolean }>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, is_admin`,
      [email.toLowerCase(), await bcrypt.hash(password, 10), name]
    );
    const user = rows[0];
    res.status(201).json({ token: tokenFor(user.id, user.is_admin) });
  } catch {
    res.status(409).json({ error: "User already exists" });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const rows = await query<{ id: string; password_hash: string; is_admin: boolean; disabled: boolean; name: string; email: string }>(
    `SELECT id, password_hash, is_admin, disabled, name, email FROM users WHERE email = $1`,
    [parsed.data.email.toLowerCase()]
  );
  const user = rows[0];
  if (!user || user.disabled || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  res.json({ token: tokenFor(user.id, user.is_admin) });
});

app.get("/api/me", auth, async (req: AuthRequest, res) => {
  const rows = await query<{ id: string; email: string; name: string; is_admin: boolean }>(
    `SELECT id, email, name, is_admin FROM users WHERE id = $1`,
    [req.user!.id]
  );
  res.json(rows[0]);
});

app.get("/api/chat/sessions", auth, async (req: AuthRequest, res) => {
  const rows = await query<{ id: string; title: string; updated_at: string }>(
    `SELECT id, title, updated_at FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
    [req.user!.id]
  );
  res.json(rows);
});

app.post("/api/chat/sessions", auth, async (req: AuthRequest, res) => {
  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "New Chat";
  const rows = await query<{ id: string; title: string }>(
    `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id, title`,
    [req.user!.id, title.slice(0, 80)]
  );
  res.status(201).json(rows[0]);
});

app.get("/api/chat/sessions/:id/messages", auth, async (req: AuthRequest, res) => {
  const sessionRows = await query<{ id: string }>(`SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2`, [
    req.params.id,
    req.user!.id
  ]);
  if (!sessionRows[0]) {
    return res.status(404).json({ error: "Session not found" });
  }

  const rows = await query<{ id: string; role: string; content: string; created_at: string }>(
    `SELECT id, role, content, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [req.params.id]
  );
  return res.json(rows);
});

app.post("/api/chat/sessions/:id/messages", auth, async (req: AuthRequest, res) => {
  const schema = z.object({ content: z.string().min(1).max(4000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Message is required" });
  }

  const sessionRows = await query<{ id: string }>(`SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2`, [
    req.params.id,
    req.user!.id
  ]);
  if (!sessionRows[0]) {
    return res.status(404).json({ error: "Session not found" });
  }

  const input = parsed.data.content.trim();
  await query(`INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`, [req.params.id, input]);

  const memories = await query<{ content: string }>(`SELECT content FROM memories WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`, [
    req.user!.id
  ]);
  const topMemories = rankRelevantMemories(input, memories)
    .map((m) => `- ${m.content}`)
    .join("\n");

  const history = await query<{ role: "user" | "assistant"; content: string }>(
    `SELECT role, content FROM (
       SELECT role, content, created_at
       FROM chat_messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 12
     ) history
     ORDER BY created_at ASC`,
    [req.params.id]
  );

  const systemPrompt = `You are Clover AI assistant. Keep responses useful and concise. Relevant user memory:\n${topMemories || "- none"}`;
  const settingsRows = await query<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
  const weatherReply = await fetchNwsWeatherReply(input);
  const assistant =
    weatherReply ||
    (await generateAssistantReply(
      [
        { role: "system", content: systemPrompt },
        ...history.map((item) => ({ role: item.role, content: item.content }))
      ],
      {
        provider: settings.ai_provider,
        groqApiKey: settings.groq_api_key || config.groqApiKey,
        groqModel: settings.groq_model || config.groqModel,
        ollamaUrl: settings.ollama_url || config.ollamaUrl,
        ollamaModel: settings.ollama_model || config.ollamaModel
      }
    ));

  await query(`INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`, [req.params.id, assistant]);
  await query(`UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`, [req.params.id]);

  for (const snippet of extractMemorySnippets(input)) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM memories WHERE user_id = $1 AND lower(content) = lower($2) LIMIT 1`,
      [req.user!.id, snippet]
    );
    if (existing[0]) {
      await query(`UPDATE memories SET updated_at = NOW() WHERE id = $1`, [existing[0].id]);
    } else {
      await query(`INSERT INTO memories (user_id, content, source_session_id) VALUES ($1, $2, $3)`, [
        req.user!.id,
        snippet,
        req.params.id
      ]);
    }
  }

  res.json({ reply: assistant });
});

app.get("/api/admin/users", auth, adminOnly, async (_req, res) => {
  const rows = await query<{ id: string; email: string; name: string; is_admin: boolean; disabled: boolean; created_at: string }>(
    `SELECT id, email, name, is_admin, disabled, created_at FROM users ORDER BY created_at DESC`
  );
  res.json(rows);
});

app.patch("/api/admin/users/:id", auth, adminOnly, async (req, res) => {
  const schema = z.object({ disabled: z.boolean().optional(), isAdmin: z.boolean().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { disabled, isAdmin } = parsed.data;
  await query(`UPDATE users SET disabled = COALESCE($2, disabled), is_admin = COALESCE($3, is_admin) WHERE id = $1`, [
    req.params.id,
    disabled,
    isAdmin
  ]);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", auth, adminOnly, async (req, res) => {
  await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

app.get("/api/admin/conversations", auth, adminOnly, async (_req, res) => {
  const rows = await query<{ id: string; title: string; email: string; updated_at: string; messages: string }>(
    `SELECT s.id, s.title, u.email, s.updated_at, COUNT(m.id)::text AS messages
     FROM chat_sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN chat_messages m ON m.session_id = s.id
     GROUP BY s.id, u.email
     ORDER BY s.updated_at DESC`
  );
  res.json(rows);
});

app.get("/api/admin/memories", auth, adminOnly, async (_req, res) => {
  const rows = await query<{ id: string; content: string; email: string; updated_at: string }>(
    `SELECT m.id, m.content, u.email, m.updated_at
     FROM memories m JOIN users u ON u.id = m.user_id
     ORDER BY m.updated_at DESC`
  );
  res.json(rows);
});

app.patch("/api/admin/memories/:id", auth, adminOnly, async (req, res) => {
  const schema = z.object({ content: z.string().min(3).max(500) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid memory" });
  }
  await query(`UPDATE memories SET content = $2, updated_at = NOW() WHERE id = $1`, [req.params.id, parsed.data.content]);
  res.json({ ok: true });
});

app.get("/api/admin/settings", auth, adminOnly, async (_req, res) => {
  const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM settings ORDER BY key ASC`);
  res.json(rows);
});

app.put("/api/admin/settings", auth, adminOnly, async (req, res) => {
  const schema = z.object({ key: z.string().min(2), value: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid setting" });
  }
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [parsed.data.key, parsed.data.value]
  );
  res.json({ ok: true });
});

app.get("/api/admin/analytics", auth, adminOnly, async (_req, res) => {
  const [users] = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users`);
  const [sessions] = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM chat_sessions`);
  const [messages] = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM chat_messages`);
  const [memory] = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM memories`);
  res.json({ users: Number(users.count), sessions: Number(sessions.count), messages: Number(messages.count), memories: Number(memory.count) });
});

app.get("/api/admin/logs", auth, adminOnly, async (_req, res) => {
  const rows = await query<{ id: string; action: string; created_at: string; payload: unknown }>(
    `SELECT id, action, created_at, payload FROM audit_logs ORDER BY created_at DESC LIMIT 100`
  );
  res.json(rows);
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message || "Server error" });
});

const start = async () => {
  await ensureSchema();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Clover backend running on :${config.port}`);
  });
};

start().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  await pool.end();
  process.exit(1);
});
