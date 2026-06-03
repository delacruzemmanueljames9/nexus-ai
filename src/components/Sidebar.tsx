import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import type { Conversation } from "@/types";
import {
  Plus, Trash2, MessageSquare, LogOut, Sparkles, X,
  Settings, Sun, Moon, Monitor, UserRound, RefreshCw
} from "lucide-react";

interface SidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onDeleteAllConversations: () => void;
  conversations: Conversation[];
  loadingConversations: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export default function Sidebar({
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onDeleteAllConversations,
  conversations,
  loadingConversations,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { user, signOut, switchAccount } = useAuth();
  const { theme, setTheme } = useTheme();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    await onDeleteConversation(id);
    setDeletingId(null);
  };

  const handleDeleteAll = async () => {
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true);
      return;
    }
    onDeleteAllConversations();
    setConfirmDeleteAll(false);
    setShowSettings(false);
  };

  const groupedConversations = groupByDate(conversations);

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={onCloseMobile} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-72 bg-[#111111] border-r border-zinc-800/60 flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-md">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-white text-sm">Nexus AI</span>
          </div>
          <button className="lg:hidden text-zinc-500 hover:text-white transition-colors" onClick={onCloseMobile}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-3 py-3">
          <button
            data-testid="button-new-chat"
            onClick={() => { onNewChat(); onCloseMobile(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-violet-600/10 hover:bg-violet-600/20 border border-violet-600/20 hover:border-violet-500/40 text-violet-300 hover:text-violet-200 text-sm font-medium transition-all group"
          >
            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" />
            New chat
          </button>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
          {loadingConversations ? (
            <div className="space-y-1 px-2 pt-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-9 bg-zinc-800/50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <MessageSquare className="w-8 h-8 text-zinc-700 mb-3" />
              <p className="text-xs text-zinc-600">No conversations yet</p>
              <p className="text-xs text-zinc-700 mt-1">Start a new chat above</p>
            </div>
          ) : (
            Object.entries(groupedConversations).map(([label, convos]) => (
              <div key={label} className="mb-4">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                  {label}
                </p>
                {convos.map((conv) => (
                  <div
                    key={conv.id}
                    data-testid={`conversation-item-${conv.id}`}
                    onClick={() => { onSelectConversation(conv.id); onCloseMobile(); }}
                    className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all mb-0.5 ${
                      activeConversationId === conv.id
                        ? "bg-zinc-800/80 text-white"
                        : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                    <span className="flex-1 text-sm truncate">{conv.title}</span>
                    <button
                      data-testid={`button-delete-${conv.id}`}
                      onClick={(e) => handleDelete(e, conv.id)}
                      disabled={deletingId === conv.id}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all p-0.5 rounded flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800/60 px-3 py-3 space-y-1">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">
                {user?.email?.[0]?.toUpperCase() ?? "U"}
              </span>
            </div>
            <span className="flex-1 text-xs text-zinc-400 truncate">{user?.email}</span>
            <button
              onClick={() => setShowSettings(true)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 rounded-lg hover:bg-zinc-800"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              data-testid="button-sign-out"
              onClick={signOut}
              className="text-zinc-600 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-zinc-800"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { setShowSettings(false); setConfirmDeleteAll(false); }}>
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded-2xl w-full max-w-sm p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-white font-semibold text-base">Settings</h2>
              <button onClick={() => { setShowSettings(false); setConfirmDeleteAll(false); }} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Theme */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Theme</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                  { value: "system", label: "System", icon: Monitor },
                ].map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value as "light" | "dark" | "system")}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs transition-all ${
                      theme === value
                        ? "border-violet-500 bg-violet-600/10 text-violet-300"
                        : "border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Account */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Account</p>
              <div className="flex items-center gap-3 px-3 py-2.5 bg-zinc-800/40 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-white">
                    {user?.email?.[0]?.toUpperCase() ?? "U"}
                  </span>
                </div>
                <span className="flex-1 text-xs text-zinc-300 truncate">{user?.email}</span>
              </div>
              <button
                onClick={switchAccount}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/40 text-zinc-300 hover:text-white hover:border-zinc-600 text-sm transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Switch account
              </button>
              <button
                onClick={signOut}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/40 text-red-400 hover:text-red-300 hover:border-red-800 text-sm transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>

            {/* Danger Zone */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Danger Zone</p>
              <button
                onClick={handleDeleteAll}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm transition-all ${
                  confirmDeleteAll
                    ? "border-red-500 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                    : "border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:text-red-400 hover:border-red-800"
                }`}
              >
                <Trash2 className="w-4 h-4" />
                {confirmDeleteAll ? "Tap again to confirm delete all" : "Delete all conversations"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function groupByDate(conversations: Conversation[]): Record<string, Conversation[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastMonth = new Date(today);
  lastMonth.setDate(lastMonth.getDate() - 30);

  const groups: Record<string, Conversation[]> = {};

  for (const conv of conversations) {
    const date = new Date(conv.updated_at || conv.created_at);
    let label: string;

    if (date >= today) label = "Today";
    else if (date >= yesterday) label = "Yesterday";
    else if (date >= lastWeek) label = "Previous 7 days";
    else if (date >= lastMonth) label = "Previous 30 days";
    else label = "Older";

    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }

  return groups;
}
