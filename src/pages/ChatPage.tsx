import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { streamGroqResponse, generateTitle } from "@/lib/groq";
import { useAuth } from "@/context/AuthContext";
import type { Conversation, Message } from "@/types";
import Sidebar from "@/components/Sidebar";
import MessageBubble from "@/components/MessageBubble";
import { Send, Loader2, Menu, Sparkles, StopCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ChatPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

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
      : firstMessage;

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

    // Always bubble the conversation to the top in local state
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
    const title = await generateTitle(userMsg, assistantMsg);
    if (!title) return;

    // Update in Supabase (best-effort)
    await supabase
      .from("conversations")
      .update({ title })
      .eq("id", conversationId);

    // Animate title in sidebar
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, title } : c))
    );
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    setInput("");
    autoResizeTextarea();

    let conversationId = activeConversationId;
    const isFirstMessage = messages.length === 0;

    // Create new conversation if needed
    if (!conversationId) {
      conversationId = await createConversation(trimmed);
      if (!conversationId) return;
      setActiveConversationId(conversationId);
    }

    // Add user message to UI immediately
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversation_id: conversationId,
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Save user message to Supabase
    const savedUserMsg = await saveMessage(conversationId, "user", trimmed);
    if (savedUserMsg) {
      setMessages((prev) => prev.map((m) => m.id === tempUserMsg.id ? savedUserMsg : m));
    }

    // Build history for Groq (existing + new)
    const history = [
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: trimmed },
    ];

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
      await streamGroqResponse(history, ({ content, done }) => {
        if (abortRef.current) return;

        if (!done) {
          fullContent += content;
          setMessages((prev) =>
            prev.map((m) => m.id === tempAssistantMsg.id ? { ...m, content: fullContent } : m)
          );
        } else {
          // Done streaming — save to Supabase
          if (fullContent) {
            saveMessage(conversationId!, "assistant", fullContent).then((saved) => {
              if (saved) {
                setMessages((prev) =>
                  prev.map((m) => m.id === tempAssistantMsg.id ? saved : m)
                );
              }
            });
            updateConversationTimestamp(conversationId!);
            // Auto-rename on first exchange
            if (isFirstMessage) {
              autoRenameConversation(conversationId!, trimmed, fullContent);
            }
          }
        }
      });
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

    // Find last assistant message and the user message before it
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastAssistant || !lastUser) return;

    // Delete last assistant message from Supabase + local state
    await supabase.from("messages").delete().eq("id", lastAssistant.id);
    const messagesWithoutLast = messages.filter((m) => m.id !== lastAssistant.id);
    setMessages(messagesWithoutLast);

    // Build history without the last assistant message
    const history = messagesWithoutLast.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

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
      await streamGroqResponse(history, ({ content, done }) => {
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
      });
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
  };

  const handleDeleteConversation = async (id: string) => {
    // Delete messages first, then conversation
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

  const autoResizeTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    autoResizeTextarea();
  };

  return (
    <div className="flex h-screen bg-[#0d0d0d] overflow-hidden">
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
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60 bg-[#0d0d0d]/80 backdrop-blur-sm flex-shrink-0">
          <button
            data-testid="button-toggle-sidebar"
            className="lg:hidden text-zinc-500 hover:text-white transition-colors p-1"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-zinc-300 truncate">
            {activeConversationId
              ? conversations.find((c) => c.id === activeConversationId)?.title ?? "Conversation"
              : "New chat"}
          </span>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto py-4">
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
        <div className="flex-shrink-0 px-4 py-4 border-t border-zinc-800/60 bg-[#0d0d0d]">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-2 bg-zinc-900 border border-zinc-700/60 rounded-2xl px-4 py-3 focus-within:border-violet-500/60 focus-within:ring-1 focus-within:ring-violet-500/20 transition-all">
              <textarea
                ref={textareaRef}
                data-testid="input-message"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message Nexus AI..."
                rows={1}
                disabled={streaming}
                className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 resize-none focus:outline-none min-h-[24px] max-h-[160px] leading-relaxed disabled:opacity-50"
                style={{ height: "24px" }}
              />
              {streaming ? (
                <button
                  data-testid="button-stop"
                  onClick={handleStop}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 flex items-center justify-center transition-all"
                >
                  <StopCircle className="w-4 h-4" />
                </button>
              ) : (
                <button
                  data-testid="button-send"
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-md shadow-violet-900/30"
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
    <div className="flex flex-col items-center justify-center h-full px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-5 shadow-xl shadow-violet-900/40">
        <Sparkles className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">How can I help you?</h2>
      <p className="text-sm text-zinc-500 mb-8 max-w-xs">
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
    <div className="px-4 py-3 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800/60 text-left text-sm text-zinc-400 hover:text-zinc-200 cursor-pointer transition-all">
      {text}
    </div>
  );
}
