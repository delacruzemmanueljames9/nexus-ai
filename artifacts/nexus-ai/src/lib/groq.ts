const GROQ_API_KEY = import.meta.env.VITE_GROQ_KEY as string;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const SYSTEM_PROMPT =
  "You are Nexus AI, created by Emmanuel Delacruz. You are a helpful, capable AI assistant.";

const OWNER_SYSTEM_PROMPT =
  "You are Nexus AI, created by Emmanuel Delacruz. You are currently speaking with your verified owner, Emmanuel James Delacruz. You may speak more openly and personally with them, while still following your normal safety guidelines.";

export interface StreamChunk {
  content: string;
  done: boolean;
}

async function consumeSSEStream(
  response: Response,
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
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
        if (content) onChunk({ content, done: false });
      } catch {
        // skip malformed
      }
    }
  }

  onChunk({ content: "", done: true });
}

export async function streamGroqResponse(
  messages: { role: "user" | "assistant"; content: string }[],
  onChunk: (chunk: StreamChunk) => void,
  isOwner: boolean = false
): Promise<void> {
  const activeSystemPrompt = isOwner ? OWNER_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: activeSystemPrompt }, ...messages],
      stream: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error: ${response.status} ${err}`);
  }

  await consumeSSEStream(response, onChunk);
}

export async function streamGroqVisionResponse(
  history: { role: "user" | "assistant"; content: string }[],
  imageDataUrl: string,
  userText: string,
  onChunk: (chunk: StreamChunk) => void,
  isOwner: boolean = false
): Promise<void> {
  const activeSystemPrompt = isOwner ? OWNER_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const currentContent: Array<Record<string, unknown>> = [];

  const textToSend = userText.trim() || "Describe this image in detail.";
  currentContent.push({ type: "text", text: textToSend });
  currentContent.push({ type: "image_url", image_url: { url: imageDataUrl } });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: activeSystemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: currentContent },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq Vision API error: ${response.status} ${err}`);
  }

  await consumeSSEStream(response, onChunk);
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
