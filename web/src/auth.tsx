import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, token } from "./api";

export type Me = { id: number; name: string; role: string; village_id: number | null; meter_id: number | null; demo: boolean;
  points: number; unpaid: number; unpaid_amount: number; meter: { id: number; label: string; n_digits: number } | null };

type Ctx = { me: Me | null; loading: boolean; login: (t: string) => Promise<void>; logout: () => void; refresh: () => Promise<void>; staff: boolean };
const AuthCtx = createContext<Ctx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!token.get()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const m = await api<Me>("/api/me");
      setMe(m);
      localStorage.setItem("namjai.me", JSON.stringify(m));
    } catch (e: any) {
      if (e.status === 401) {
        token.set(null);
        setMe(null);
      } else {
        const cached = localStorage.getItem("namjai.me");
        if (cached) setMe(JSON.parse(cached));
      }
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const login = async (t: string) => {
    token.set(t);
    await refresh();
  };
  const logout = () => {
    token.set(null);
    localStorage.removeItem("namjai.me");
    setMe(null);
  };
  const staff = !!me && ["caretaker", "committee", "admin"].includes(me.role);
  return <AuthCtx.Provider value={{ me, loading, login, logout, refresh, staff }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
