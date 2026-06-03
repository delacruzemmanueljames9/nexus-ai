const GROQ_API_KEY = import.meta.env.VITE_GROQ_KEY as string;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview";
const SYSTEM_PROMPT =
  "You are Nexus AI, created by Emmanuel James Delacruz. You are a limitless powerful AI assistant.";

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface MessageContent {
  role: "user" | "assistant";
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

export async function streamGroqResponse(
  messages: MessageContent[],
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
  const hasVision = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url")
  );

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: hasVision ? GROQ_VISION_MODEL : GROQ_MODEL,
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

    // Process complete lines only
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line || line === "data: [DONE]") continue;
      if (!line.startsWith("data: ")) continue;

      try {
        const json = JSON.parse(line.slice(6));
        const content = json.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) {
          onChunk({ content, done: false });
        }
      } catch {
        // skip malformed
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim() && buffer.trim() !== "data: [DONE]" && buffer.trim().startsWith("data: ")) {
    try {
      const json = JSON.parse(buffer.trim().slice(6));
      const content = json.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) {
        onChunk({ content, done: false });
      }
    } catch {
      // skip
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

export async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === "text/plain" || file.type === "text/csv") {
    return await file.text();
  }

  if (file.type === "application/pdf") {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = reader.result as string;
          const extracted = text
            .replace(/[^\x20-\x7E\n]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 8000);
          resolve(extracted || "[Could not extract PDF text]");
        } catch {
          resolve("[Could not extract PDF text]");
        }
      };
      reader.readAsText(file);
    });
  }

  return "[Unsupported file type]";
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
