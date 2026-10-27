import type { JSX } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-provider.js";
import { AuthSpinner } from "../components/AuthShell.js";

// Gates routes that need a real session (e.g. /cuenta). Deliberately NOT used
// on /dashboard — that route is public by design (anonymous visitors browse
// the 48h-masked freemium view, see Dashboard.tsx's "Explorando sin cuenta"
// state).
export default function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <AuthSpinner />;

  if (!isAuthenticated) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?return_to=${returnTo}`} replace />;
  }

  return children;
}
