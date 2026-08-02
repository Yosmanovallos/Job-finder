import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Star } from "lucide-react";
import { useAuth } from "../auth/auth-provider.js";
import { Button } from "./ui/button.js";
import { Textarea } from "./ui/textarea.js";
import { CompanyReviewsDataProps, MyCompanyReviewProps } from "./CompanyReviewsList.js";

export interface CompanyReviewFormProps {
  slug: string;
  myReview: MyCompanyReviewProps | null;
  onUpdate: (data: CompanyReviewsDataProps) => void;
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value;
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Calificación">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} de 5 estrellas`}
          className="p-0.5"
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onChange(n)}
        >
          <Star
            className="h-6 w-6 transition-colors"
            style={{ color: "#d4a93a" }}
            fill={n <= shown ? "currentColor" : "none"}
          />
        </button>
      ))}
    </div>
  );
}

// Gated on isAuthenticated alone (same gate as /cuenta), never on onboarding
// completion — a user who hasn't picked preferred roles yet can still
// review a company. Pre-loads in edit mode whenever the caller's own row
// already exists (myReview), including when it's status='hidden': the
// author can still see and edit it, they just can't tell it's hidden from
// this form (moderation state isn't surfaced here, only in the DB).
export const CompanyReviewForm: React.FC<CompanyReviewFormProps> = ({ slug, myReview, onUpdate }) => {
  const { isAuthenticated, accessToken } = useAuth();
  const location = useLocation();
  const [rating, setRating] = useState(myReview?.rating || 0);
  const [comment, setComment] = useState(myReview?.comment || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <div className="rounded-md border border-border bg-background/60 p-4 text-center">
        <p className="text-sm text-muted-foreground mb-3">
          Inicia sesión para dejar tu reseña de esta empresa.
        </p>
        <Button asChild size="sm">
          <Link to={`/login?return_to=${encodeURIComponent(returnTo)}`}>Iniciar sesión</Link>
        </Button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1) {
      setError("Selecciona una calificación de 1 a 5 estrellas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(slug)}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ rating, comment: comment.trim() || null })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "No se pudo guardar la reseña.");
        return;
      }
      onUpdate(data.userReviews);
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar la reseña.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(slug)}/reviews`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "No se pudo borrar la reseña.");
        return;
      }
      setRating(0);
      setComment("");
      onUpdate(data.userReviews);
    } catch (e: any) {
      setError(e?.message || "No se pudo borrar la reseña.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-border bg-background/60 p-4">
      <p className="text-xs font-mono text-ink-faint mb-2 uppercase tracking-wide">
        {myReview ? "Editar tu reseña" : "Deja tu reseña"}
      </p>
      <StarPicker value={rating} onChange={setRating} />
      <Textarea
        className="mt-3"
        rows={3}
        maxLength={1000}
        placeholder="¿Cómo fue tu experiencia con esta empresa? (opcional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      <div className="flex items-center gap-2 mt-3">
        <Button type="submit" size="sm" disabled={busy}>
          {myReview ? "Guardar cambios" : "Publicar reseña"}
        </Button>
        {myReview && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={handleDelete}>
            Borrar reseña
          </Button>
        )}
      </div>
    </form>
  );
};
