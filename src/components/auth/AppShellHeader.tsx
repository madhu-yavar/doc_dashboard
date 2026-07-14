import { Database, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export default function AppShellHeader() {
  const { user, logout } = useAuth();
  const welcomeLabel = user?.displayName ? `Welcome ${user.displayName}!` : "Welcome";

  return (
    <div className="border-b border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,249,0.98))] backdrop-blur">
      <div className="app-shell flex flex-col gap-4 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col items-start">
          <img
            src="/manipal-logo.png"
            alt="Manipal Hospitals"
            className="h-8 w-auto shrink-0 object-contain blur-lg select-none"
          />
        </div>

        <div className="flex flex-col items-start gap-3 self-start lg:items-end lg:self-auto">
          <img
            src="/yavar-logo.png"
            alt="Powered by Yavar.ai"
            className="h-8 w-auto shrink-0 object-contain opacity-85"
          />
          <div className="flex items-center gap-2">
            <p className="text-sm text-slate-600">{welcomeLabel}</p>
            {user?.role === "admin" ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="rounded-full px-3 text-slate-600 hover:text-slate-900"
              >
                <Link to="/admin/item-service-master">
                  <Database className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.8} />
                  Item master
                </Link>
              </Button>
            ) : null}
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
