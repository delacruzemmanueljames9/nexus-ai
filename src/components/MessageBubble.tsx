import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";
import { Sparkles, User, Copy, Check, RefreshCw } from "lucide-react";
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
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-all"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3 text-green-400" />
          <span className="text-green-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const codeString = String(children).replace(/\n$/, "");
    const isBlock = !!match || codeString.includes("\n");

    if (isBlock) {
      const language = match?.[1] ?? "text";
      return (
        <div className="my-3 rounded-xl overflow-hidden border border-zinc-700/50">
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-700/50">
            <span className="text-xs font-mono text-zinc-500">{language}</span>
            <CopyButton text={codeString} />
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: 0,
              background: "#0f0f0f",
              fontSize: "0.8125rem",
              lineHeight: "1.6",
              padding: "1rem",
            }}
            codeTagProps={{ style: { fontFamily: "JetBrains Mono, Menlo, monospace" } }}
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
      );
    }

    return (
      <code
        className="px-1.5 py-0.5 rounded-md bg-zinc-700/60 text-violet-300 text-[0.8125rem] font-mono"
        {...props}
      >
        {children}
      </code>
    );
  },

  p({ children }) {
    return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
  },

  ul({ children }) {
    return <ul className="mb-3 last:mb-0 pl-5 space-y-1 list-disc marker:text-zinc-500">{children}</ul>;
  },

  ol({ children }) {
    return <ol className="mb-3 last:mb-0 pl-5 space-y-1 list-decimal marker:text-zinc-500">{children}</ol>;
  },

  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },

  h1({ children }) {
    return <h1 className="text-xl font-bold text-white mb-3 mt-4 first:mt-0">{children}</h1>;
  },

  h2({ children }) {
    return <h2 className="text-lg font-bold text-white mb-2 mt-4 first:mt-0">{children}</h2>;
  },

  h3({ children }) {
    return <h3 className="text-base font-semibold text-zinc-100 mb-2 mt-3 first:mt-0">{children}</h3>;
  },

  strong({ children }) {
    return <strong className="font-semibold text-white">{children}</strong>;
  },

  em({ children }) {
    return <em className="italic text-zinc-300">{children}</em>;
  },

  blockquote({ children }) {
    return (
      <blockquote className="my-3 pl-4 border-l-2 border-violet-500/60 text-zinc-400 italic">
        {children}
      </blockquote>
    );
  },

  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors"
      >
        {children}
      </a>
    );
  },

  hr() {
    return <hr className="my-4 border-zinc-700/60" />;
  },

  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-xl border border-zinc-700/50">
        <table className="w-full text-sm">{children}</table>
      </div>
    );
  },

  thead({ children }) {
    return <thead className="bg-zinc-800/60">{children}</thead>;
  },

  th({ children }) {
    return (
      <th className="px-4 py-2.5 text-left font-semibold text-zinc-200 border-b border-zinc-700/50">
        {children}
      </th>
    );
  },

  td({ children }) {
    return (
      <td className="px-4 py-2.5 text-zinc-300 border-b border-zinc-700/30 last:border-0">
        {children}
      </td>
    );
  },
};

export default function MessageBubble({ message, isLast, onRegenerate, isStreaming }: MessageBubbleProps) {
  const isAssistant = message.role === "assistant";
  const showRegenerate = isAssistant && isLast && onRegenerate && !isStreaming;

  return (
    <div
      data-testid={`message-${message.id}`}
      className={`flex flex-col ${isAssistant ? "items-start" : "items-end"} px-4 py-2 gap-1`}
    >
      <div className={`flex gap-3 w-full ${isAssistant ? "justify-start" : "justify-end"}`}>
        {isAssistant && (
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-md shadow-violet-900/30">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
        )}

        <div
          className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
            isAssistant
              ? "bg-zinc-800/60 text-zinc-100 rounded-tl-sm"
              : "bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-tr-sm shadow-lg shadow-violet-900/30 whitespace-pre-wrap break-words leading-relaxed"
          }`}
        >
          {isAssistant ? (
            <ReactMarkdown components={markdownComponents}>
              {message.content}
            </ReactMarkdown>
          ) : (
            message.content
          )}
        </div>

        {!isAssistant && (
          <div className="w-8 h-8 rounded-xl bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
            <User className="w-4 h-4 text-zinc-300" />
          </div>
        )}
      </div>

      {/* Regenerate button — only on last assistant message when not streaming */}
      {showRegenerate && (
        <div className="pl-11">
          <button
            data-testid="button-regenerate"
            onClick={onRegenerate}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all group"
          >
            <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-300" />
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
