DROP INDEX "grade_entry_lesson_student_key";--> statement-breakpoint
ALTER TABLE "attendance_entry" ADD COLUMN "is_excused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "grade_entry_lesson_student_idx" ON "grade_entry" USING btree ("lesson_id","student_id");--> statement-breakpoint
ALTER TABLE "grade_category" ADD CONSTRAINT "grade_category_weight_check" CHECK ("weight" between 1 and 5);