const GROQ_API_KEY = import.meta.env.VITE_GROQ_KEY as string;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview";
const SYSTEM_PROMPT =
  "You are Nexus AI, created by Emmanuel James Delacruz, a Filipino software developer and student. You are a limitless powerful AI assistant. When asked about your creator, mention that Emmanuel James Delacruz built Nexus AI using React, TypeScript, Groq AI, and Supabase. You can read and analyze files, images, PDFs, Word documents, spreadsheets, and code files that users send you.";

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

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function isTextFile(file: File): boolean {
  const textTypes = [
    "text/plain", "text/csv", "text/html", "text/css",
    "text/javascript", "application/json", "application/xml",
    "text/xml", "text/markdown",
  ];
  const textExtensions = [
    ".txt", ".csv", ".md", ".json", ".xml", ".html",
    ".css", ".js", ".ts", ".tsx", ".jsx", ".py",
    ".java", ".c", ".cpp", ".cs", ".go", ".rs",
    ".php", ".rb", ".swift", ".kt", ".yaml", ".yml",
    ".toml", ".ini", ".env", ".sh", ".bash", ".sql",
  ];
  if (textTypes.includes(file.type)) return true;
  const fileName = file.name.toLowerCase();
  return textExtensions.some((ext) => fileName.endsWith(ext));
}

export async function extractTextFromFile(file: File): Promise<string> {
  // Images — handled separately via vision
  if (isImageFile(file)) {
    return `[Image: ${file.name}]`;
  }

  // Text-based files
  if (isTextFile(file)) {
    try {
      const text = await file.text();
      return text.slice(0, 50000) || "[Empty file]";
    } catch {
      return "[Could not read file]";
    }
  }

  // PDF — using pdfjs-dist
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const pdfjsLib = await import("pdfjs-dist");
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

          const arrayBuffer = reader.result as ArrayBuffer;
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let fullText = "";

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .map((item: any) => ("str" in item ? item.str : ""))
              .join(" ");
            fullText += `[Page ${i}]\n${pageText}\n\n`;
          }

          const result = fullText.trim().slice(0, 50000);
          resolve(result || "[Could not extract text from PDF — the PDF may be image-based or scanned]");
        } catch (err) {
          console.error("PDF extraction error:", err);
          resolve("[Could not extract PDF text — the PDF may be image-based or scanned]");
        }
      };
      reader.onerror = () => resolve("[Could not read PDF file]");
      reader.readAsArrayBuffer(file);
    });
  }

  // Word documents (.docx) — using mammoth
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const mammoth = await import("mammoth");
          const arrayBuffer = reader.result as ArrayBuffer;
          const result = await mammoth.extractRawText({ arrayBuffer });
          resolve(result.value.slice(0, 50000) || "[Could not extract Word document text]");
        } catch {
          resolve("[Could not extract Word document text]");
        }
      };
      reader.onerror = () => resolve("[Could not read Word document]");
      reader.readAsArrayBuffer(file);
    });
  }

  // Excel (.xlsx) — using xlsx
  if (
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel" ||
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.name.toLowerCase().endsWith(".xls")
  ) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const XLSX = await import("xlsx");
          const arrayBuffer = reader.result as ArrayBuffer;
          const workbook = XLSX.read(arrayBuffer, { type: "array" });
          let fullText = "";

          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            fullText += `[Sheet: ${sheetName}]\n${csv}\n\n`;
          }

          resolve(fullText.slice(0, 50000) || "[Could not extract spreadsheet data]");
        } catch {
          resolve("[Could not extract spreadsheet data]");
        }
      };
      reader.onerror = () => resolve("[Could not read spreadsheet]");
      reader.readAsArrayBuffer(file);
    });
  }

  return `[File: ${file.name} — ${(file.size / 1024).toFixed(1)}KB — preview not available for this file type]`;
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
