import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { verdictLabel, type Verdict } from '@/lib/evaluation';
export const dynamic='force-dynamic';

function List({items,empty='None identified.'}:{items?:string[];empty?:string}){return items?.length?<ul className="bullets">{items.map((item,i)=><li key={i}>{item}</li>)}</ul>:<p className="muted">{empty}</p>}

function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
function text(value:unknown):string{return typeof value==='string'?value:''}
function texts(value:unknown):string[]{return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[]}
function cleanTransitStatus(value:string):string{return value.replace(/^(previous\s+transit\s+employer\s*:\s*)+/i,'').trim()}
function normalizeAssessment(value:unknown){
  const source=record(value);const ats=record(source.ats_compatibility);const employment=record(source.employment_history_review);
  const transitValue=employment.previous_transit_employer;const transit=record(transitValue);const legacyTransit=cleanTransitStatus(text(transitValue));
  const strongestMatches=Array.isArray(source.strongest_matches)?source.strongest_matches.flatMap(item=>{const match=record(item);const requirement=text(match.requirement);const evidence=text(match.evidence);const assessment=text(match.assessment);return requirement||evidence||assessment?[{requirement,evidence,assessment}]:[]}):[];
  return {assessment:text(source.assessment),standoutReasons:texts(source.standout_reasons),strongestMatches,mostImportantConcern:text(source.most_important_concern),dealBreakers:texts(source.deal_breakers),whatToVerify:texts(source.what_to_verify),trainableAfterHire:texts(source.trainable_after_hire),ats:{level:text(ats.level),reasoning:text(ats.reasoning)},employment:{transit:{status:cleanTransitStatus(text(transit.status))||legacyTransit,employer:text(transit.employer),position:text(transit.position),dates:text(transit.dates)},gaps:texts(employment.gaps),shortTenure:texts(employment.short_tenure),stability:text(employment.stability)},strategicRisk:text(source.strategic_risk),interviewPriorities:texts(source.interview_priorities),finalRecommendationReasoning:text(source.final_recommendation_reasoning)};
}

export default async function CandidatePage({params}:{params:{id:string}}){
  const {data:candidate}=await supabaseAdmin.from('phase1_candidates').select('*,phase1_requisitions(title)').eq('id',params.id).single();if(!candidate)notFound();
  const {data:e}=await supabaseAdmin.from('phase1_evaluations').select('*').eq('candidate_id',params.id).order('created_at',{ascending:false}).limit(1).single();if(!e)notFound();
  const a=normalizeAssessment(e.assessment);const verdict=e.verdict as Verdict;const position=text(record(candidate.phase1_requisitions).title);
  return <article className="evaluation"><a className="back" href={`/requisitions/${candidate.requisition_id}`}>← {position}</a><section className="hero"><p className="muted">Candidate Evaluation</p><h1>{candidate.full_name}</h1><p>{position}</p><div className="match">{e.overall_match}% Match</div><p className={`verdict ${verdict}`}>{verdictLabel[verdict]}</p></section>
  {a.assessment&&<><h2>Assessment</h2><div className="prose">{a.assessment}</div></>}
  <h2>Weighted Alignment</h2><table><thead><tr><th>Category</th><th>Weight</th><th>Score</th></tr></thead><tbody><tr><td>Job Responsibilities</td><td className="numeric">50%</td><td className="numeric">{e.job_responsibilities_score}%</td></tr><tr><td>Hard Skills</td><td className="numeric">25%</td><td className="numeric">{e.hard_skills_score}%</td></tr><tr><td>Soft Skills</td><td className="numeric">15%</td><td className="numeric">{e.soft_skills_score}%</td></tr><tr><td>Keywords &amp; Terminology</td><td className="numeric">10%</td><td className="numeric">{e.keyword_terminology_score}%</td></tr><tr><td><strong>Match</strong></td><td className="numeric"><strong>100%</strong></td><td className="numeric"><strong>{e.overall_match}%</strong></td></tr></tbody></table>
  {a.standoutReasons.length>0&&<><h2>Why This Candidate Stands Out</h2><List items={a.standoutReasons}/></>}
  {a.strongestMatches.length>0&&<><h2>Strongest Job-Specific Matches</h2><table className="strong-table"><thead><tr><th>Requirement</th><th>Candidate Evidence</th><th>Assessment</th></tr></thead><tbody>{a.strongestMatches.map((m,i)=><tr key={i}><td>{m.requirement}</td><td>{m.evidence}</td><td>{m.assessment}</td></tr>)}</tbody></table></>}
  {a.mostImportantConcern&&<><h2>Most Important Concern</h2><p>{a.mostImportantConcern}</p></>}
  {a.dealBreakers.length>0&&<><h3>Transparent deal-breakers</h3><List items={a.dealBreakers}/></>}
  {a.whatToVerify.length>0&&<><h2>What to Verify</h2><List items={a.whatToVerify}/></>}
  {a.trainableAfterHire.length>0&&<><h2>Trainable After Hire</h2><List items={a.trainableAfterHire}/></>}
  {(a.ats.level||a.ats.reasoning)&&<><h2>ATS Compatibility</h2><p>{a.ats.level&&<strong>{a.ats.level}</strong>}{a.ats.level&&a.ats.reasoning&&' — '}{a.ats.reasoning}</p></>}
  {(a.employment.transit.status||a.employment.gaps.length>0||a.employment.shortTenure.length>0||a.employment.stability)&&<><h2>Employment History Review</h2><p><strong>Previous Transit Employer:</strong> {a.employment.transit.status||'None Identified'}</p>{a.employment.transit.status==='Yes'&&<div><p><strong>Employer:</strong> {a.employment.transit.employer}</p><p><strong>Position:</strong> {a.employment.transit.position}</p><p><strong>Dates:</strong> {a.employment.transit.dates}</p></div>}{a.employment.gaps.length>0&&<><h3>Gaps</h3><List items={a.employment.gaps}/></>}{a.employment.shortTenure.length>0&&<><h3>Short tenure</h3><List items={a.employment.shortTenure}/></>}{a.employment.stability&&<><h3>Stability</h3><p>{a.employment.stability}</p></>}</>}
  {a.strategicRisk&&<><h2>Strategic Risk Assessment</h2><p>{a.strategicRisk}</p></>}
  {a.interviewPriorities.length>0&&<><h2>Interview Priorities</h2><List items={a.interviewPriorities}/></>}
  <h2>Final Recommendation</h2><p><strong>{verdictLabel[verdict]}.</strong>{a.finalRecommendationReasoning&&<> {a.finalRecommendationReasoning}</>}</p></article>
}
