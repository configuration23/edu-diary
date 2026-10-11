CREATE TABLE "bell_schedule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pair_number" integer NOT NULL,
	"time_start" time NOT NULL,
	"time_end" time NOT NULL,
	"break_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bell_schedule_pair_key" ON "bell_schedule" USING btree ("pair_number");