CREATE TABLE "app"."pending_registrations" (
	"address" text PRIMARY KEY NOT NULL,
	"email" text,
	"name" text,
	"hr_address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
