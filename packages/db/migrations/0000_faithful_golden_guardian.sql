CREATE TABLE "bootstrap_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note" text DEFAULT 'job-radar-local bootstrap' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
