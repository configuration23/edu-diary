-- Срок домашнего задания становится **уроком**, а не датой.
--
-- Датами оперировать неудобно, и они порождают ошибки: учитель указывает совсем другие
-- числа. Поэтому вместо `due_on` (срок) и `visible_until` (до какой даты видно) остаётся
-- один `due_lesson_id` — урок, до которого задано.
--
-- Существующие задания переносим без потери смысла: сроком становится **свой урок**, то есть
-- задание, заданное на занятии, сдаётся к этому же занятию. Заполняем до объявления NOT NULL.
ALTER TABLE "homework_assignment" ADD COLUMN "due_lesson_id" uuid;--> statement-breakpoint
UPDATE "homework_assignment" SET "due_lesson_id" = "lesson_id" WHERE "due_lesson_id" IS NULL;--> statement-breakpoint
ALTER TABLE "homework_assignment" ALTER COLUMN "due_lesson_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "homework_assignment" ADD CONSTRAINT "homework_assignment_due_lesson_id_lesson_id_fk" FOREIGN KEY ("due_lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "homework_assignment_due_lesson_idx" ON "homework_assignment" USING btree ("due_lesson_id");--> statement-breakpoint
-- Уникальность «один урок — одно задание» снимается: на один урок может быть задано
-- несколько работ (долгий проект и задача к следующему занятию), и это разные задания.
DROP INDEX IF EXISTS "homework_assignment_lesson_key";--> statement-breakpoint
DROP INDEX IF EXISTS "homework_assignment_visible_until_idx";--> statement-breakpoint
ALTER TABLE "homework_assignment" DROP COLUMN "due_on";--> statement-breakpoint
ALTER TABLE "homework_assignment" DROP COLUMN "visible_until";
