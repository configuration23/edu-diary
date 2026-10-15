CREATE TABLE "homework_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid NOT NULL,
	"text" text NOT NULL,
	"due_on" text,
	"visible_until" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_assignment_text_or_files" CHECK (length(btrim("homework_assignment"."text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "homework_assignment_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assignment_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homework_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid,
	"submission_id" uuid,
	"url" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_link_single_owner" CHECK (("homework_link"."assignment_id" is null) <> ("homework_link"."submission_id" is null))
);
--> statement-breakpoint
CREATE TABLE "homework_submission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"text" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homework_submission_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "homework_assignment" ADD CONSTRAINT "homework_assignment_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_assignment" ADD CONSTRAINT "homework_assignment_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_assignment" ADD CONSTRAINT "homework_assignment_deleted_by_app_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_assignment_file" ADD CONSTRAINT "homework_assignment_file_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_assignment_file" ADD CONSTRAINT "homework_assignment_file_deleted_by_app_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_assignment_file" ADD CONSTRAINT "homework_assignment_file_assignment_id_homework_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."homework_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_link" ADD CONSTRAINT "homework_link_assignment_id_homework_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."homework_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_link" ADD CONSTRAINT "homework_link_submission_id_homework_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."homework_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission" ADD CONSTRAINT "homework_submission_assignment_id_homework_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."homework_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission" ADD CONSTRAINT "homework_submission_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission" ADD CONSTRAINT "homework_submission_deleted_by_app_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission_file" ADD CONSTRAINT "homework_submission_file_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission_file" ADD CONSTRAINT "homework_submission_file_deleted_by_app_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission_file" ADD CONSTRAINT "homework_submission_file_submission_id_homework_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."homework_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "homework_assignment_lesson_idx" ON "homework_assignment" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "homework_assignment_lesson_key" ON "homework_assignment" USING btree ("lesson_id") WHERE "homework_assignment"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "homework_assignment_visible_until_idx" ON "homework_assignment" USING btree ("visible_until");--> statement-breakpoint
CREATE INDEX "homework_assignment_file_assignment_idx" ON "homework_assignment_file" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "homework_link_assignment_idx" ON "homework_link" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "homework_link_submission_idx" ON "homework_link" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "homework_submission_assignment_idx" ON "homework_submission" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "homework_submission_student_idx" ON "homework_submission" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "homework_submission_assignment_student_idx" ON "homework_submission" USING btree ("assignment_id","student_id");--> statement-breakpoint
CREATE INDEX "homework_submission_file_submission_idx" ON "homework_submission_file" USING btree ("submission_id");