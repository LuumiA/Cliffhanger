-- Migration 7 : économie du jeu (tickets), marché entre joueurs, échanges et boutique.
-- À coller dans Supabase > SQL Editor > Run (après migration-6.sql).
--
-- Règles :
--  * Les tickets passent UNIQUEMENT entre joueurs : il n'y a pas de rachat par le jeu.
--  * Seuls les DOUBLONS peuvent être mis en vente ou échangés : on garde toujours 1 exemplaire.
--  * Marché : prix libre, 5 % de frais prélevés sur le vendeur (ils sortent du jeu). La carte mise en vente
--    est mise de côté (retirée du stock du vendeur) jusqu'à la vente ou l'annulation.
--  * Échange : 1 doublon contre 1 doublon, accepté ou refusé par l'autre joueur.
--  * Boutique : un booster supplémentaire contre des tickets (impossible si le stock est plein).
--  * Chaque nouveau compte reçoit 150 tickets de départ.
--  * Tout passe par des fonctions serveur : le navigateur ne peut pas modifier tickets ni cartes.

-- ---------- Prix conseillés (indicatifs : les joueurs fixent leur prix librement) ----------
create or replace function public.card_value(p_rarity text) returns int
language sql immutable as $$
  select case p_rarity
    when 'figurant' then 5 when 'second' then 15 when 'principal' then 50
    when 'culte' then 200 when 'iconique' then 800 when 'cliffhanger' then 3000
    else 0 end
$$;

create or replace function public.booster_price() returns int language sql immutable as $$ select 300 $$;
create or replace function public.market_fee(p_price int) returns int language sql immutable as $$ select ceil(p_price * 0.05)::int $$;

create or replace function public.get_economy() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'suggested', jsonb_build_object(
      'figurant', card_value('figurant'), 'second', card_value('second'), 'principal', card_value('principal'),
      'culte', card_value('culte'), 'iconique', card_value('iconique'), 'cliffhanger', card_value('cliffhanger')),
    'booster_price', booster_price(), 'fee_percent', 5)
$$;
grant execute on function public.get_economy() to authenticated;

-- ---------- Tickets de départ ----------
alter table public.profiles alter column coins set default 150;
update public.profiles set coins = 150 where coins = 0;   -- comptes existants : 150 tickets une fois

-- ---------- Tables ----------
create table if not exists public.listings (
  id         bigserial primary key,
  seller_id  uuid not null references auth.users(id) on delete cascade,
  card_id    text not null references public.cards(id),
  price      int  not null check (price between 1 and 1000000),
  status     text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  buyer_id   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sold_at    timestamptz
);
create index if not exists listings_active_idx on public.listings (status, card_id);
alter table public.listings enable row level security;   -- aucune policy : tout passe par les fonctions

create table if not exists public.trades (
  id          bigserial primary key,
  from_id     uuid not null references auth.users(id) on delete cascade,
  to_id       uuid not null references auth.users(id) on delete cascade,
  give_card   text not null references public.cards(id),
  want_card   text not null references public.cards(id),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  check (from_id <> to_id)
);
create index if not exists trades_to_idx on public.trades (to_id, status);
alter table public.trades enable row level security;     -- aucune policy : tout passe par les fonctions

-- ---------- Marché ----------
create or replace function public.create_listing(p_card text, p_price int)
returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); q int; new_id bigint;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  if p_price is null or p_price < 1 or p_price > 1000000 then raise exception 'prix_invalide'; end if;
  perform 1 from profiles where id = uid for update;
  select quantity into q from collection where user_id = uid and card_id = p_card;
  if q is null or q < 2 then raise exception 'pas_de_doublon'; end if;
  if (select count(*) from listings where seller_id = uid and status = 'active') >= 30 then raise exception 'trop_d_annonces'; end if;
  update collection set quantity = quantity - 1 where user_id = uid and card_id = p_card;
  insert into listings (seller_id, card_id, price) values (uid, p_card, p_price) returning id into new_id;
  return new_id;
end; $$;

create or replace function public.cancel_listing(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l listings;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  perform 1 from profiles where id = uid for update;
  select * into l from listings where id = p_id and seller_id = uid and status = 'active' for update;
  if l.id is null then raise exception 'annonce_indisponible'; end if;
  update listings set status = 'cancelled' where id = p_id;
  insert into collection (user_id, card_id) values (uid, l.card_id)
    on conflict (user_id, card_id) do update set quantity = collection.quantity + 1;
end; $$;

create or replace function public.buy_listing(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l listings; seller uuid; money int; fee int;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  select seller_id into seller from listings where id = p_id;
  if seller is null then raise exception 'annonce_indisponible'; end if;
  if seller = uid then raise exception 'propre_annonce'; end if;
  -- On verrouille les deux joueurs dans un ordre fixe (évite les blocages), puis l'annonce.
  perform 1 from profiles where id in (uid, seller) order by id for update;
  select * into l from listings where id = p_id and status = 'active' for update;
  if l.id is null then raise exception 'annonce_indisponible'; end if;
  select coins into money from profiles where id = uid;
  if money < l.price then raise exception 'pas_assez_de_tickets'; end if;
  fee := market_fee(l.price);
  update profiles set coins = coins - l.price where id = uid;
  update profiles set coins = coins + (l.price - fee) where id = seller;
  insert into collection (user_id, card_id) values (uid, l.card_id)
    on conflict (user_id, card_id) do update set quantity = collection.quantity + 1;
  update listings set status = 'sold', buyer_id = uid, sold_at = now() where id = p_id;
  return jsonb_build_object('card_id', l.card_id, 'price', l.price);
end; $$;

create or replace function public.get_listings(p_search text default null, p_rarity text default null, p_sort text default 'new')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('id', l.id, 'price', l.price, 'seller', p.username, 'mine', l.seller_id = auth.uid(), 'card', to_jsonb(k)) as x
    from listings l
    join cards k on k.id = l.card_id
    join profiles p on p.id = l.seller_id
    where l.status = 'active'
      and (p_rarity is null or k.rarity = p_rarity)
      and (p_search is null or k.name ilike '%' || p_search || '%' or k.show ilike '%' || p_search || '%' or coalesce(k.actor, '') ilike '%' || p_search || '%')
    order by (case p_sort when 'price' then l.price end) asc nulls last,
             (case p_sort when 'rarity' then array_position(array['figurant','second','principal','culte','iconique','cliffhanger'], k.rarity) end) desc nulls last,
             l.created_at desc
    limit 60
  ) t
$$;

create or replace function public.get_my_listings()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('id', l.id, 'price', l.price, 'status', l.status, 'sold_at', l.sold_at,
                              'buyer', b.username, 'card', to_jsonb(k)) as x
    from listings l
    join cards k on k.id = l.card_id
    left join profiles b on b.id = l.buyer_id
    where l.seller_id = auth.uid() and l.status in ('active', 'sold')
    order by (l.status = 'active') desc, coalesce(l.sold_at, l.created_at) desc
    limit 40
  ) t
$$;

-- ---------- Échanges ----------
create or replace function public.propose_trade(p_to text, p_give text, p_want text)
returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); tid uuid; priv jsonb; qg int; qw int; new_id bigint;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  perform 1 from profiles where id = uid for update;
  select id, privacy into tid, priv from profiles where lower(username) = lower(p_to);
  if tid is null then raise exception 'joueur_introuvable'; end if;
  if tid = uid then raise exception 'soi_meme'; end if;
  if priv->>'profile' = 'private' or priv->>'dups' = 'private' then raise exception 'doublons_prives'; end if;
  select quantity into qg from collection where user_id = uid and card_id = p_give;
  if qg is null or qg < 2 then raise exception 'pas_de_doublon'; end if;
  select quantity into qw from collection where user_id = tid and card_id = p_want;
  if qw is null or qw < 2 then raise exception 'doublon_indisponible'; end if;
  if (select count(*) from trades where from_id = uid and status = 'pending') >= 20 then raise exception 'trop_d_echanges'; end if;
  insert into trades (from_id, to_id, give_card, want_card) values (uid, tid, p_give, p_want) returning id into new_id;
  return new_id;
end; $$;

create or replace function public.respond_trade(p_id bigint, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t trades; qg int; qw int;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  select * into t from trades where id = p_id and to_id = uid and status = 'pending';
  if t.id is null then raise exception 'echange_introuvable'; end if;
  perform 1 from profiles where id in (t.from_id, t.to_id) order by id for update;
  select * into t from trades where id = p_id and status = 'pending' for update;
  if t.id is null then raise exception 'echange_introuvable'; end if;

  if not p_accept then
    update trades set status = 'declined', resolved_at = now() where id = p_id;
    return 'declined';
  end if;

  select quantity into qg from collection where user_id = t.from_id and card_id = t.give_card;
  select quantity into qw from collection where user_id = t.to_id and card_id = t.want_card;
  if coalesce(qg, 0) < 2 or coalesce(qw, 0) < 2 then
    -- Un des deux n'a plus le doublon : l'échange est annulé proprement.
    update trades set status = 'cancelled', resolved_at = now() where id = p_id;
    return 'unavailable';
  end if;

  update collection set quantity = quantity - 1 where user_id = t.from_id and card_id = t.give_card;
  update collection set quantity = quantity - 1 where user_id = t.to_id and card_id = t.want_card;
  insert into collection (user_id, card_id) values (t.from_id, t.want_card)
    on conflict (user_id, card_id) do update set quantity = collection.quantity + 1;
  insert into collection (user_id, card_id) values (t.to_id, t.give_card)
    on conflict (user_id, card_id) do update set quantity = collection.quantity + 1;
  update trades set status = 'accepted', resolved_at = now() where id = p_id;
  return 'accepted';
end; $$;

create or replace function public.cancel_trade(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non_connecte'; end if;
  update trades set status = 'cancelled', resolved_at = now()
    where id = p_id and from_id = auth.uid() and status = 'pending';
  if not found then raise exception 'echange_introuvable'; end if;
end; $$;

create or replace function public.get_trades()
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select t.*, (t.to_id = auth.uid()) as incoming,
           case when t.to_id = auth.uid() then pf.username else pt.username end as other
    from trades t
    join profiles pf on pf.id = t.from_id
    join profiles pt on pt.id = t.to_id
    where auth.uid() in (t.from_id, t.to_id)
      and (t.status = 'pending' or t.resolved_at > now() - interval '7 days')
    order by (t.status = 'pending') desc, coalesce(t.resolved_at, t.created_at) desc
    limit 60
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'status', m.status, 'incoming', m.incoming, 'other', m.other, 'created_at', m.created_at,
    'give', to_jsonb(g), 'want', to_jsonb(w))
    order by (m.status = 'pending') desc, coalesce(m.resolved_at, m.created_at) desc), '[]'::jsonb)
  from mine m
  join cards g on g.id = m.give_card
  join cards w on w.id = m.want_card
$$;

-- ---------- Boutique ----------
create or replace function public.buy_booster()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p profiles; r record;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  select * into p from profiles where id = uid for update;
  select * into r from booster_refill(p.booster_stock, p.booster_stock_at);
  if r.cur_stock >= 20 then raise exception 'stock_plein'; end if;
  if p.coins < booster_price() then raise exception 'pas_assez_de_tickets'; end if;
  update profiles set coins = coins - booster_price(), booster_stock = r.cur_stock + 1, booster_stock_at = r.cur_at where id = uid;
  return jsonb_build_object('stock', r.cur_stock + 1);
end; $$;

-- ---------- Droits : réservé aux joueurs connectés ----------
do $$
declare f text;
begin
  foreach f in array array[
    'create_listing(text,int)', 'cancel_listing(bigint)',
    'buy_listing(bigint)', 'get_listings(text,text,text)', 'get_my_listings()', 'propose_trade(text,text,text)',
    'respond_trade(bigint,boolean)', 'cancel_trade(bigint)', 'get_trades()', 'buy_booster()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
