-- À coller dans Supabase > SQL Editor > Run.

create table if not exists public.cards (
  id        text primary key,
  name      text not null,
  actor     text,
  show      text not null,
  rarity    text not null check (rarity in ('figurant','second','principal','culte','iconique','cliffhanger')),
  charisme  int  not null,
  repliques int  not null,
  saisons   int  not null,
  image     text,
  hue       int  not null default 0
);

create table if not exists public.collection (
  user_id  uuid not null references auth.users(id) on delete cascade,
  card_id  text not null references public.cards(id),
  quantity int  not null default 1,
  primary key (user_id, card_id)
);

create table if not exists public.booster_log (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  last_opened timestamptz not null
);

-- Sécurité : lecture seule depuis le navigateur. Toute écriture passe par open_booster().
alter table public.cards       enable row level security;
alter table public.collection  enable row level security;
alter table public.booster_log enable row level security;

drop policy if exists "cards lisibles par tous" on public.cards;
create policy "cards lisibles par tous" on public.cards for select using (true);

drop policy if exists "collection perso" on public.collection;
create policy "collection perso" on public.collection for select using (auth.uid() = user_id);

drop policy if exists "log perso" on public.booster_log;
create policy "log perso" on public.booster_log for select using (auth.uid() = user_id);

-- Tirage d'un booster, entièrement côté serveur : cooldown + tirage pondéré + ajout à la collection.
create or replace function public.open_booster()
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

  -- Verrouille la ligne du joueur pour éviter deux ouvertures simultanées.
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

    select * into card from cards where rarity = picked order by random() limit 1;

    insert into collection (user_id, card_id) values (uid, card.id)
      on conflict (user_id, card_id) do update set quantity = collection.quantity + 1;

    result := result || to_jsonb(card);
  end loop;

  update booster_log set last_opened = now() where user_id = uid;
  return result;
end;
$$;

revoke all on function public.open_booster() from public, anon;
grant execute on function public.open_booster() to authenticated;
