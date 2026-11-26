create table public.portal_teachers(user_id uuid primary key references auth.users(id) on delete cascade);
create table public.portal_results(
 teacher_id uuid not null references public.portal_teachers(user_id) on delete cascade,
 exam_code text not null,
 student_id uuid not null references auth.users(id) on delete cascade,
 title text not null,
 published boolean not null default false,
 payload jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(teacher_id,exam_code,student_id)
);
alter table public.portal_teachers enable row level security;
alter table public.portal_results enable row level security;
revoke all on public.portal_teachers,public.portal_results from anon,authenticated;
grant select on public.portal_teachers,public.portal_results to authenticated;
create policy teacher_self on public.portal_teachers for select to authenticated using(user_id=(select auth.uid()));
create policy own_result on public.portal_results for select to authenticated using(
 teacher_id=(select auth.uid()) or (student_id=(select auth.uid()) and published)
);
create index portal_results_student_idx on public.portal_results(student_id);
grant insert,update,delete on public.portal_results to authenticated;
create policy teacher_insert on public.portal_results for insert to authenticated with check (
 teacher_id=(select auth.uid()) and exists(select 1 from public.portal_teachers where user_id=(select auth.uid()))
);
create policy teacher_update on public.portal_results for update to authenticated using (
 teacher_id=(select auth.uid()) and exists(select 1 from public.portal_teachers where user_id=(select auth.uid()))
) with check (
 teacher_id=(select auth.uid()) and exists(select 1 from public.portal_teachers where user_id=(select auth.uid()))
);
create policy teacher_delete on public.portal_results for delete to authenticated using (
 teacher_id=(select auth.uid()) and exists(select 1 from public.portal_teachers where user_id=(select auth.uid()))
);
create function public.portal_sync(p_exam text,p_title text,p_published boolean,p_rows jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v_teacher uuid:=auth.uid();
begin
 if v_teacher is null or not exists(select 1 from public.portal_teachers where user_id=v_teacher) then raise exception 'Professor não autorizado'; end if;
 if p_exam is null or p_exam !~ '^[a-zA-Z0-9_-]{3,100}$' or p_title is null or length(p_title)>500 or p_published is null then raise exception 'Avaliação inválida'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Lista inválida'; end if;
 if jsonb_array_length(p_rows)>10000 then raise exception 'Limite de 10000 resultados por envio'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where r->>'student_id' is null or jsonb_typeof(r->'payload') is distinct from 'object') then raise exception 'Resultado inválido'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_teacher::text || ':' || p_exam,0));
 -- The delete and insert are atomic: any error restores the previous publication.
 delete from public.portal_results where teacher_id=v_teacher and exam_code=p_exam;
 insert into public.portal_results(teacher_id,exam_code,student_id,title,published,payload)
 select v_teacher,p_exam,(r->>'student_id')::uuid,p_title,p_published,r->'payload' from jsonb_array_elements(p_rows) r;
end;$$;
revoke all on function public.portal_sync(text,text,boolean,jsonb) from public,anon;
grant execute on function public.portal_sync(text,text,boolean,jsonb) to authenticated;
