-- Migration 5 : 10 boosters bonus offerts à la création d'un compte.
-- À coller dans Supabase > SQL Editor > Run (après migration-4.sql).
--
-- Un booster bonus s'ouvre sans attendre le cooldown. Il n'est consommé que lorsqu'on est en attente :
-- si le booster gratuit est disponible, c'est lui qui est utilisé en premier.

-- Colonne : 0 pour les comptes existants, 10 pour tous les nouveaux comptes.
alter table public.profiles add column if not exists bonus_boosters int not null default 0 check (bonus_boosters >= 0);
alter table public.profiles alter column bonus_boosters set default 10;

-- Pour offrir aussi les 10 boosters aux comptes déjà créés (hors admins), décommente cette ligne :
-- update public.profiles set bonus_boosters = 10 where not is_admin;

-- Le navigateur ne peut toujours modifier que son pseudo : impossible de se donner des boosters.
-- (revoke / grant de la migration 3 : seule la colonne username est modifiable.)

drop function if exists public.open_booster(text);

create or replace function public.open_booster(p_theme text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  cooldown   interval := interval '10 minutes';
  admin      boolean;
  bonus      int;
  used_bonus boolean := false;
  last_time  timestamptz;
  roll       numeric;
  picked     text;
  card       public.cards;
  result     jsonb := '[]'::jsonb;
  i          int;
begin
  if uid is null then
    raise exception 'non_connecte';
  end if;

  if p_theme is not null and not exists (select 1 from cards where p_theme = any(themes)) then
    raise exception 'theme_inconnu';
  end if;

  -- Verrouille la ligne du joueur : deux ouvertures simultanées ne peuvent pas dépenser le même bonus.
  select is_admin, bonus_boosters into admin, bonus from profiles where id = uid for update;

  insert into booster_log (user_id, last_opened) values (uid, 'epoch') on conflict do nothing;
  select last_opened into last_time from booster_log where user_id = uid for update;

  if not coalesce(admin, false) and now() - last_time < cooldown then
    if coalesce(bonus, 0) > 0 then
      used_bonus := true;
    else
      raise exception 'cooldown:%', ceil(extract(epoch from (last_time + cooldown - now())));
    end if;
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

  if used_bonus then
    update profiles set bonus_boosters = bonus_boosters - 1 where id = uid;
  else
    update booster_log set last_opened = now() where user_id = uid;
  end if;
  return result;
end;
$$;

revoke all on function public.open_booster(text) from public, anon;
grant execute on function public.open_booster(text) to authenticated;
