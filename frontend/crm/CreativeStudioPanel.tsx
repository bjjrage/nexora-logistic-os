import {useState,type FormEvent} from 'react';
import {crmPath,useCrmQuery,type Page,type RunAction} from './model';
import {LoadStatus,Pager} from './detail';
import {Field} from './forms';
import HelpTip from '../HelpTip';

type Scene={scene:number;seconds:number;voiceOver:string;overlay:string;imagePrompt:string;motionPrompt:string};
type Concept={id:string;angle:string;hook:string;cta:string;scenes:Scene[]};
type Plan={engine:string;styleBible:string;concepts:Concept[];claimChecks:string[];notes:string;modelSelection:string};
type Brief={id:string;campaign:string;objective:string;audience:string;idea:string;durationSeconds:number;aspectRatio:string;state:string;version:number;plan:Plan|null};
type Row={id:string;campaign:string;idea:string;state:string;updatedAt:string};
export default function CreativeStudioPanel({revision,busy,run}:{revision:number;busy:boolean;run:RunAction}) {
  const [offset,setOffset]=useState(0),[id,setId]=useState(''),[newBrief,setNewBrief]=useState(false);
  const [idea,setIdea]=useState(''),[audience,setAudience]=useState(''),[objective,setObjective]=useState(''),
    [campaign,setCampaign]=useState(''),[duration,setDuration]=useState(20),[ratio,setRatio]=useState('9:16');
  const [chosen,setChosen]=useState(0);
  const status=useCrmQuery<{planning:string;llm:string;fal:string;paidRendering:boolean}>(crmPath('/creative/status'),revision);
  const briefs=useCrmQuery<Page<Row>>(crmPath('/creative/briefs',{offset}),revision);
  const detail=useCrmQuery<Brief>(id?crmPath('/creative/briefs/'+id):null,revision);
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const result=await run('/creative/briefs',{idea,audience,objective,campaign,durationSeconds:duration,aspectRatio:ratio});
    if(result?.id){setId(result.id);setNewBrief(false);}
  }
  const brief=detail?.data,concept=brief?.plan?.concepts[chosen];
  return <div className="stack">
    <div className="card stack">
      <div className="card-header"><h2>Studio creativo NEXORA</h2><HelpTip label="Alcance">
        Esta primera etapa prepara conceptos y prompts editoriales. No invoca modelos IA ni genera videos.
        Los prompts son editables en futuras fases. Nunca se realizan llamadas pagas desde esta pantalla.
      </HelpTip></div>
      <div className="crm-actions"><span>Director editorial: {status?.data?.planning??'Verificando'}</span>
        <span>Render fal.ai: {status?.data?.fal??'No disponible'}</span>
        <button className="button button-primary" onClick={()=>setNewBrief(v=>!v)}>Nuevo brief</button></div>
      {newBrief&&<form className="stack" onSubmit={e=>void create(e)}>
        <Field label="Qué queremos comunicar"><textarea required minLength={15} maxLength={2000} rows={3} value={idea} onChange={e=>setIdea(e.target.value)} /></Field>
        <div className="form-grid">
          <Field label="Público"><input value={audience} maxLength={300} onChange={e=>setAudience(e.target.value)}/></Field>
          <Field label="Objetivo"><input value={objective} maxLength={150} onChange={e=>setObjective(e.target.value)}/></Field>
          <Field label="Campaña"><input value={campaign} maxLength={150} onChange={e=>setCampaign(e.target.value)}/></Field>
          <Field label="Segundos"><input type="number" min={15} max={30} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></Field>
          <Field label="Formato"><select value={ratio} onChange={e=>setRatio(e.target.value)}><option>9:16</option><option>1:1</option><option>16:9</option></select></Field>
        </div>
        <div><button className="button button-primary" disabled={busy}>Guardar brief</button></div>
      </form>}
    </div>
    {brief?<section className="card stack">
      <div className="card-header"><h2>Brief · {brief.campaign||'Sin campaña'}</h2><button className="button button-secondary" onClick={()=>setId('')}>Volver</button></div>
      <p className="crm-summary">{brief.idea}</p>
      <div className="crm-actions"><span className="badge badge-neutral">{brief.state}</span><span>{brief.durationSeconds} s · {brief.aspectRatio}</span></div>
      {brief.state==='DRAFT'&&<button className="button button-primary" disabled={busy} onClick={()=>void run('/creative/briefs/'+brief.id+'/plan',{expectedVersion:brief.version})}>Crear propuesta editorial</button>}
      {brief.plan&&<div className="stack">
        <p className="notice">Storyboard editorial sin IA. No implica servicios, cobertura ni tiempos confirmados.</p>
        <div className="crm-actions">{brief.plan.concepts.map((c,i)=><button key={c.id} className="button button-secondary" aria-pressed={chosen===i} onClick={()=>setChosen(i)}>{c.angle}</button>)}</div>
        {concept&&<div className="stack"><h3>{concept.hook}</h3>
          {concept.scenes.map(s=><details key={s.scene}><summary>Escena {s.scene} · {s.seconds} s · {s.voiceOver}</summary>
            <div className="stack"><p><strong>Narración:</strong> {s.voiceOver}</p>
              <p><strong>Visual:</strong> {s.imagePrompt}</p>
              <p><strong>Movimiento:</strong> {s.motionPrompt}</p></div>
          </details>)}
          <strong>CTA: {concept.cta}</strong>
        </div>}
        <details><summary>Validaciones comerciales</summary><ul>{brief.plan.claimChecks.map(c=><li key={c}>{c}</li>)}</ul></details>
        {brief.state==='PLANNED'&&<button className="button button-primary" disabled={busy} onClick={()=>void run('/creative/briefs/'+brief.id+'/approve',{expectedVersion:brief.version})}>Aprobar storyboard (sin render)</button>}
      </div>}
    </section>:id?<LoadStatus error={detail?.error}/>:null}
    {!id&&(briefs?.data?<section className="card stack">
      <div className="card-header"><h2>Briefs de campaña</h2><span>{briefs.data.total}</span></div>
      <div className="table-wrap"><table className="table crm-table"><thead><tr><th>Campaña</th><th>Idea</th><th>Estado</th></tr></thead>
      <tbody>{briefs.data.rows.map(b=><tr key={b.id}><td><button className="text-button" onClick={()=>{setId(b.id);setChosen(0)}}>{b.campaign||'Sin campaña'}</button></td><td>{b.idea.slice(0,90)}</td><td>{b.state}</td></tr>)}
        {!briefs.data.rows.length&&<tr><td colSpan={3}>Todavía no hay briefs.</td></tr>}</tbody></table></div>
      <Pager data={briefs.data} label="Páginas de briefs" onChange={setOffset}/>
    </section>:<LoadStatus error={briefs?.error}/>)}
  </div>;
}
