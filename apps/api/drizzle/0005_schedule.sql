CREATE TABLE "lesson" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_entry_id" uuid,
	"assignment_id" uuid NOT NULL,
	"study_group_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_user_id" uuid NOT NULL,
	"planned_teacher_user_id" uuid,
	"room_id" uuid,
	"lesson_date" date NOT NULL,
	"pair_number" integer NOT NULL,
	"time_start" time NOT NULL,
	"time_end" time NOT NULL,
	"topic" text,
	"lesson_type" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"study_group_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"pair_number" integer NOT NULL,
	"time_start" time NOT NULL,
	"time_end" time NOT NULL,
	"room_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_exception" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_entry_id" uuid NOT NULL,
	"study_group_id" uuid NOT NULL,
	"exception_date" date NOT NULL,
	"pair_number" integer NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "substitution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"lesson_id" uuid,
	"substitute_user_id" uuid NOT NULL,
	"replaced_user_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_schedule_entry_id_schedule_entry_id_fk" FOREIGN KEY ("schedule_entry_id") REFERENCES "public"."schedule_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_assignment_id_teaching_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."teaching_assignment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_study_group_id_study_group_id_fk" FOREIGN KEY ("study_group_id") REFERENCES "public"."study_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_assignment_id_teaching_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."teaching_assignment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_study_group_id_study_group_id_fk" FOREIGN KEY ("study_group_id") REFERENCES "public"."study_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_schedule_entry_id_schedule_entry_id_fk" FOREIGN KEY ("schedule_entry_id") REFERENCES "public"."schedule_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_study_group_id_study_group_id_fk" FOREIGN KEY ("study_group_id") REFERENCES "public"."study_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitution" ADD CONSTRAINT "substitution_assignment_id_teaching_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."teaching_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitution" ADD CONSTRAINT "substitution_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_group_date_idx" ON "lesson" USING btree ("study_group_id","lesson_date");--> statement-breakpoint
CREATE INDEX "lesson_teacher_date_idx" ON "lesson" USING btree ("teacher_user_id","lesson_date");--> statement-breakpoint
CREATE INDEX "lesson_assignment_idx" ON "lesson" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_group_slot_key" ON "lesson" USING btree ("study_group_id","lesson_date","pair_number") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "schedule_entry_group_idx" ON "schedule_entry" USING btree ("study_group_id","day_of_week");--> statement-breakpoint
CREATE INDEX "schedule_entry_assignment_idx" ON "schedule_entry" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entry_group_slot_key" ON "schedule_entry" USING btree ("study_group_id","day_of_week","pair_number");--> statement-breakpoint
CREATE INDEX "schedule_exception_group_date_idx" ON "schedule_exception" USING btree ("study_group_id","exception_date");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_exception_slot_key" ON "schedule_exception" USING btree ("schedule_entry_id","exception_date","pair_number");--> statement-breakpoint
CREATE INDEX "substitution_assignment_range_idx" ON "substitution" USING btree ("assignment_id","starts_on");--> statement-breakpoint
CREATE INDEX "substitution_lesson_idx" ON "substitution" USING btree ("lesson_id");