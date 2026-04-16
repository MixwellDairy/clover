"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type AdminUser = { id: string; email: string; name: string; is_admin: boolean; disabled: boolean; daily_message_limit: number };
type Memory = { id: string; content: string; email: string; updated_at: string };
type Conversation = { id: string; title: string; email: string; updated_at: string; messages: string };
type Setting = { key: string; value: string };
type Analytics = { users: number; sessions: number; messages: number; memories: number };
const DEFAULT_MODEL_PROFILES_JSON =
  '[\n  {"id":"groq-fast","name":"Groq Fast","provider":"groq","model":"llama-3.1-8b-instant"},\n  {"id":"local-ollama","name":"Local Ollama","provider":"ollama","model":"llama3.1","url":"http://localhost:11434"}\n]';

export default function AdminPage() {
  const [token] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem("clover_token") || ""));
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [settingKey, setSettingKey] = useState("groq_api_key");
  const [settingValue, setSettingValue] = useState("");
  const [groqApiKeysText, setGroqApiKeysText] = useState("");
  const [activeGroqKeyIndex, setActiveGroqKeyIndex] = useState("0");
  const [modelProfilesText, setModelProfilesText] = useState(DEFAULT_MODEL_PROFILES_JSON);
  const [activeModelProfile, setActiveModelProfile] = useState("");
  const [usageDrafts, setUsageDrafts] = useState<Record<string, string>>({});
  const missingToken = !token;

  const load = async (authToken: string) => {
    const [u, m, c, s, a] = await Promise.all([
      api<AdminUser[]>("/api/admin/users", {}, authToken),
      api<Memory[]>("/api/admin/memories", {}, authToken),
      api<Conversation[]>("/api/admin/conversations", {}, authToken),
      api<Setting[]>("/api/admin/settings", {}, authToken),
      api<Analytics>("/api/admin/analytics", {}, authToken)
    ]);
    setUsers(u);
    setMemories(m);
    setConversations(c);
    setSettings(s);
    setAnalytics(a);
    const settingsMap = Object.fromEntries(s.map((setting) => [setting.key, setting.value]));
    const savedGroqKeys = (() => {
      try {
        const parsed = JSON.parse(settingsMap.groq_api_keys || "[]");
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").join("\n") : "";
      } catch {
        return "";
      }
    })();
    setGroqApiKeysText(savedGroqKeys);
    setActiveGroqKeyIndex(settingsMap.groq_api_key_index || "0");
    if (settingsMap.model_profiles) {
      setModelProfilesText(settingsMap.model_profiles);
    }
    setActiveModelProfile(settingsMap.active_model_profile || "");
    setUsageDrafts(Object.fromEntries(u.map((user) => [user.id, String(user.daily_message_limit)])));
  };

  useEffect(() => {
    if (missingToken) {
      return;
    }
    load(token).catch((err: Error) => setError(err.message));
  }, [missingToken, token]);

  const upsertSettings = async (entries: Array<{ key: string; value: string }>) => {
    await Promise.all(entries.map((entry) => api("/api/admin/settings", { method: "PUT", body: JSON.stringify(entry) }, token)));
    await load(token);
  };

  const upsertSetting = async (key: string, value: string) => {
    await upsertSettings([{ key, value }]);
  };

  const saveApiKeys = async () => {
    const keys = groqApiKeysText
      .split("\n")
      .map((key) => key.trim())
      .filter(Boolean);
    const indexValue = Number(activeGroqKeyIndex);
    if (!Number.isInteger(indexValue) || indexValue < 0) {
      setError("Active API key index must be a non-negative integer.");
      return;
    }
    setError("");
    await upsertSettings([
      { key: "groq_api_keys", value: JSON.stringify(keys) },
      { key: "groq_api_key_index", value: String(indexValue) }
    ]);
    setStatus("Saved API key settings.");
  };

  const saveModelProfiles = async () => {
    try {
      const parsed = JSON.parse(modelProfilesText);
      if (!Array.isArray(parsed)) {
        setError("Model profiles must be a JSON array.");
        return;
      }
    } catch {
      setError("Model profiles must be valid JSON.");
      return;
    }
    setError("");
    await upsertSettings([
      { key: "model_profiles", value: modelProfilesText },
      { key: "active_model_profile", value: activeModelProfile.trim() }
    ]);
    setStatus("Saved model profile settings.");
  };

  const updateUsageLimit = async (userId: string) => {
    const limit = Number(usageDrafts[userId]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
      setError("Usage limit must be an integer between 1 and 10000.");
      return;
    }
    setError("");
    await api("/api/admin/users/" + userId, { method: "PATCH", body: JSON.stringify({ dailyMessageLimit: limit }) }, token);
    await load(token);
    setStatus("Updated user usage limit.");
  };

  return (
    <main className="page admin-shell">
      <section className="panel">
        <h1>Admin Dashboard</h1>
        <p>Manage users, conversations, memory and model settings.</p>
        <Link href="/">Back to chat</Link>
        {(missingToken || error) && <p className="error">{missingToken ? "Login first, then open /admin" : error}</p>}
        {status && <p className="hint">{status}</p>}
      </section>

      {analytics && (
        <section className="panel metrics">
          <h2>Analytics</h2>
          <div>
            <span>Users: {analytics.users}</span>
            <span>Sessions: {analytics.sessions}</span>
            <span>Messages: {analytics.messages}</span>
            <span>Memories: {analytics.memories}</span>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Users</h2>
        <div className="table-grid">
          {users.map((user) => (
            <article key={user.id} className="row">
              <p>{user.email}</p>
              <p>{user.name}</p>
              <p>{user.is_admin ? "Admin" : "User"}</p>
              <p>{user.disabled ? "Disabled" : "Active"}</p>
              <div className="setting-actions">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={usageDrafts[user.id] ?? String(user.daily_message_limit)}
                  onChange={(e) => setUsageDrafts((prev) => ({ ...prev, [user.id]: e.target.value }))}
                  placeholder="Daily message limit"
                />
                <button onClick={() => updateUsageLimit(user.id)}>Save limit</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Conversations</h2>
        <div className="table-grid">
          {conversations.map((conversation) => (
            <article key={conversation.id} className="row">
              <p>{conversation.title}</p>
              <p>{conversation.email}</p>
              <p>{conversation.messages} messages</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Memories</h2>
        <div className="table-grid">
          {memories.map((memory) => (
            <article key={memory.id} className="row">
              <p>{memory.email}</p>
              <p>{memory.content}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>AI Access and Model Settings</h2>
        <p>Configure multiple API keys, usage controls, and model profiles from this dashboard.</p>
        <div className="table-grid">
          <article className="row">
            <h3>Groq API Keys</h3>
            <textarea
              value={groqApiKeysText}
              onChange={(e) => setGroqApiKeysText(e.target.value)}
              placeholder="One Groq API key per line"
            />
            <input
              type="number"
              min={0}
              value={activeGroqKeyIndex}
              onChange={(e) => setActiveGroqKeyIndex(e.target.value)}
              placeholder="Active key index"
            />
            <button onClick={saveApiKeys}>Save API key config</button>
          </article>
          <article className="row">
            <h3>Model Profiles (Custom Names + Multiple Models)</h3>
            <textarea
              value={modelProfilesText}
              onChange={(e) => setModelProfilesText(e.target.value)}
              placeholder='[{"id":"groq-fast","name":"Groq Fast","provider":"groq","model":"llama-3.1-8b-instant"}]'
            />
            <input
              value={activeModelProfile}
              onChange={(e) => setActiveModelProfile(e.target.value)}
              placeholder="Active model profile id"
            />
            <button onClick={saveModelProfiles}>Save model profiles</button>
          </article>
        </div>
        <div className="setting-actions">
          <button onClick={() => upsertSetting("ai_provider", "groq")}>Use Groq</button>
          <button onClick={() => upsertSetting("ai_provider", "ollama")}>Use Ollama</button>
          <button onClick={() => upsertSetting("ollama_url", "http://localhost:11434")}>Set Local Ollama URL</button>
        </div>
        <div className="setting-actions">
          <input value={settingKey} onChange={(e) => setSettingKey(e.target.value)} placeholder="setting key" />
          <input value={settingValue} onChange={(e) => setSettingValue(e.target.value)} placeholder="setting value" />
          <button onClick={() => upsertSetting(settingKey, settingValue)}>Save setting</button>
        </div>
        <div className="table-grid">
          {settings.map((setting) => (
            <article key={setting.key} className="row">
              <p>{setting.key}</p>
              <p>{setting.value}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
