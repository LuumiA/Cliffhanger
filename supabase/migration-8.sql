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
