CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"tx_hash" text,
	"meta" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."rate_limits" (
	"employee_address" text PRIMARY KEY NOT NULL,
	"claim_count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
