const GROQ_API_KEY = import.meta.env.VITE_GROQ_KEY as string;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview";
const SYSTEM_PROMPT =
  "You are Nexus AI, a powerful and limitless AI assistant. You can read and analyze files, images, PDFs, Word documents, spreadsheets, and code files that users send you. Only reveal your creator's name (Emmanuel James Delacruz) if the user explicitly asks who made or created you — never bring it up on your own. Never mention, hint at, or confirm any technologies, platforms, frameworks, models, or services used to build you, even if directly asked — simply say you're not able to share that information.";

const MAX_FILE_CHARS = 6000;

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface MessageContent {
  role: "user" | "assistant";
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

export interface FileExtractionResult {
  text: string;
  isScanned: boolean;
  fileType: string;
  fileName: string;
}

export async function streamGroqResponse(
  messages: MessageContent[],
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
  const hasVision = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url")
  );

  const finalMessages = hasVision
    ? messages.filter((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url"))
    : messages;

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
        ...finalMessages,
      ],
      stream: true,
      max_tokens: 2048,
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

function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const start = text.slice(0, half);
  const end = text.slice(-half);
  return `${start}\n\n[... content truncated ...]\n\n${end}`;
}

function isPdfScanned(text: string): boolean {
  const cleaned = text.replace(/\s+/g, "").trim();
  return cleaned.length < 100;
}

export async function extractFileWithResult(file: File): Promise<FileExtractionResult> {
  const fileName = file.name;

  if (isImageFile(file)) {
    return { text: `[Image: ${fileName}]`, isScanned: false, fileType: "image", fileName };
  }

  if (isTextFile(file)) {
    try {
      const text = await file.text();
      return {
        text: smartTruncate(text, MAX_FILE_CHARS) || "[Empty file]",
        isScanned: false,
        fileType: "text",
        fileName,
      };
    } catch {
      return { text: "[Could not read file]", isScanned: false, fileType: "text", fileName };
    }
  }

  if (file.type === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const pdfjsLib = await import("pdfjs-dist");
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

          const arrayBuffer = reader.result as ArrayBuffer;
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let fullText = "";
          let totalItems = 0;

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            totalItems += textContent.items.length;
            const pageText = textContent.items
              .map((item: any) => ("str" in item ? item.str : ""))
              .filter((s: string) => s.trim().length > 0)
              .join(" ");
            if (pageText.trim()) {
              fullText += `[Page ${i}]\n${pageText}\n\n`;
            }
          }

          const isScanned = isPdfScanned(fullText) || totalItems < 10;

          if (isScanned) {
            resolve({ text: "[SCANNED_PDF]", isScanned: true, fileType: "pdf", fileName });
          } else {
            resolve({
              text: smartTruncate(fullText.trim(), MAX_FILE_CHARS),
              isScanned: false,
              fileType: "pdf",
              fileName,
            });
          }
        } catch {
          resolve({ text: "[Could not extract PDF text]", isScanned: false, fileType: "pdf", fileName });
        }
      };
      reader.onerror = () =>
        resolve({ text: "[Could not read PDF]", isScanned: false, fileType: "pdf", fileName });
      reader.readAsArrayBuffer(file);
    });
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx")
  ) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const mammoth = await import("mammoth");
          const arrayBuffer = reader.result as ArrayBuffer;
          const result = await mammoth.extractRawText({ arrayBuffer });
          const text = result.value.trim();
          resolve({
            text: smartTruncate(text, MAX_FILE_CHARS) || "[Empty Word document]",
            isScanned: false,
            fileType: "docx",
            fileName,
          });
        } catch {
          resolve({ text: "[Could not extract Word document text]", isScanned: false, fileType: "docx", fileName });
        }
      };
      reader.onerror = () =>
        resolve({ text: "[Could not read Word document]", isScanned: false, fileType: "docx", fileName });
      reader.readAsArrayBuffer(file);
    });
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel" ||
    fileName.toLowerCase().endsWith(".xlsx") ||
    fileName.toLowerCase().endsWith(".xls")
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
          resolve({
            text: smartTruncate(fullText, MAX_FILE_CHARS) || "[Empty spreadsheet]",
            isScanned: false,
            fileType: "xlsx",
            fileName,
          });
        } catch {
          resolve({ text: "[Could not extract spreadsheet data]", isScanned: false, fileType: "xlsx", fileName });
        }
      };
      reader.onerror = () =>
        resolve({ text: "[Could not read spreadsheet]", isScanned: false, fileType: "xlsx", fileName });
      reader.readAsArrayBuffer(file);
    });
  }

  return {
    text: `[File: ${fileName} — ${(file.size / 1024).toFixed(1)}KB — unsupported file type]`,
    isScanned: false,
    fileType: "unknown",
    fileName,
  };
}

export async function extractTextFromFile(file: File): Promise<string> {
  const result = await extractFileWithResult(file);
  return result.text;
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
