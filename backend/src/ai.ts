import { config } from "./config";

type Message = { role: "system" | "user" | "assistant"; content: string };
type ProviderOptions = {
  provider?: string;
  groqApiKey?: string;
  groqModel?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
};

const trimReply = (text: string) => text.trim().slice(0, 4000);

const callGroq = async (messages: Message[], options?: ProviderOptions) => {
  const groqApiKey = options?.groqApiKey || config.groqApiKey;
  const groqModel = options?.groqModel || config.groqModel;

  if (!groqApiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqApiKey}`
    },
    body: JSON.stringify({
      model: groqModel,
      messages,
      temperature: 0.5
    })
  });

  if (!response.ok) {
    throw new Error(`Groq request failed: ${response.status}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return trimReply(data.choices?.[0]?.message?.content || "");
};

const callOllama = async (messages: Message[], options?: ProviderOptions) => {
  const ollamaUrl = options?.ollamaUrl || config.ollamaUrl;
  const ollamaModel = options?.ollamaModel || config.ollamaModel;
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status}`);
  }

  const data = (await response.json()) as { message?: { content?: string } };
  return trimReply(data.message?.content || "");
};

export const generateAssistantReply = async (messages: Message[], options?: ProviderOptions) => {
  try {
    if ((options?.provider || config.aiProvider).toLowerCase() === "ollama") {
      return await callOllama(messages, options);
    }
    return await callGroq(messages, options);
  } catch {
    return "I couldn't reach the configured AI provider right now. Please verify Groq/Ollama settings in admin and try again.";
  }
};
