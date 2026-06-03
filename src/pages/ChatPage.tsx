import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { streamGroqResponse, generateTitle, extractTextFromFile, fileToBase64, type MessageContent } from "@/lib/groq";
import { useAuth } from "@/context/AuthContext";
import type { Conversation, Message } from "@/types";
import Sidebar from "@/components/Sidebar";
import MessageBubble from "@/components/MessageBubble";
import { Send, Loader2, Menu, Sparkles, StopCircle, Paperclip, X, Lock, Crown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PREMIUM_PASSWORD = "Lei100";
const FREE_ATTACHMENT_LIMIT = 6;
const RESET_HOURS = 5;

function getAttachmentData(userId: string) {
  try {
    const raw = localStorage.getItem(`nexus_attach_${userId}`);
    if (!raw) return { count: 0, resetAt: Date.now() + RESET_HOURS * 60 * 60 * 1000, isPremium: false };
    return JSON.parse(raw);
  } catch {
    return { count: 0, resetAt: Date.now() + RESET_HOURS * 60 * 60 * 1000, isPremium: false };
  }
}

function saveAttachmentData(userId: string, data: { count: number; resetAt: number; isPremium: boolean }) {
  localStorage.setItem(`nexus_attach_${userId}`, JSON.stringify(data));
}

function PremiumModal({ onClose, onUnlock }: { onClose: () => void; onUnlock: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (code === PREMIUM_PASSWORD) {
      onUnlock();
    } else {
      setError("Invalid code. Please try again.");
      setCode("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex flex-col items-center mb-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center mb-3 shadow-lg">
            <Crown className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-lg font-bold text-white">Upgrade to Premium</h2>
          <p className="text-xs text-zinc-400 text-center mt-1">
            You've used your 6 free file attachments. Enter your premium code to unlock unlimited uploads.
          </p>
        </div>

        <input
          type="password"
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Enter premium code..."
          className="w-full bg-zinc-800 border border-zinc-700/60 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition-all mb-2"
        />
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

        <button
          onClick={handleSubmit}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold hover:opacity-90 transition-all shadow-md shadow-amber-900/30 mb-2"
        >
          Unlock Premium
        </button>
        <button
          onClick={onClose}
          className="w-full py-2 rounded-xl text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
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
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const abortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);
  useEffect(() => { if (!user) return; loadConversations(); }, [user]);

  const getAttachInfo = useCallback(() => {
    if (!user) return { count: 0, resetAt: 0, isPremium: false };
    const data = getAttachmentData(user.id);
    if (Date.now() > data.resetAt && !data.isPremium) {
      const reset = { count: 0, resetAt: Date.now() + RESET_HOURS * 60 * 60 * 1000, isPremium: false };
      saveAttachmentData(user.id, reset);
      return reset;
    }
    return data;
  }, [user]);

  const canAttach = useCallback(() => {
    const data = getAttachInfo();
    return data.isPremium || data.count < FREE_ATTACHMENT_LIMIT;
  }, [getAttachInfo]);

  const incrementAttachCount = useCallback(() => {
    if (!user) return;
    const data = getAttachInfo();
    if (!data.isPremium) {
      saveAttachmentData(user.id, { ...data, count: data.count + 1 });
    }
  }, [user, getAttachInfo]);

  const handleUnlockPremium = useCallback(() => {
    if (!user) return;
    const data = getAttachInfo();
    saveAttachmentData(user.id, { ...data, isPremium: true });
    setShowPremiumModal(false);
    toast({ title: "Premium Unlocked! 🎉", description: "You now have unlimited file uploads!" });
  }, [user, getAttachInfo, toast]);

  const getRemainingUploads = useCallback(() => {
    const data = getAttachInfo();
    if (data.isPremium) return "∞";
    return Math.max(0, FREE_ATTACHMENT_LIMIT - data.count);
  }, [getAttachInfo]);

  const getResetTime = useCallback(() => {
    const data = getAttachInfo();
    if (data.isPremium) return null;
    const ms = data.resetAt - Date.now();
    if (ms <= 0) return null;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }, [getAttachInfo]);

  const loadConversations = async () => {
    setLoadingConversations(true);
    const { data, error } = await supabase
      .from("conversations").select("*").eq("user_id", user!.id).order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load conversations", description: error.message, variant: "destructive" });
    } else {
      setConversations(data ?? []);
    }
    setLoadingConversations(false);
  };

  useEffect(() => {
    if (!activeConversationId) { setMessages([]); return; }
    loadMessages(activeConversationId);
  }, [activeConversationId]);

  const loadMessages = async (conversationId: string) => {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Error", description: "Failed to load messages", variant: "destructive" });
    } else {
      setMessages(data ?? []);
    }
    setLoadingMessages(false);
  };

  const createConversation = async (firstMessage: string): Promise<string | null> => {
    const title = firstMessage.length > 50 ? firstMessage.slice(0, 50) + "…" : firstMessage;
    const { data, error } = await supabase
      .from("conversations").insert({ user_id: user!.id, title }).select().single();
    if (error || !data) {
      toast({ title: "Failed to create conversation", description: error?.message ?? "Unknown error", variant: "destructive" });
      return null;
    }
    setConversations((prev) => [data, ...prev]);
    return data.id;
  };

  const saveMessage = async (conversationId: string, role: "user" | "assistant", content: string): Promise<Message | null> => {
    const { data, error } = await supabase
      .from("messages").insert({ conversation_id: conversationId, role, content }).select().single();
    if (error || !data) return null;
    return data;
  };

  const updateConversationTimestamp = async (conversationId: string) => {
    const now = new Date().toISOString();
    await supabase.from("conversations").update({ updated_at: now }).eq("id", conversationId);
    setConversations((prev) => {
      const updated = prev.map((c) => c.id === conversationId ? { ...c, updated_at: now } : c);
      return updated.sort((a, b) =>
        new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime()
      );
    });
  };

  const autoRenameConversation = async (conversationId: string, userMsg: string, assistantMsg: string) => {
    const title = await generateTitle(userMsg, assistantMsg);
    if (!title) return;
    await supabase.from("conversations").update({ title }).eq("id", conversationId);
    setConversations((prev) => prev.map((c) => c.id === conversationId ? { ...c, title } : c));
  };

  const uploadFileToSupabase = async (file: File, conversationId: string): Promise<string | null> => {
    const ext = file.name.split(".").pop();
    const path = `${user!.id}/${conversationId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("attachments").upload(path, file);
    if (error) { console.error("Upload error:", error); return null; }
    const { data } = supabase.storage.from("attachments").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if ((!trimmed && !attachedFile) || streaming) return;

    const fileToSend = attachedFile;

    // Check attachment limit
    if (fileToSend && !canAttach()) {
      setShowPremiumModal(true);
      return;
    }

    setInput("");
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    autoResizeTextarea();

    let conversationId = activeConversationId;
    const isFirstMessage = messages.length === 0;

    if (!conversationId) {
      conversationId = await createConversation(trimmed || fileToSend?.name || "File");
      if (!conversationId) return;
      setActiveConversationId(conversationId);
    }

    let userMessageContent: MessageContent["content"] = trimmed;
    let userMessageText = trimmed;

    if (fileToSend) {
      incrementAttachCount();
      const isImage = fileToSend.type.startsWith("image/");

      if (isImage) {
        const base64 = await fileToBase64(fileToSend);
        const dataUrl = `data:${fileToSend.type};base64,${base64}`;
        const publicUrl = await uploadFileToSupabase(fileToSend, conversationId);
        userMessageContent = [
          ...(trimmed ? [{ type: "text", text: trimmed }] : []),
          { type: "image_url", image_url: { url: dataUrl } },
        ];
        const imageTag = publicUrl ? `[Image: ${fileToSend.name}|${publicUrl}]` : `[Image: ${fileToSend.name}]`;
        userMessageText = trimmed ? `${trimmed}\n\n${imageTag}` : imageTag;
      } else {
        await uploadFileToSupabase(fileToSend, conversationId);
        try {
          const extractedText = await extractTextFromFile(fileToSend);
          const fileContext = `\n\n[File: ${fileToSend.name}]\n${extractedText}`;
          userMessageContent = (trimmed || "") + fileContext;
          userMessageText = (trimmed || "") + fileContext;
        } catch {
          toast({ title: "File Error", description: `Could not read ${fileToSend.name}.`, variant: "destructive" });
          return;
        }
      }
    }

    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversation_id: conversationId,
      role: "user",
      content: userMessageText,
      created_at: new Date().toISOString(),
    };

    const currentMessages = [...messages, tempUserMsg];
    setMessages(currentMessages);

    const savedUserMsg = await saveMessage(conversationId, "user", userMessageText);
    if (savedUserMsg) {
      setMessages((prev) => prev.map((m) => m.id === tempUserMsg.id ? savedUserMsg : m));
    }

    const recentMessages = currentMessages.slice(-10);
    const history: MessageContent[] = recentMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.id === tempUserMsg.id ? userMessageContent : m.content,
    }));

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
          setMessages((prev) => prev.map((m) => m.id === tempAssistantMsg.id ? { ...m, content: fullContent } : m));
        } else {
          if (fullContent) {
            saveMessage(conversationId!, "assistant", fullContent).then((saved) => {
              if (saved) setMessages((prev) => prev.map((m) => m.id === tempAssistantMsg.id ? saved : m));
            });
            updateConversationTimestamp(conversationId!);
            if (isFirstMessage) autoRenameConversation(conversationId!, userMessageText, fullContent);
          }
        }
      });
    } catch (err: unknown) {
      if (!abortRef.current) {
        toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to get AI response", variant: "destructive" });
        setMessages((prev) => prev.filter((m) => m.id !== tempAssistantMsg.id));
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleStop = () => { abortRef.current = true; setStreaming(false); };

  const handleRegenerate = async () => {
    if (!activeConversationId || streaming) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastAssistant || !lastUser) return;

    await supabase.from("messages").delete().eq("id", lastAssistant.id);
    const messagesWithoutLast = messages.filter((m) => m.id !== lastAssistant.id);
    setMessages(messagesWithoutLast);

    const history: MessageContent[] = messagesWithoutLast.slice(-10).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

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
          setMessages((prev) => prev.map((m) => m.id === tempAssistantMsg.id ? { ...m, content: fullContent } : m));
        } else {
          if (fullContent) {
            saveMessage(activeConversationId, "assistant", fullContent).then((saved) => {
              if (saved) setMessages((prev) => prev.map((m) => m.id === tempAssistantMsg.id ? saved : m));
            });
            updateConversationTimestamp(activeConversationId);
          }
        }
      });
    } catch (err: unknown) {
      if (!abortRef.current) {
        toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to regenerate", variant: "destructive" });
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
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteConversation = async (id: string) => {
    await supabase.from("messages").delete().eq("conversation_id", id);
    await supabase.from("conversations").delete().eq("id", id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) { setActiveConversationId(null); setMessages([]); }
  };

  const handleDeleteAllConversations = async () => {
    for (const conv of conversations) {
      await supabase.from("messages").delete().eq("conversation_id", conv.id);
      await supabase.from("conversations").delete().eq("id", conv.id);
    }
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
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

  const attachInfo = getAttachInfo();
  const remaining = getRemainingUploads();
  const resetTime = getResetTime();

  return (
    <div className="flex h-[100dvh] bg-[#0d0d0d] overflow-hidden">
      {showPremiumModal && (
        <PremiumModal
          onClose={() => setShowPremiumModal(false)}
          onUnlock={handleUnlockPremium}
        />
      )}

      <Sidebar
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        onDeleteAllConversations={handleDeleteAllConversations}
        conversations={conversations}
        loadingConversations={loadingConversations}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60 bg-[#0d0d0d]/80 backdrop-blur-sm flex-shrink-0">
          <button
            data-testid="button-toggle-sidebar"
            className="lg:hidden text-zinc-500 hover:text-white transition-colors p-1"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-zinc-300 truncate flex-1">
            {activeConversationId
              ? conversations.find((c) => c.id === activeConversationId)?.title ?? "Conversation"
              : "New chat"}
          </span>
          {attachInfo.isPremium ? (
            <span className="flex items-center gap-1 text-xs text-amber-400 font-medium">
              <Crown className="w-3 h-3" /> Premium
            </span>
          ) : (
            <span className="text-xs text-zinc-500">
              {remaining} uploads left
              {resetTime && ` · resets in ${resetTime}`}
            </span>
          )}
        </div>

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

        <div className="flex-shrink-0 px-4 py-4 border-t border-zinc-800/60 bg-[#0d0d0d] sticky bottom-0">
          <div className="max-w-3xl mx-auto">
            {attachedFile && (
              <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-zinc-800/60 rounded-xl border border-zinc-700/50">
                <span className="text-xs text-zinc-400 truncate flex-1">{attachedFile.name}</span>
                <button onClick={() => { setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className="text-zinc-500 hover:text-zinc-200 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="relative flex items-end gap-2 bg-zinc-900 border border-zinc-700/60 rounded-2xl px-4 py-3 focus-within:border-violet-500/60 focus-within:ring-1 focus-within:ring-violet-500/20 transition-all">
              <button
                onClick={() => {
                  if (!canAttach()) { setShowPremiumModal(true); return; }
                  fileInputRef.current?.click();
                }}
                disabled={streaming}
                className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30 ${
                  canAttach()
                    ? "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/60"
                    : "text-amber-500 hover:text-amber-400 hover:bg-zinc-700/60"
                }`}
              >
                {canAttach() ? <Paperclip className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.txt,.csv,.json,.xml,.md,.docx,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 50 * 1024 * 1024) {
                      toast({ title: "File too large", description: "Maximum file size is 50MB", variant: "destructive" });
                      return;
                    }
                    setAttachedFile(file);
                  }
                  e.target.value = "";
                }}
              />

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
                <button data-testid="button-stop" onClick={handleStop}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 flex items-center justify-center transition-all">
                  <StopCircle className="w-4 h-4" />
                </button>
              ) : (
                <button data-testid="button-send" onClick={handleSend}
                  disabled={!input.trim() && !attachedFile}
                  className="flex-shrink-0 w-8 h-8 rounded-xl bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-md shadow-violet-900/30">
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
      <p className="text-sm text-zinc-500 mb-8 max-w-xs">I'm Nexus AI, a limitless powerful assistant. Ask me anything.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {suggestions.map((s) => (<SuggestionCard key={s} text={s} />))}
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
