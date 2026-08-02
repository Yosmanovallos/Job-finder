import React from "react";
import { Star } from "lucide-react";

// Mirrors company-reviews-repository.ts's CompanyReviewEntry/MyCompanyReview
// on the server — this is the one place the shape is defined on the
// frontend; CompanyReviewForm and CompanyLanding both import it from here,
// same convention as ReputationEntryProps living in ReputationBadges.tsx.
export interface CompanyReviewEntryProps {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyCompanyReviewProps extends CompanyReviewEntryProps {
  status: "visible" | "hidden";
}

export interface CompanyReviewsDataProps {
  average: number | null;
  count: number;
  entries: CompanyReviewEntryProps[];
  myReview: MyCompanyReviewProps | null;
}

function formatRelativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return "hace unos minutos";
  if (diffH < 24) return `hace ${Math.floor(diffH)} h`;
  const diffD = diffH / 24;
  if (diffD < 30) return `hace ${Math.floor(diffD)} día${Math.floor(diffD) === 1 ? "" : "s"}`;
  const diffM = diffD / 30;
  if (diffM < 12) return `hace ${Math.floor(diffM)} mes${Math.floor(diffM) === 1 ? "" : "es"}`;
  return `hace ${Math.floor(diffM / 12)} año${Math.floor(diffM / 12) === 1 ? "" : "s"}`;
}

function StaticStars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className="h-3.5 w-3.5"
          style={{ color: "#d4a93a" }}
          fill={n <= rating ? "currentColor" : "none"}
        />
      ))}
    </div>
  );
}

export interface CompanyReviewsListProps {
  data: CompanyReviewsDataProps;
}

// Never the reviewer's real name and never "empleado actual" — we have no
// way to verify an actual employment relationship, and claiming one would
// invent a fact the platform can't back up (regla 5 de AGENTS.md). Every
// entry gets the same generic attribution regardless of who wrote it.
export const CompanyReviewsList: React.FC<CompanyReviewsListProps> = ({ data }) => {
  return (
    <div>
      {data.count > 0 ? (
        <div className="flex items-center gap-2 mb-4">
          <StaticStars rating={Math.round(data.average || 0)} />
          <span className="text-sm font-mono text-foreground">
            {data.average?.toFixed(1)}{" "}
            <span className="text-muted-foreground">
              · {data.count} reseña{data.count === 1 ? "" : "s"}
            </span>
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mb-4">Sé el primero en dejar una reseña.</p>
      )}

      {data.entries.length > 0 && (
        <ul className="space-y-3">
          {data.entries.map((entry) => (
            <li key={entry.id} className="rounded-md border border-border bg-background/60 p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <StaticStars rating={entry.rating} />
                <span className="text-[11px] font-mono text-ink-faint">
                  {formatRelativeDate(entry.createdAt)}
                </span>
              </div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Usuario verificado de BuscoTrabajo
              </p>
              {entry.comment && (
                <p className="text-sm text-foreground/80 leading-relaxed">{entry.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
