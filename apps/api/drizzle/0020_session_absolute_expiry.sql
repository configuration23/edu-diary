alter table session
  add column absolute_expires_at timestamptz;

-- Действующие сессии получают предел из своего текущего срока: продлевать их бесконечно нельзя.
update session
set absolute_expires_at = expires_at
where absolute_expires_at is null;

alter table session
  alter column absolute_expires_at set not null;
