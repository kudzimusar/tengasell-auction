"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, getApiMode, initApi, onApiMode, type ApiMode } from "./api";
import { connectSocket, disconnectSocket, isConnected } from "./socket";
import { bus } from "./bus";
import type { CurrentUser } from "./types";

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  mode: ApiMode;
  engineConnected: boolean;
  signIn: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUp: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ApiMode>(getApiMode());
  const [engineConnected, setEngineConnected] = useState(false);
  const booted = useRef(false);

  useEffect(() => onApiMode(setMode), []);

  useEffect(() => {
    const off = bus.on("connection:changed", ({ connected }) => setEngineConnected(connected));
    return () => off();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setEngineConnected(isConnected()), 4000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const m = await initApi();
      setMode(m);
      if (m === "live") {
        const current = await api.currentUser();
        setUser(current);
        // Connect the floor socket even for anonymous visitors (token-less
        // auth) — the engine accepts anonymous sockets and enforces auth
        // per-RPC. Without this the header pill claims "Demo mode" for every
        // signed-out visitor even though they are browsing live data.
        await connectSocket(current?.token ?? null).catch(() => {});
      } else {
        const current = await api.currentUser();
        setUser(current);
      }
      setLoading(false);
    })();
  }, []);

  const refreshUser = useCallback(async () => {
    const current = await api.currentUser();
    setUser(current);
  }, []);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const res = await api.login(username, password);
      if (res.ok && res.user) {
        setUser(res.user);
        if (getApiMode() === "live" && res.user.token) {
          await connectSocket(res.user.token);
        }
      }
      return { ok: res.ok, error: res.error };
    },
    [],
  );

  const signUp = useCallback(
    async (username: string, password: string) => {
      const res = await api.register(username, password);
      if (!res.ok) return res;
      return await signIn(username, password);
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    disconnectSocket();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, mode, engineConnected, signIn, signUp, signOut, refreshUser }),
    [user, loading, mode, engineConnected, signIn, signUp, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
