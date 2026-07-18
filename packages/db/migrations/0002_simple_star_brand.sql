CREATE TABLE "notion_sync_state" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"notion_page_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"last_synced_hash" text NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'synced' NOT NULL,
	"last_error" text,
	"human_fields" jsonb,
	"human_pulled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notion_sync_state" ADD CONSTRAINT "notion_sync_state_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notion_sync_state_page_idx" ON "notion_sync_state" USING btree ("notion_page_id");