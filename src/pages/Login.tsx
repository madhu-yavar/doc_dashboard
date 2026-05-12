import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LockKeyhole, ShieldCheck, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const from = typeof location.state?.from === "string" ? location.state.from : "/dashboard";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await login({ username, password });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid username or password.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_28%),linear-gradient(180deg,_#f8fffc_0%,_#edf7f3_100%)] px-6 py-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-emerald-200 bg-white/70 px-4 py-2 text-sm text-emerald-800 shadow-sm">
            <Stethoscope className="h-4 w-4" />
            Secure clinician access
          </div>
          <div className="max-w-2xl space-y-5">
            <h1 className="text-5xl font-semibold leading-tight tracking-tight text-slate-900">
              Secure access to the clinical document and decision-support workspace.
            </h1>
            <p className="max-w-xl text-base leading-7 text-slate-600">
              Sign in with your assigned credentials to review records, process documents, and access workflow tools permitted for your role.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-emerald-100 bg-white/80 shadow-sm">
              <CardContent className="flex gap-3 p-5">
                <ShieldCheck className="mt-1 h-5 w-5 text-emerald-600" />
                <div>
                  <p className="font-medium text-slate-900">Role-based access</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Access is governed by user role, with controls applied across both the application and server APIs.
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-emerald-100 bg-white/80 shadow-sm">
              <CardContent className="flex gap-3 p-5">
                <LockKeyhole className="mt-1 h-5 w-5 text-emerald-600" />
                <div>
                  <p className="font-medium text-slate-900">Session security</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Sessions are maintained server-side and protected in transit using secure HttpOnly session cookies.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <CardContent className="p-8">
            <div className="mb-8">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">Sign in</p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">Doctor Dashboard access</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Enter your assigned username and password. Access is determined automatically after authentication.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="doctor.smith"
                  disabled={submitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  disabled={submitting}
                />
              </div>

              {error ? <p className="text-sm text-rose-600">{error}</p> : null}

              <Button className="w-full" type="submit" disabled={submitting || !username.trim() || !password}>
                {submitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
