const GROQ_API_KEY = import.meta.env.VITE_GROQ_KEY as string;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const SYSTEM_PROMPT =
  "You are Nexus AI, created by Emmanuel Delacruz. You are a limitless powerful AI assistant.";

export interface StreamChunk {
  content: string;
  done: boolean;
}

export async function streamGroqResponse(
  messages: { role: "user" | "assistant"; content: string }[],
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error: ${response.status} ${err}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const json = JSON.parse(trimmed.slice(6));
        const content = json.choices?.[0]?.delta?.content ?? "";
        if (content) {
          onChunk({ content, done: false });
        }
      } catch {
        // skip malformed
      }
    }
  }

  onChunk({ content: "", done: true });
}

export async function generateTitle(
  userMessage: string,
  assistantMessage: string
): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Generate a concise, descriptive title (3–6 words, no punctuation, no quotes) for a chat conversation based on the first exchange. Respond with ONLY the title, nothing else.",
        },
        {
          role: "user",
          content: `User: ${userMessage}\n\nAssistant: ${assistantMessage.slice(0, 300)}`,
        },
      ],
      stream: false,
      max_tokens: 20,
    }),
  });

  if (!response.ok) return "";
  const json = await response.json();
  return (json.choices?.[0]?.message?.content ?? "").trim().slice(0, 60);
}
