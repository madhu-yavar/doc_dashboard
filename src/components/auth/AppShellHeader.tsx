import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, LogOut, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export default function AppShellHeader() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isUploadRoute = location.pathname.startsWith("/upload");
  const isDashboardRoute = location.pathname.startsWith("/dashboard");
  const welcomeLabel = user?.displayName ? `Welcome ${user.displayName}!` : "Welcome";

  return (
    <div className="border-b border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,249,0.98))] backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col items-start gap-1">
          <img
            src="/manipal-logo.png"
            alt="Manipal Hospitals"
            className="h-8 w-auto shrink-0 object-contain"
          />
          <img
            src="/yavar-logo.png"
            alt="Powered by Yavar.ai"
            className="h-3.5 w-auto shrink-0 object-contain opacity-70"
          />
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={
                isUploadRoute
                  ? "rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                  : "rounded-full text-slate-600 hover:text-slate-900"
              }
            >
              <Link to="/upload">
                <Upload className="mr-2 h-3.5 w-3.5" strokeWidth={1.8} />
                Upload
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className={
                isDashboardRoute
                  ? "rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                  : "rounded-full text-slate-600 hover:text-slate-900"
              }
            >
              <Link to="/dashboard">
                <LayoutDashboard className="mr-2 h-3.5 w-3.5" strokeWidth={1.8} />
                Chartboard
              </Link>
            </Button>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <p className="text-sm text-slate-600">{welcomeLabel}</p>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full px-3 text-slate-600 hover:text-slate-900"
              onClick={() => void logout()}
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
