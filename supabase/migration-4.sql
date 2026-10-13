-- Migration 4 : profils personnalisables et profils publics.
-- À coller dans Supabase > SQL Editor > Run (après migration-3.sql).

-- ---------- Colonnes de personnalisation ----------
alter table public.profiles add column if not exists bio            text not null default '' check (char_length(bio) <= 160);
alter table public.profiles add column if not exists title          text;
alter table public.profiles add column if not exists avatar_card    text references public.cards(id) on delete set null;
alter table public.profiles add column if not exists frame          text;
alter table public.profiles add column if not exists showcase_style text not null default 'glass' check (showcase_style in ('glass','spotlight','binder'));
alter table public.profiles add column if not exists showcase       text[] not null default '{}' check (cardinality(showcase) <= 4);
alter table public.profiles add column if not exists blocks         jsonb not null default '{"order":["showcase","collection","series","dups"],"hidden":[]}';
alter table public.profiles add column if not exists privacy        jsonb not null default '{"profile":"public","collection":"public","dups":"public"}';

-- Les écritures passent par save_profile() : le navigateur ne peut toujours modifier que son pseudo.

-- ---------- Statistiques servant aux déblocages ----------
create or replace function public.profile_stats(p_uid uuid)
returns table (unique_cards bigint, cliff_cards bigint, complete_series bigint)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from collection where user_id = p_uid),
    (select count(*) from collection c join cards k on k.id = c.card_id
       where c.user_id = p_uid and k.rarity = 'cliffhanger'),
    (select count(*) from (
       select k.show from cards k
       left join collection c on c.card_id = k.id and c.user_id = p_uid
       group by k.show having count(c.card_id) = count(*)) s)
$$;
revoke all on function public.profile_stats(uuid) from public, anon, authenticated;

create or replace function public.title_ok(k text, u bigint, cl bigint, cs bigint)
returns boolean language sql immutable as $$
  select case k
    when 'spectateur'      then u >= 10
    when 'fan'             then u >= 50
    when 'cinephile'       then u >= 150
    when 'critique'        then u >= 400
    when 'showrunner'      then u >= 900
    when 'legende'         then u >= 1500
    when 'cliffhanger'     then cl >= 1
    when 'saison_complete' then cs >= 1
    when 'integrale'       then cs >= 5
    else false end
$$;

create or replace function public.frame_ok(k text, u bigint, cl bigint, cs bigint)
returns boolean language sql immutable as $$
  select case k
    when 'bronze'      then u >= 50
    when 'argent'      then u >= 150
    when 'or'          then u >= 400
    when 'platine'     then u >= 900
    when 'cliffhanger' then cl >= 3
    when 'serie'       then cs >= 1
    else false end
$$;

-- ---------- Enregistrer son profil ----------
create or replace function public.save_profile(
  p_bio text, p_title text, p_avatar text, p_frame text,
  p_blocks jsonb, p_style text, p_showcase text[], p_privacy jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  adm boolean;
  st  record;
  bad int;
begin
  if uid is null then raise exception 'non_connecte'; end if;
  select is_admin into adm from profiles where id = uid;
  select * into st from profile_stats(uid);

  if char_length(coalesce(p_bio, '')) > 160 then raise exception 'bio_trop_longue'; end if;
  if p_style not in ('glass', 'spotlight', 'binder') then raise exception 'style_invalide'; end if;

  if p_title is not null and not (coalesce(adm, false) or title_ok(p_title, st.unique_cards, st.cliff_cards, st.complete_series)) then
    raise exception 'titre_verrouille';
  end if;
  if p_frame is not null and not (coalesce(adm, false) or frame_ok(p_frame, st.unique_cards, st.cliff_cards, st.complete_series)) then
    raise exception 'cadre_verrouille';
  end if;

  if p_avatar is not null and not exists (select 1 from collection where user_id = uid and card_id = p_avatar) then
    raise exception 'avatar_non_possede';
  end if;

  if cardinality(coalesce(p_showcase, '{}')) > 4 then raise exception 'vitrine_trop_grande'; end if;
  select count(*) into bad from unnest(coalesce(p_showcase, '{}')) s(id)
    where not exists (select 1 from collection where user_id = uid and card_id = s.id);
  if bad > 0 then raise exception 'vitrine_non_possedee'; end if;

  if coalesce(p_privacy->>'profile', '') not in ('public', 'private')
     or coalesce(p_privacy->>'collection', '') not in ('public', 'private')
     or coalesce(p_privacy->>'dups', '') not in ('public', 'private') then
    raise exception 'confidentialite_invalide';
  end if;

  if coalesce(jsonb_typeof(p_blocks->'order'), '') <> 'array' or coalesce(jsonb_typeof(p_blocks->'hidden'), '') <> 'array' then
    raise exception 'blocs_invalides';
  end if;

  update profiles set
    bio = coalesce(p_bio, ''), title = p_title, avatar_card = p_avatar, frame = p_frame,
    blocks = jsonb_build_object('order', p_blocks->'order', 'hidden', p_blocks->'hidden'),
    showcase_style = p_style, showcase = coalesce(p_showcase, '{}'),
    privacy = jsonb_build_object('profile', p_privacy->>'profile', 'collection', p_privacy->>'collection', 'dups', p_privacy->>'dups')
  where id = uid;
end;
$$;
revoke all on function public.save_profile(text, text, text, text, jsonb, text, text[], jsonb) from public, anon;
grant execute on function public.save_profile(text, text, text, text, jsonb, text, text[], jsonb) to authenticated;

-- ---------- Lire un profil (le sien ou celui d'un autre), en respectant la confidentialité ----------
create or replace function public.get_public_profile(p_username text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p      profiles;
  me     boolean;
  st     record;
  priv   jsonb;
  res    jsonb;
  av     jsonb;
  sc     jsonb;
  rc     jsonb;
  sp     jsonb;
  dp     jsonb;
  rar    text[] := array['figurant','second','principal','culte','iconique','cliffhanger'];
begin
  select * into p from profiles where lower(username) = lower(p_username);
  if p.id is null then return null; end if;
  me := (p.id = auth.uid());
  priv := p.privacy;
  select * into st from profile_stats(p.id);

  select jsonb_build_object('id', k.id, 'name', k.name, 'image', k.image, 'hue', k.hue) into av
    from cards k where k.id = p.avatar_card;

  res := jsonb_build_object(
    'username', p.username, 'created_at', p.created_at, 'is_me', me, 'is_admin', p.is_admin,
    'bio', p.bio, 'title', p.title, 'frame', p.frame, 'avatar', av,
    'unique_cards', st.unique_cards, 'cliff_cards', st.cliff_cards, 'complete_series', st.complete_series,
    'total_cards', (select count(*) from cards)
  );

  if me then
    res := res || jsonb_build_object('blocks', p.blocks, 'style', p.showcase_style, 'privacy', priv, 'showcase_ids', to_jsonb(p.showcase));
  elsif priv->>'profile' = 'private' then
    return res || jsonb_build_object('restricted', true);
  else
    res := res || jsonb_build_object('blocks', p.blocks, 'style', p.showcase_style);
  end if;

  -- Vitrine : les cartes choisies, sinon les 4 plus belles.
  if cardinality(p.showcase) > 0 then
    select coalesce(jsonb_agg(to_jsonb(k) || jsonb_build_object('qty', coalesce(c.quantity, 0)) order by s.ord), '[]'::jsonb) into sc
      from unnest(p.showcase) with ordinality as s(id, ord)
      join cards k on k.id = s.id
      left join collection c on c.card_id = k.id and c.user_id = p.id;
  else
    select coalesce(jsonb_agg(x), '[]'::jsonb) into sc from (
      select to_jsonb(k) || jsonb_build_object('qty', c.quantity) as x
      from collection c join cards k on k.id = c.card_id
      where c.user_id = p.id
      order by array_position(rar, k.rarity) desc, k.charisme desc limit 4) t;
  end if;
  res := res || jsonb_build_object('showcase', sc);

  if me or priv->>'collection' = 'public' then
    select coalesce(jsonb_object_agg(rarity, n), '{}'::jsonb) into rc from (
      select k.rarity, count(*) as n from collection c join cards k on k.id = c.card_id
      where c.user_id = p.id group by k.rarity) t;
    select coalesce(jsonb_agg(jsonb_build_object('show', show, 'got', got, 'total', total) order by got desc, show), '[]'::jsonb) into sp from (
      select k.show, count(c.card_id) as got, count(*) as total from cards k
      left join collection c on c.card_id = k.id and c.user_id = p.id
      group by k.show having count(c.card_id) > 0) t;
    res := res || jsonb_build_object('rarity_counts', rc, 'series', sp);
  else
    res := res || jsonb_build_object('collection_private', true);
  end if;

  if me or priv->>'dups' = 'public' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into dp from (
      select to_jsonb(k) || jsonb_build_object('qty', c.quantity) as x
      from collection c join cards k on k.id = c.card_id
      where c.user_id = p.id and c.quantity > 1
      order by array_position(rar, k.rarity) desc, k.name limit 60) t;
    res := res || jsonb_build_object('dups', dp);
  else
    res := res || jsonb_build_object('dups_private', true);
  end if;

  return res;
end;
$$;
revoke all on function public.get_public_profile(text) from public, anon;
grant execute on function public.get_public_profile(text) to authenticated;
