-- Migration 2 : profils, classement, gros tirages, boosters par série.
-- À coller dans Supabase > SQL Editor > Run (après schema.sql).

-- ---------- Profils ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null unique check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profils lisibles" on public.profiles;
create policy "profils lisibles" on public.profiles for select to authenticated using (true);

drop policy if exists "modifier son profil" on public.profiles;
create policy "modifier son profil" on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Pseudo automatique à l'inscription (modifiable ensuite).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username)
  values (new.id, 'Joueur-' || substr(replace(new.id::text, '-', ''), 1, 6))
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Comptes déjà existants
insert into public.profiles (id, username)
select id, 'Joueur-' || substr(replace(id::text, '-', ''), 1, 6) from auth.users
on conflict do nothing;

-- ---------- Journal des gros tirages ----------
create table if not exists public.pulls (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  card_id    text not null references public.cards(id),
  created_at timestamptz not null default now()
);
alter table public.pulls enable row level security; -- aucune policy : lecture via get_recent_pulls()

-- ---------- Booster par série ----------
drop function if exists public.open_booster();

create or replace function public.open_booster(p_show text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  cooldown  interval := interval '10 minutes';
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

  if p_show is not null and not exists (select 1 from cards where show = p_show) then
    raise exception 'serie_inconnue';
  end if;

  insert into booster_log (user_id, last_opened) values (uid, 'epoch') on conflict do nothing;
  select last_opened into last_time from booster_log where user_id = uid for update;

  if now() - last_time < cooldown then
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
      where rarity = picked and (p_show is null or show = p_show)
      order by random() limit 1;

    -- Si la série n'a aucune carte de cette rareté, on prend la rareté la plus proche en dessous.
    if card.id is null then
      select * into card from cards where (p_show is null or show = p_show) order by random() limit 1;
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

-- ---------- Classement ----------
create or replace function public.get_leaderboard()
returns table (rank bigint, username text, unique_cards bigint, top_cards bigint, is_me boolean)
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select p.id, p.username,
           count(c.card_id) as unique_cards,
           count(c.card_id) filter (where k.rarity in ('culte','iconique','cliffhanger')) as top_cards,
           row_number() over (order by count(c.card_id) desc,
                                       count(c.card_id) filter (where k.rarity in ('culte','iconique','cliffhanger')) desc,
                                       p.created_at) as rn
    from profiles p
    left join collection c on c.user_id = p.id
    left join cards k on k.id = c.card_id
    group by p.id, p.username, p.created_at
  )
  select rn, username, unique_cards, top_cards, (id = auth.uid())
  from ranked
  where rn <= 20 or id = auth.uid()
  order by rn;
$$;

revoke all on function public.get_leaderboard() from public, anon;
grant execute on function public.get_leaderboard() to authenticated;

-- ---------- Gros tirages ----------
create or replace function public.get_recent_pulls()
returns table (username text, card_id text, card_name text, image text, rarity text, show text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.username, k.id, k.name, k.image, k.rarity, k.show, l.created_at
  from pulls l
  join profiles p on p.id = l.user_id
  join cards k on k.id = l.card_id
  order by l.created_at desc
  limit 12;
$$;

revoke all on function public.get_recent_pulls() from public, anon;
grant execute on function public.get_recent_pulls() to authenticated;
