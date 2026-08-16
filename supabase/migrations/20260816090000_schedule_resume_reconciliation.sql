begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'stapphire-resume-operation-reconciliation'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'stapphire-resume-operation-reconciliation',
  '* * * * *',
  $reconciliation$
    select net.http_get(
      url := (
        select rtrim(decrypted_secret, '/')
        from vault.decrypted_secrets
        where name = 'stapphire_app_url'
        limit 1
      ) || '/api/cron/resume-operations',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'stapphire_resume_reconciliation_secret'
          limit 1
        )
      ),
      timeout_milliseconds := 30000
    );
  $reconciliation$
);

commit;
