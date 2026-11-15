'use client';

import { useEffect, useMemo, useState } from 'react';

type Kind = 'text' | 'date' | 'number' | 'select';
type Col = { key: string; label: string; kind: Kind; choices?: string[]; locked?: boolean };
type Entry = { id: string; type: 'requisition' | 'candidate'; fields: Record<string, string>; punch: string[] };
type Data = { columns: Record<'requisition' | 'candidate', Col[]>; entries: Entry[] };
const seed: Data = {
  columns: {
    requisition: [
      {key:'reqId', label:'Requisition ID',kind:'text',locked:true},
      {key:'title',label:'Position Title',kind:'text'},
      {key:'department',label:'Department',kind:'text'},
      {key:'manager',label:'Hiring Manager',kind:'text'},
      {key:'openDate',label:'Open Date',kind:'date'},
      {key:'status',label:'Status',kind:'select',choices:['Open','On Hold','Closed']},
      {key:'openings',label:'Openings',kind:'number'},
      {key:'closeDate',label:'Close Date',kind:'date'}
    ],
    candidate: [
      {key:'applicationId',label:'Application ID',kind:'text',locked:true},
      {key:'reqId',label:'Requisition ID',kind:'text',locked:true},
      {key:'name',label:'Candidate Name',kind:'text'},
      {key:'stage',label:'Stage',kind:'select',choices:['Applied','Screen','Interview','Offer','Hired','Rejected','Withdrawn']},
      {key:'email',label:'Email',kind:'text'},
      {key:'phone',label:'Phone',kind:'text'},
      {key:'applied',label:'Applied Date',kind:'date'}
    ]
  },
  entries: [
    {id:'r1',type:'requisition',fields:{reqId:'REQ-101',title:'Director of Planning',department:'Planning',manager:'J. Williams',openDate:'2026-11-01',status:'Open',openings:'1',closeDate:''},punch:['Review candidate shortlist']},
    {id:'r2',type:'requisition',fields:{reqId:'REQ-102',title:'Capital Project Manager',department:'Infrastructure',manager:'A. Lewis',openDate:'2026-11-04',status:'Open',openings:'2',closeDate:''},punch:[]},
    {id:'c1',type:'candidate',fields:{applicationId:'APP-001',reqId:'REQ-101',name:'Alex Morgan',stage:'Interview',email:'alex@example.com',phone:'',applied:'2026-11-05'},punch:['Confirm interview feedback']},
    {id:'c2',type:'candidate',fields:{applicationId:'APP-002',reqId:'REQ-102',name:'Jordan Lee',stage:'Screen',email:'jordan@example.com',phone:'',applied:'2026-11-08'},punch:[]}
  ]
};
const panel: React.CSSProperties = {border:'1px solid #d5dce6',borderRadius:12,padding:18,background:'#fff'};
const control: React.CSSProperties = {width:'100%',padding:'8px 10px',border:'1px solid #bcc8d6',borderRadius:7,background:'#fff',color:'#15243b'};
const action: React.CSSProperties = {padding:'9px 14px',border:'1px solid #9db2c8',borderRadius:8,cursor:'pointer',background:'#f5f8fc',color:'#12243a'};
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
export default function WorkbookPrototype() {
  const [data,setData] = useState<Data>(seed);
  const [loaded,setLoaded] = useState(false);
  const [selected,setSelected] = useState<string>('r1');
  const [tab,setTab] = useState<'update'|'punch'|'columns'>('update');
  const [draft,setDraft] = useState<Record<string,string>>({});
  const [newPunch,setNewPunch] = useState('');
  const [notice,setNotice] = useState('');
  const [showIntake,setShowIntake] = useState<null|'requisition'|'candidate'>(null);
  useEffect(() => {
    try { const saved = localStorage.getItem('stapphire-workbook-prototype-v1'); if(saved) setData(JSON.parse(saved)); } catch {}
    setLoaded(true);
  },[]);
  useEffect(() => { if(loaded) localStorage.setItem('stapphire-workbook-prototype-v1',JSON.stringify(data)); },[data,loaded]);
  const record = data.entries.find(r=>r.id===selected);
  const columns = record ? data.columns[record.type] : [];
  useEffect(() => { setDraft(record ? {...record.fields} : {});setNotice(''); },[record?.id,record?.fields]);
  const dirty = !!record && !same(draft,record.fields);
  const requisitions = data.entries.filter(r=>r.type==='requisition');
  const candidates = data.entries.filter(r=>r.type==='candidate');
  const hiredCounts = useMemo(()=>Object.fromEntries(requisitions.map(r=>[r.fields.reqId,candidates.filter(c=>c.fields.reqId===r.fields.reqId && c.fields.stage==='Hired').length])),[data.entries]);
  function updateField(key:string, value:string) { setDraft(old=>({...old,[key]:value}));setNotice(''); }
  function save() {
    if(!record) return;
    const fields = {...draft};
    if(record.type==='requisition') {
      if(fields.status==='Closed' && !fields.closeDate) fields.closeDate=new Date().toLocaleDateString('en-CA');
      if(fields.status!=='Closed') fields.closeDate='';
    }
    setData(old=>({...old,entries:old.entries.map(e=>e.id===record.id?{...e,fields}:e)}));
    setNotice('Changes saved to the workbook.');
  }
  function addPunch() {
    if(!record||!newPunch.trim()) return;
    setData(old=>({...old,entries:old.entries.map(e=>e.id===record.id?{...e,punch:[...e.punch,newPunch.trim()]}:e)}));
    setNewPunch('');
  }
  function removePunch(index:number) {
    if(!record) return;
    setData(old=>({...old,entries:old.entries.map(e=>e.id===record.id?{...e,punch:e.punch.filter((_,i)=>i!==index)}:e)}));
  }
  function setColumn(key:string,patch:Partial<Col>) {
    if(!record) return;
    setData(old=>({...old,columns:{...old.columns,[record.type]:old.columns[record.type].map(c=>c.key===key?{...c,...patch}:c)}}));
  }
  function createRecord(type:'requisition'|'candidate') {
    const id=String(Date.now());
    const fields=Object.fromEntries(data.columns[type].map(c=>[c.key,'']));
    if(type==='requisition'){fields.reqId='REQ-'+id.slice(-5);fields.status='Open';}
    else {fields.applicationId='APP-'+id.slice(-5);fields.stage='Applied';fields.reqId=requisitions[0]?.fields.reqId||'';}
    setData(old=>({...old,entries:[...old.entries,{id,type,fields,punch:[]}]}));
    setSelected(id);setTab('update');setShowIntake(null);
  }
  return <main style={{padding:'24px',maxWidth:1450,margin:'0 auto',color:'#16263c',fontFamily:'system-ui,sans-serif'}}>
    <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:12,alignItems:'center'}}>
      <div><div style={{fontSize:12,letterSpacing:2,fontWeight:700,color:'#526b88'}}>STAPPHIRE · INTERACTION TEST</div><h1 style={{margin:'5px 0'}}>Recruiting Workbook</h1><p style={{color:'#52647a'}}>Select a workbook row. Update every field in the right panel; Punch Lists remain separate.</p></div>
      <div style={{display:'flex',gap:8}}><button style={action} onClick={()=>setShowIntake('requisition')}>+ New Requisition</button><button style={action} onClick={()=>setShowIntake('candidate')}>+ New Candidate</button></div>
    </div>
    {showIntake && <div role="dialog" aria-modal="true" style={{...panel,marginBottom:16,background:'#f1f5fb'}}>
      <h2>New {showIntake==='requisition'?'Requisition':'Candidate'} intake</h2><p>Creates a new record with all workbook fields ready for entry.</p>
      <button style={action} onClick={()=>createRecord(showIntake)}>Create & open record</button> <button style={action} onClick={()=>setShowIntake(null)}>Cancel</button>
    </div>}
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(310px,390px)',gap:16,alignItems:'start'}}>
      <section style={{...panel,overflowX:'auto'}}>
        <h2>Requisitions</h2><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr>{data.columns.requisition.map(c=><th key={c.key} style={{padding:8,textAlign:'left',borderBottom:'2px solid #dce4ed',whiteSpace:'nowrap'}}>{c.label}</th>)}<th>Hired</th></tr></thead>
        <tbody>{requisitions.map(r=><tr key={r.id} onClick={()=>{setSelected(r.id);setTab('update');}} style={{cursor:'pointer',background:selected===r.id?'#e6f0fc':'transparent'}}>{data.columns.requisition.map(c=><td key={c.key} style={{padding:8,borderBottom:'1px solid #e3e8ee',whiteSpace:'nowrap'}}>{r.fields[c.key]||'—'}</td>)}<td style={{padding:8}}>{hiredCounts[r.fields.reqId]||0}</td></tr>)}</tbody></table>
        <h2 style={{marginTop:26}}>Candidates</h2><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr>{data.columns.candidate.map(c=><th key={c.key} style={{padding:8,textAlign:'left',borderBottom:'2px solid #dce4ed',whiteSpace:'nowrap'}}>{c.label}</th>)}</tr></thead><tbody>{candidates.map(r=><tr key={r.id} onClick={()=>{setSelected(r.id);setTab('update');}} style={{cursor:'pointer',background:selected===r.id?'#e6f0fc':'transparent'}}>{data.columns.candidate.map(c=><td key={c.key} style={{padding:8,borderBottom:'1px solid #e3e8ee',whiteSpace:'nowrap'}}>{r.fields[c.key]||'—'}</td>)}</tr>)}</tbody></table>
      </section>
      <aside style={{...panel,position:'sticky',top:16,maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{fontSize:12,color:'#586d86'}}>SELECTED {record?.type.toUpperCase()}</div><h2 style={{margin:'4px 0 12px'}}>{record?.fields.title||record?.fields.name||'New record'}</h2>
        <nav style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>{(['update','punch','columns'] as const).map(t=><button key={t} style={{...action,background:tab===t?'#193c68':'#f5f8fc',color:tab===t?'white':'#15243b'}} onClick={()=>setTab(t)}>{t==='punch'?'Punch List':t==='columns'?'Column Setup':'Update'}</button>)}</nav>
        {tab==='update' && record && <form onSubmit={e=>{e.preventDefault();save();}}>
          {columns.map(c=><label key={c.key} style={{display:'block',fontSize:13,fontWeight:600,marginBottom:12}}>{c.label}
            {c.kind==='select' ? <select disabled={c.locked} style={{...control,marginTop:5}} value={draft[c.key]||''} onChange={e=>updateField(c.key,e.target.value)}><option value="">Select…</option>{(c.choices||[]).map(choice=><option key={choice} value={choice}>{choice}</option>)}</select> :
            <input disabled={c.locked} type={c.kind==='date'?'date':c.kind==='number'?'number':'text'} style={{...control,marginTop:5}} value={draft[c.key]||''} onChange={e=>updateField(c.key,e.target.value)}/>}
          </label>)}
          <div style={{display:'flex',gap:8}}><button type="submit" disabled={!dirty} style={{...action,background:dirty?'#163e6d':'#e9eef5',color:dirty?'white':'#506072'}}>Save Changes</button><button type="button" style={action} onClick={()=>setDraft({...record.fields})}>Discard</button></div>
          {notice && <p role="status" style={{color:'#226641'}}>{notice}</p>}{dirty && <p style={{color:'#9a641c'}}>Unsaved changes</p>}
          <p style={{fontSize:12,color:'#64758a'}}>Closing a requisition sets its close date. The hired count updates when a candidate's Stage becomes Hired.</p>
        </form>}
        {tab==='punch' && record && <div><h3>Outstanding actions</h3>{record.punch.length===0&&<p>No outstanding items.</p>}{record.punch.map((v,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:9}}><span>{v}</span><button style={action} onClick={()=>removePunch(i)}>Complete</button></div>)}<input style={control} placeholder="Add an action…" value={newPunch} onChange={e=>setNewPunch(e.target.value)}/><button style={{...action,marginTop:8}} onClick={addPunch}>Add</button></div>}
        {tab==='columns' && record && <div><p style={{fontSize:13}}>Change each field's input format. Every field is driven by the same column definition used by the workbook.</p>
          {columns.map(c=><div key={c.key} style={{borderBottom:'1px solid #e3e8ee',padding:'8px 0'}}><strong style={{fontSize:13}}>{c.label}</strong><select aria-label={c.label+' format'} disabled={c.locked} style={{...control,marginTop:5}} value={c.kind} onChange={e=>setColumn(c.key,{kind:e.target.value as Kind})}>{(['text','date','number','select'] as const).map(k=><option key={k} value={k}>{k}</option>)}</select>{c.kind==='select' && <input style={{...control,marginTop:6}} aria-label={c.label+' choices'} value={(c.choices||[]).join(', ')} onChange={e=>setColumn(c.key,{choices:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})} placeholder="Comma-separated choices" />}</div>)}
        </div>}
      </aside>
    </div>
    <p style={{fontSize:12,color:'#61728a',marginTop:16}}>Prototype only · illustrative records · saved in this browser's local storage · not connected to production Supabase data.</p>
  </main>;
}
