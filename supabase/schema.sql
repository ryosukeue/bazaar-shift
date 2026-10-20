-- Bazaar Shift v2. Run once in Supabase SQL Editor as postgres.
-- After this schema, install the owner key with the separate private setup file.
begin;
create schema if not exists bazaar_private;
revoke all on schema bazaar_private from public, anon, authenticated;
create table if not exists bazaar_private.settings (
 singleton boolean primary key default true check(singleton), creator_hash text not null
);
create table if not exists bazaar_private.events (
 id uuid primary key, admin_hash text not null,
 data jsonb not null, revision integer not null default 0,
 updated_at timestamptz not null default now()
);
create table if not exists bazaar_private.answer_keys (
 event_id uuid references bazaar_private.events(id) on delete cascade,
 person_id uuid, edit_hash text not null, primary key(event_id,person_id)
);
alter table bazaar_private.settings enable row level security;
alter table bazaar_private.events enable row level security;
alter table bazaar_private.answer_keys enable row level security;
revoke all on all tables in schema bazaar_private from public, anon, authenticated;

create or replace function bazaar_private.hash_key(k text) returns text
language sql immutable strict set search_path = '' as $$
 select encode(sha256(convert_to(k,'UTF8')),'hex');
$$;
create or replace function bazaar_private.check_key(k text) returns void
language plpgsql set search_path = '' as $$
begin
 if k is null or k !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_KEY'; end if;
end; $$;
create or replace function bazaar_private.check_person(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare x jsonb; n numeric;
begin
 if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p)>12000 then raise exception 'INVALID_PERSON'; end if;
 perform (p->>'id')::uuid;
 if (p->>'id') is null or coalesce(length(trim(p->>'name')),0) not between 1 and 60
 or jsonb_typeof(p->'name') is distinct from 'string'
 or coalesce(p->>'grade','') !~ '^[1-5]$'
 or jsonb_typeof(p->'available') is distinct from 'array'
 or jsonb_typeof(p->'note') is distinct from 'string'
 or length(p->>'note')>500 or jsonb_typeof(p->'maxHours') is distinct from 'number'
 then raise exception 'INVALID_PERSON'; end if;
 n := (p->>'maxHours')::numeric;
 if n<0 or n>10 or mod(n*2,1)<>0 or jsonb_array_length(p->'available')>20 then raise exception 'INVALID_PERSON'; end if;
 for x in select value from jsonb_array_elements(p->'available') loop
  if jsonb_typeof(x)<>'number' or x::text !~ '^([0-9]|1[0-9])$' then raise exception 'INVALID_SLOT'; end if;
 end loop;
end; $$;
create or replace function bazaar_private.check_state(s jsonb) returns void
language plpgsql set search_path = '' as $$
declare e jsonb; p jsonb; d text;
begin
 if s is null or jsonb_typeof(s)<>'object' or pg_column_size(s)>1000000 then raise exception 'INVALID_STATE'; end if;
 e:=s->'event';
 if coalesce(length(trim(e->>'title')),0) not between 1 and 80 or jsonb_typeof(e->'dates') is distinct from 'array'
 or jsonb_typeof(s->'people') is distinct from 'array' then raise exception 'INVALID_EVENT'; end if;
 perform (e->>'id')::uuid;
 if e->>'id' is null or jsonb_array_length(e->'dates')<>2 or jsonb_array_length(s->'people')>300 then raise exception 'INVALID_EVENT'; end if;
 for d in select jsonb_array_elements_text(e->'dates') loop
  if d !~ '^\d{4}-\d{2}-\d{2}$' or (d::date)::text<>d then raise exception 'INVALID_DATE'; end if;
 end loop;
 if (e->'dates'->>0)>=(e->'dates'->>1) then raise exception 'INVALID_DATE'; end if;
 for p in select value from jsonb_array_elements(s->'people') loop
  perform bazaar_private.check_person(p);
  if coalesce(p->>'role','') not in ('','chief','fire','cooklead','cook','selllead','sell') then raise exception 'INVALID_ROLE'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(s->'people')) <> jsonb_array_length(s->'people') then raise exception 'DUPLICATE_PERSON'; end if;
end; $$;

create or replace function public.bazaar_health() returns jsonb
language sql security definer set search_path = '' as $$
 select jsonb_build_object('version',2,'ready',exists(select 1 from bazaar_private.settings));
$$;
create or replace function public.bazaar_create(p_creator_token text,p_admin_token text,p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare eid uuid;
begin
 perform bazaar_private.check_key(p_creator_token); perform bazaar_private.check_key(p_admin_token);
 if not exists(select 1 from bazaar_private.settings where creator_hash=bazaar_private.hash_key(p_creator_token)) then raise exception 'ACCESS_DENIED'; end if;
 perform bazaar_private.check_state(p_state); eid:=(p_state->'event'->>'id')::uuid;
 insert into bazaar_private.events(id,admin_hash,data) values(eid,bazaar_private.hash_key(p_admin_token), jsonb_build_object('event',p_state->'event','people',p_state->'people','result',p_state->'result'));
 return jsonb_build_object('revision',0);
end; $$;
create or replace function public.bazaar_read(p_event_id uuid,p_admin_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r bazaar_private.events;
begin
 perform bazaar_private.check_key(p_admin_token);
 select * into r from bazaar_private.events where id=p_event_id and admin_hash=bazaar_private.hash_key(p_admin_token);
 if not found then raise exception 'ACCESS_DENIED'; end if;
 return r.data || jsonb_build_object('revision',r.revision);
end; $$;
create or replace function public.bazaar_save(p_event_id uuid,p_admin_token text,p_revision integer,p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r bazaar_private.events;
begin
 perform bazaar_private.check_key(p_admin_token);
 select * into r from bazaar_private.events where id=p_event_id and admin_hash=bazaar_private.hash_key(p_admin_token) for update;
 if not found then raise exception 'ACCESS_DENIED'; end if;
 if p_revision is distinct from r.revision then raise exception 'REVISION_CONFLICT'; end if;
 perform bazaar_private.check_state(p_state);
 if (p_state->'event'->>'id')::uuid<>p_event_id or p_state->'event'->'dates' is distinct from r.data->'event'->'dates' then raise exception 'DATES_LOCKED'; end if;
 update bazaar_private.events set data=jsonb_build_object('event',p_state->'event','people',p_state->'people','result',p_state->'result'),revision=revision+1,updated_at=now() where id=p_event_id;
 return jsonb_build_object('revision',r.revision+1);
end; $$;
create or replace function public.bazaar_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e jsonb;
begin
 select data->'event' into e from bazaar_private.events where id=p_event_id;
 if e is null then raise exception 'EVENT_NOT_FOUND'; end if;
 -- Deliberately return only public event fields, never answers or admin credentials.
 return jsonb_build_object('id',p_event_id,'title',e->>'title','dates',e->'dates','collecting',coalesce((e->>'collecting')::boolean,true));
end; $$;
create or replace function public.bazaar_submit(p_event_id uuid,p_edit_token text,p_person jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r bazaar_private.events; ps jsonb; existing jsonb; person jsonb; idx integer; expected text; pid uuid;
begin
 perform bazaar_private.check_key(p_edit_token); perform bazaar_private.check_person(p_person); pid:=(p_person->>'id')::uuid;
 select * into r from bazaar_private.events where id=p_event_id for update;
 if not found then raise exception 'EVENT_NOT_FOUND'; end if;
 if coalesce((r.data->'event'->>'collecting')::boolean,true)=false then raise exception 'COLLECTION_CLOSED'; end if;
 ps:=r.data->'people';
 select value, (ordinality-1)::integer into existing,idx from jsonb_array_elements(ps) with ordinality where value->>'id'=pid::text;
 select edit_hash into expected from bazaar_private.answer_keys where event_id=p_event_id and person_id=pid;
 if expected is not null and expected<>bazaar_private.hash_key(p_edit_token) then raise exception 'ACCESS_DENIED'; end if;
 if existing is not null and expected is null then raise exception 'ACCESS_DENIED'; end if;
 if expected is null then insert into bazaar_private.answer_keys values(p_event_id,pid,bazaar_private.hash_key(p_edit_token)); end if;
 -- Never accept a participant's role or arbitrary fields; role is admin-controlled.
 person:=jsonb_build_object('id',pid,'name',trim(p_person->>'name'),'grade',(p_person->>'grade')::integer,'available',p_person->'available','maxHours',(p_person->>'maxHours')::numeric,'note',p_person->>'note','role',coalesce(existing->>'role',''),'updatedAt',now());
 if existing is null then
  if jsonb_array_length(ps)>=300 then raise exception 'EVENT_FULL'; end if;
  ps:=ps||jsonb_build_array(person);
 else ps:=jsonb_set(ps,array[idx::text],person); end if;
 update bazaar_private.events set data=jsonb_set(jsonb_set(data,'{people}',ps),'{result}','null'::jsonb),revision=revision+1,updated_at=now() where id=p_event_id;
 return jsonb_build_object('ok',true);
end; $$;

revoke all on all functions in schema bazaar_private from public,anon,authenticated;
revoke all on function public.bazaar_health(),public.bazaar_create(text,text,jsonb),public.bazaar_read(uuid,text),public.bazaar_save(uuid,text,integer,jsonb),public.bazaar_event(uuid),public.bazaar_submit(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.bazaar_health(),public.bazaar_create(text,text,jsonb),public.bazaar_read(uuid,text),public.bazaar_save(uuid,text,integer,jsonb),public.bazaar_event(uuid),public.bazaar_submit(uuid,text,jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
