import {useState, type FormEvent} from 'react';
import {crmPath, useCrmQuery, type Contact, type Detail, type Page, type Prospect, type RunAction} from './model';
import {LoadStatus, Pager} from './detail';
import {Field} from './forms';
import HelpTip from '../HelpTip';
import {AgentPanel} from './AgentPanel';

type Thread={id:string;prospectId:string;prospectName:string;contactName:string;contactId:string;channel:string;state:string;noContact:boolean;updatedAt:string};
type Message={id:string;body:string;state:'DRAFT'|'PENDING_APPROVAL'|'APPROVED';createdAt:string;reviewedAt:string|null};
const status={DRAFT:'Borrador',PENDING_APPROVAL:'Pendiente de aprobación',APPROVED:'Aprobado · no enviado'};
const channels=['EMAIL','WHATSAPP','FACEBOOK','INSTAGRAM'] as const;

export default function OutreachPanel({revision,busy,run}:{revision:number;busy:boolean;run:RunAction}) {
  const [offset,setOffset]=useState(0),[prospectId,setProspectId]=useState(''),[contactId,setContactId]=useState('');
  const [channel,setChannel]=useState<(typeof channels)[number]>('EMAIL');
  const [threadId,setThreadId]=useState(''),[message,setMessage]=useState('');
  const threads=useCrmQuery<Page<Thread>>(crmPath('/outreach/threads',{offset}),revision);
  const prospects=useCrmQuery<Page<Prospect>>(crmPath('/prospects',{limit:100,offset:0}),revision);
  const detail=useCrmQuery<Detail>(prospectId?crmPath('/prospects/'+prospectId):null,revision);
  const messages=useCrmQuery<Page<Message>>(threadId?crmPath('/outreach/threads/'+threadId+'/messages'):null,revision);
  async function open(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!prospectId||!contactId)return;
    const result=await run('/outreach/threads',{prospectId,contactId,channel});
    if(result?.id)setThreadId(result.id);
  }
  async function draft(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!threadId||!message.trim())return;
    const result=await run('/outreach/threads/'+threadId+'/drafts',{body:message.trim()});
    if(result?.id)setMessage('');
  }
  const contact:Contact|undefined=detail?.data?.contacts.find(c=>c.id===contactId);
  return <div className="stack">
    <div className="card stack">
      <div className="card-header"><h2>Bandeja comercial</h2><HelpTip label="Alcance de la bandeja">
        Aquí solo se preparan y aprueban borradores. No hay envíos reales ni respuestas simuladas.
        Antes de conectar proveedores se verificará consentimiento, políticas por canal y baja de contactos.
      </HelpTip></div>
      <form className="crm-actions" onSubmit={event=>void open(event)}>
        <Field label="Empresa prospecto"><select value={prospectId} onChange={e=>{setProspectId(e.target.value);setContactId('');}}>
          <option value="">Seleccionar</option>{prospects?.data?.rows.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select></Field>
        <Field label="Contacto"><select aria-label="Contacto" value={contactId} onChange={e=>setContactId(e.target.value)}>
          <option value="">Seleccionar</option>{detail?.data?.contacts.map(c=><option key={c.id} value={c.id} disabled={c.noContact}>{c.name}{c.noContact?' · No contactar':''}</option>)}
        </select></Field>
        <Field label="Canal"><select value={channel} onChange={e=>setChannel(e.target.value as typeof channel)}>{channels.map(x=><option key={x} value={x}>{x}</option>)}</select></Field>
        <button type="submit" className="button button-primary" disabled={busy||!contact||contact.noContact}>Abrir conversación</button>
      </form>
      {prospects?.error&&<LoadStatus error={prospects.error}/>}
      {contact?.noContact&&<p role="alert" className="notice error">Este contacto no permite acercamientos comerciales.</p>}
    </div>
    {threads?.data?<section className="card stack">
      <div className="card-header"><h2>Conversaciones</h2><span>{threads.data.total}</span></div>
      <div className="table-wrap"><table className="table crm-table"><thead><tr><th>Empresa</th><th>Contacto</th><th>Canal</th><th>Estado</th></tr></thead>
        <tbody>{threads.data.rows.map(t=><tr key={t.id}><td><button className="text-button" type="button" onClick={()=>setThreadId(t.id)}>{t.prospectName}</button></td><td>{t.contactName}</td><td>{t.channel}</td>
          <td>{t.noContact?'No contactar':t.state==='OPEN'?'Abierta':'Cerrada'}</td></tr>)}
          {!threads.data.rows.length&&<tr><td colSpan={4}>Todavía no hay conversaciones.</td></tr>}</tbody></table></div>
      <Pager data={threads.data} label="Páginas de conversaciones" onChange={setOffset}/>
    </section>:<LoadStatus error={threads?.error}/>}
    {threadId&&<AgentPanel key={threadId} threadId={threadId} revision={revision} busy={busy} run={run}/>}
    {threadId&&<section className="card stack">
      <div className="card-header"><h2>Mensajes de trabajo</h2><button className="text-button" onClick={()=>setThreadId('')}>Cerrar vista</button></div>
      <form className="stack" onSubmit={event=>void draft(event)}>
        <Field label="Borrador del mensaje"><textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={3000} rows={3} required/></Field>
        <div><button className="button button-primary" disabled={busy||!message.trim()}>Guardar borrador</button></div>
      </form>
      {messages?.data?<div className="stack">{messages.data.rows.map(m=><article className="crm-outreach-message" key={m.id}>
        <span className="badge badge-neutral">{status[m.state]}</span>
        <p className="crm-summary">{m.body}</p>
        {m.state==='DRAFT'&&<button className="button button-secondary" disabled={busy} onClick={()=>void run('/outreach/messages/'+m.id+'/request-approval',{})}>Solicitar aprobación</button>}
        {m.state==='PENDING_APPROVAL'&&<button className="button button-primary" disabled={busy} onClick={()=>void run('/outreach/messages/'+m.id+'/approve',{})}>Aprobar (no enviar)</button>}
      </article>)}
      {!messages.data.rows.length&&<p>No hay mensajes.</p>}
      </div>:<LoadStatus error={messages?.error}/>}
    </section>}
  </div>;
}
