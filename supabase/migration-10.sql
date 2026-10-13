-- Migration 10 : la connexion du jour ne doit jamais renvoyer d'erreur, même si deux onglets l'envoient en même temps.
create or replace function public.ping_login() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'Europe/Paris')::date;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  begin
    insert into player_stats (user_id, login_days, last_login) values (uid, 1, today)
    on conflict (user_id) do update
      set login_days = player_stats.login_days + 1, last_login = today
      where player_stats.last_login is null or player_stats.last_login < today;
  exception when unique_violation then
    null;  -- l'autre requête a déjà compté la journée
  end;
end; $$;
