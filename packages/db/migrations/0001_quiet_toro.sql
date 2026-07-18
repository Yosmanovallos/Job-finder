CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_normalized" text NOT NULL,
	"name_raw" text NOT NULL,
	"domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"method" text NOT NULL,
	"http_status" integer,
	"result" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "job_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"canonical_content_hash" text NOT NULL,
	"content_source_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"title_raw" text NOT NULL,
	"title_normalized" text NOT NULL,
	"title_family" text,
	"seniority" text NOT NULL,
	"company_name_raw" text NOT NULL,
	"company_name_normalized" text NOT NULL,
	"company_domain" text,
	"canonical_url" text NOT NULL,
	"canonical_url_normalized" text NOT NULL,
	"apply_url" text,
	"apply_url_normalized" text,
	"description_text" text NOT NULL,
	"responsibilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_experience_years" real,
	"education_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_mode" text NOT NULL,
	"remote_region" text,
	"employment_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compensation" jsonb NOT NULL,
	"visa_sponsorship" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"dedupe_key" text NOT NULL,
	"simhash" bigint NOT NULL,
	"canonical_content_hash" text NOT NULL,
	"content_source_id" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"extraction_method" text NOT NULL,
	"extraction_confidence" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text,
	"requested_url" text NOT NULL,
	"final_url" text,
	"http_status" integer NOT NULL,
	"content_type" text,
	"etag" text,
	"last_modified" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"body" text,
	"parser" text NOT NULL,
	"adapter_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"source_job_id" text NOT NULL,
	"source_url" text NOT NULL,
	"last_content_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"adapter_name" text NOT NULL,
	"kind" text NOT NULL,
	"tier" text NOT NULL,
	"base_url" text NOT NULL,
	"company_slug" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 30 NOT NULL,
	"concurrency" integer DEFAULT 1 NOT NULL,
	"terms_reviewed_at" timestamp with time zone,
	"robots_reviewed_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"health_status" text DEFAULT 'healthy' NOT NULL,
	"failure_streak" integer DEFAULT 0 NOT NULL,
	"circuit_open_until" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"dedupe_version" text NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "job_verifications" ADD CONSTRAINT "job_verifications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_versions" ADD CONSTRAINT "job_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_run_id_source_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."source_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_occurrences" ADD CONSTRAINT "source_occurrences_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_source_id_source_registry_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_normalized_idx" ON "companies" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "job_verifications_job_idx" ON "job_verifications" USING btree ("job_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_versions_job_version_idx" ON "job_versions" USING btree ("job_id","version");--> statement-breakpoint
CREATE INDEX "jobs_dedupe_key_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_canonical_url_idx" ON "jobs" USING btree ("canonical_url_normalized");--> statement-breakpoint
CREATE INDEX "jobs_company_title_idx" ON "jobs" USING btree ("company_name_normalized","title_normalized");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "raw_documents_run_idx" ON "raw_documents" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_occurrences_source_job_idx" ON "source_occurrences" USING btree ("source_id","source_job_id");--> statement-breakpoint
CREATE INDEX "source_occurrences_job_idx" ON "source_occurrences" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "source_runs_source_idx" ON "source_runs" USING btree ("source_id","started_at");