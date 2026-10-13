-- Migration 8 : on peut vendre n'importe quelle carte (plus seulement les doublons).
-- Si c'est le dernier exemplaire, la carte quitte la collection jusqu'à la vente ou l'annulation.
-- Les échanges restent réservés aux doublons.
create or replace function public.create_listing(p_card text, p_price int)
returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); q int; new_id bigint;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  if p_price is null or p_price < 1 or p_price > 1000000 then raise exception 'prix_invalide'; end if;
  perform 1 from profiles where id = uid for update;
  select quantity into q from collection where user_id = uid and card_id = p_card;
  if q is null or q < 1 then raise exception 'pas_de_carte'; end if;
  if (select count(*) from listings where seller_id = uid and status = 'active') >= 30 then raise exception 'trop_d_annonces'; end if;
  if q = 1 then delete from collection where user_id = uid and card_id = p_card;
  else update collection set quantity = quantity - 1 where user_id = uid and card_id = p_card; end if;
  insert into listings (seller_id, card_id, price) values (uid, p_card, p_price) returning id into new_id;
  return new_id;
end; $$;

-- Boutique : un booster coûte 100 tickets.
create or replace function public.booster_price() returns int language sql immutable as $$ select 100 $$;

-- Ouvrir un booster : gratuit tant qu'il y a du stock, sinon 100 tickets (plus de boutique à part).
drop function if exists public.open_booster(text);
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

-- Le prix du booster payant est transmis avec l'état du stock.
create or replace function public.get_booster_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p profiles; r record;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  select * into p from profiles where id = uid;
  select * into r from booster_refill(p.booster_stock, p.booster_stock_at);
  return jsonb_build_object(
    'stock', r.cur_stock, 'cap', 20, 'admin', p.is_admin, 'coins', p.coins, 'price', booster_price(),
    'next_in', case when r.cur_stock >= 20 then null else ceil(extract(epoch from (r.cur_at + interval '10 minutes' - now())))::int end
  );
end; $$;

drop function if exists public.buy_booster();
