"use client";

// Tengasell Q&A section — Yahoo Auctions-style public questions & answers.
// Buyers ask (min 10 chars), the seller answers inline; question:update bus
// events refresh the list in realtime.

import { useState } from "react";
import { Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { formatRelative } from "@/lib/tengasell/format";
import { useLinkProps } from "@/lib/tengasell/router";
import type { Auction, Question } from "@/lib/tengasell/types";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/tengasell/ui";
import { cn } from "@/lib/utils";
import { maskUsername } from "./helpers";

interface QaSectionProps {
  auction: Auction;
  questions: Question[] | null;
  loading: boolean;
  reload: () => void;
}

const MIN_QUESTION_LEN = 10;

export function QaSection({ auction, questions, loading, reload }: QaSectionProps) {
  const { user } = useAuth();
  const isSeller = !!user && user.username === auction.seller_username;
  const canAsk = !!user && !isSeller;

  return (
    <div className="space-y-5 pt-4">
      {canAsk ? (
        <AskForm auction={auction} reload={reload} />
      ) : !user ? (
        <SignInToAsk />
      ) : (
        <p className="rounded-control bg-gold-soft/60 dark:bg-gold-soft/30 text-gold-on dark:text-gold-on text-caption p-3 font-medium">
          You&apos;re the seller of this listing — answer buyer questions below.
        </p>
      )}

      {loading && !questions?.length ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading questions">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-card border border-border p-4 space-y-2">
              <div className="h-3 w-24 bg-muted rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : !questions?.length ? (
        <EmptyState
          icon={<MessageCircleQuestion className="size-10" />}
          title="No questions yet"
          body="Be the first to ask — sellers usually reply within a few hours."
        />
      ) : (
        <ul className="space-y-3">
          {[...questions]
            .sort((a, b) => a.id - b.id)
            .map((q) => (
              <QuestionItem key={q.id} question={q} isSeller={isSeller} reload={reload} />
            ))}
        </ul>
      )}
    </div>
  );
}

// ── ask form ──────────────────────────────────────────────────────────

function AskForm({ auction, reload }: { auction: Auction; reload: () => void }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const trimmed = body.trim();
  const tooShort = trimmed.length < MIN_QUESTION_LEN;

  const ask = async () => {
    if (tooShort || sending) return;
    setSending(true);
    try {
      await api.askQuestion(auction.id, trimmed);
      setBody("");
      toast({
        title: "Question sent",
        description: "The seller has been notified — answers appear here.",
      });
      reload();
    } catch (err) {
      toast({
        title: "Could not send question",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-card border border-border bg-raised p-4 space-y-2">
      <label htmlFor="ts-question" className="text-label text-foreground">
        Ask the seller a question
      </label>
      <Textarea
        id="ts-question"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Ask the seller a question… (min 10 characters)"
        disabled={sending}
        aria-describedby="ts-question-hint"
        className="rounded-input resize-none"
      />
      <div className="flex items-center justify-between gap-3">
        <span
          id="ts-question-hint"
          className={cn(
            "text-caption ts-numeric",
            trimmed.length >= MIN_QUESTION_LEN ? "text-ok" : "text-muted-foreground",
          )}
        >
          {trimmed.length}/{MIN_QUESTION_LEN} min characters
        </span>
        <Button
          onClick={ask}
          disabled={tooShort || sending}
          className="min-h-11 rounded-control"
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          Ask question
        </Button>
      </div>
    </div>
  );
}

function SignInToAsk() {
  const link = useLinkProps("/signin");
  return (
    <p className="text-caption text-muted-foreground rounded-control border border-dashed border-border p-3">
      <a {...link} className="font-semibold text-teal hover:underline">
        Sign in
      </a>{" "}
      to ask the seller a question.
    </p>
  );
}

// ── one question + answer pair ────────────────────────────────────────

function QuestionItem({
  question,
  isSeller,
  reload,
}: {
  question: Question;
  isSeller: boolean;
  reload: () => void;
}) {
  return (
    <li className="rounded-card border border-border bg-raised p-4">
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center size-5 rounded-full bg-teal-tint text-teal-deep dark:text-teal-soft font-bold text-[10px]"
        >
          Q
        </span>
        <span className="font-semibold text-foreground">{maskUsername(question.asker_username)}</span>
        <span aria-hidden="true">·</span>
        <time title={question.created_at}>{formatRelative(question.created_at)}</time>
      </div>
      <p className="text-body text-foreground mt-2 whitespace-pre-line">{question.body}</p>

      {question.answer ? (
        <div className="mt-3 rounded-control bg-muted/60 p-3">
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center size-5 rounded-full bg-gold-soft text-gold-deep font-bold text-[10px]"
            >
              A
            </span>
            <span className="font-semibold text-foreground">Seller</span>
            <span aria-hidden="true">·</span>
            <time title={question.answered_at ?? undefined}>
              {question.answered_at ? formatRelative(question.answered_at) : ""}
            </time>
          </div>
          <p className="text-body text-foreground mt-1.5 whitespace-pre-line">{question.answer}</p>
        </div>
      ) : isSeller ? (
        <AnswerForm question={question} reload={reload} />
      ) : (
        <p className="text-caption text-muted-foreground mt-2">Awaiting seller&apos;s answer…</p>
      )}
    </li>
  );
}

function AnswerForm({ question, reload }: { question: Question; reload: () => void }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const trimmed = body.trim();

  const answer = async () => {
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await api.answerQuestion(question.id, trimmed);
      setBody("");
      toast({ title: "Answer posted", description: "The buyer has been notified." });
      reload();
    } catch (err) {
      toast({
        title: "Could not post answer",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <Textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Answer this question publicly…"
        disabled={sending}
        aria-label={`Answer question from ${maskUsername(question.asker_username)}`}
        className="rounded-input resize-none"
      />
      <div className="flex justify-end">
        <Button
          onClick={answer}
          disabled={!trimmed || sending}
          size="sm"
          className="min-h-9 rounded-control"
        >
          {sending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-3.5" aria-hidden="true" />
          )}
          Post answer
        </Button>
      </div>
    </div>
  );
}
