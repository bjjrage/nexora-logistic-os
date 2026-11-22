import {useState} from 'react';
import {crmPath,useCrmQuery,formatDate,type Page,type RunAction} from './model';
import {Field} from './forms';
import {LoadStatus,Pager} from './detail';

type Draft = {brief:{company:string;sector:string;city:string}; hypotheses:string[];
  outreachDraft:string;replyDraft:string;nextAction:string;nextAt:string};
type AgentRun = {id:string;state:'PENDING'|'READY'|'FAILED';startedAt:string;result:Draft|null};
type RunPage=Page<AgentRun>&{configured:boolean;contactAllowed:boolean};
const topics = {
  SIN_RESPUESTA:'Sin respuesta',PIDE_INFORMACION:'Solicitó información',PIDE_PRECIOS:'Consultó precios',
  PIDE_REUNION:'Pidió una reunión',YA_TIENE_OPERADOR:'Ya tiene operador',
};
type Research={score:number;reasons:{points:number;text:string}[];
  sources:{batchId:string;sourceRef:string;sourceRow:number;authorizationBasis:string}[]};
export function ResearchCard({id,revision}:{id:string;revision:number}) {
  const research=useCrmQuery<Research>(crmPath('/agent/prospects/'+id),revision);
  return <details className="card">
    <summary>Relevancia comercial</summary>
    {research?.data?<div className="stack">
      <strong>{research.data.score}/100</strong>
      {research.data.reasons.map(r=><span key={r.text}>+{r.points} · {r.text}</span>)}
      <strong>Procedencia autorizada</strong>
      {research.data.sources.map(s=><span key={s.batchId}>{s.sourceRef} · fila {s.sourceRow} · {s.authorizationBasis}</span>)}
      {!research.data.sources.length&&<span>Sin fuente registrada</span>}
    </div>:<LoadStatus error={research?.error}/>}
  </details>;
}

export function AgentPanel({threadId,revision,busy,run}:{threadId:string;revision:number;busy:boolean;run:RunAction}) {
  const [offset,setOffset]=useState(0);
  const [topic,setTopic]=useState<keyof typeof topics>('SIN_RESPUESTA');
  const [actions,setActions]=useState<Record<string,boolean>>({});
  const path='/agent/threads/'+threadId;
  const history=useCrmQuery<RunPage>(crmPath(path,{offset}),revision);
  const data=history?.data;
  async function apply(row:AgentRun, kind:'OUTREACH'|'REPLY'|'TASK') {
    const result=await run('/agent/suggestions/'+row.id+(kind==='TASK'?'/follow-up':'/draft'),kind==='TASK'?{}:{kind});
    if(result?.id)setActions(previous=>({...previous,[row.id+kind]:true}));
  }
  return <details className="card">
    <summary>Asistente comercial</summary>
    {data?<div className="stack">
      <span role="status">{data.configured?'Proveedor configurado':'IA deshabilitada · proveedor sin configurar'}</span>
      {!data.contactAllowed&&<p role="alert" className="notice error">Contacto bloqueado o conversación cerrada.</p>}
      <div className="crm-actions">
        <Field label="Respuesta registrada por el equipo"><select value={topic} onChange={e=>setTopic(e.target.value as keyof typeof topics)}>
          {Object.entries(topics).map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select></Field>
        <button type="button" className="button button-primary" disabled={busy||!data.configured||!data.contactAllowed}
          onClick={()=>void run(path,{replyTopic:topic})}>Preparar sugerencias</button>
      </div>
      {data.rows.map(row=><article className="card stack" key={row.id}>
        <span>{formatDate(row.startedAt)} · {row.state==='READY'?'Preparada':row.state==='FAILED'?'Falló la ejecución':'Pendiente'}</span>
        {row.result&&<>
          <strong>Ficha · {row.result.brief.company}</strong>
          <span>{row.result.brief.sector||'Rubro sin informar'} · {row.result.brief.city||'Ciudad sin informar'}</span>
          <strong>Hipótesis</strong><span>{row.result.hypotheses.join(' ')}</span>
          <strong>Acercamiento</strong><span>{row.result.outreachDraft}</span>
          <strong>Respuesta sugerida</strong><span>{row.result.replyDraft}</span>
          <strong>{row.result.nextAction}</strong><span>{formatDate(row.result.nextAt)}</span>
          <div className="crm-actions">
            {(['OUTREACH','REPLY','TASK'] as const).map((kind,i)=><button key={kind} type="button" className="button button-secondary"
              disabled={busy||!data.contactAllowed||actions[row.id+kind]} onClick={()=>void apply(row,kind)}>
              {actions[row.id+kind]?'Guardado':['Guardar acercamiento','Guardar respuesta','Crear tarea'][i]}
            </button>)}
          </div>
        </>}
      </article>)}
      <Pager label="Páginas de sugerencias" data={data} onChange={setOffset}/>
    </div>:<LoadStatus error={history?.error}/>}
  </details>;
}
