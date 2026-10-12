CREATE TABLE "attendance_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deleted_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attendance_entry_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" text,
	"after" text,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"value" text,
	"sign" text,
	"category_id" uuid,
	"comment" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"deleted_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grade_entry_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" text,
	"after" text,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sign" text NOT NULL,
	"threshold" integer NOT NULL,
	"reward" text NOT NULL,
	"category_id" uuid,
	"subject_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_rule_application" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"period_id" uuid,
	"application_number" integer NOT NULL,
	"counter_value" integer NOT NULL,
	"grade_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_deleted_by_app_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_revision" ADD CONSTRAINT "attendance_revision_attendance_entry_id_attendance_entry_id_fk" FOREIGN KEY ("attendance_entry_id") REFERENCES "public"."attendance_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_revision" ADD CONSTRAINT "attendance_revision_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_entry" ADD CONSTRAINT "grade_entry_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_entry" ADD CONSTRAINT "grade_entry_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_entry" ADD CONSTRAINT "grade_entry_category_id_grade_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."grade_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_entry" ADD CONSTRAINT "grade_entry_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_entry" ADD CONSTRAINT "grade_entry_deleted_by_app_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_revision" ADD CONSTRAINT "grade_revision_grade_entry_id_grade_entry_id_fk" FOREIGN KEY ("grade_entry_id") REFERENCES "public"."grade_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_revision" ADD CONSTRAINT "grade_revision_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rule" ADD CONSTRAINT "grade_rule_category_id_grade_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."grade_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rule" ADD CONSTRAINT "grade_rule_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rule_application" ADD CONSTRAINT "grade_rule_application_rule_id_grade_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."grade_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rule_application" ADD CONSTRAINT "grade_rule_application_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rule_application" ADD CONSTRAINT "grade_rule_application_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rule_application" ADD CONSTRAINT "grade_rule_application_period_id_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_rule_application" ADD CONSTRAINT "grade_rule_application_grade_entry_id_grade_entry_id_fk" FOREIGN KEY ("grade_entry_id") REFERENCES "public"."grade_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_entry_lesson_idx" ON "attendance_entry" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "attendance_entry_student_idx" ON "attendance_entry" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_entry_lesson_student_key" ON "attendance_entry" USING btree ("lesson_id","student_id") WHERE "attendance_entry"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "attendance_revision_entry_idx" ON "attendance_revision" USING btree ("attendance_entry_id");--> statement-breakpoint
CREATE INDEX "grade_entry_lesson_idx" ON "grade_entry" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "grade_entry_student_idx" ON "grade_entry" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_entry_lesson_student_key" ON "grade_entry" USING btree ("lesson_id","student_id") WHERE "grade_entry"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "grade_revision_entry_idx" ON "grade_revision" USING btree ("grade_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_rule_application_key" ON "grade_rule_application" USING btree ("rule_id","student_id","subject_id","period_id","application_number");