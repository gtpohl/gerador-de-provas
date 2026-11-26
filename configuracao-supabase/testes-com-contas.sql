-- Run in SQL Editor AFTER installation and after creating test accounts.
-- Replace UUID_PROFESSOR, UUID_ALUNO_A and UUID_ALUNO_B with real UUIDs.
-- All test data and changes are rolled back at the end.
begin;
insert into public.portal_teachers(user_id) values ('UUID_PROFESSOR') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub','UUID_PROFESSOR',true);
select public.portal_sync('teste-isolamento','Teste',true,
 '[{"student_id":"UUID_ALUNO_A","payload":{"note":8}},{"student_id":"UUID_ALUNO_B","payload":{"note":6}}]'::jsonb);
select set_config('request.jwt.claim.sub','UUID_ALUNO_A',true);
do $$ begin
 if (select count(*) from public.portal_results where exam_code='teste-isolamento')<>1 then raise exception 'Falha de isolamento A'; end if;
 if exists(select 1 from public.portal_results where exam_code='teste-isolamento' and student_id<>auth.uid()) then raise exception 'A viu outro aluno'; end if;
 begin
  perform public.portal_sync('teste-isolamento','Invasão',true,'[]');
  raise exception 'Aluno conseguiu publicar';
 exception when raise_exception then
  if sqlerrm<>'Professor não autorizado' then raise; end if;
 end;
end $$;
select set_config('request.jwt.claim.sub','UUID_ALUNO_B',true);
do $$ begin
 if (select count(*) from public.portal_results where exam_code='teste-isolamento')<>1 then raise exception 'Falha de isolamento B'; end if;
end $$;
select set_config('request.jwt.claim.sub','UUID_PROFESSOR',true);
select public.portal_sync('teste-isolamento','Teste',false,
 '[{"student_id":"UUID_ALUNO_A","payload":{"note":9}}]'::jsonb);
select set_config('request.jwt.claim.sub','UUID_ALUNO_A',true);
do $$ begin
 if exists(select 1 from public.portal_results where exam_code='teste-isolamento') then raise exception 'Resultado não liberado foi exposto'; end if;
end $$;
reset role;
rollback;
