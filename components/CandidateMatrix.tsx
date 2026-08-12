'use client';

import { useMemo, useState } from 'react';
import { verdictLabel, type Verdict } from '@/lib/evaluation';

export type MatrixCandidate = {
  id: string;
  name: string;
  match: number | null;
  verdict: Verdict | null;
  responsibilities: number | null;
  hardSkills: number | null;
  softSkills: number | null;
  keywords: number | null;
  transitEmployer: boolean | null;
};

type SortKey = 'match' | 'name' | 'responsibilities' | 'hardSkills' | 'softSkills' | 'keywords';
type VerdictFilter = 'all' | Verdict;
type TransitFilter = 'all' | 'yes' | 'no';

const scoreColumns: Array<{key:SortKey;label:string;shortLabel?:string}> = [
  {key:'responsibilities',label:'Responsibilities',shortLabel:'Resp.'},
  {key:'hardSkills',label:'Hard Skills'},
  {key:'softSkills',label:'Soft Skills'},
  {key:'keywords',label:'Keywords'}
];

function Score({value,prominent=false}:{value:number|null;prominent?:boolean}){
  return <span className={prominent?'matrix-match':undefined}>{value===null?'—':`${value}%`}</span>;
}

export function CandidateMatrix({candidates}:{candidates:MatrixCandidate[]}){
  const [sortKey,setSortKey]=useState<SortKey>('match');
  const [sortDirection,setSortDirection]=useState<'asc'|'desc'>('desc');
  const [verdictFilter,setVerdictFilter]=useState<VerdictFilter>('all');
  const [transitFilter,setTransitFilter]=useState<TransitFilter>('all');

  function sortBy(key:SortKey){if(key===sortKey)setSortDirection(value=>value==='asc'?'desc':'asc');else{setSortKey(key);setSortDirection(key==='name'?'asc':'desc')}}
  const rows=useMemo(()=>candidates.filter(candidate=>(verdictFilter==='all'||candidate.verdict===verdictFilter)&&(transitFilter==='all'||candidate.transitEmployer===(transitFilter==='yes'))).sort((a,b)=>{
    if(sortKey==='name')return sortDirection==='asc'?a.name.localeCompare(b.name):b.name.localeCompare(a.name);
    const av=a[sortKey],bv=b[sortKey];if(av===null&&bv===null)return 0;if(av===null)return 1;if(bv===null)return -1;return sortDirection==='asc'?av-bv:bv-av;
  }),[candidates,sortKey,sortDirection,verdictFilter,transitFilter]);
  const heading=(label:string,key:SortKey)=><button className="matrix-sort" onClick={()=>sortBy(key)} aria-label={`Sort by ${label}`}>{label}{sortKey===key?<span aria-hidden="true"> {sortDirection==='asc'?'↑':'↓'}</span>:null}</button>;

  if(!candidates.length)return <div className="matrix-empty"><strong>No candidates evaluated yet.</strong><p>Add a resume to begin building the candidate comparison.</p></div>;
  return <section className="candidate-matrix">
    <div className="matrix-controls">
      <div className="matrix-filter" aria-label="Filter by verdict">
        {([['all','All'],['greenlight','Recommend'],['consider','Hold / Clarify'],['decline','Decline']] as const).map(([value,label])=><button key={value} className={verdictFilter===value?'active':''} onClick={()=>setVerdictFilter(value)}>{label}</button>)}
      </div>
      <label className="transit-filter">Transit Employer<select value={transitFilter} onChange={event=>setTransitFilter(event.target.value as TransitFilter)}><option value="all">All</option><option value="yes">Yes</option><option value="no">No</option></select></label>
    </div>
    <div className="matrix-scroll"><table className="matrix-table"><thead><tr><th>{heading('Candidate','name')}</th><th>{heading('Match','match')}</th><th>Verdict</th>{scoreColumns.map(column=><th key={column.key}>{heading(column.shortLabel||column.label,column.key)}</th>)}<th>Transit</th></tr></thead><tbody>{rows.map(candidate=><tr key={candidate.id}><td><a className="candidate-link" href={`/candidates/${candidate.id}`}>{candidate.name}</a></td><td className="numeric"><Score value={candidate.match} prominent/></td><td><span className={`verdict ${candidate.verdict||''}`}>{candidate.verdict?verdictLabel[candidate.verdict]:'—'}</span></td><td className="numeric"><Score value={candidate.responsibilities}/></td><td className="numeric"><Score value={candidate.hardSkills}/></td><td className="numeric"><Score value={candidate.softSkills}/></td><td className="numeric"><Score value={candidate.keywords}/></td><td>{candidate.transitEmployer===null?'—':candidate.transitEmployer?'Yes':'No'}</td></tr>)}</tbody></table></div>
    {!rows.length&&<p className="matrix-no-results">No candidates match these filters.</p>}
  </section>;
}
