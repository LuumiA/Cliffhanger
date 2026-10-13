-- Migration 9 : missions à paliers. Chaque palier atteint se récupère une seule fois contre des tickets.
-- À coller dans Supabase > SQL Editor > Run (après migration-8.sql).
-- Tout est calculé côté serveur : le navigateur ne peut ni modifier les compteurs ni se donner des tickets.

create table if not exists public.player_stats (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  boosters_opened int  not null default 0,
  cards_sold      int  not null default 0,
  cards_bought    int  not null default 0,
  trades_done     int  not null default 0,
  login_days      int  not null default 0,
  last_login      date
);
alter table public.player_stats enable row level security;   -- aucune policy : tout passe par les fonctions

create table if not exists public.mission_claims (
  user_id    uuid not null references auth.users(id) on delete cascade,
  mission    text not null,
  tier       int  not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, mission, tier)
);
alter table public.mission_claims enable row level security;

-- Compteur interne (non appelable depuis le navigateur)
create or replace function public.bump_stat(p_user uuid, p_col text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_col not in ('boosters_opened', 'cards_sold', 'cards_bought', 'trades_done') then raise exception 'colonne_invalide'; end if;
  execute format('insert into player_stats (user_id, %1$I) values ($1, 1) on conflict (user_id) do update set %1$I = player_stats.%1$I + 1', p_col) using p_user;
end; $$;
revoke all on function public.bump_stat(uuid, text) from public, anon, authenticated;

-- Ventes et échanges : comptés automatiquement quand ils se concluent
create or replace function public.stat_on_listing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'active' and new.status = 'sold' then
    perform bump_stat(new.seller_id, 'cards_sold');
    perform bump_stat(new.buyer_id, 'cards_bought');
  end if;
  return new;
end; $$;
drop trigger if exists stat_listing on public.listings;
create trigger stat_listing after update on public.listings for each row execute function public.stat_on_listing();

create or replace function public.stat_on_trade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    perform bump_stat(new.from_id, 'trades_done');
    perform bump_stat(new.to_id, 'trades_done');
  end if;
  return new;
end; $$;
drop trigger if exists stat_trade on public.trades;
create trigger stat_trade after update on public.trades for each row execute function public.stat_on_trade();

-- Boosters ouverts : même fonction qu'avant, avec un compteur en plus
drop function if exists public.open_booster(text, boolean);
create or replace function public.open_booster(p_theme text default null, p_pay boolean default false)
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
    if r.cur_stock >= 1 then
      update profiles set booster_stock = r.cur_stock - 1, booster_stock_at = r.cur_at where id = uid;
    elsif p_pay then
      -- Plus de booster gratuit : on peut en ouvrir un pour 100 tickets (stock et délai inchangés).
      if p.coins < booster_price() then raise exception 'pas_assez_de_tickets'; end if;
      update profiles set coins = coins - booster_price(), booster_stock = r.cur_stock, booster_stock_at = r.cur_at where id = uid;
    else
      raise exception 'cooldown:%', ceil(extract(epoch from (r.cur_at + interval '10 minutes' - now())));
    end if;
  end if;

  perform bump_stat(uid, 'boosters_opened');

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


revoke all on function public.open_booster(text, boolean) from public, anon;
grant execute on function public.open_booster(text, boolean) to authenticated;

-- Connexion du jour (un jour de plus par date, heure de Paris)
create or replace function public.ping_login() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'Europe/Paris')::date;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  insert into player_stats (user_id, login_days, last_login) values (uid, 1, today)
  on conflict (user_id) do update
    set login_days = player_stats.login_days + 1, last_login = today
    where player_stats.last_login is null or player_stats.last_login < today;
end; $$;

-- Liste des missions et de leurs paliers : [objectif, récompense en tickets]
create or replace function public.mission_defs() returns jsonb language sql immutable as $$
  select '[
   {"id":"boosters","title":"Ouvreur de boosters","desc":"Ouvre des boosters","tiers":[[1,20],[10,50],[50,150],[100,300],[250,600],[500,1000]]},
   {"id":"login","title":"Fidèle au poste","desc":"Connecte-toi des jours différents","tiers":[[1,10],[3,30],[7,60],[14,100],[30,250],[60,500],[100,800]]},
   {"id":"collection","title":"Collectionneur","desc":"Possède des cartes différentes","tiers":[[10,30],[50,100],[100,200],[250,500],[500,1000]]},
   {"id":"legend","title":"Chasseur de légendes","desc":"Possède des cartes Légendaire ou Cliffhanger différentes","tiers":[[1,50],[5,150],[20,400],[50,1000]]},
   {"id":"sold","title":"Vendeur","desc":"Vends des cartes à d''autres joueurs","tiers":[[1,20],[5,60],[25,200],[100,500]]},
   {"id":"bought","title":"Acheteur","desc":"Achète des cartes sur le marché","tiers":[[1,20],[5,50],[25,150],[100,400]]},
   {"id":"trades","title":"Négociateur","desc":"Réalise des échanges","tiers":[[1,30],[5,80],[20,250],[50,600]]}
  ]'::jsonb
$$;

create or replace function public.mission_value(p_user uuid, p_id text) returns int
language sql stable security definer set search_path = public as $$
  select case p_id
    when 'boosters'   then coalesce((select boosters_opened from player_stats where user_id = p_user), 0)
    when 'login'      then coalesce((select login_days from player_stats where user_id = p_user), 0)
    when 'sold'       then coalesce((select cards_sold from player_stats where user_id = p_user), 0)
    when 'bought'     then coalesce((select cards_bought from player_stats where user_id = p_user), 0)
    when 'trades'     then coalesce((select trades_done from player_stats where user_id = p_user), 0)
    when 'collection' then (select count(*) from collection where user_id = p_user and quantity > 0)::int
    when 'legend'     then (select count(*) from collection c join cards k on k.id = c.card_id
                            where c.user_id = p_user and c.quantity > 0 and k.rarity in ('iconique', 'cliffhanger'))::int
    else 0 end
$$;
revoke all on function public.mission_value(uuid, text) from public, anon, authenticated;

create or replace function public.get_missions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); m jsonb; t jsonb; res jsonb := '[]'::jsonb; tiers jsonb; i int;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  for m in select * from jsonb_array_elements(mission_defs()) loop
    tiers := '[]'::jsonb; i := 0;
    for t in select * from jsonb_array_elements(m->'tiers') loop
      i := i + 1;
      tiers := tiers || jsonb_build_object('tier', i, 'goal', (t->>0)::int, 'reward', (t->>1)::int,
        'claimed', exists (select 1 from mission_claims where user_id = uid and mission = m->>'id' and tier = i));
    end loop;
    res := res || jsonb_build_object('id', m->>'id', 'title', m->>'title', 'desc', m->>'desc',
      'value', mission_value(uid, m->>'id'), 'tiers', tiers);
  end loop;
  return res;
end; $$;

create or replace function public.claim_mission(p_mission text, p_tier int) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m jsonb; t jsonb; goal int; reward int;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  select x into m from jsonb_array_elements(mission_defs()) x where x->>'id' = p_mission;
  if m is null then raise exception 'mission_inconnue'; end if;
  if p_tier is null or p_tier < 1 then raise exception 'palier_inconnu'; end if;
  t := (m->'tiers')->(p_tier - 1);
  if t is null then raise exception 'palier_inconnu'; end if;
  goal := (t->>0)::int; reward := (t->>1)::int;
  perform 1 from profiles where id = uid for update;
  if mission_value(uid, p_mission) < goal then raise exception 'palier_non_atteint'; end if;
  begin
    insert into mission_claims (user_id, mission, tier) values (uid, p_mission, p_tier);
  exception when unique_violation then raise exception 'deja_reclame';
  end;
  update profiles set coins = coins + reward where id = uid;
  return reward;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['ping_login()', 'get_missions()', 'claim_mission(text,int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
