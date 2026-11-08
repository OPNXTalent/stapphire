const PAGE='4124afa7-d4a0-8118-867a-e4b5ee932d43';
const ROOT='https://api.notion.com/v1';
const PREFIX='STAPPHIRE_CC_STATE_V1:';
const headers=()=>({'Authorization':'Bearer '+process.env.NOTION_TOKEN,'Notion-Version':'2022-06-28','Content-Type':'application/json'});
async function notion(path,options={}){const r=await fetch(ROOT+path,{...options,headers:headers()});const body=await r.json();if(!r.ok)throw Error('Notion '+r.status+': '+(body.message||'API error'));return body}
async function readState(){let blocks=[],cursor;do{const q=new URLSearchParams({page_size:'100'});if(cursor)q.set('start_cursor',cursor);const res=await notion('/blocks/'+PAGE+'/children?'+q);blocks.push(...res.results);cursor=res.has_more?res.next_cursor:null}while(cursor&&blocks.length<1000);
const matches=blocks.filter(b=>b.type==='paragraph'&&!b.archived&&(b.paragraph.rich_text||[]).map(t=>t.plain_text).join('').startsWith(PREFIX));
if(!matches.length)return {data:null,revision:null,blockIds:[]};
const segments=matches.map(b=>({id:b.id,text:b.paragraph.rich_text.map(t=>t.plain_text).join('')}));
const head=segments.find(s=>s.text.startsWith(PREFIX+'META:'));if(!head)throw Error('Incomplete Notion state');
const meta=JSON.parse(head.text.slice((PREFIX+'META:').length));
const chunks=segments.filter(s=>s.text.startsWith(PREFIX+meta.revision+':')).map(s=>{const p=s.text.slice((PREFIX+meta.revision+':').length);const colon=p.indexOf(':');return {i:Number(p.slice(0,colon)),value:p.slice(colon+1)}}).sort((a,b)=>a.i-b.i);
if(chunks.length!==meta.parts)throw Error('Incomplete Notion state chunks');
return {data:JSON.parse(chunks.map(c=>c.value).join('')),revision:meta.revision,blockIds:segments.map(s=>s.id)}}
const para=text=>({object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:text}}]}});
export default async function handler(req,res){
res.setHeader('Cache-Control','no-store');
if(!process.env.NOTION_TOKEN)return res.status(503).json({error:'Notion integration is not configured'});
if(!['GET','PUT'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
try{
const current=await readState();
if(req.method==='GET')return res.status(200).json({data:current.data,revision:current.revision});
const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
if(!body||!body.data||!Array.isArray(body.data.features)||!Array.isArray(body.data.decisions)||!Array.isArray(body.data.captures))return res.status(400).json({error:'Invalid state'});
if(JSON.stringify(body.data).length>100000)return res.status(413).json({error:'State exceeds 100KB'});
if((body.revision||null)!==current.revision)return res.status(409).json({error:'State changed in Notion; reload before saving'});
const revision=Date.now().toString(36);const json=JSON.stringify(body.data);const parts=json.match(/[\s\S]{1,1700}/g)||[''];
const children=[para(PREFIX+'META:'+JSON.stringify({revision,parts:parts.length})),...parts.map((s,i)=>para(PREFIX+revision+':'+i+':'+s))];
if(children.length>100)return res.status(413).json({error:'Too many state blocks'});
await notion('/blocks/'+PAGE+'/children',{method:'PATCH',body:JSON.stringify({children})});
for(const id of current.blockIds)await notion('/blocks/'+id,{method:'DELETE'});
return res.status(200).json({revision});
}catch(e){return res.status(500).json({error:e.message||'Sync failed'})}
}