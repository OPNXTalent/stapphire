import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verdictLabel, type ModelEvaluation, type Verdict } from '@/lib/evaluation';
export const dynamic='force-dynamic';

function List({items,empty='None identified.'}:{items?:string[];empty?:string}){return items?.length?<ul className="bullets">{items.map((item,i)=><li key={i}>{item}</li>)}</ul>:<p className="muted">{empty}</p>}

export default async function CandidatePage({params}:{params:{id:string}}){
  const {data:candidate}=await supabaseAdmin.from('phase1_candidates').select('*,phase1_requisitions(title)').eq('id',params.id).single();if(!candidate)notFound();
  const {data:e}=await supabaseAdmin.from('phase1_evaluations').select('*').eq('candidate_id',params.id).order('created_at',{ascending:false}).limit(1).single();if(!e)notFound();
  const a=e.assessment as ModelEvaluation;const verdict=e.verdict as Verdict;const position=(candidate.phase1_requisitions as unknown as {title:string})?.title;
  return <article className="evaluation"><a className="back" href={`/requisitions/${candidate.requisition_id}`}>← {position}</a><section className="hero"><p className="muted">Candidate Evaluation</p><h1>{candidate.full_name}</h1><p>{position}</p><div className="match">{e.overall_match}% Match</div><p className={`verdict ${verdict}`}>{verdictLabel[verdict]}</p></section>
  <h2>Assessment</h2><div className="prose">{a.assessment}</div>
  <h2>Weighted Alignment</h2><table><thead><tr><th>Category</th><th>Weight</th><th>Score</th></tr></thead><tbody><tr><td>Job Responsibilities</td><td className="numeric">50%</td><td className="numeric">{e.job_responsibilities_score}%</td></tr><tr><td>Hard Skills</td><td className="numeric">25%</td><td className="numeric">{e.hard_skills_score}%</td></tr><tr><td>Soft Skills</td><td className="numeric">15%</td><td className="numeric">{e.soft_skills_score}%</td></tr><tr><td>Keywords &amp; Terminology</td><td className="numeric">10%</td><td className="numeric">{e.keyword_terminology_score}%</td></tr><tr><td><strong>Match</strong></td><td className="numeric"><strong>100%</strong></td><td className="numeric"><strong>{e.overall_match}%</strong></td></tr></tbody></table>
  <h2>Why This Candidate Stands Out</h2><List items={a.standout_reasons}/>
  <h2>Strongest Job-Specific Matches</h2>{a.strongest_matches?.length?<table className="strong-table"><thead><tr><th>Requirement</th><th>Candidate Evidence</th><th>Assessment</th></tr></thead><tbody>{a.strongest_matches.map((m,i)=><tr key={i}><td>{m.requirement}</td><td>{m.evidence}</td><td>{m.assessment}</td></tr>)}</tbody></table>:<p className="muted">None identified.</p>}
  <h2>Most Important Concern</h2><p>{a.most_important_concern||'No material concern identified from the resume.'}</p>
  {a.deal_breakers?.length>0&&<><h3>Transparent deal-breakers</h3><List items={a.deal_breakers}/></>}
  <h2>What to Verify</h2><List items={a.what_to_verify}/>
  <h2>Trainable After Hire</h2><List items={a.trainable_after_hire}/>
  <h2>ATS Compatibility</h2>{a.ats_compatibility?<p><strong>{a.ats_compatibility.level}</strong>{a.ats_compatibility.reasoning&&<> — {a.ats_compatibility.reasoning}</>}</p>:<p className="muted">Not provided.</p>}
  <h2>Employment History Review</h2><p><strong>Previous Transit Employer:</strong> {a.employment_history_review?.previous_transit_employer||'None Identified'}</p><h3>Gaps</h3><List items={a.employment_history_review?.gaps}/><h3>Short tenure</h3><List items={a.employment_history_review?.short_tenure}/><h3>Stability</h3><p>{a.employment_history_review?.stability||''}</p>
  <h2>Strategic Risk Assessment</h2><p>{a.strategic_risk}</p>
  <h2>Interview Priorities</h2><List items={a.interview_priorities}/>
  <h2>Final Recommendation</h2><p><strong>{verdictLabel[verdict]}.</strong> {a.final_recommendation_reasoning}</p></article>
}
