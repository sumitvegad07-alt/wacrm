"use client";

import { useEffect, useState } from "react";
import { Link } from "@/components/ui/link";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Where a password-reset link finally lands. `/auth/callback` has already
// traded the one-time code for a session by the time this renders, so the
// only thing left is to set the new password on it.
export default function ResetPasswordPage() {
  // Until the session is known we show nothing but the card frame — rendering
  // the form first and snatching it away reads as a bug.
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "missing">(
    "checking",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSessionState(data.session ? "ready" : "missing");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Both passwords must match");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Full reload, like sign-in: the browser then sends the refreshed auth
    // cookie with the very next request.
    window.location.href = "/dashboard";
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            {sessionState === "missing" ? "This link has expired" : "Set a new password"}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {sessionState === "missing"
              ? "Reset links can only be used once, and only in the browser that asked for them. Request a new one and it will work."
              : "Choose a password you have not used here before. You will be signed in straight away."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionState === "checking" && (
            <p className="text-center text-sm text-muted-foreground">Checking your link...</p>
          )}

          {sessionState === "missing" && (
            <Link href="/forgot-password">
              <Button
                variant="outline"
                className="h-10 w-full border-border text-foreground hover:bg-muted"
              >
                Request a new link
              </Button>
            </Link>
          )}

          {sessionState === "ready" && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-muted-foreground">
                  New password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="border-border bg-muted pr-10 text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center px-3 text-muted-foreground hover:text-foreground md:min-w-0"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm" className="text-muted-foreground">
                  Confirm password
                </Label>
                <Input
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  placeholder="Type it again"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
