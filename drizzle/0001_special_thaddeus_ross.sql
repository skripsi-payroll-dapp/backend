CREATE TABLE "app"."employees" (
	"address" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"nik" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sessions" (
	"jti" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
