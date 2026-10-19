-- Счётчики неудачных входов по адресу.
--
-- Нужны против перебора «по словарю логинов»: ограничение по учётной записи такой перебор не
-- ловит, потому что каждая учётка получает свои 5 попыток. Ключ — `ip:<адрес>`.
create table if not exists login_throttle (
  key text primary key,
  failures integer not null default 0,
  locked_until timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);
