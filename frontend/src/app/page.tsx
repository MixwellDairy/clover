"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Session = { id: string; title: string };
type Message = { id: string; role: string; content: string; created_at: string };
type User = { id: string; email: string; name: string; is_admin: boolean };

export default function Home() {
  const [token, setToken] = useState<string>("");
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("clover_token");
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    window.localStorage.setItem("clover_token", token);
    api<User>("/api/me", {}, token)
      .then(setUser)
      .catch(() => {
        setToken("");
        window.localStorage.removeItem("clover_token");
      });
  }, [token]);

  const refreshSessions = useCallback(async (activeId?: string) => {
    const list = await api<Session[]>("/api/chat/sessions", {}, token);
    setSessions(list);
    const selected = activeId || list[0]?.id || "";
    setActiveSessionId(selected);
    if (selected) {
      const msg = await api<Message[]>(`/api/chat/sessions/${selected}/messages`, {}, token);
      setMessages(msg);
    } else {
      setMessages([]);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      refreshSessions().catch((err: Error) => setError(err.message));
    }
  }, [refreshSessions, token]);

  useEffect(() => {
    if (!token || !activeSessionId) return;
    api<Message[]>(`/api/chat/sessions/${activeSessionId}/messages`, {}, token)
      .then(setMessages)
      .catch((err: Error) => setError(err.message));
  }, [activeSessionId, token]);

  const submitAuth = async () => {
    setError("");
    try {
      const path = isSignup ? "/api/auth/signup" : "/api/auth/login";
      const payload = isSignup ? { email, password, name } : { email, password };
      const result = await api<{ token: string }>(path, { method: "POST", body: JSON.stringify(payload) });
      setToken(result.token);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const newSession = async () => {
    const created = await api<Session>(
      "/api/chat/sessions",
      { method: "POST", body: JSON.stringify({ title: `Chat ${new Date().toLocaleString()}` }) },
      token
    );
    await refreshSessions(created.id);
  };

  const send = async () => {
    if (!activeSessionId || !draft.trim()) return;
    const content = draft.trim();
    setDraft("");
    await api<{ reply: string }>(
      `/api/chat/sessions/${activeSessionId}/messages`,
      { method: "POST", body: JSON.stringify({ content }) },
      token
    );
    const updated = await api<Message[]>(`/api/chat/sessions/${activeSessionId}/messages`, {}, token);
    setMessages(updated);
    await refreshSessions(activeSessionId);
  };

  const sortedMessages = useMemo(() => [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at)), [messages]);

  if (!user) {
    return (
      <main className="page auth-shell">
        <section className="panel auth-panel">
          <h1>Clover</h1>
          <p>Multi-user AI chat with smart memory.</p>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {isSignup && <input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />}
          <button onClick={submitAuth}>{isSignup ? "Create account" : "Login"}</button>
          <button className="ghost" onClick={() => setIsSignup((prev) => !prev)}>
            {isSignup ? "Have an account? Login" : "New user? Sign up"}
          </button>
          {error && <p className="error">{error}</p>}
          <p className="hint">Default admin: admin@clover.local / admin123</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page app-shell">
      <aside className="panel sidebar">
        <div>
          <h2>Chats</h2>
          <p>{user.name}</p>
          {user.is_admin && <a href="/admin">Open Admin Panel</a>}
        </div>
        <button onClick={newSession}>+ New Session</button>
        <div className="session-list">
          {sessions.map((session) => (
            <button key={session.id} className={session.id === activeSessionId ? "active" : ""} onClick={() => setActiveSessionId(session.id)}>
              {session.title}
            </button>
          ))}
        </div>
        <button
          className="ghost"
          onClick={() => {
            setToken("");
            window.localStorage.removeItem("clover_token");
          }}
        >
          Logout
        </button>
      </aside>
      <section className="panel chat">
        <div className="messages">
          {sortedMessages.map((message) => (
            <article key={message.id} className={`msg ${message.role}`}>
              <strong>{message.role === "assistant" ? "Clover" : "You"}</strong>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
        <div className="composer">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your message..." />
          <button onClick={send}>Send</button>
        </div>
      </section>
    </main>
  );
}
