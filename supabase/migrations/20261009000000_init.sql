-- Pepper Planner: initial schema
-- Tables: profiles, classes, groups, group_members, tasks, task_completions,
--         activity (group feed), task_rescues (copy-on-delete offers)
-- Every table has row-level security (RLS). The app talks to the database
-- directly with the user's login token, so these policies ARE the security model.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.task_type as enum ('test', 'quiz', 'project', 'homework', 'custom');
create type public.weight_tier as enum ('high', 'medium', 'low');
create type public.education_level as enum ('middle', 'high', 'college');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  education_level public.education_level,
  grade text check (char_length(grade) <= 20),
  goals text check (char_length(goals) <= 500),
  struggles text check (char_length(struggles) <= 500),
  quiet_hours_enabled boolean not null default true,
  quiet_start smallint not null default 22 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 7 check (quiet_end between 0 and 23),
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  owner_id uuid not null references auth.users (id) on delete cascade,
  join_code text not null unique check (join_code ~ '^[A-Z2-9]{6}$'),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- Each member maps the group to one of THEIR OWN classes, so shared tasks
  -- show up in that member's class color.
  class_id uuid references public.classes (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- A recurring series: the template and rule live here, so deleting or editing
-- one generated task never shifts the series or brings a deleted task back.
-- Only the creator's device generates instances (see tasks_check_series).
create table public.task_series (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  class_id uuid references public.classes (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  task_type public.task_type not null,
  custom_label text check (char_length(custom_label) <= 40),
  custom_tier public.weight_tier,
  weight_pct numeric(5, 2) check (weight_pct > 0 and weight_pct <= 100),
  notes text check (char_length(notes) <= 1000),
  rule jsonb not null check (rule ->> 'freq' in ('daily', 'weekdays', 'weekly')),
  first_due timestamptz not null,
  generated_until timestamptz not null,
  created_at timestamptz not null default now(),
  check (group_id is null or class_id is null)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  class_id uuid references public.classes (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  task_type public.task_type not null,
  custom_label text check (char_length(custom_label) <= 40),
  custom_tier public.weight_tier,
  weight_pct numeric(5, 2) check (weight_pct > 0 and weight_pct <= 100),
  due_at timestamptz not null check (due_at > '2000-01-01'),
  notes text check (char_length(notes) <= 1000),
  series_id uuid references public.task_series (id) on delete set null,
  recurrence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- custom types must say which default tier they count as
  check (task_type <> 'custom' or custom_tier is not null),
  -- shared tasks get their class from each member's group mapping instead
  check (group_id is null or class_id is null),
  -- one instance per date in a recurring series (makes top-ups idempotent)
  unique (series_id, due_at)
);

-- Completion is per student and private: checking off a shared task only
-- checks it off for you.
create table public.task_completions (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table public.activity (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in (
    'task_added', 'task_edited', 'due_changed', 'type_changed', 'task_deleted',
    'series_stopped', 'member_joined', 'member_left', 'member_removed'
  )),
  task_id uuid,
  task_title text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- When a shared task (or a whole group) is deleted, each other member gets a
-- "keep a copy?" offer. The snapshot is everything needed to recreate it.
create table public.task_rescues (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  group_name text not null,
  reason text not null check (reason in ('task_deleted', 'group_deleted')),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- Failed join-code attempts, for rate limiting guesses (no client access).
create table public.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index join_attempts_user_idx on public.join_attempts (user_id, attempted_at);
create index task_series_created_by_idx on public.task_series (created_by);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_group_id_idx on public.tasks (group_id);
create index tasks_due_at_idx on public.tasks (due_at);
create index tasks_series_idx on public.tasks (series_id) where series_id is not null;
create index group_members_user_idx on public.group_members (user_id);
create index activity_group_created_idx on public.activity (group_id, created_at desc);
create index task_completions_user_idx on public.task_completions (user_id);
create index task_rescues_user_idx on public.task_rescues (user_id);
create index classes_user_idx on public.classes (user_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse into RLS)
-- ---------------------------------------------------------------------------
create function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid())
  );
$$;

create function public.is_group_owner(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- owner_id alone is not enough: the owner must also still be a member
  -- with the owner role (guards against a stale owner_id).
  select exists (
    select 1
    from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = g.owner_id
    where g.id = gid and g.owner_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create function public.shares_group_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

-- 6-char join code without look-alike characters (no 0/O, 1/I)
create function public.new_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where join_code = code);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Create a profile row for every new sign-up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1),
      ''
    ), 60)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- A task's class must belong to whoever owns the task.
create function public.check_task_class()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.class_id is not null and not exists (
    select 1 from public.classes where id = new.class_id and user_id = new.created_by
  ) then
    raise exception 'class does not belong to task owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tasks_check_class
  before insert or update of class_id on public.tasks
  for each row execute function public.check_task_class();

-- A member's group->class mapping must point at their own class.
create function public.check_member_class()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.class_id is not null and not exists (
    select 1 from public.classes where id = new.class_id and user_id = new.user_id
  ) then
    raise exception 'class does not belong to member' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger group_members_check_class
  before insert or update of class_id on public.group_members
  for each row execute function public.check_member_class();

create function public.task_snapshot(t public.tasks)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'title', t.title,
    'task_type', t.task_type,
    'custom_label', t.custom_label,
    'custom_tier', t.custom_tier,
    'weight_pct', t.weight_pct,
    'due_at', t.due_at,
    'notes', t.notes
  );
$$;

-- Offer a copy of a deleted shared task to every other member who hasn't
-- finished it. Skipped when the task's group itself is being deleted (the
-- group trigger below handles that case in one pass).
create function public.offer_rescues(t public.tasks, p_group_name text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.task_rescues (user_id, group_name, reason, snapshot)
  select gm.user_id, p_group_name, p_reason, public.task_snapshot(t)
  from public.group_members gm
  where gm.group_id = t.group_id
    and gm.user_id is distinct from (select auth.uid())
    -- skip accounts that are being deleted in this same transaction
    and exists (select 1 from auth.users u where u.id = gm.user_id)
    and t.due_at > now() - interval '7 days'
    and not exists (
      select 1 from public.task_completions c
      where c.task_id = t.id and c.user_id = gm.user_id
    );
$$;

-- Write group activity for every change to a shared task.
create function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  g_name text;
begin
  if tg_op = 'INSERT' then
    if new.group_id is null then return null; end if;
    -- recurring top-ups: only log the first instance of a series
    if new.series_id is not null and exists (
      select 1 from public.tasks where series_id = new.series_id and id <> new.id
    ) then
      return null;
    end if;
    insert into public.activity (group_id, actor_id, kind, task_id, task_title, payload)
    values (new.group_id, actor, 'task_added', new.id, new.title,
            jsonb_build_object('due_at', new.due_at, 'task_type', new.task_type,
                               'recurring', new.series_id is not null));
    return null;
  end if;

  if tg_op = 'DELETE' then
    if old.group_id is null then return null; end if;
    -- stop_series logs one 'series_stopped' row instead of one per instance
    if old.series_id is not null
       and current_setting('pepper.stopping_series', true) = old.series_id::text then
      return null;
    end if;
    select name into g_name from public.groups where id = old.group_id;
    if g_name is null then return null; end if; -- whole group is going away
    insert into public.activity (group_id, actor_id, kind, task_id, task_title, payload)
    values (old.group_id, actor, 'task_deleted', old.id, old.title, public.task_snapshot(old));
    perform public.offer_rescues(old, g_name, 'task_deleted');
    return null;
  end if;

  -- UPDATE
  if old.group_id is distinct from new.group_id then
    if old.group_id is not null then
      -- unshared from the old group: looks like a delete to everyone else
      select name into g_name from public.groups where id = old.group_id;
      insert into public.activity (group_id, actor_id, kind, task_id, task_title, payload)
      values (old.group_id, actor, 'task_deleted', old.id, old.title, public.task_snapshot(old));
      perform public.offer_rescues(old, g_name, 'task_deleted');
    end if;
    if new.group_id is not null then
      insert into public.activity (group_id, actor_id, kind, task_id, task_title, payload)
      values (new.group_id, actor, 'task_added', new.id, new.title,
              jsonb_build_object('due_at', new.due_at, 'task_type', new.task_type));
    end if;
    return null;
  end if;

  if new.group_id is null then return null; end if;

  if old.due_at is distinct from new.due_at then
    insert into public.activity (group_id, actor_id, kind, task_id, task_title, payload)
    values (new.group_id, actor, 'due_changed', new.id, new.title,
            jsonb_build_object('from', old.due_at, 'to', new.due_at));
  end if;

  if old.task_type is distinct from new.task_type
     or old.custom_tier is distinct from new.custom_tier
     or old.custom_label is distinct from new.custom_label then
    insert into public.activity (group_id, actor_id, kind, task_id, task_title, payload)
    values (new.group_id, actor, 'type_changed', new.id, new.title,
            jsonb_build_object('from', old.task_type, 'to', new.task_type,
                               'label', new.custom_label));
  end if;

  if old.title is distinct from new.title
     or old.notes is distinct from new.notes
     or old.weight_pct is distinct from new.weight_pct then
    insert into public.activity (group_id, actor_id, kind, task_id, task_title, payload)
    values (new.group_id, actor, 'task_edited', new.id, new.title,
            jsonb_build_object('old_title', old.title));
  end if;

  return null;
end;
$$;

create trigger tasks_log_activity
  after insert or update or delete on public.tasks
  for each row execute function public.log_task_activity();

-- Before a group is deleted, offer every non-owner member copies of the
-- group's unfinished tasks.
create function public.rescue_group_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  for t in select * from public.tasks where group_id = old.id loop
    perform public.offer_rescues(t, old.name, 'group_deleted');
  end loop;
  return old;
end;
$$;

create trigger groups_rescue_tasks
  before delete on public.groups
  for each row execute function public.rescue_group_tasks();

-- Only a task's creator may move it into or out of a group. Otherwise any
-- member could "delete" someone else's shared task by moving it to a group
-- they own.
create function public.check_task_group_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id
     and (select auth.uid()) is not null
     and old.created_by <> (select auth.uid()) then
    raise exception 'only the creator can move a task' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tasks_check_group_move
  before update of group_id on public.tasks
  for each row execute function public.check_task_group_move();

-- A task can only join a series its own creator owns. Stops other members
-- from squatting future dates of someone else's series.
create function public.check_task_series()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.series_id is not null and not exists (
    select 1 from public.task_series s
    where s.id = new.series_id and s.created_by = new.created_by
  ) then
    raise exception 'series belongs to someone else' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Every group member reads a shared task's created_at, so it must be server-
-- stamped; a personal task may keep a client value (the demo week backdates a
-- neglected project). id and updated_at are never client-set (column grants).
create function public.stamp_task_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is not null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger tasks_stamp_insert
  before insert on public.tasks
  for each row execute function public.stamp_task_insert();

create trigger tasks_check_series
  before insert or update of series_id on public.tasks
  for each row execute function public.check_task_series();

-- Deleting an account: hand each group the user owns to its longest-standing
-- member first, so the group survives for everyone else.
create function public.handoff_groups_on_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
  heir uuid;
begin
  for gid in select id from public.groups where owner_id = old.id for update loop
    select user_id into heir from public.group_members
    where group_id = gid and user_id <> old.id
    order by joined_at
    limit 1;
    if heir is not null then
      update public.groups set owner_id = heir where id = gid;
      update public.group_members set role = 'owner' where group_id = gid and user_id = heir;
    end if;
  end loop;
  return old;
end;
$$;

create trigger before_user_delete_handoff
  before delete on auth.users
  for each row execute function public.handoff_groups_on_user_delete();

-- ---------------------------------------------------------------------------
-- RPCs (the only way to create/join/leave groups)
-- ---------------------------------------------------------------------------
create function public.create_group(p_name text, p_class_id uuid default null)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  g public.groups;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 60 then
    raise exception 'group name must be 1-60 characters' using errcode = '22023';
  end if;
  insert into public.groups (name, owner_id, join_code)
  values (trim(p_name), uid, public.new_join_code())
  returning * into g;
  insert into public.group_members (group_id, user_id, role, class_id)
  values (g.id, uid, 'owner', p_class_id);
  return g;
end;
$$;

create function public.join_group(p_code text, p_class_id uuid default null)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_failed_per_day constant integer := 20;
  uid uuid := (select auth.uid());
  g public.groups;
  inserted integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- Serialize this user's join attempts so concurrent calls can't all read a
  -- stale count below the cap and slip past the rate limit together.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pepper-join:' || uid::text));
  if (select count(*) from public.join_attempts
      where user_id = uid and attempted_at > now() - interval '24 hours') >= max_failed_per_day then
    raise exception 'Too many attempts. Try again tomorrow.' using errcode = 'P0001';
  end if;
  select * into g from public.groups
  where join_code = upper(trim(coalesce(p_code, '')))
  for update;
  if g.id is null then
    -- Unknown code: record the attempt and return NULL. (Raising here would
    -- roll back the attempt row and make the rate limit useless.)
    insert into public.join_attempts (user_id) values (uid);
    return null;
  end if;
  insert into public.group_members (group_id, user_id, role, class_id)
  values (g.id, uid, 'member', p_class_id)
  on conflict (group_id, user_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted > 0 then
    insert into public.activity (group_id, actor_id, kind)
    values (g.id, uid, 'member_joined');
  end if;
  return g;
end;
$$;

-- Leaving: a member just leaves. If the owner leaves, ownership passes to the
-- longest-standing member; if nobody is left, the group is deleted.
create function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  my_role text;
  heir uuid;
begin
  -- Serialize membership changes in this group (two owners leaving at once).
  perform 1 from public.groups where id = p_group_id for update;
  select role into my_role from public.group_members
  where group_id = p_group_id and user_id = uid;
  if my_role is null then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  if my_role = 'owner' then
    select user_id into heir from public.group_members
    where group_id = p_group_id and user_id <> uid
    order by joined_at
    limit 1
    for update;
    if heir is null then
      delete from public.groups where id = p_group_id;
      return;
    end if;
    update public.groups set owner_id = heir where id = p_group_id;
    update public.group_members set role = 'owner' where group_id = p_group_id and user_id = heir;
  end if;

  delete from public.group_members where group_id = p_group_id and user_id = uid;
  insert into public.activity (group_id, actor_id, kind)
  values (p_group_id, uid, 'member_left');
end;
$$;

create function public.remove_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.groups where id = p_group_id for update;
  if not public.is_group_owner(p_group_id) then
    raise exception 'only the owner can remove members' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'use leave_group to leave your own group' using errcode = '22023';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
  if found then
    -- New code so the removed member can't walk straight back in.
    update public.groups set join_code = public.new_join_code() where id = p_group_id;
    insert into public.activity (group_id, actor_id, kind, payload)
    values (p_group_id, (select auth.uid()), 'member_removed',
            jsonb_build_object('user_id', p_user_id));
  end if;
end;
$$;

-- Owner-only: replace the join code (the old one stops working).
create function public.regenerate_join_code(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  perform 1 from public.groups where id = p_group_id for update;
  if not public.is_group_owner(p_group_id) then
    raise exception 'only the owner can change the code' using errcode = '42501';
  end if;
  code := public.new_join_code();
  update public.groups set join_code = code where id = p_group_id;
  return code;
end;
$$;

-- Creator-only: end a recurring series after p_after. Future instances are
-- removed in one go, with a single activity row (not one alert per instance)
-- and no rescue offers. Instances due before now are kept as history.
create function public.stop_series(p_series_id uuid, p_after timestamptz, p_until date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.task_series;
  cutoff timestamptz := greatest(now(), p_after);
  removed integer;
begin
  select * into s from public.task_series where id = p_series_id for update;
  if s.id is null or s.created_by is distinct from (select auth.uid()) then
    raise exception 'only the person who made this repeating task can stop it' using errcode = '42501';
  end if;
  update public.task_series
     set rule = jsonb_set(rule, '{until}', to_jsonb(p_until::text)),
         generated_until = cutoff
   where id = p_series_id;
  perform set_config('pepper.stopping_series', p_series_id::text, true);
  delete from public.tasks
   where series_id = p_series_id and created_by = s.created_by and due_at > cutoff;
  get diagnostics removed = row_count;
  perform set_config('pepper.stopping_series', '', true);
  -- keep the display copy of the rule on the remaining instances in step
  update public.tasks
     set recurrence = jsonb_set(coalesce(recurrence, s.rule), '{until}', to_jsonb(p_until::text))
   where series_id = p_series_id;
  if s.group_id is not null and removed > 0 then
    insert into public.activity (group_id, actor_id, kind, task_title, payload)
    values (s.group_id, s.created_by, 'series_stopped', s.title, jsonb_build_object('removed', removed));
  end if;
  return removed;
end;
$$;

-- Your own full profile. Groupmates can only read id + display_name (see the
-- column grants below), so the app reads its own row through this function.
create function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.profiles where id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- AI usage cap: each student gets AI_DAILY_LIMIT AI calls per day, so a bug
-- or a curious user can't run up the Claude bill. Checked by the edge
-- functions before every Claude call.
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  calls integer not null default 0,
  primary key (user_id, day)
);

create function public.use_ai_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai_daily_limit constant integer := 40;        -- per student
  ai_global_daily_limit constant integer := 2000; -- whole app: a spend backstop
  uid uuid := (select auth.uid());
  n integer;
  total integer;
begin
  if uid is null then
    return false;
  end if;
  insert into public.ai_usage (user_id, day, calls)
  values (uid, current_date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls into n;
  -- Open sign-up means the per-student cap alone is not a spend ceiling, so cap
  -- the whole app's daily Claude calls too. (The Console spend limit is the
  -- final backstop.)
  select coalesce(sum(calls), 0) into total from public.ai_usage where day = current_date;
  if total > ai_global_daily_limit then
    return false;
  end if;
  return n <= ai_daily_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.ai_usage enable row level security; -- no policies: no direct access
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.activity enable row level security;
alter table public.task_rescues enable row level security;
alter table public.task_series enable row level security;
alter table public.join_attempts enable row level security; -- no policies: no direct access

-- profiles: you see yourself and people you share a group with
create policy "profiles: read self and groupmates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_group_with(id));
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- classes: private to each student
create policy "classes: own rows" on public.classes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- groups: members can read; owner can rename/delete; creation goes through RPC
create policy "groups: members read" on public.groups
  for select to authenticated
  using (public.is_group_member(id));
create policy "groups: owner updates" on public.groups
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "groups: owner deletes" on public.groups
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- group_members: members see the roster; you may change your own class mapping
create policy "members: read roster" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));
create policy "members: update own mapping" on public.group_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- tasks: personal tasks are private; shared tasks are visible to members
create policy "tasks: read" on public.tasks
  for select to authenticated
  using (
    (group_id is null and created_by = (select auth.uid()))
    or (group_id is not null and public.is_group_member(group_id))
  );
create policy "tasks: insert" on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (group_id is null or public.is_group_member(group_id))
  );
-- any member can edit a shared task (deadline changes alert everyone)
create policy "tasks: update" on public.tasks
  for update to authenticated
  using (
    (group_id is null and created_by = (select auth.uid()))
    or (group_id is not null and public.is_group_member(group_id))
  )
  with check (
    (group_id is null and created_by = (select auth.uid()))
    or (group_id is not null and public.is_group_member(group_id))
  );
-- only the task's creator or the group owner can delete a shared task
create policy "tasks: delete" on public.tasks
  for delete to authenticated
  using (
    created_by = (select auth.uid())
    or (group_id is not null and public.is_group_owner(group_id))
  );

-- task_series: creator manages; group members can read shared series
create policy "series: read" on public.task_series
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (group_id is not null and public.is_group_member(group_id))
  );
create policy "series: insert" on public.task_series
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (group_id is null or public.is_group_member(group_id))
  );
create policy "series: creator updates" on public.task_series
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy "series: creator deletes" on public.task_series
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- completions: private to each student
create policy "completions: own rows" on public.task_completions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id)
  );

-- activity: members read; only triggers/RPCs write
create policy "activity: members read" on public.activity
  for select to authenticated
  using (public.is_group_member(group_id));

-- rescues: your own offers only
create policy "rescues: read own" on public.task_rescues
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "rescues: delete own" on public.task_rescues
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Column-level privileges (RLS limits rows; these limit columns)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
-- Supabase grants EXECUTE on new functions to everyone by default. Internal
-- helpers (offer_rescues, task_snapshot, ...) must not be callable as RPCs, so
-- revoke everything and grant back only the intended entry points below.
revoke all on all functions in schema public from anon, authenticated, public;

-- Groupmates may read only id + display_name. Your own full row comes from
-- get_my_profile() (goals and struggles stay private).
revoke select, insert, update, delete on public.profiles from authenticated;
grant select (id, display_name) on public.profiles to authenticated;
grant update (display_name, education_level, grade, goals, struggles,
              quiet_hours_enabled, quiet_start, quiet_end, onboarded)
  on public.profiles to authenticated;

revoke insert, update, delete on public.groups from authenticated;
grant update (name) on public.groups to authenticated;
grant delete on public.groups to authenticated;

revoke insert, update, delete on public.group_members from authenticated;
grant update (class_id) on public.group_members to authenticated;

revoke update on public.tasks from authenticated;
grant update (group_id, class_id, title, task_type, custom_label, custom_tier,
              weight_pct, due_at, notes, recurrence)
  on public.tasks to authenticated;

revoke update on public.task_series from authenticated;
grant update (rule, generated_until) on public.task_series to authenticated;

-- Clients may INSERT only the business columns; id, updated_at and (except on
-- tasks, for the demo week) created_at are server-managed. created_by/user_id
-- stay grantable because RLS pins them to auth.uid().
revoke insert on public.tasks from authenticated;
grant insert (created_by, group_id, class_id, title, task_type, custom_label,
              custom_tier, weight_pct, due_at, notes, series_id, recurrence, created_at)
  on public.tasks to authenticated;

revoke insert on public.task_series from authenticated;
grant insert (created_by, group_id, class_id, title, task_type, custom_label,
              custom_tier, weight_pct, notes, rule, first_due, generated_until)
  on public.task_series to authenticated;

revoke insert on public.task_completions from authenticated;
grant insert (task_id) on public.task_completions to authenticated;

revoke insert on public.classes from authenticated;
grant insert (name, color, position) on public.classes to authenticated;

revoke insert, update, delete on public.activity from authenticated;
revoke insert, update on public.task_rescues from authenticated;

grant execute on function public.create_group(text, uuid) to authenticated;
grant execute on function public.join_group(text, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_owner(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;
grant execute on function public.use_ai_quota() to authenticated;
grant execute on function public.regenerate_join_code(uuid) to authenticated;
grant execute on function public.stop_series(uuid, timestamptz, date) to authenticated;
grant execute on function public.get_my_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: push changes to subscribed apps (RLS still applies)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Only the activity feed is published. Its INSERTs are RLS-checked, and
    -- every shared-task or membership change writes one. (DELETE events on
    -- other tables would reach every subscriber regardless of RLS.)
    alter publication supabase_realtime add table public.activity;
  end if;
end;
$$;
