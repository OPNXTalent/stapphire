create table if not exists public.phase1_aoe_preferences (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  hidden_standard_areas text[] not null default '{}'::text[],
  custom_areas text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  constraint phase1_aoe_preferences_hidden_limit check (cardinality(hidden_standard_areas) <= 30),
  constraint phase1_aoe_preferences_custom_limit check (cardinality(custom_areas) <= 50)
);

alter table public.phase1_aoe_preferences enable row level security;
revoke all on table public.phase1_aoe_preferences from anon, authenticated, public;
grant select, insert, update, delete on table public.phase1_aoe_preferences to service_role;

comment on table public.phase1_aoe_preferences is 'Organization-level customization for Stapphire Areas of Evaluation. Canonical areas are hidden, never deleted; custom areas are additive.';
