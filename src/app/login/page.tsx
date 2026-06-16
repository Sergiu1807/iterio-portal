"use client";

import { useState } from "react";
import { ArrowRight, Sparkles, MailCheck, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setError("");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
      <div className="brand-wash pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-[28%] bg-primary text-primary-foreground shadow-card">
            <Sparkles className="size-5" />
          </span>
          <h1 className="font-display letterpress text-3xl font-semibold tracking-tight">Iterio Portal</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Your personal multi-brand creative workspace.</p>
        </div>

        <div
          className="rounded-[var(--radius)] border border-border/70 bg-card p-7"
          style={{ boxShadow: "var(--shadow-card), var(--inner-light)" }}
        >
          {status === "sent" ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
                <MailCheck className="size-6" />
              </span>
              <h2 className="font-display text-lg font-medium">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                We sent a magic link to <span className="font-medium text-foreground">{email}</span>. Open it on this device to sign in.
              </p>
              <button onClick={() => setStatus("idle")} className="mt-1 text-sm text-primary hover:underline">
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={sendLink} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@studio.co"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === "sending"}
                  autoFocus
                />
              </div>
              {status === "error" && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" size="lg" disabled={status === "sending" || !email.trim()}>
                {status === "sending" ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                {status === "sending" ? "Sending…" : "Send magic link"}
              </Button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Passwordless sign-in via Supabase. Only allow-listed emails get access.
        </p>
      </div>
    </div>
  );
}
