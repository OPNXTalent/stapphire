begin;

alter function public.create_phase1_hiring_criteria_operation(uuid, text)
set search_path = public, extensions;
notify pgrst, 'reload schema';
commit;
