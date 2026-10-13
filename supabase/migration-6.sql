-- Migration 6 : stock de boosters (1 toutes les 10 minutes, 20 au maximum) et monnaie du jeu.
-- À coller dans Supabase > SQL Editor > Run (après migration-5.sql).
--
-- Remplace le cooldown : chaque joueur reçoit 1 booster toutes les 10 minutes et peut en stocker 20.
-- Un nouveau compte démarre avec 10 boosters. Quand le stock est plein, la recharge s'arrête
-- et elle reprend dès qu'on ouvre un booster. Les admins sont illimités.

alter table public.profiles add column if not exists booster_stock    int not null default 10 check (booster_stock between 0 and 20);
alter table public.profiles add column if not exists booster_stock_at timestamptz not null default now();
alter table public.profiles add column if not exists coins            int not null default 0 check (coins >= 0);

-- Comptes existants : leurs boosters bonus de la migration 5, plus le booster gratuit qu'ils avaient.
-- (La colonne bonus_boosters n'est plus utilisée.)
update public.profiles
set booster_stock = least(20, coalesce(bonus_boosters, 0) + 1), booster_stock_at = now();

-- Recalcule le stock à l'instant présent sans rien écrire : renvoie le stock et le moment de la dernière recharge.
create or replace function public.booster_refill(p_stock int, p_at timestamptz)
returns table (cur_stock int, cur_at timestamptz)
language plpgsql stable as $$
declare
  cap  int := 20;
  step interval := interval '10 minutes';
  gained int;
begin
  cur_stock := p_stock; cur_at := p_at;
  if cur_stock >= cap then
    cur_at := now();
  else
    gained := floor(extract(epoch from (now() - cur_at)) / extract(epoch from step))::int;
    if cur_stock + gained >= cap then
      cur_stock := cap; cur_at := now();
    else
      cur_stock := cur_stock + gained; cur_at := cur_at + gained * step;
    end if;
  end if;
  return next;
end;
$$;

-- Statut affiché dans la barre du haut.
create or replace function public.get_booster_status()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p   profiles;
  r   record;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  select * into p from profiles where id = uid;
  select * into r from booster_refill(p.booster_stock, p.booster_stock_at);
  return jsonb_build_object(
    'stock', r.cur_stock, 'cap', 20, 'admin', p.is_admin, 'coins', p.coins,
    'next_in', case when r.cur_stock >= 20 then null else ceil(extract(epoch from (r.cur_at + interval '10 minutes' - now())))::int end
  );
end;
$$;
revoke all on function public.get_booster_status() from public, anon;
grant execute on function public.get_booster_status() to authenticated;

-- Ouverture d'un booster : consomme 1 du stock (sauf admin).
drop function if exists public.open_booster(text);

create or replace function public.open_booster(p_theme text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  p      profiles;
  r      record;
  roll   numeric;
  picked text;
  card   public.cards;
  result jsonb := '[]'::jsonb;
  i      int;
begin
  if uid is null then
    raise exception 'non_connecte';
  end if;

  if p_theme is not null and not exists (select 1 from cards where p_theme = any(themes)) then
    raise exception 'theme_inconnu';
  end if;

  -- Verrouille la ligne du joueur : deux ouvertures simultanées ne peuvent pas dépenser le même booster.
  select * into p from profiles where id = uid for update;
  select * into r from booster_refill(p.booster_stock, p.booster_stock_at);

  if not p.is_admin then
    if r.cur_stock < 1 then
      raise exception 'cooldown:%', ceil(extract(epoch from (r.cur_at + interval '10 minutes' - now())));
    end if;
    update profiles set booster_stock = r.cur_stock - 1, booster_stock_at = r.cur_at where id = uid;
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

  return result;
end;
$$;

revoke all on function public.open_booster(text) from public, anon;
grant execute on function public.open_booster(text) to authenticated;
