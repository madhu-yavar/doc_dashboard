import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LockKeyhole, FileText, Activity, Clock } from "lucide-react";
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.08),_transparent_30%),linear-gradient(180deg,_#f8fffc_0%,_#edf7f3_100%)] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between rounded-[28px] border border-white/70 bg-white/75 px-6 py-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur">
          <img src="/manipal-logo.png" alt="Manipal Hospitals" className="h-10 w-auto object-contain sm:h-12" />
          <img src="/yavar-logo.png" alt="Powered by Yavar.ai" className="h-10 w-auto object-contain sm:h-12" />
        </div>

        <div className="grid min-h-[calc(100vh-12rem)] items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-8">
          <div className="max-w-2xl space-y-5">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              Your AI-powered clinical workspace
            </h1>
            <p className="max-w-xl text-base leading-7 text-slate-600">
              Instantly extract patient information, medications, and clinical insights from prescriptions, lab reports, and handwritten notes.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="rounded-[24px] border-emerald-100 bg-white/80 shadow-sm">
              <CardContent className="flex gap-3 p-5">
                <FileText className="mt-1 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-medium text-slate-900">Smart extraction</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Auto-capture patient details, meds, and diagnosis from any document
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-[24px] border-emerald-100 bg-white/80 shadow-sm">
              <CardContent className="flex gap-3 p-5">
                <Activity className="mt-1 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-medium text-slate-900">Real-time alerts</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Pharmacy & department notifications for faster patient care
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-[24px] border-emerald-100 bg-white/80 shadow-sm">
              <CardContent className="flex gap-3 p-5">
                <Clock className="mt-1 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-medium text-slate-900">Save time</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Reduce manual data entry and focus on what matters most
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="overflow-hidden rounded-[28px] border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <div className="border-b border-emerald-100 bg-[linear-gradient(135deg,rgba(16,185,129,0.08),rgba(255,255,255,0.7))] px-8 py-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">Sign in</p>
                <h2 className="mt-3 text-2xl font-semibold text-slate-900">Access your dashboard</h2>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                <LockKeyhole className="h-5 w-5" />
              </div>
            </div>
          </div>
          <CardContent className="p-8 pt-6">

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

              <Button className="h-11 w-full" type="submit" disabled={submitting || !username.trim() || !password}>
                {submitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
