export type MemorySnippet = {
  content: string;
  score: number;
};

const MEMORY_PATTERNS = [/\bi like\b/i, /\bi prefer\b/i, /\bmy\b/i, /\bi am\b/i, /\bi work\b/i];

export const extractMemorySnippets = (text: string): string[] => {
  return text
    .split(/[.!?\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 5 && MEMORY_PATTERNS.some((pattern) => pattern.test(part)))
    .slice(0, 3);
};

export const rankRelevantMemories = (input: string, memories: Array<{ content: string }>): MemorySnippet[] => {
  const words = new Set(input.toLowerCase().split(/\W+/).filter(Boolean));
  return memories
    .map((memory) => {
      const overlap = memory.content
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => words.has(w)).length;
      return { content: memory.content, score: overlap };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
};
