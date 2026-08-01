import { lazy } from "react";
import { useParams } from "react-router-dom";
import { isUuid } from "../lib/job-seo.js";

const JobLanding = lazy(() => import("./JobLanding.js"));
const CategoryLanding = lazy(() => import("./CategoryLanding.js"));

// Single entry point for /empleos/:id/:slug? (App.tsx) — a jobId is always a
// UUID, a city/role category slug never is (see job-seo.ts's isUuid/
// resolveCategorySlug, and server.ts's matching split in the same route),
// so this is the client-side mirror of that same disambiguation instead of
// registering a second, colliding route pattern.
export default function EmpleosRoute() {
  const { id } = useParams<{ id: string }>();
  return isUuid(id || "") ? <JobLanding /> : <CategoryLanding />;
}
