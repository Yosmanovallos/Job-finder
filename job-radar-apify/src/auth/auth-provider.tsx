import React, { createContext, useContext, useState, useEffect } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase-client.js";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  subscriptionTier: "free" | "pro";
  subscriptionEnd?: string;
}

export interface AuthContextType {
  user: UserProfile | null;
  tier: "free" | "pro";
  isAuthenticated: boolean;
  loading: boolean;
  accessToken: string | null;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refreshTier: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [tier, setTier] = useState<"free" | "pro">("free");
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const fetchServerProfile = async (accessToken: string) => {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setTier(data.tier);
      setSubscriptionEnd(data.subscriptionEnd);
    } catch (e) {
      console.warn("[Auth] No se pudo verificar el tier con el servidor:", e);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) fetchServerProfile(data.session.access_token);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        fetchServerProfile(newSession.access_token);
      } else {
        setTier("free");
        setSubscriptionEnd(undefined);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` }
    });
    if (error) throw error;
  };

  const loginWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message };
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const refreshTier = async () => {
    if (session) await fetchServerProfile(session.access_token);
  };

  const user: UserProfile | null = session?.user
    ? {
        id: session.user.id,
        email: session.user.email || "",
        name:
          session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Usuario",
        subscriptionTier: tier,
        subscriptionEnd
      }
    : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        tier,
        isAuthenticated: !!session,
        loading,
        accessToken: session?.access_token || null,
        loginWithGoogle,
        loginWithEmail,
        signUpWithEmail,
        logout,
        refreshTier
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe ser usado dentro de un AuthProvider");
  }
  return context;
}
