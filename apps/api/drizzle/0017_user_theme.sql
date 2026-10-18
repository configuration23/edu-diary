-- Тема оформления: личная настройка учётной записи.
--
-- Три состояния, а не два: «как в системе» — это не «светлая». Человек, у которого ОС переключает
-- тему по расписанию, ждёт того же от дневника, и явный выбор «светлая» означал бы другое намерение.
alter table app_user
  add column theme text not null default 'system';

alter table app_user
  add constraint app_user_theme_check check (theme in ('light', 'dark', 'system'));
