ALTER TABLE "grade_rule" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grade_rule_application" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "grade_rule" CASCADE;--> statement-breakpoint
DROP TABLE "grade_rule_application" CASCADE;--> statement-breakpoint
ALTER TABLE "grade_category" ADD COLUMN "sign" text;--> statement-breakpoint
ALTER TABLE "grade_category" ADD COLUMN "sign_threshold" integer;--> statement-breakpoint
ALTER TABLE "grade_category" ADD COLUMN "sign_rule_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "grade_entry" ADD COLUMN "consumed_by_grade_id" uuid;--> statement-breakpoint
ALTER TABLE "grade_entry" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "grade_entry_consumed_by_idx" ON "grade_entry" USING btree ("consumed_by_grade_id");