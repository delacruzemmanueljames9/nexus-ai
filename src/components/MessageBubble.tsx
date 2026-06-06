import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { Components } from "react-markdown";
import { Sparkles, User, Copy, Check, RefreshCw, FileText, Image, Play, X, Github, CheckCircle } from "lucide-react";
import { useState } from "react";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
  isLast?: boolean;
  onRegenerate?: () => void;
  isStreaming?: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-all">
      {copied ? <><Check className="w-3 h-3 text-green-400" /><span className="text-green-400">Copied</span></> : <><Copy className="w-3 h-3" /><span>Copy</span></>}
    </button>
  );
}

function GitHubPushButton({ code, filename }: { code: string; filename: string }) {
  const [status, setStatus] = useState<"idle" | "pushing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handlePush = async () => {
    const token = localStorage.getItem("nexus_github_token");
    const repo = localStorage.getItem("nexus_github_repo");

    if (!token || !repo) {
      setErrorMsg("Set GitHub token & repo in Settings first.");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
      return;
    }

    setStatus("pushing");
    try {
      const path = filename || "nexus-output.txt";
      const content = btoa(unescape(encodeURIComponent(code)));

      // Check if file exists
      let sha: string | undefined;
      const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (checkRes.ok) {
        const existing = await checkRes.json();
        sha = existing.sha;
      }

      const pushRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Add ${path} via Nexus AI`,
          content,
          ...(sha ? { sha } : {}),
        }),
      });

      if (!pushRes.ok) throw new Error(await pushRes.text());
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message?.slice(0, 60) ?? "Push failed");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  return (
    <button
      onClick={handlePush}
      disabled={status === "pushing"}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${
        status === "success"
          ? "text-green-400"
          : status === "error"
          ? "text-red-400"
          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60"
      }`}
      title={status === "error" ? errorMsg : "Push to GitHub"}
    >
      {status === "pushing" ? (
        <RefreshCw className="w-3 h-3 animate-spin" />
      ) : status === "success" ? (
        <CheckCircle className="w-3 h-3" />
      ) : (
        <Github className="w-3 h-3" />
      )}
      <span>
        {status === "pushing" ? "Pushing..." : status === "success" ? "Pushed!" : status === "error" ? errorMsg : "Push"}
      </span>
    </button>
  );
}

function PreviewModal({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/60">
          <span className="text-sm font-medium text-zinc-300">Preview</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <iframe
          className="flex-1 w-full rounded-b-2xl bg-white"
          srcDoc={code}
          sandbox="allow-scripts"
          title="preview"
        />
      </div>
    </div>
  );
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (match) => {
      return match.replace(/```(\w+)?\n?/g, "").replace(/```/g, "");
    })
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/^\d+\.\s+/gm, (m) => m)
    .replace(/^>\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMessageContent(content: string) {
  const imageMatchWithUrl = content.match(/\[Image: (.+?)\|(.+?)\]/);
  const imageMatchNoUrl = content.match(/\[Image: (.+?)\]/);
  const fileMatch = content.match(/\[File: (.+?)\]\n([\s\S]*)/);

  let textPart = content;
  let imageName: string | null = null;
  let imageUrl: string | null = null;
  let fileName: string | null = null;

  if (imageMatchWithUrl) {
    imageName = imageMatchWithUrl[1];
    imageUrl = imageMatchWithUrl[2];
    textPart = content.replace(imageMatchWithUrl[0], "").trim();
  } else if (imageMatchNoUrl) {
    imageName = imageMatchNoUrl[1];
    textPart = content.replace(imageMatchNoUrl[0], "").trim();
  }

  if (fileMatch) {
    fileName = fileMatch[1];
    textPart = textPart.replace(`[File: ${fileName}]\n${fileMatch[2]}`, "").trim();
  }

  return { textPart, imageName, imageUrl, fileName };
}

const makeMarkdownComponents = (): Components => ({
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const codeString = String(children).replace(/\n$/, "");
    const isBlock = !!match || codeString.includes("\n");

    if (isBlock) {
      const language = match?.[1] ?? "text";
      const isHTML = language === "html";
      const filename = isHTML ? "index.html" : `code.${language}`;

      return (
        <CodeBlock
          language={language}
          codeString={codeString}
          filename={filename}
          isHTML={isHTML}
        />
      );
    }
    return <code className="px-1.5 py-0.5 rounded-md bg-zinc-700/60 text-violet-300 text-[0.8125rem] font-mono" {...props}>{children}</code>;
  },
  p({ children }) { return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>; },
  ul({ children }) { return <ul className="mb-3 last:mb-0 pl-5 space-y-1 list-disc marker:text-zinc-500">{children}</ul>; },
  ol({ children }) { return <ol className="mb-3 last:mb-0 pl-5 space-y-1 list-decimal marker:text-zinc-500">{children}</ol>; },
  li({ children }) { return <li className="leading-relaxed">{children}</li>; },
  h1({ children }) { return <h1 className="text-xl font-bold text-white mb-3 mt-4 first:mt-0">{children}</h1>; },
  h2({ children }) { return <h2 className="text-lg font-bold text-white mb-2 mt-4 first:mt-0">{children}</h2>; },
  h3({ children }) { return <h3 className="text-base font-semibold text-zinc-100 mb-2 mt-3 first:mt-0">{children}</h3>; },
  strong({ children }) { return <strong className="font-semibold text-white">{children}</strong>; },
  em({ children }) { return <em className="italic text-zinc-300">{children}</em>; },
  blockquote({ children }) { return <blockquote className="my-3 pl-4 border-l-2 border-violet-500/60 text-zinc-400 italic">{children}</blockquote>; },
  a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors">{children}</a>; },
  hr() { return <hr className="my-4 border-zinc-700/60" />; },
  table({ children }) { return <div className="my-3 overflow-x-auto rounded-xl border border-zinc-700/50"><table className="w-full text-sm">{children}</table></div>; },
  thead({ children }) { return <thead className="bg-zinc-800/60">{children}</thead>; },
  th({ children }) { return <th className="px-4 py-2.5 text-left font-semibold text-zinc-200 border-b border-zinc-700/50">{children}</th>; },
  td({ children }) { return <td className="px-4 py-2.5 text-zinc-300 border-b border-zinc-700/30 last:border-0">{children}</td>; },
});

function CodeBlock({ language, codeString, filename, isHTML }: {
  language: string;
  codeString: string;
  filename: string;
  isHTML: boolean;
}) {
  const [preview, setPreview] = useState(false);

  return (
    <>
      {preview && <PreviewModal code={codeString} onClose={() => setPreview(false)} />}
      <div className="my-3 rounded-xl overflow-hidden border border-zinc-700/50">
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-700/50">
          <span className="text-xs font-mono text-zinc-500">{language}</span>
          <div className="flex items-center gap-1">
            {isHTML && (
              <button
                onClick={() => setPreview(true)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-violet-400 hover:text-violet-300 hover:bg-zinc-700/60 transition-all"
              >
                <Play className="w-3 h-3" />
                <span>Preview</span>
              </button>
            )}
            <GitHubPushButton code={codeString} filename={filename} />
            <CopyButton text={codeString} />
          </div>
        </div>
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          customStyle={{ margin: 0, borderRadius: 0, background: "#0f0f0f", fontSize: "0.8125rem", lineHeight: "1.6", padding: "1rem" }}
          codeTagProps={{ style: { fontFamily: "JetBrains Mono, Menlo, monospace" } }}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    </>
  );
}

export default function MessageBubble({ message, isLast, onRegenerate, isStreaming }: MessageBubbleProps) {
  const isAssistant = message.role === "assistant";
  const showRegenerate = isAssistant && isLast && onRegenerate && !isStreaming;
  const { textPart, imageName, imageUrl, fileName } = parseMessageContent(message.content);

  const copyText = stripMarkdown(
    textPart || ((!imageUrl && !imageName && !fileName) ? message.content : "")
  );

  const markdownComponents = makeMarkdownComponents();

  return (
    <div data-testid={`message-${message.id}`} className={`flex flex-col ${isAssistant ? "items-start" : "items-end"} px-4 py-2 gap-1`}>
      <div className={`flex gap-3 w-full ${isAssistant ? "justify-start" : "justify-end"}`}>
        {isAssistant && (
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-md shadow-violet-900/30">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
        )}

        <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
          isAssistant
            ? "bg-zinc-800/60 text-zinc-100 rounded-tl-sm"
            : "bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-tr-sm shadow-lg shadow-violet-900/30 break-words leading-relaxed"
        }`}>

          {imageUrl && (
            <img src={imageUrl} alt={imageName ?? "uploaded image"} className="mb-2 rounded-xl max-w-full max-h-64 object-contain border border-white/10" />
          )}

          {!imageUrl && imageName && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-white/10 rounded-xl border border-white/20">
              <Image className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs truncate">{imageName}</span>
            </div>
          )}

          {fileName && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-white/10 rounded-xl border border-white/20">
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs truncate">{fileName}</span>
            </div>
          )}

          {textPart ? (
            isAssistant ? (
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                {textPart}
              </ReactMarkdown>
            ) : (
              <span className="whitespace-pre-wrap">{textPart}</span>
            )
          ) : (!imageUrl && !imageName && !fileName) ? (
            isAssistant ? (
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            ) : (
              <span className="whitespace-pre-wrap">{message.content}</span>
            )
          ) : null}
        </div>

        {!isAssistant && (
          <div className="w-8 h-8 rounded-xl bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
            <User className="w-4 h-4 text-zinc-300" />
          </div>
        )}
      </div>

      {isAssistant && !isStreaming && copyText && (
        <div className="pl-11 flex items-center gap-1">
          <CopyButton text={copyText} />
          {showRegenerate && (
            <button data-testid="button-regenerate" onClick={onRegenerate}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all group">
              <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-300" />
              Regenerate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
