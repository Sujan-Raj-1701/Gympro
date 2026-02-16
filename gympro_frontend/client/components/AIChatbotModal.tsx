import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Send, Bot, User, Loader2, Lock } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation } from "@tanstack/react-query";

interface AIChatbotModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  response: string;
  data_context?: any;
}

export default function AIChatbotModal({ open, onOpenChange }: AIChatbotModalProps) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Simple feature gate for AI chat
  const isAIEnabled = (() => {
    try {
      // 1) Explicit localStorage flag for overrides/debug
      const flag = (localStorage.getItem('enable_ai_chat') || '').toLowerCase();
      if (flag === 'true' || flag === '1' || flag === 'yes') return true;

      // 2) Check license_info features
      const licRaw = sessionStorage.getItem('license_info');
      if (licRaw) {
        const lic = JSON.parse(licRaw);
        const feats: string[] = Array.isArray(lic?.features) ? lic.features : [];
        if (feats.some((f) => typeof f === 'string' && /ai\s*(chat|assistant)/i.test(f))) return true;
      }

      // 3) Check retail_master flags (backend may set feature flags here)
      const rmRaw = sessionStorage.getItem('retail_master');
      if (rmRaw) {
        const rm = JSON.parse(rmRaw);
        if (rm?.ai_enabled === true || String(rm?.ai_enabled).toLowerCase() === 'true') return true;
        if (typeof rm?.features === 'string' && /ai\s*(chat|assistant)/i.test(rm.features)) return true;
        if (Array.isArray(rm?.features) && rm.features.some((f: any) => typeof f === 'string' && /ai\s*(chat|assistant)/i.test(f))) return true;
      }
    } catch {}
    return false;
  })();
  const isLocked = !isAIEnabled;

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: async (userMessage: string): Promise<ChatResponse> => {
      const response = await fetch("/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          conversation_history: messages.slice(-10),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to get AI response");
      }

      return response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: "assistant", content: data.response }]);
    },
    onError: (error: Error) => {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `Sorry, I encountered an error: ${error.message}. Please try again.` }
      ]);
    }
  });

  const handleSendMessage = () => {
    if (isLocked) return;
    if (!message.trim() || chatMutation.isPending) return;
    const userMessage = message.trim();
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setMessage("");
    chatMutation.mutate(userMessage);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[480px] p-0 overflow-hidden flex flex-col bg-white border-l border-slate-200">
        <SheetHeader className="relative p-4 border-b border-slate-200 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
              <Bot className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-semibold flex items-center gap-2 text-white">
                AI Assistant {isLocked && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white/15 px-2 py-0.5 rounded">
                    <Lock className="h-3.5 w-3.5" /> Locked
                  </span>
                )}
                <Sparkles className="h-4 w-4 animate-pulse" />
              </SheetTitle>
              <p className="text-xs text-white/90 mt-0.5">Intelligent insights for your business</p>
            </div>
          </div>
        </SheetHeader>

        <div className="relative flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4" ref={scrollAreaRef}>
            {isLocked ? (
              <div className="flex flex-col items-center justify-center h-full space-y-4 py-8">
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
                  <div className="inline-flex p-6 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full mb-4">
                    <Lock className="h-16 w-16 text-blue-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">Upgrade to unlock AI Chat</h3>
                  <p className="text-base text-slate-600 max-w-sm mx-auto leading-relaxed mb-5">
                    Get instant answers about bookings, revenue, staff performance and more. Enable the AI Assistant in your license to start chatting.
                  </p>
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
                      onClick={() => {
                        try { window.dispatchEvent(new Event('open-license-modal')); } catch {}
                        onOpenChange(false);
                      }}
                    >
                      Upgrade to Chat
                    </Button>
                    <p className="text-xs text-slate-500">Or contact 7397288500 • admin@techiesmagnifier.com</p>
                  </div>
                </motion.div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full space-y-4 py-8">
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
                  <div className="inline-flex p-6 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full mb-4">
                    <Bot className="h-16 w-16 text-blue-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-3">AI Business Assistant</h3>
                  <p className="text-base text-slate-600 max-w-sm mx-auto leading-relaxed mb-6">
                    Ask me anything about your business analytics, revenue, bookings, inventory, and more!
                  </p>

                  <div className="grid gap-2 max-w-md mx-auto text-left">
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Try asking:</p>
                    {[
                      "What is my total revenue?",
                      "How many bookings do I have?",
                      "Show me my sales performance",
                      "What is my profit this month?",
                    ].map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setMessage(suggestion);
                          setTimeout(() => handleSendMessage(), 100);
                        }}
                        className="text-sm text-left px-4 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </div>
            ) : (
              <div className="space-y-4">
                <AnimatePresence>
                  {messages.map((msg, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white">
                          <Bot className="h-5 w-5" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                          msg.role === "user"
                            ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white"
                            : "bg-white/70 backdrop-blur-sm text-slate-800 border border-blue-100 shadow-sm"
                        }`}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      {msg.role === "user" && (
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600">
                          <User className="h-5 w-5" />
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                {chatMutation.isPending && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 justify-start">
                    <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div className="bg-white/70 backdrop-blur-sm text-slate-800 border border-blue-100 shadow-sm px-4 py-3 rounded-2xl">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                        <span className="text-sm text-slate-600">Thinking...</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="p-4 bg-white border-t border-slate-200 shrink-0 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
          {isLocked ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-slate-600">AI Chat is locked for your plan.</p>
              <Button
                variant="default"
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
                onClick={() => {
                  try { window.dispatchEvent(new Event('open-license-modal')); } catch {}
                  onOpenChange(false);
                }}
              >
                Upgrade to Chat
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Ask me anything about your business..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={chatMutation.isPending}
                  className="flex-1 bg-slate-50 border-slate-200 focus:border-blue-400 focus:ring-blue-400/20"
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!message.trim() || chatMutation.isPending}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shrink-0"
                >
                  {chatMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-slate-500 mt-2 text-center">
                Powered by AI  Real-time business insights
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
