import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import ReactMarkdown from "react-markdown";
import {
  X, Send, Trash2, Bot, Sparkles, ChevronDown,
  FileText, AlertTriangle, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DashboardData, Manager } from "@/pages/Dashboard";

type ChatMessage = {
  id: number;
  sessionId: string;
  managerId: string | null;
  role: "user" | "assistant";
  content: string;
  sourcesUsed: string | null;
  createdAt: string;
};

interface AiChatProps {
  isOpen: boolean;
  onClose: () => void;
  selectedManager: string | null;
  managers: Manager[];
  dashboardData: DashboardData | undefined;
}

const STARTER_PROMPTS = [
  "Which of my accounts are at risk and why?",
  "Which clients haven't had a meaningful touch in over 30 days?",
  "What's the YoY trend across my portfolio?",
  "Which accounts are growing and which need attention today?",
  "Which clients show signs of churn risk?",
];

export default function AiChat({
  isOpen,
  onClose,
  selectedManager,
  managers,
  dashboardData,
}: AiChatProps) {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionId = selectedManager ?? "all";
  const managerName = selectedManager
    ? managers.find((m) => m.id === selectedManager)?.name
    : undefined;

  const { data: messages = [], refetch: refetchMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat", sessionId],
    queryFn: () =>
      apiRequest("GET", `/api/chat/${sessionId}`).then((r) => r.json()),
    enabled: isOpen,
    refetchInterval: false,
  });

  const sendMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("POST", `/api/chat/${sessionId}`, {
        query,
        managerId: selectedManager,
        managerName,
        dashboardData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to get response");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchMessages();
      setIsTyping(false);
    },
    onError: () => {
      refetchMessages();
      setIsTyping(false);
    },
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      apiRequest("DELETE", `/api/chat/${sessionId}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat", sessionId] });
    },
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  function handleSend(text?: string) {
    const query = (text ?? input).trim();
    if (!query || sendMutation.isPending) return;
    setInput("");
    setIsTyping(true);
    sendMutation.mutate(query);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-y-0 right-0 w-[420px] max-w-full z-50 flex flex-col shadow-2xl"
      style={{
        background: "hsl(150, 18%, 7%)",
        borderLeft: "1px solid hsl(150, 12%, 17%)",
      }}
      data-testid="ai-chat-panel"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "hsl(150, 12%, 17%)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "hsl(93, 48%, 55%, 0.15)" }}
          >
            <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(93, 48%, 55%)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">BLG Intelligence</p>
            <p className="text-xs text-muted-foreground">
              {managerName ? `${managerName}'s data` : "All clients"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={() => clearMutation.mutate()}
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Clear conversation"
              data-testid="button-clear-chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-chat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isTyping && (
          <div className="flex flex-col items-center justify-center h-full gap-6 pb-8">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "hsl(93, 48%, 55%, 0.12)" }}
            >
              <Bot className="w-7 h-7" style={{ color: "hsl(93, 48%, 55%)" }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground mb-1">Ask about your data</p>
              <p className="text-xs text-muted-foreground max-w-[280px]">
                I have access to your live dashboard data and any documents uploaded in Settings.
              </p>
            </div>
            <div className="w-full space-y-2">
              <p className="text-xs text-muted-foreground text-center mb-1">Try asking</p>
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => handleSend(p)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs transition-colors"
                  style={{
                    background: "hsl(150, 14%, 13%)",
                    color: "hsl(140, 15%, 80%)",
                    border: "1px solid hsl(150, 12%, 17%)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor =
                      "hsl(93, 48%, 55%, 0.4)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor =
                      "hsl(150, 12%, 17%)";
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isTyping && (
          <div className="flex gap-2 items-start">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: "hsl(93, 48%, 55%, 0.15)" }}
            >
              <Sparkles
                className="w-3 h-3 animate-pulse"
                style={{ color: "hsl(93, 48%, 55%)" }}
              />
            </div>
            <div
              className="rounded-lg px-3 py-2.5"
              style={{
                background: "hsl(150, 14%, 13%)",
                border: "1px solid hsl(150, 12%, 17%)",
              }}
            >
              <div className="flex gap-1 items-center h-4">
                <span
                  className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: "hsl(93, 48%, 55%)", animationDelay: "0ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: "hsl(93, 48%, 55%)", animationDelay: "150ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: "hsl(93, 48%, 55%)", animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: "hsl(150, 12%, 17%)" }}
      >
        <div
          className="flex gap-2 items-end rounded-xl p-2"
          style={{
            background: "hsl(150, 14%, 13%)",
            border: "1px solid hsl(150, 12%, 17%)",
          }}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your clients, trends, or performance..."
            rows={1}
            className="flex-1 resize-none bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm text-foreground placeholder:text-muted-foreground p-1 min-h-0"
            style={{ boxShadow: "none" }}
            data-testid="input-chat"
          />
          <Button
            size="sm"
            onClick={() => handleSend()}
            disabled={!input.trim() || sendMutation.isPending}
            className="h-8 w-8 p-0 flex-shrink-0 rounded-lg"
            style={{
              background: input.trim() ? "hsl(93, 48%, 55%)" : "hsl(150, 14%, 20%)",
              color: input.trim() ? "hsl(150, 18%, 8%)" : "hsl(140, 8%, 45%)",
            }}
            data-testid="button-send-chat"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Answers grounded in live data · Enter to send
        </p>
      </div>
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const sources: string[] = message.sourcesUsed
    ? (() => { try { return JSON.parse(message.sourcesUsed); } catch { return []; } })()
    : [];

  return (
    <div className={`flex gap-2 items-start ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: "hsl(93, 48%, 55%, 0.15)" }}
        >
          <Sparkles className="w-3 h-3" style={{ color: "hsl(93, 48%, 55%)" }} />
        </div>
      )}

      <div className={`max-w-[85%] space-y-1 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className="rounded-xl px-3 py-2.5 text-sm"
          style={
            isUser
              ? {
                  background: "hsl(93, 48%, 55%, 0.15)",
                  color: "hsl(140, 15%, 90%)",
                  border: "1px solid hsl(93, 48%, 55%, 0.25)",
                }
              : {
                  background: "hsl(150, 14%, 13%)",
                  color: "hsl(140, 15%, 88%)",
                  border: "1px solid hsl(150, 12%, 17%)",
                }
          }
        >
          {isUser ? (
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          ) : (
            <div className="prose prose-sm prose-invert max-w-none leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:mt-0.5 [&_strong]:text-foreground [&_h3]:text-foreground [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_code]:bg-secondary [&_code]:px-1 [&_code]:rounded [&_code]:text-xs">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {sources.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <FileText className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Sources used</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground px-1">
          {new Date(message.createdAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
