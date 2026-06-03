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

// Detect if file is an image
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

// Detect if file is a text-based file
export function isTextFile(file: File): boolean {
  const textTypes = [
    "text/plain",
    "text/csv",
    "text/html",
    "text/css",
    "text/javascript",
    "application/json",
    "application/xml",
    "text/xml",
    "text/markdown",
  ];
  const textExtensions = [
    ".txt", ".csv", ".md", ".json", ".xml", ".html",
    ".css", ".js", ".ts", ".tsx", ".jsx", ".py",
    ".java", ".c", ".cpp", ".cs", ".go", ".rs",
    ".php", ".rb", ".swift", ".kt", ".yaml", ".yml",
    ".toml", ".ini", ".env", ".sh", ".bash",
  ];

  if (textTypes.includes(file.type)) return true;

  const fileName = file.name.toLowerCase();
  return textExtensions.some((ext) => fileName.endsWith(ext));
}

// Extract text from any file
export async function extractTextFromFile(file: File): Promise<string> {
  // Text-based files — read directly
  if (isTextFile(file)) {
    try {
      const text = await file.text();
      return text || "[Empty file]";
    } catch {
      return "[Could not read file]";
    }
  }

  // PDF — extract readable text
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const binary = reader.result as string;

          // Extract text between stream markers
          const streamRegex = /stream([\s\S]*?)endstream/g;
          let extractedChunks: string[] = [];
          let match;

          while ((match = streamRegex.exec(binary)) !== null) {
            const chunk = match[1]
              .replace(/[^\x20-\x7E\n\r\t]/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            if (chunk.length > 20) extractedChunks.push(chunk);
          }

          // Fallback: extract all readable ASCII text
          if (extractedChunks.length === 0) {
            const fallback = binary
              .replace(/[^\x20-\x7E\n\r\t]/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            extractedChunks = [fallback];
          }

          const result = extractedChunks.join("\n").slice(0, 50000);
          resolve(result || "[Could not extract PDF text — try copy-pasting the content]");
        } catch {
          resolve("[Could not extract PDF text]");
        }
      };
      reader.onerror = () => resolve("[Could not read PDF file]");
      reader.readAsBinaryString(file);
    });
  }

  // Word documents (.docx) — extract readable text
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const binary = reader.result as string;
          // Extract text content from XML inside docx
          const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
          const texts: string[] = [];
          let match;
          while ((match = textRegex.exec(binary)) !== null) {
            if (match[1].trim()) texts.push(match[1]);
          }
          const result = texts.join(" ").slice(0, 50000);
          resolve(result || "[Could not extract Word document text]");
        } catch {
          resolve("[Could not extract Word document text]");
        }
      };
      reader.onerror = () => resolve("[Could not read Word document]");
      reader.readAsBinaryString(file);
    });
  }

  return `[File: ${file.name} — ${(file.size / 1024).toFixed(1)}KB — preview not available for this file type]`;
}

// Convert image to base64 for Groq vision
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
