CREATE TABLE "grade_category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"color" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_category_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "student_enrollment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"study_group_id" uuid NOT NULL,
	"joined_on" date NOT NULL,
	"left_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_group" (
	"id" uuid PRIMARY KEY NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"course" integer,
	"specialty" text,
	"curator_user_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_group_year_name_key" UNIQUE("academic_year_id","name")
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"kind" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "teaching_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"teacher_user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"study_group_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"hours_planned" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_enrollment" ADD CONSTRAINT "student_enrollment_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollment" ADD CONSTRAINT "student_enrollment_study_group_id_study_group_id_fk" FOREIGN KEY ("study_group_id") REFERENCES "public"."study_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_group" ADD CONSTRAINT "study_group_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_study_group_id_study_group_id_fk" FOREIGN KEY ("study_group_id") REFERENCES "public"."study_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_enrollment_group_idx" ON "student_enrollment" USING btree ("study_group_id","left_on");--> statement-breakpoint
CREATE INDEX "student_enrollment_student_idx" ON "student_enrollment" USING btree ("student_id","left_on");--> statement-breakpoint
CREATE INDEX "study_group_year_idx" ON "study_group" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "teaching_assignment_teacher_idx" ON "teaching_assignment" USING btree ("teacher_user_id");--> statement-breakpoint
CREATE INDEX "teaching_assignment_group_subject_idx" ON "teaching_assignment" USING btree ("study_group_id","subject_id");