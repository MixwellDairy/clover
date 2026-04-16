"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type AdminUser = { id: string; email: string; name: string; is_admin: boolean; disabled: boolean };
type Memory = { id: string; content: string; email: string; updated_at: string };
type Conversation = { id: string; title: string; email: string; updated_at: string; messages: string };
type Setting = { key: string; value: string };
type Analytics = { users: number; sessions: number; messages: number; memories: number };

export default function AdminPage() {
  const [token] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem("clover_token") || ""));
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [settingKey, setSettingKey] = useState("groq_api_key");
  const [settingValue, setSettingValue] = useState("");
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
  };

  useEffect(() => {
    if (missingToken) {
      return;
    }
    load(token).catch((err: Error) => setError(err.message));
  }, [missingToken, token]);

  const upsertSetting = async (key: string, value: string) => {
    await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ key, value }) }, token);
    await load(token);
  };

  return (
    <main className="page admin-shell">
      <section className="panel">
        <h1>Admin Dashboard</h1>
        <p>Manage users, conversations, memory and model settings.</p>
        <Link href="/">Back to chat</Link>
        {(missingToken || error) && <p className="error">{missingToken ? "Login first, then open /admin" : error}</p>}
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
        <h2>Model Settings</h2>
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
