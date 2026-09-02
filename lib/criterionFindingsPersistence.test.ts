import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { fingerprintCriterionSemantics } from './criterionSemantics.ts';

const migration = readFileSync(new URL('../supabase/migrations/20260830170609_criterion_findings_persistence.sql', import.meta.url), 'utf8');

const prelude = String.raw`
create role anon; create role authenticated; create role service_role;
create schema extensions;
create extension pgcrypto schema extensions;
create function uuid_generate_v4() returns uuid language sql volatile as $$ select gen_random_uuid() $$;
create table phase1_requisitions(id uuid primary key default uuid_generate_v4(),title text,job_description text,archived_at timestamptz,job_description_updated_at timestamptz default now(),current_evaluation_basis_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table phase1_hiring_criteria_models(id uuid primary key default uuid_generate_v4(),requisition_id uuid,extraction_status text,updated_at timestamptz default now());
create table phase1_hiring_criteria_items(id uuid primary key default uuid_generate_v4(),model_id uuid,category text,label text,rationale text,jd_evidence text,default_weight integer,draft_weight integer,is_knockout boolean,knockout_suggested boolean,created_at timestamptz default now());
create table phase1_hiring_criteria_versions(id uuid primary key default uuid_generate_v4(),requisition_id uuid,model_id uuid,version_number integer,criteria_snapshot jsonb,category_totals jsonb,total_weight integer,unique(requisition_id,version_number));
create table phase1_evaluation_bases(id uuid primary key default uuid_generate_v4(),requisition_id uuid,basis_type text,job_description_snapshot text,job_description_hash text,job_description_updated_at timestamptz,hiring_criteria_version_id uuid);
create table phase1_operations(id uuid primary key default uuid_generate_v4(),operation_type text,requisition_id uuid,status text,stage text,progress_current integer default 0,progress_total integer,input_snapshot jsonb,result_summary jsonb default '{}'::jsonb,error_summary text,idempotency_key text,attempt_count integer default 0,available_at timestamptz default now(),lease_token uuid,lease_expires_at timestamptz,created_at timestamptz default now(),started_at timestamptz,completed_at timestamptz,failed_at timestamptz,updated_at timestamptz default now());
create table phase1_operation_items(id uuid primary key default uuid_generate_v4(),operation_id uuid,item_key text,status text,input_ref jsonb,candidate_id uuid,evaluation_id uuid,error_summary text,attempt_count integer default 0,available_at timestamptz default now(),lease_token uuid,lease_expires_at timestamptz,created_at timestamptz default now(),started_at timestamptz,completed_at timestamptz,failed_at timestamptz,updated_at timestamptz default now());
create table phase1_candidates(id uuid primary key default uuid_generate_v4(),requisition_id uuid,full_name text,source_filename text,source_storage_path text,source_mime_type text,resume_text text,operation_item_id uuid unique);
create table phase1_evaluations(id uuid primary key default uuid_generate_v4(),requisition_id uuid,candidate_id uuid,evaluation_basis_id uuid,job_responsibilities_score integer,hard_skills_score integer,soft_skills_score integer,keyword_terminology_score integer,overall_match integer,verdict text,assessment jsonb,raw_model_response jsonb,operation_item_id uuid unique);
create function refresh_phase1_resume_operation_rollup(uuid) returns text language sql as $$ select 'processing'::text $$;
create function complete_phase1_resume_operation_item(uuid,uuid,text,text,jsonb,text,jsonb,jsonb) returns jsonb language sql as $$ select '{"legacy":true}'::jsonb $$;
`;

type Fixture = { itemId: string; leaseToken: string; fingerprint: string; findings: Array<Record<string, unknown>> };

async function seedCompletionFixture(db: PGlite, suffix: string): Promise<Fixture> {
  const criterionId = `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  const fingerprint = fingerprintCriterionSemantics({ category: 'hard_skills', label: 'ERP administration', rationale: 'Operate ERP', jdEvidence: 'ERP required' });
  const ids = {
    requisition: `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    model: `20000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    version: `30000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    basis: `40000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    operation: `50000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    item: `60000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    lease: `70000000-0000-4000-8000-${suffix.padStart(12, '0')}`
  };
  const snapshot = [{ id: criterionId, category: 'hard_skills', label: 'ERP administration', rationale: 'Operate ERP', jdEvidence: 'ERP required', defaultWeight: 100, appliedWeight: 100, isKnockout: false, knockoutSuggested: false }];
  await db.query(`insert into phase1_requisitions(id,title,job_description) values($1,'Role','JD')`, [ids.requisition]);
  await db.query(`insert into phase1_hiring_criteria_models(id,requisition_id,extraction_status) values($1,$2,'ready')`, [ids.model, ids.requisition]);
  await db.query(`insert into phase1_hiring_criteria_versions(id,requisition_id,model_id,version_number,criteria_snapshot,category_totals,total_weight) values($1,$2,$3,1,$4,'{}',100)`, [ids.version, ids.requisition, ids.model, JSON.stringify(snapshot)]);
  await db.query(`insert into phase1_evaluation_bases(id,requisition_id,basis_type,job_description_snapshot,job_description_hash,job_description_updated_at,hiring_criteria_version_id) values($1,$2,'hiring_criteria','JD',$3,now(),$4)`, [ids.basis, ids.requisition, '0'.repeat(64), ids.version]);
  await db.query(`insert into phase1_operations(id,operation_type,requisition_id,status,input_snapshot,idempotency_key) values($1,'resume_batch_evaluation',$2,'processing',$3,$4)`, [ids.operation, ids.requisition, JSON.stringify({ evaluationBasisId: ids.basis }), `op-${suffix}`]);
  await db.query(`insert into phase1_operation_items(id,operation_id,item_key,status,input_ref,lease_token,lease_expires_at) values($1,$2,$3,'processing',$4,$5,now()+interval '1 hour')`, [ids.item, ids.operation, `item-${suffix}`, JSON.stringify({ originalFilename: 'resume.pdf', storagePath: `path-${suffix}`, mimeType: 'application/pdf' }), ids.lease]);
  return {
    itemId: ids.item,
    leaseToken: ids.lease,
    fingerprint,
    findings: [{ criterionId, criterionSemanticFingerprint: fingerprint, semanticFingerprintVersion: 'criterion_semantics_v1', alignmentScore: 75, satisfactionStatus: 'MET', evidence: 'ERP listed', assessment: 'Substantially demonstrated' }]
  };
}

async function complete(db: PGlite, fixture: Fixture, findings = fixture.findings) {
  return db.query(`select complete_phase1_hiring_criteria_resume_operation_item_v1($1,$2,'Candidate','resume text',$3,'consider',$4,$5,$6,'gpt-test-actual','criteria_evaluation_neutral_findings_v1')`, [
    fixture.itemId, fixture.leaseToken,
    JSON.stringify({ responsibilities: null, hardSkills: 75, softSkills: null, keywords: null, match: 75 }),
    JSON.stringify({ frozen: true }), JSON.stringify({ criterionFindings: fixture.findings }), JSON.stringify(findings)
  ]);
}

test('migration executes in disposable Postgres and completion is complete, atomic, and idempotent', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(prelude);
    await db.exec(`
      insert into phase1_requisitions(id,title,job_description) values('12000000-0000-4000-8000-000000000000','Legacy','JD');
      insert into phase1_candidates(id,requisition_id,full_name,source_filename,resume_text) values('22000000-0000-4000-8000-000000000000','12000000-0000-4000-8000-000000000000','Legacy Candidate','legacy.pdf','legacy resume');
      insert into phase1_evaluations(id,requisition_id,candidate_id,overall_match,verdict,assessment) values('32000000-0000-4000-8000-000000000000','12000000-0000-4000-8000-000000000000','22000000-0000-4000-8000-000000000000',50,'consider','{"legacy":true}');
    `);
    await db.exec(migration);

    const historical = await db.query<{ assessment: { legacy: boolean }; model_identifier: string | null; prompt_schema_version: string | null; neutral_findings_provenance: string | null }>(`select assessment,model_identifier,prompt_schema_version,neutral_findings_provenance from phase1_evaluations where id='32000000-0000-4000-8000-000000000000'`);
    assert.deepEqual(historical.rows[0], { assessment: { legacy: true }, model_identifier: null, prompt_schema_version: null, neutral_findings_provenance: null });

    const parity = await db.query<{ canonical: string; fingerprint: string }>(`select phase1_criterion_semantic_canonical_json(' hard_skills ','Café\t administration','  Five  years\r\nrequired ',null) canonical, phase1_criterion_semantic_fingerprint(' hard_skills ','Café\t administration','  Five  years\r\nrequired ',null) fingerprint`);
    assert.equal(parity.rows[0].canonical, '{"category":"hard_skills","label":"Café administration","rationale":"Five years\\nrequired","jdEvidence":null}');
    assert.equal(parity.rows[0].fingerprint, '7a47ef97972a77c7a6c7c7f967f13dd829f3be47683b8055a7b7c4ef63bcb3a4');

    await db.exec(`
      insert into phase1_requisitions(id,title,job_description) values('11000000-0000-4000-8000-000000000000','Apply','JD');
      insert into phase1_hiring_criteria_models(id,requisition_id,extraction_status) values('21000000-0000-4000-8000-000000000000','11000000-0000-4000-8000-000000000000','ready');
      insert into phase1_hiring_criteria_items(id,model_id,category,label,rationale,jd_evidence,default_weight,draft_weight,is_knockout,knockout_suggested)
      values('01000000-0000-4000-8000-000000000000','21000000-0000-4000-8000-000000000000','hard_skills','ERP administration','Operate ERP','ERP required',100,100,false,false);
      select apply_phase1_hiring_criteria('11000000-0000-4000-8000-000000000000');
    `);
    const applied = await db.query<{ fingerprint: string; version: string }>(`select criteria_snapshot->0->>'semanticFingerprint' fingerprint,criteria_snapshot->0->>'semanticFingerprintVersion' version from phase1_hiring_criteria_versions where requisition_id='11000000-0000-4000-8000-000000000000'`);
    assert.equal(applied.rows[0].fingerprint, fingerprintCriterionSemantics({ category: 'hard_skills', label: 'ERP administration', rationale: 'Operate ERP', jdEvidence: 'ERP required' }));
    assert.equal(applied.rows[0].version, 'criterion_semantics_v1');

    const good = await seedCompletionFixture(db, '1');
    await complete(db, good);
    const persisted = await db.query<{ evaluations: number; findings: number; status: string; model_identifier: string; prompt_schema_version: string; neutral_findings_provenance: string; assessment: { frozen: boolean }; alignment_score: number; satisfaction_status: string }>(`select (select count(*)::int from phase1_evaluations where operation_item_id=$1) evaluations,(select count(*)::int from phase1_evaluation_criterion_findings where evaluation_id=e.id) findings,i.status,e.model_identifier,e.prompt_schema_version,e.neutral_findings_provenance,e.assessment,f.alignment_score,f.satisfaction_status from phase1_operation_items i join phase1_evaluations e on e.id=i.evaluation_id join phase1_evaluation_criterion_findings f on f.evaluation_id=e.id where i.id=$1`, [good.itemId]);
    assert.deepEqual(persisted.rows[0], { evaluations: 1, findings: 1, status: 'completed', model_identifier: 'gpt-test-actual', prompt_schema_version: 'criteria_evaluation_neutral_findings_v1', neutral_findings_provenance: 'model_observed', assessment: { frozen: true }, alignment_score: 75, satisfaction_status: 'MET' });
    await assert.rejects(complete(db, good), /lease is no longer authoritative/);
    assert.equal((await db.query<{ count: number }>(`select count(*)::int count from phase1_evaluation_criterion_findings`)).rows[0].count, 1);

    for (const [suffix, mutate, message] of [
      ['2', () => [], /cover every captured criterion/],
      ['3', (f: Fixture) => [f.findings[0], f.findings[0]], /cover every captured criterion|duplicate/],
      ['4', (f: Fixture) => [{ ...f.findings[0], criterionId: '00000000-0000-4000-8000-999999999999' }], /unknown or missing/],
      ['5', (f: Fixture) => [{ ...f.findings[0], criterionSemanticFingerprint: '0'.repeat(64) }], /fingerprint does not match/],
      ['8', (f: Fixture) => [{ ...f.findings[0], alignmentScore: undefined }], /payload is invalid/],
      ['9', (f: Fixture) => [{ ...f.findings[0], satisfactionStatus: undefined }], /payload is invalid/],
      ['10', (f: Fixture) => [{ ...f.findings[0], semanticFingerprintVersion: undefined }], /payload is invalid/],
      ['11', (f: Fixture) => [{ ...f.findings[0], assessment: ' ' }], /payload is invalid/]
    ] as const) {
      const fixture = await seedCompletionFixture(db, suffix);
      if (suffix === '3') {
        await db.query(`update phase1_hiring_criteria_versions v set criteria_snapshot=criteria_snapshot||$2::jsonb from phase1_evaluation_bases b,phase1_operations o,phase1_operation_items i where i.id=$1 and o.id=i.operation_id and b.id=(o.input_snapshot->>'evaluationBasisId')::uuid and v.id=b.hiring_criteria_version_id`, [fixture.itemId, JSON.stringify([{ id: '00000000-0000-4000-8000-000000000099', category: 'soft_skills', label: 'Communication', rationale: null, jdEvidence: null, appliedWeight: 0, isKnockout: true }])]);
      }
      await assert.rejects(complete(db, fixture, mutate(fixture)), message);
      const state = await db.query<{ candidates: number; evaluations: number; findings: number; status: string }>(`select (select count(*)::int from phase1_candidates where operation_item_id=$1) candidates,(select count(*)::int from phase1_evaluations where operation_item_id=$1) evaluations,(select count(*)::int from phase1_evaluation_criterion_findings f join phase1_evaluations e on e.id=f.evaluation_id where e.operation_item_id=$1) findings,status from phase1_operation_items where id=$1`, [fixture.itemId]);
      assert.deepEqual(state.rows[0], { candidates: 0, evaluations: 0, findings: 0, status: 'processing' });
    }

    const rollback = await seedCompletionFixture(db, '6');
    await db.exec(`create function reject_finding() returns trigger language plpgsql as $$ begin raise exception 'forced finding failure'; end $$; create trigger reject_finding before insert on phase1_evaluation_criterion_findings for each row execute function reject_finding();`);
    await assert.rejects(complete(db, rollback), /forced finding failure/);
    assert.equal((await db.query<{ count: number }>(`select count(*)::int count from phase1_candidates where operation_item_id=$1`, [rollback.itemId])).rows[0].count, 0);
    assert.equal((await db.query<{ status: string }>(`select status from phase1_operation_items where id=$1`, [rollback.itemId])).rows[0].status, 'processing');
    await db.exec(`drop trigger reject_finding on phase1_evaluation_criterion_findings; drop function reject_finding();`);

    const resumed = await seedCompletionFixture(db, '7');
    await db.query(`insert into phase1_candidates(id,requisition_id,full_name,source_filename,source_storage_path,source_mime_type,resume_text,operation_item_id) select gen_random_uuid(),o.requisition_id,'Candidate','resume.pdf','path-7','application/pdf','resume text',i.id from phase1_operation_items i join phase1_operations o on o.id=i.operation_id where i.id=$1`, [resumed.itemId]);
    await db.query(`insert into phase1_evaluations(id,requisition_id,candidate_id,evaluation_basis_id,job_responsibilities_score,hard_skills_score,soft_skills_score,keyword_terminology_score,overall_match,verdict,assessment,raw_model_response,operation_item_id,model_identifier,prompt_schema_version,neutral_findings_provenance) select gen_random_uuid(),o.requisition_id,c.id,(o.input_snapshot->>'evaluationBasisId')::uuid,null,75,null,null,75,'consider',$2,$3,i.id,'gpt-test-actual','criteria_evaluation_neutral_findings_v1','model_observed' from phase1_operation_items i join phase1_operations o on o.id=i.operation_id join phase1_candidates c on c.operation_item_id=i.id where i.id=$1`, [resumed.itemId, JSON.stringify({ frozen: true }), JSON.stringify({ criterionFindings: resumed.findings })]);
    await complete(db, resumed);
    const resumedCounts = await db.query<{ evaluations: number; findings: number; status: string }>(`select (select count(*)::int from phase1_evaluations where operation_item_id=$1) evaluations,(select count(*)::int from phase1_evaluation_criterion_findings f join phase1_evaluations e on e.id=f.evaluation_id where e.operation_item_id=$1) findings,status from phase1_operation_items where id=$1`, [resumed.itemId]);
    assert.deepEqual(resumedCounts.rows[0], { evaluations: 1, findings: 1, status: 'completed' });

    const legacy = await db.query<{ value: { legacy: boolean } }>(`select complete_phase1_resume_operation_item(gen_random_uuid(),gen_random_uuid(),'','','{}','consider','{}','{}') value`);
    assert.deepEqual(legacy.rows[0].value, { legacy: true });
  } finally {
    await db.close();
  }
});
