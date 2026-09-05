with extracted as (
  select id,
    (regexp_match(
      resume_text,
      '((?:\+?1[[:space:].-]?)?(?:\([0-9]{3}\)|[0-9]{3})[[:space:].-]?[0-9]{3}[[:space:].-]?[0-9]{4})',
      'i'
    ))[1] as raw_phone
  from public.phase1_candidates
  where primary_phone_e164 is null
), normalized as (
  select id,
    case
      when length(regexp_replace(raw_phone, '[^0-9]', '', 'g')) = 11
        and left(regexp_replace(raw_phone, '[^0-9]', '', 'g'), 1) = '1'
      then right(regexp_replace(raw_phone, '[^0-9]', '', 'g'), 10)
      else regexp_replace(raw_phone, '[^0-9]', '', 'g')
    end as digits
  from extracted
  where raw_phone is not null
), valid as (
  select id, digits from normalized where length(digits) = 10
)
update public.phase1_candidates as candidate
set primary_phone_display = '(' || left(valid.digits, 3) || ') ' || substring(valid.digits from 4 for 3) || '-' || right(valid.digits, 4),
    primary_phone_e164 = '+1' || valid.digits,
    contact_extraction_version = 'resume_contact_v1'
from valid
where candidate.id = valid.id
  and candidate.primary_phone_e164 is null;
