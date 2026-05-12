import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { apiFetch, expectApiJson, API_BASE } from "@/lib/apiClient";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "doctor";
};

export type AuthSessionResponse = {
  authenticated: boolean;
  user: AuthUser | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: { username: string; password: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthUser | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadSession() {
  const response = await apiFetch(`${API_BASE}/auth/session`, {
    method: "GET",
    skipUnauthorizedRedirect: true,
  });
  const payload = await expectApiJson<AuthSessionResponse>(response, "Unable to load session.");
  return payload.user || null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = async () => {
    const nextUser = await loadSession();
    setUser(nextUser);
    return nextUser;
  };

  useEffect(() => {
    refreshSession()
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    const handler = async () => {
      try {
        const nextUser = await loadSession();
        setUser(nextUser);
      } catch {
        setUser(null);
      }

      if (location.pathname !== "/login") {
        navigate("/login", {
          replace: true,
          state: { from: location.pathname + location.search },
        });
      }
    };

    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, [location.pathname, location.search, navigate]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    isAuthenticated: Boolean(user),
    login: async ({ username, password }) => {
      const response = await apiFetch(`${API_BASE}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
        skipUnauthorizedRedirect: true,
      });
      const payload = await expectApiJson<{ user: AuthUser }>(response, "Login failed.");
      setUser(payload.user);
      return payload.user;
    },
    logout: async () => {
      const response = await apiFetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        skipUnauthorizedRedirect: true,
      });
      await expectApiJson<{ success: boolean }>(response, "Logout failed.");
      setUser(null);
      navigate("/login", { replace: true });
    },
    refreshSession,
  }), [user, isLoading, navigate]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export function ProtectedRoute({ roles }: { roles?: Array<AuthUser["role"]> }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600">
        Checking session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <ForbiddenState />;
  }

  return <Outlet />;
}

export function LoginRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600">
        Checking session...
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export function RoleGate({
  allow,
  children,
}: {
  allow: Array<AuthUser["role"]>;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !allow.includes(user.role)) return null;
  return <>{children}</>;
}

export function ForbiddenState() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-16">
      <div className="mx-auto max-w-xl rounded-3xl border border-rose-100 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          403
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Access denied</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your account is authenticated, but this area is restricted to a different role.
        </p>
      </div>
    </div>
  );
}
