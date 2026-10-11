-- Один представитель привязывается к ученику один раз.
--
-- Раньше уникальности не было: проверка жила только в сервисе, и ту же пару
-- можно было записать дважды — например, одного человека и «матерью», и «отцом».
-- Перед ограничением убираем уже накопившиеся дубли, оставляя самую раннюю
-- запись: остальные считаем ошибочным повтором.
DELETE FROM "guardian_link"
WHERE "id" NOT IN (
  SELECT DISTINCT ON ("student_id", "guardian_user_id") "id"
  FROM "guardian_link"
  ORDER BY "student_id", "guardian_user_id", "created_at", "id"
);

CREATE UNIQUE INDEX "guardian_link_student_user_key" ON "guardian_link" USING btree ("student_id","guardian_user_id");
