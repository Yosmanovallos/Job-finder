import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";

// "Mis vacantes" on the client: the star (saved) and the check (applied) on
// every job, and the list in /cuenta. Backed by /api/me/saved-jobs for a
// signed-in visitor. Without a session, the first star or check remembers
// the job, sends the visitor to sign in and saves it on the way back. Until
// the table is migrated (the API answers 503) it behaves as it always did:
// marks kept in memory for this visit.

export interface SavedJobEntry {
  jobId: string;
  title: string;
  company: string | null;
  location: string | null;
  source: string | null;
  savedAt: string;
  appliedAt: string | null;
  available: boolean;
}

type Mode = "anonymous" | "loading" | "account" | "memory";

interface SavedJobsContextValue {
  mode: Mode;
  savedIds: Set<string>;
  appliedIds: Set<string>;
  /** The account's list, newest first (empty unless mode is "account"). */
  entries: SavedJobEntry[];
  toggleSaved: (jobId: string) => void;
  toggleApplied: (jobId: string) => void;
  remove: (jobId: string) => void;
  refresh: () => void;
}

const SavedJobsContext = createContext<SavedJobsContextValue | undefined>(undefined);

const PENDING_KEY = "bt:pending-saved-job";

interface PendingAction {
  jobId: string;
  applied: boolean;
}

function readPending(): PendingAction | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
    return value && typeof value.jobId === "string" ? { jobId: value.jobId, applied: value.applied === true } : null;
  } catch {
    return null;
  }
}

function toggleSet(set: Set<string>, jobId: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(jobId);
  else next.delete(jobId);
  return next;
}

function writePending(value: PendingAction | null): void {
  try {
    if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage blocked (private mode): the visitor just stars it again.
  }
}

export const SavedJobsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { accessToken, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // "loading" until the session is known, so an early click never sends a
  // signed-in visitor to the login page.
  const [mode, setMode] = useState<Mode>("loading");
  const [entries, setEntries] = useState<SavedJobEntry[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set());
  const [reloadKey, setReloadKey] = useState(0);

  // Read inside the stable callbacks below (memoized job cards depend on
  // their identity staying the same across renders).
  const live = useRef({ mode, accessToken, savedIds, appliedIds, path: location.pathname + location.search });
  live.current = { mode, accessToken, savedIds, appliedIds, path: location.pathname + location.search };

  const applyEntries = useCallback((list: SavedJobEntry[]) => {
    setEntries(list);
    setSavedIds(new Set(list.map((entry) => entry.jobId)));
    setAppliedIds(new Set(list.filter((entry) => entry.appliedAt).map((entry) => entry.jobId)));
  }, []);

  const request = useCallback(
    async (method: "PUT" | "DELETE", jobId: string, applied?: boolean): Promise<SavedJobEntry | null | "unavailable"> => {
      const token = live.current.accessToken;
      if (!token) return null;
      const res = await fetch(`/api/me/saved-jobs/${encodeURIComponent(jobId)}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(method === "PUT" ? { "Content-Type": "application/json" } : {}) },
        body: method === "PUT" ? JSON.stringify(applied === undefined ? {} : { applied }) : undefined
      });
      if (res.status === 503) return "unavailable";
      if (!res.ok) throw new Error(`saved-jobs ${method} ${res.status}`);
      return method === "PUT" ? ((await res.json()) as { savedJob: SavedJobEntry }).savedJob : null;
    },
    []
  );

  // Load the account's list once the session is known; then run a star or
  // check the visitor made before signing in.
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !accessToken) {
      setMode("anonymous");
      applyEntries([]);
      return;
    }
    let cancelled = false;
    setMode((current) => (current === "account" ? current : "loading"));
    (async () => {
      try {
        const pending = readPending();
        if (pending) {
          writePending(null);
          await request("PUT", pending.jobId, pending.applied || undefined).catch(() => null);
        }
        const res = await fetch("/api/me/saved-jobs", { headers: { Authorization: `Bearer ${accessToken}` } });
        if (cancelled) return;
        if (res.status === 503) {
          // Not migrated yet: the star the visitor signed in for still
          // shows, kept in memory like every other mark in this mode.
          if (pending) {
            setSavedIds((prev) => toggleSet(prev, pending.jobId, true));
            if (pending.applied) setAppliedIds((prev) => toggleSet(prev, pending.jobId, true));
          }
          setMode("memory");
          return;
        }
        if (!res.ok) throw new Error(`saved-jobs GET ${res.status}`);
        const data = (await res.json()) as { savedJobs: SavedJobEntry[] };
        applyEntries(data.savedJobs);
        setMode("account");
      } catch (error) {
        console.warn("[saved-jobs] No se pudieron cargar las vacantes guardadas:", error);
        if (!cancelled) setMode("memory");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, isAuthenticated, authLoading, reloadKey, request, applyEntries]);

  const goSignIn = useCallback(
    (pending: PendingAction) => {
      writePending(pending);
      navigate(`/login?${new URLSearchParams({ return_to: live.current.path, intent: "save" })}`);
    },
    [navigate]
  );

  const toggleSaved = useCallback(
    (jobId: string) => {
      const { mode: currentMode, savedIds: saved, appliedIds: applied } = live.current;
      if (currentMode === "anonymous") return goSignIn({ jobId, applied: false });
      const nowSaved = !saved.has(jobId);
      setSavedIds((prev) => toggleSet(prev, jobId, nowSaved));
      // Unsaving drops the job from "Mis vacantes", applied mark included.
      if (!nowSaved) setAppliedIds((prev) => toggleSet(prev, jobId, false));
      if (currentMode === "memory" || !live.current.accessToken) return;
      const previous = { saved, applied };
      request(nowSaved ? "PUT" : "DELETE", jobId)
        .then((entry) => {
          if (entry === "unavailable") return setMode("memory");
          setEntries((prev) => {
            const rest = prev.filter((item) => item.jobId !== jobId);
            return entry ? [entry, ...rest] : rest;
          });
        })
        .catch((error) => {
          console.warn("[saved-jobs] No se pudo guardar:", error);
          setSavedIds(previous.saved);
          setAppliedIds(previous.applied);
        });
    },
    [goSignIn, request]
  );

  const toggleApplied = useCallback(
    (jobId: string) => {
      const { mode: currentMode, savedIds: saved, appliedIds: applied } = live.current;
      if (currentMode === "anonymous") return goSignIn({ jobId, applied: true });
      const nowApplied = !applied.has(jobId);
      setAppliedIds((prev) => toggleSet(prev, jobId, nowApplied));
      // Marking applied also keeps the job in "Mis vacantes".
      if (nowApplied) setSavedIds((prev) => toggleSet(prev, jobId, true));
      if (currentMode === "memory" || !live.current.accessToken) return;
      const previous = { saved, applied };
      request("PUT", jobId, nowApplied)
        .then((entry) => {
          if (entry === "unavailable") return setMode("memory");
          if (entry) setEntries((prev) => [entry, ...prev.filter((item) => item.jobId !== jobId)].sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
        })
        .catch((error) => {
          console.warn("[saved-jobs] No se pudo marcar como postulada:", error);
          setSavedIds(previous.saved);
          setAppliedIds(previous.applied);
        });
    },
    [goSignIn, request]
  );

  const remove = useCallback(
    (jobId: string) => {
      if (live.current.savedIds.has(jobId)) toggleSaved(jobId);
    },
    [toggleSaved]
  );

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  const value = useMemo(
    () => ({ mode, savedIds, appliedIds, entries, toggleSaved, toggleApplied, remove, refresh }),
    [mode, savedIds, appliedIds, entries, toggleSaved, toggleApplied, remove, refresh]
  );
  return <SavedJobsContext.Provider value={value}>{children}</SavedJobsContext.Provider>;
};

export function useSavedJobs(): SavedJobsContextValue {
  const context = useContext(SavedJobsContext);
  if (!context) throw new Error("useSavedJobs debe usarse dentro de SavedJobsProvider");
  return context;
}
