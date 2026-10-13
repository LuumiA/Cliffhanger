-- Migration 3 : compte admin (boosters illimités) et boosters par thème.
-- À coller dans Supabase > SQL Editor > Run (après migration-2.sql).

-- ---------- Admin ----------
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Un joueur ne peut modifier que son pseudo : impossible de se donner le statut admin depuis le navigateur.
revoke update on public.profiles from authenticated;
grant update (username) on public.profiles to authenticated;

-- Ton compte : remplace l'adresse ci-dessous par celle de ton compte Cliffhanger.
update public.profiles set is_admin = true
where id in (select id from auth.users where email = 'ton.email@exemple.com');

-- ---------- Thèmes ----------
alter table public.cards add column if not exists themes text[] not null default '{}';

-- Thèmes de chaque série. Pour une nouvelle série, ajoute une ligne ici.
update public.cards set themes = case show
  when 'Game of Thrones'      then array['action','aventure','fantastique','drame']
  when 'The Walking Dead'     then array['horreur','action','aventure','drame']
  when 'La casa de papel'     then array['crime','action','drame']
  when 'Desperate Housewives' then array['comedie','drame','amour']
  when 'Vampire Diaries'      then array['fantastique','horreur','amour','drame']
  else themes
end;

-- ---------- Booster par thème (remplace le booster par série) ----------
drop function if exists public.open_booster(text);

create or replace function public.open_booster(p_theme text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  cooldown  interval := interval '10 minutes';
  admin     boolean;
  last_time timestamptz;
  roll      numeric;
  picked    text;
  card      public.cards;
  result    jsonb := '[]'::jsonb;
  i         int;
begin
  if uid is null then
    raise exception 'non_connecte';
  end if;

  if p_theme is not null and not exists (select 1 from cards where p_theme = any(themes)) then
    raise exception 'theme_inconnu';
  end if;

  select is_admin into admin from profiles where id = uid;

  insert into booster_log (user_id, last_opened) values (uid, 'epoch') on conflict do nothing;
  select last_opened into last_time from booster_log where user_id = uid for update;

  if not coalesce(admin, false) and now() - last_time < cooldown then
    raise exception 'cooldown:%', ceil(extract(epoch from (last_time + cooldown - now())));
  end if;

  for i in 1..5 loop
    roll := random() * 100;
    picked := case
      when roll < 55   then 'figurant'
      when roll < 80   then 'second'
      when roll < 92   then 'principal'
      when roll < 97   then 'culte'
      when roll < 99.5 then 'iconique'
      else 'cliffhanger'
    end;

    select * into card from cards
      where rarity = picked and (p_theme is null or p_theme = any(themes))
      order by random() limit 1;

    -- Si le thème n'a aucune carte de cette rareté, on prend une carte au hasard dans le thème.
    if card.id is null then
      select * into card from cards where (p_theme is null or p_theme = any(themes)) order by random() limit 1;
    end if;

    insert into collection (user_id, card_id) values (uid, card.id)
      on conflict (user_id, card_id) do update set quantity = collection.quantity + 1;

    if card.rarity in ('culte', 'iconique', 'cliffhanger') then
      insert into pulls (user_id, card_id) values (uid, card.id);
    end if;

    result := result || to_jsonb(card);
  end loop;

  update booster_log set last_opened = now() where user_id = uid;
  return result;
end;
$$;

revoke all on function public.open_booster(text) from public, anon;
grant execute on function public.open_booster(text) to authenticated;
