alter table app_user
  add column view_mode text not null default 'compact';

alter table app_user
  add constraint app_user_view_mode_check check (view_mode in ('compact', 'expanded'));
