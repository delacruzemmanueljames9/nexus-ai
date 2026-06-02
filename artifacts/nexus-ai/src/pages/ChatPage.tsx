import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { streamGroqResponse, streamGroqVisionResponse, generateTitle } from "@/lib/groq";
import { useAuth } from "@/context/AuthContext";
import type { Conversation, Message } from "@/types";
import Sidebar from "@/components/Sidebar";
import MessageBubble from "@/components/MessageBubble";
import { Send, Loader2, Menu, Sparkles, StopCircle, Paperclip, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { parseMessageContent } from "@/lib/messageUtils";
import type { ImageAttachment } from "@/lib/messageUtils";

async function resizeImageToBase64(file: File, maxDimension = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };

    img.src = objectUrl;
  });
}

export default function ChatPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState("");
  const [attachedImage, setAttachedImage] = useState<ImageAttachment | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Prevents loadMessages from wiping optimistic state when handleSend creates a new conversation
  const skipNextLoadRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Auto-resize textarea whenever input changes (including on clear)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Load conversations
  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user]);

  const loadConversations = async () => {
    setLoadingConversations(true);
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadConversations error:", error);
      toast({
        title: "Failed to load conversations",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setConversations(data ?? []);
    }
    setLoadingConversations(false);
  };

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    // Skip the load triggered by handleSend creating a new conversation —
    // handleSend manages messages state directly to avoid wiping the streaming response.
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    loadMessages(activeConversationId);
  }, [activeConversationId]);

  const loadMessages = async (conversationId: string) => {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Error", description: "Failed to load messages", variant: "destructive" });
    } else {
      setMessages(data ?? []);
    }
    setLoadingMessages(false);
  };

  const createConversation = async (firstMessage: string): Promise<string | null> => {
    const title = firstMessage.length > 50
      ? firstMessage.slice(0, 50) + "…"
      : firstMessage || "Image conversation";

    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user!.id, title })
      .select()
      .single();

    if (error || !data) {
      console.error("createConversation error:", error);
      toast({
        title: "Failed to create conversation",
        description: error?.message ?? "Unknown error — check console for details",
        variant: "destructive",
      });
      return null;
    }

    setConversations((prev) => [data, ...prev]);
    return data.id;
  };

  const saveMessage = async (conversationId: string, role: "user" | "assistant", content: string): Promise<Message | null> => {
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, role, content })
      .select()
      .single();

    if (error || !data) {
      console.error("saveMessage error:", error);
      return null;
    }
    return data;
  };

  const updateConversationTimestamp = async (conversationId: string) => {
    const now = new Date().toISOString();
    // Best-effort — silently ignore if updated_at column doesn't exist
    await supabase
      .from("conversations")
      .update({ updated_at: now })
      .eq("id", conversationId);

    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === conversationId ? { ...c, updated_at: now } : c
      );
      return updated.sort(
        (a, b) =>
          new Date(b.updated_at ?? b.created_at).getTime() -
          new Date(a.updated_at ?? a.created_at).getTime()
      );
    });
  };

  const autoRenameConversation = async (
    conversationId: string,
    userMsg: string,
    assistantMsg: string
  ) => {
    const title = await generateTitle(userMsg || "Image attached", assistantMsg);
    if (!title) return;

    await supabase
      .from("conversations")
      .update({ title })
      .eq("id", conversationId);

    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, title } : c))
    );
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-selected if needed
    e.target.value = "";

    try {
      const dataUrl = await resizeImageToBase64(file);
      setAttachedImage({ dataUrl, name: file.name });
    } catch {
      toast({ title: "Failed to load image", description: "Please try a different file.", variant: "destructive" });
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if ((!trimmed && !attachedImage) || streaming) return;

    const imageToSend = attachedImage;
    setInput("");
    setAttachedImage(null);

    let conversationId = activeConversationId;
    const isFirstMessage = messages.length === 0;

    // Create new conversation if needed
    if (!conversationId) {
      conversationId = await createConversation(trimmed);
      if (!conversationId) return;
      skipNextLoadRef.current = true; // prevent loadMessages from wiping streaming state
      setActiveConversationId(conversationId);
    }

    // Encode content: JSON for image messages, plain text otherwise
    const contentToSave = imageToSend
      ? JSON.stringify({ __type: "image_msg", text: trimmed, image: imageToSend.dataUrl })
      : trimmed;

    // Add user message to UI immediately
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversation_id: conversationId,
      role: "user",
      content: contentToSave,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Save user message to Supabase
    const savedUserMsg = await saveMessage(conversationId, "user", contentToSave);
    if (savedUserMsg) {
      setMessages((prev) => prev.map((m) => m.id === tempUserMsg.id ? savedUserMsg : m));
    }

    // Build text-only history of previous messages for Groq
    const historyMessages = messages.map((m) => {
      const parsed = parseMessageContent(m.content);
      return { role: m.role as "user" | "assistant", content: parsed.text };
    });

    // Start streaming assistant response
    const tempAssistantMsg: Message = {
      id: `temp-assistant-${Date.now()}`,
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempAssistantMsg]);
    setStreaming(true);
    abortRef.current = false;

    let fullContent = "";

    try {
      const onChunk = ({ content, done }: { content: string; done: boolean }) => {
        if (abortRef.current) return;
        if (!done) {
          fullContent += content;
          setMessages((prev) =>
            prev.map((m) => m.id === tempAssistantMsg.id ? { ...m, content: fullContent } : m)
          );
        } else {
          if (fullContent) {
            saveMessage(conversationId!, "assistant", fullContent).then((saved) => {
              if (saved) {
                setMessages((prev) =>
                  prev.map((m) => m.id === tempAssistantMsg.id ? saved : m)
                );
              }
            });
            updateConversationTimestamp(conversationId!);
            if (isFirstMessage) {
              autoRenameConversation(conversationId!, trimmed, fullContent);
            }
          }
        }
      };

      if (imageToSend) {
        await streamGroqVisionResponse(historyMessages, imageToSend.dataUrl, trimmed, onChunk);
      } else {
        await streamGroqResponse(
          [...historyMessages, { role: "user" as const, content: trimmed }],
          onChunk
        );
      }
    } catch (err: unknown) {
      if (!abortRef.current) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to get AI response",
          variant: "destructive",
        });
        setMessages((prev) => prev.filter((m) => m.id !== tempAssistantMsg.id));
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    setStreaming(false);
  };

  const handleRegenerate = async () => {
    if (!activeConversationId || streaming) return;

    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastAssistant || !lastUser) return;

    // Delete last assistant message from Supabase + local state
    await supabase.from("messages").delete().eq("id", lastAssistant.id);
    const messagesWithoutLast = messages.filter((m) => m.id !== lastAssistant.id);
    setMessages(messagesWithoutLast);

    // Parse the last user message to check for image
    const parsedLastUser = parseMessageContent(lastUser.content);

    // Stream a new response
    const tempAssistantMsg: Message = {
      id: `temp-assistant-${Date.now()}`,
      conversation_id: activeConversationId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempAssistantMsg]);
    setStreaming(true);
    abortRef.current = false;

    let fullContent = "";

    try {
      const onChunk = ({ content, done }: { content: string; done: boolean }) => {
        if (abortRef.current) return;
        if (!done) {
          fullContent += content;
          setMessages((prev) =>
            prev.map((m) => m.id === tempAssistantMsg.id ? { ...m, content: fullContent } : m)
          );
        } else {
          if (fullContent) {
            saveMessage(activeConversationId, "assistant", fullContent).then((saved) => {
              if (saved) {
                setMessages((prev) =>
                  prev.map((m) => m.id === tempAssistantMsg.id ? saved : m)
                );
              }
            });
            updateConversationTimestamp(activeConversationId);
          }
        }
      };

      if (parsedLastUser.imageUrl) {
        // History = everything before the last user message, text-only
        const lastUserIdx = messagesWithoutLast.findIndex((m) => m.id === lastUser.id);
        const historyBeforeLastUser = messagesWithoutLast
          .slice(0, lastUserIdx)
          .map((m) => {
            const p = parseMessageContent(m.content);
            return { role: m.role as "user" | "assistant", content: p.text };
          });
        await streamGroqVisionResponse(
          historyBeforeLastUser,
          parsedLastUser.imageUrl,
          parsedLastUser.text,
          onChunk
        );
      } else {
        const history = messagesWithoutLast.map((m) => {
          const p = parseMessageContent(m.content);
          return { role: m.role as "user" | "assistant", content: p.text };
        });
        await streamGroqResponse(history, onChunk);
      }
    } catch (err: unknown) {
      if (!abortRef.current) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to regenerate response",
          variant: "destructive",
        });
        setMessages((prev) => prev.filter((m) => m.id !== tempAssistantMsg.id));
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    setAttachedImage(null);
  };

  const handleDeleteConversation = async (id: string) => {
    await supabase.from("messages").delete().eq("conversation_id", id);
    await supabase.from("conversations").delete().eq("id", id);

    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const canSend = (input.trim().length > 0 || attachedImage !== null) && !streaming;

  return (
    <div className="flex h-screen bg-[#0d0d0d] overflow-hidden">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      <Sidebar
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        conversations={conversations}
        loadingConversations={loadingConversations}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-zinc-800/60 bg-[#0d0d0d]/80 backdrop-blur-sm flex-shrink-0">
          <button
            data-testid="button-toggle-sidebar"
            className="lg:hidden text-zinc-500 hover:text-white transition-colors p-1.5 -ml-1 touch-manipulation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-zinc-300 truncate flex-1 min-w-0">
            {activeConversationId
              ? conversations.find((c) => c.id === activeConversationId)?.title ?? "Conversation"
              : "New chat"}
          </span>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto py-2 sm:py-4">
          {!activeConversationId && messages.length === 0 ? (
            <WelcomeScreen />
          ) : loadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full">
              {messages.map((message, index) => {
                const isLastMsg = index === messages.length - 1;
                const isLastAssistant = isLastMsg && message.role === "assistant";
                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isLast={isLastAssistant}
                    onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                    isStreaming={streaming}
                  />
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="flex-shrink-0 px-3 sm:px-4 py-3 sm:py-4 border-t border-zinc-800/60 bg-[#0d0d0d]">
          <div className="max-w-3xl mx-auto">
            {/* Image preview chip */}
            {attachedImage && (
              <div className="mb-2 flex items-center gap-2">
                <div className="relative group inline-flex items-center gap-2 bg-zinc-800/80 border border-zinc-700/60 rounded-xl px-2 py-1.5 max-w-full">
                  <img
                    src={attachedImage.dataUrl}
                    alt="attachment"
                    className="h-10 w-10 rounded-lg object-cover flex-shrink-0"
                  />
                  <span className="text-xs text-zinc-400 truncate max-w-[140px]">
                    {attachedImage.name}
                  </span>
                  <button
                    onClick={() => setAttachedImage(null)}
                    className="flex-shrink-0 w-5 h-5 rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-400 hover:text-white flex items-center justify-center transition-all touch-manipulation"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-end gap-2 bg-zinc-900 border border-zinc-700/60 rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 focus-within:border-violet-500/60 focus-within:ring-1 focus-within:ring-violet-500/20 transition-all">
              {/* Paperclip / attach button */}
              <button
                type="button"
                disabled={streaming}
                onClick={() => fileInputRef.current?.click()}
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-zinc-600 hover:text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors touch-manipulation"
                title="Attach image"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <textarea
                ref={textareaRef}
                data-testid="input-message"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message Nexus AI..."
                rows={1}
                disabled={streaming}
                className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 resize-none focus:outline-none leading-relaxed disabled:opacity-50 overflow-y-auto"
                style={{ minHeight: "24px", maxHeight: "160px" }}
              />

              {streaming ? (
                <button
                  data-testid="button-stop"
                  onClick={handleStop}
                  className="flex-shrink-0 w-9 h-9 sm:w-8 sm:h-8 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 flex items-center justify-center transition-all touch-manipulation"
                >
                  <StopCircle className="w-4 h-4" />
                </button>
              ) : (
                <button
                  data-testid="button-send"
                  onClick={handleSend}
                  disabled={!canSend}
                  className="flex-shrink-0 w-9 h-9 sm:w-8 sm:h-8 rounded-xl bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-md shadow-violet-900/30 touch-manipulation"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-center text-[10px] text-zinc-700 mt-2">
              Nexus AI can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen() {
  const suggestions = [
    "Explain quantum computing in simple terms",
    "Write a Python function to sort a list",
    "What are the best practices for REST APIs?",
    "Help me brainstorm startup ideas",
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 sm:px-6 text-center">
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-4 sm:mb-5 shadow-xl shadow-violet-900/40">
        <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">How can I help you?</h2>
      <p className="text-sm text-zinc-500 mb-6 sm:mb-8 max-w-xs">
        I'm Nexus AI, a limitless powerful assistant. Ask me anything.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {suggestions.map((s) => (
          <SuggestionCard key={s} text={s} />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({ text }: { text: string }) {
  return (
    <div className="px-4 py-3 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800/60 text-left text-sm text-zinc-400 hover:text-zinc-200 cursor-pointer transition-all touch-manipulation active:bg-zinc-800/80">
      {text}
    </div>
  );
}
