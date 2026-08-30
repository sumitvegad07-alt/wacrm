"use client";

// ============================================================
// ASK OZZO — floating Support & Implementation Copilot (web).
//
// Read-only: it explains, guides and troubleshoots the product, grounded in
// OZZO docs with citations. It never shows business data and never acts.
// Streams NDJSON from /api/ozzo/ask.
// ============================================================

import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, Send, X, BookOpen } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface Citation {
  slug: string;
  title: string;
  module: string;
}
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  error?: boolean;
}

const STARTERS = [
  "How do I configure a scheme?",
  "Why can't my field agent punch in?",
  "What's the difference between an order and an invoice?",
  "How do I import my customer list correctly?",
];

export function AskOzzo() {
  const { user, profile, account, hasCRM, hasSFA, hasWFA, moduleSettings } =
    useAuth();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const context = useMemo(() => {
    const plan =
      [hasSFA && "SFA", hasWFA && "WFA", hasCRM && "CRM"]
        .filter(Boolean)
        .join("+") || account?.subscription_plan;
    const enabledModules = Object.entries(moduleSettings || {}).map(
      ([k, v]) => `${k}:${v ? "on" : "off"}`,
    );
    const currentModule = pathname?.split("/").filter(Boolean)[0] || undefined;
    return {
      roleName: profile?.employee_role?.name ?? undefined,
      accountRole: profile?.account_role ?? undefined,
      plan,
      enabledModules,
      currentModule,
    };
  }, [
    profile?.employee_role?.name,
    profile?.account_role,
    hasSFA,
    hasWFA,
    hasCRM,
    account?.subscription_plan,
    moduleSettings,
    pathname,
  ]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || streaming) return;
      setInput("");
      setMessages((m) => [
        ...m,
        { role: "user", content: q },
        { role: "assistant", content: "" },
      ]);
      setStreaming(true);
      scrollToBottom();

      try {
        const res = await fetch("/api/ozzo/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            question: q,
            surface: "web",
            context,
          }),
        });

        if (!res.ok || !res.body) {
          const msg =
            res.status === 429
              ? "You're asking quickly — give me a moment."
              : res.status === 403
                ? "ASK OZZO isn't enabled for your account."
                : "I'm having trouble right now. Please try again.";
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", content: msg, error: true };
            return copy;
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const applyLine = (line: string) => {
          if (!line.trim()) return;
          let evt: {
            type: string;
            text?: string;
            message?: string;
            conversationId?: string;
            citations?: Citation[];
          };
          try {
            evt = JSON.parse(line);
          } catch {
            return;
          }
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (evt.type === "delta") {
              copy[copy.length - 1] = { ...last, content: last.content + (evt.text ?? "") };
            } else if (evt.type === "done") {
              copy[copy.length - 1] = { ...last, citations: evt.citations ?? [] };
              if (evt.conversationId) setConversationId(evt.conversationId);
            } else if (evt.type === "error") {
              copy[copy.length - 1] = {
                ...last,
                content: last.content || (evt.message ?? "Something went wrong."),
                error: true,
              };
            }
            return copy;
          });
          scrollToBottom();
        };

        // Read the NDJSON stream line by line.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) applyLine(line);
        }
        if (buffer) applyLine(buffer);
      } catch {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: "assistant",
            content: "I'm having trouble right now. Please try again.",
            error: true,
          };
          return copy;
        });
      } finally {
        setStreaming(false);
        scrollToBottom();
      }
    },
    [conversationId, context, streaming, scrollToBottom],
  );

  // Only signed-in users see the assistant. The account-level toggle is
  // enforced server-side (a disabled account returns 403, handled above).
  if (!user) return null;

  return (
    <>
      {/* Floating launcher (bottom-right; mobile theme toggle uses bottom-left). */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Ozzo"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
        >
          <Sparkles className="size-4" />
          <span className="text-sm font-semibold">Ask Ozzo</span>
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Ask Ozzo
            </SheetTitle>
            <SheetDescription>
              Your OZZO help assistant — how to set things up and why things
              work the way they do. It doesn&apos;t show your data or make changes.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div ref={scrollRef} className="flex h-full flex-col gap-4 p-4">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Ask me anything about using OZZO. For example:
                  </p>
                  <div className="flex flex-col gap-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="rounded-lg border bg-muted/40 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user" ? "flex justify-end" : "flex justify-start"
                  }
                >
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                        : `max-w-[90%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm ${
                            m.error
                              ? "bg-destructive/10 text-foreground"
                              : "bg-muted text-foreground"
                          }`
                    }
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {m.content}
                      {m.role === "assistant" &&
                        streaming &&
                        i === messages.length - 1 &&
                        !m.content && (
                          <span className="text-muted-foreground">Thinking…</span>
                        )}
                    </p>

                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
                        <BookOpen className="size-3 text-muted-foreground" />
                        {m.citations.map((c) => (
                          <Badge
                            key={c.slug}
                            variant="secondary"
                            className="text-[10px] font-normal"
                          >
                            {c.title}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-end gap-2"
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Ask how to do something…"
                rows={1}
                className="max-h-32 min-h-[42px] resize-none"
                disabled={streaming}
              />
              <Button
                type="submit"
                size="icon"
                disabled={streaming || !input.trim()}
                aria-label="Send"
              >
                <Send className="size-4" />
              </Button>
            </form>
            <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
              Ozzo can be wrong — it explains the product and can&apos;t see your
              data or make changes.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}
