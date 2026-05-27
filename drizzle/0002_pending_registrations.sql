CREATE TABLE IF NOT EXISTS "app"."pending_registrations" (
	"address" text PRIMARY KEY NOT NULL,
	"email" text,
	"hr_address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
