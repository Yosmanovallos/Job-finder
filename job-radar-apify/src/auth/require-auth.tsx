import type { JSX } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-provider.js";

// Gates routes that need a real session (e.g. /cuenta). Deliberately NOT used
// on /dashboard — that route is public by design (anonymous visitors browse
// the 48h-masked freemium view, see Dashboard.tsx's "Explorando sin cuenta"
// state).
export default function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#fafafa" }}
      >
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?return_to=${returnTo}`} replace />;
  }

  return children;
}
