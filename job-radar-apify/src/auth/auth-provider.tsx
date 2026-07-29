import React, { createContext, useContext, useState, useEffect } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase-client.js";
import { isSupabaseConfigError } from "../lib/auth-error-messages.js";

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
  // null = onboarding step not seen yet (new signup); array (even empty)
  // once the user has gone through the "¿qué puestos buscas?" step.
  preferredRoles: string[] | null;
  // True once /api/me has resolved at least once for the current session —
  // distinguishes "not onboarded" from "haven't checked yet".
  profileLoaded: boolean;
  loginWithGoogle: (returnTo?: string) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmail: (
    email: string,
    password: string,
    returnTo?: string
  ) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refreshTier: () => Promise<void>;
  updateProfileName: (name: string) => Promise<{ error?: string }>;
  saveProfileRoles: (roles: string[]) => Promise<{ error?: string }>;
  sendPasswordReset: (email: string) => Promise<{ error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ error?: string }>;
  resendConfirmation: (email: string) => Promise<{ error?: string }>;
  // True from the moment Supabase's recovery link lands back on this app
  // (PASSWORD_RECOVERY auth event) until updatePassword succeeds — gates the
  // "set new password" screen so it can't be reached without a valid link.
  passwordRecovery: boolean;
  // Set when Supabase itself rejects our API key (misconfigured VITE_SUPABASE_*
  // env vars in this deployment) — distinct from a user typing the wrong
  // password, and never resolved by retrying the same action.
  configError: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [tier, setTier] = useState<"free" | "pro">("free");
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | undefined>(undefined);
  const [dbName, setDbName] = useState<string | undefined>(undefined);
  const [preferredRoles, setPreferredRoles] = useState<string[] | null>(null);
  // Distinct from `loading` (session resolution): tracks whether the /api/me
  // round trip has settled at least once for the current session, so callers
  // can tell "not onboarded yet" (preferredRoles === null, profileLoaded)
  // apart from "haven't checked yet" (preferredRoles === null, !profileLoaded).
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  const fetchServerProfile = async (accessToken: string) => {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setTier(data.tier);
      setSubscriptionEnd(data.subscriptionEnd);
      setDbName(data.name || undefined);
      setPreferredRoles(Array.isArray(data.preferredRoles) ? data.preferredRoles : null);
    } catch (e) {
      console.warn("[Auth] No se pudo verificar el tier con el servidor:", e);
    } finally {
      setProfileLoaded(true);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        const misconfigured = isSupabaseConfigError(error.message);
        setConfigError(misconfigured);
        console.error(
          misconfigured
            ? "[Auth] Supabase rechazó la API key configurada — revisa VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY en el entorno de despliegue."
            : "[Auth] No se pudo resolver la sesión inicial:",
          error.message
        );
      }
      setSession(data.session);
      if (data.session) fetchServerProfile(data.session.access_token);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setSession(newSession);
      if (newSession) {
        fetchServerProfile(newSession.access_token);
      } else {
        setTier("free");
        setSubscriptionEnd(undefined);
        setDbName(undefined);
        setPreferredRoles(null);
        setProfileLoaded(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const loginWithGoogle = async (returnTo?: string) => {
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (returnTo) callbackUrl.searchParams.set("return_to", returnTo);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl.toString() }
    });
    if (error) {
      if (isSupabaseConfigError(error.message)) {
        setConfigError(true);
        console.error(
          "[Auth] Supabase rechazó la API key configurada (Google OAuth).",
          error.message
        );
      }
      throw error;
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error && isSupabaseConfigError(error.message)) {
      setConfigError(true);
      console.error("[Auth] Supabase rechazó la API key configurada (login).", error.message);
    }
    return { error: error?.message };
  };

  const signUpWithEmail = async (email: string, password: string, returnTo?: string) => {
    // Without emailRedirectTo, Supabase falls back to the project's "Site
    // URL" for the confirmation link — which is easy to leave pointed at
    // localhost (a real-world case we hit: see docs/BACKLOG.md). Pin it to
    // this deployment's own origin so it never depends on that setting.
    // Carries return_to the same way loginWithGoogle does, so a signup
    // started from the apply-gate modal still lands back on the job the
    // user wanted after they click the confirmation link in their email.
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (returnTo) callbackUrl.searchParams.set("return_to", returnTo);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: callbackUrl.toString() }
    });
    if (error && isSupabaseConfigError(error.message)) {
      setConfigError(true);
      console.error("[Auth] Supabase rechazó la API key configurada (signup).", error.message);
    }
    return { error: error?.message };
  };

  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });
    if (error && isSupabaseConfigError(error.message)) {
      setConfigError(true);
      console.error(
        "[Auth] Supabase rechazó la API key configurada (reset password).",
        error.message
      );
    }
    return { error: error?.message };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      if (isSupabaseConfigError(error.message)) {
        setConfigError(true);
        console.error(
          "[Auth] Supabase rechazó la API key configurada (update password).",
          error.message
        );
      }
      return { error: error.message };
    }
    setPasswordRecovery(false);
    return {};
  };

  const resendConfirmation = async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
    });
    if (error && isSupabaseConfigError(error.message)) {
      setConfigError(true);
      console.error("[Auth] Supabase rechazó la API key configurada (resend).", error.message);
    }
    return { error: error?.message };
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const refreshTier = async () => {
    if (session) await fetchServerProfile(session.access_token);
  };

  const updateProfileName = async (name: string) => {
    if (!session) return { error: "No autenticado" };
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) return { error: data?.error || "No se pudo actualizar el nombre" };
      setDbName(data.name || undefined);
      setTier(data.tier);
      setSubscriptionEnd(data.subscriptionEnd);
      return {};
    } catch (e: any) {
      return { error: e?.message || "No se pudo actualizar el nombre" };
    }
  };

  const saveProfileRoles = async (roles: string[]) => {
    if (!session) return { error: "No autenticado" };
    try {
      const res = await fetch("/api/me/roles", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ roles })
      });
      const data = await res.json();
      if (!res.ok) return { error: data?.error || "No se pudieron guardar los puestos" };
      setPreferredRoles(Array.isArray(data.preferredRoles) ? data.preferredRoles : []);
      return {};
    } catch (e: any) {
      return { error: e?.message || "No se pudieron guardar los puestos" };
    }
  };

  const user: UserProfile | null = session?.user
    ? {
        id: session.user.id,
        email: session.user.email || "",
        // Our own DB row (editable via updateProfileName) wins once set;
        // falls back to whatever Google OAuth gave us, then the email.
        name:
          dbName ||
          session.user.user_metadata?.full_name ||
          session.user.email?.split("@")[0] ||
          "Usuario",
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
        preferredRoles,
        profileLoaded,
        loginWithGoogle,
        loginWithEmail,
        signUpWithEmail,
        logout,
        refreshTier,
        updateProfileName,
        saveProfileRoles,
        sendPasswordReset,
        updatePassword,
        resendConfirmation,
        passwordRecovery,
        configError
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
