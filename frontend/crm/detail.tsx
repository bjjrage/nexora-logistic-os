import { useState, type FormEvent } from 'react';
import HelpTip from '../HelpTip';
import { CompanyForm, ContactForm, Field, OwnerSelect } from './forms';
import {
  activityNames, crmPath, fieldValue, formatDate, stages, useCrmQuery,
  type Detail, type Options, type Page, type RunAction, type Stage, type Task, type TimelineEntry,
} from './model';

export function Pager({data, onChange, label}: {
  data: Pick<Page<unknown>, 'total' | 'limit' | 'offset'>; onChange: (offset: number) => void; label: string;
}) {
  const {limit, offset, total} = data;
  return <nav className="pagination" aria-label={label}>
    <button type="button" className="button button-secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Anterior</button>
    <span>{total ? Math.min(offset + 1, total) : 0}–{Math.min(offset + limit, total)} de {total}</span>
    <button type="button" className="button button-secondary" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Siguiente</button>
  </nav>;
}

export function LoadStatus({error}: {error?: string}) {
  return error ? <p className="notice error" role="alert">{error}</p> : <p role="status">Cargando CRM…</p>;
}

export function TaskList({id, revision, options, busy, run, openProspect, initialState = 'OPEN'}: {
  id?: string; revision: number; options?: Options; busy: boolean; run: RunAction;
  openProspect: (id: string) => void; initialState?: 'OPEN' | 'OVERDUE';
}) {
  const [status, setStatus] = useState<string>(initialState);
  const [ownerId, setOwnerId] = useState('');
  const [offset, setOffset] = useState(0);
  const path = id ? '/prospects/' + id + '/tasks' : '/tasks';
  const feed = useCrmQuery<Page<Task>>(crmPath(path, {state: status, ownerId, offset}), revision);
  return <section className="card">
    <div className="card-header"><h2>Seguimientos</h2></div>
    <div className="crm-actions">
      <Field label="Estado de tareas"><select value={status} onChange={event => {setStatus(event.target.value); setOffset(0);}}>
        <option value="OPEN">Pendientes</option><option value="OVERDUE">Vencidas</option><option value="DONE">Completadas</option>
      </select></Field>
      {!id && <Field label="Responsable de tareas"><select value={ownerId} onChange={event => {setOwnerId(event.target.value); setOffset(0);}}>
        <option value="">Todos</option>
        {options?.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
      </select></Field>}
    </div>
    {feed?.data ? <div className="stack">
      <div className="table-wrap"><table className="table crm-table">
        <thead><tr>{!id && <th>Prospecto</th>}<th>Tarea</th><th>Responsable</th><th>Vencimiento</th><th>Estado</th></tr></thead>
        <tbody>
          {feed.data.rows.map(task => <tr key={task.id}>
            {!id && <td><button type="button" className="text-button" onClick={() => openProspect(task.prospectId)}>{task.prospectName}</button></td>}
            <td>{task.title}</td><td>{task.ownerName}</td><td>{formatDate(task.dueAt)}</td>
            <td>{task.completedAt ? 'Completada' : <span className="crm-actions">
              {task.overdue && <span className="badge badge-warning">Vencida</span>}
              <button type="button" className="button button-secondary" disabled={busy}
                onClick={() => void run('/tasks/' + task.id + '/complete', {})}
                aria-label={'Completar tarea: ' + task.title}>Completar</button>
            </span>}</td>
          </tr>)}
          {feed.data.rows.length === 0 && <tr><td colSpan={id ? 4 : 5}>Sin tareas.</td></tr>}
        </tbody>
      </table></div>
      <Pager data={feed.data} label="Páginas de seguimientos" onChange={setOffset}/>
    </div> : <LoadStatus error={feed?.error}/>}
  </section>;
}

function Timeline({id, revision}: {id: string; revision: number}) {
  const [offset, setOffset] = useState(0);
  const feed = useCrmQuery<Page<TimelineEntry>>(crmPath('/prospects/' + id + '/timeline', {offset}), revision);
  return <section className="card">
    <div className="card-header"><h2>Historial</h2></div>
    {feed?.data ? <>
      {feed.data.rows.length ? <ol className="crm-timeline">
        {feed.data.rows.map(event => <li key={event.id}>
          <strong>{event.toStage ? [event.fromStage && stages[event.fromStage], stages[event.toStage]].filter(Boolean).join(' → ') : activityNames[event.kind]}</strong>
          <span> · {event.actorName} · {formatDate(event.occurredAt)}</span>
          {event.contactName && <span> · {event.contactName}</span>}
          <div className="crm-summary">{event.detail}</div>
        </li>)}
      </ol> : <span>Sin actividad.</span>}
      <Pager data={feed.data} label="Páginas del historial" onChange={setOffset}/>
    </> : <LoadStatus error={feed?.error}/>}
  </section>;
}

function nextStages(stage: Stage) {
  if (stage === 'DISCARDED') return ['IDENTIFIED'] as Stage[];
  const ordered = Object.keys(stages).filter(key => key !== 'DISCARDED') as Stage[];
  const index = ordered.indexOf(stage);
  return [...ordered.filter((_, i) => Math.abs(i - index) === 1), 'DISCARDED'] as Stage[];
}

export function ProspectDetail({id, revision, options, busy, run, back, openProspect}: {
  id: string; revision: number; options: Options; busy: boolean; run: RunAction;
  back: () => void; openProspect: (id: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [contactEditor, setContactEditor] = useState<string | null>(null);
  const [activityKind, setActivityKind] = useState('NOTE');
  const path = '/prospects/' + id;
  const feed = useCrmQuery<Detail>(crmPath(path), revision);
  const data = feed?.data;

  const saveStage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    await run(path + '/stage', {stage: fieldValue(form, 'stage'), reason: fieldValue(form, 'reason'), expectedVersion: data.prospect.version});
  };

  const addActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget, form = new FormData(element);
    const result = await run(path + '/activities', {
      kind: activityKind, detail: fieldValue(form, 'detail'), contactId: fieldValue(form, 'contactId') || undefined,
    });
    if (result) element.reset();
  };

  const addTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget, form = new FormData(element);
    const result = await run(path + '/tasks', {
      title: fieldValue(form, 'title'), dueAt: new Date(fieldValue(form, 'dueAt')).toISOString(),
      ownerId: fieldValue(form, 'ownerId') || undefined,
    });
    if (result) element.reset();
  };

  if (!data) return <div className="stack">
    <div><button className="button button-secondary" type="button" onClick={back}>Volver al CRM</button></div>
    <LoadStatus error={feed?.error}/>
  </div>;
  const {prospect, contacts} = data;
  const currentContact = contacts.find(contact => contact.id === contactEditor);
  return <div className="stack">
    <div className="card-header">
      <div><h1>{prospect.name}</h1><span className="badge badge-neutral">Prospecto</span> <span className="badge badge-neutral">{stages[prospect.stage]}</span></div>
      <div className="crm-actions">
        <button className="button button-secondary" type="button" onClick={back}>Volver al CRM</button>
        <button className="button button-secondary" type="button" onClick={() => setEdit(value => !value)}>Editar empresa</button>
      </div>
    </div>
    {edit ? <CompanyForm key={prospect.version} prospect={prospect} owners={options.owners} busy={busy}
      cancel={() => setEdit(false)} onSave={async input => {
        if (await run(path, input, 'PUT')) setEdit(false);
      }}/> : <section className="card stack">
      <div className="crm-actions">
        {[prospect.sector, prospect.city, prospect.department, prospect.source, prospect.campaign].filter(Boolean)
          .map((value, index) => <span className="badge badge-neutral" key={index}>{value}</span>)}
        <span>Responsable: {options.owners.find(owner => owner.id === prospect.ownerId)?.name ?? 'Cuenta anterior'}</span>
        <span className="help-label">Score {prospect.score}/100 <HelpTip label="Score del prospecto">
          Rubro 15, ciudad y departamento 15, presencia digital 25, teléfono o correo de empresa 25, origen o campaña 20.
        </HelpTip></span>
      </div>
      <div className="crm-actions">
        {[prospect.phone, prospect.email, prospect.facebook, prospect.instagram, prospect.website, ...prospect.tags].filter(Boolean)
          .map((value, index) => <span key={index}>{value}</span>)}
      </div>
      {prospect.notes && <div className="crm-summary">{prospect.notes}</div>}
    </section>}
    <section className="card stack">
      <div className="card-header"><h2>Funnel</h2></div>
      <form className="form-grid crm-filter" key={prospect.version} onSubmit={saveStage}>
        <Field label="Próxima etapa"><select name="stage" required defaultValue="">
          <option value="" disabled>Elegí una etapa</option>
          {nextStages(prospect.stage).map(stage => <option key={stage} value={stage}>{stages[stage]}</option>)}
        </select></Field>
        <Field label="Motivo del cambio"><input name="reason" required maxLength={500}/></Field>
        <div><button className="button button-primary" disabled={busy}>Cambiar etapa</button></div>
      </form>
    </section>
    <section className="card stack">
      <div className="card-header"><h2>Contactos</h2>
        <button type="button" className="button button-secondary" onClick={() => setContactEditor('new')}>Nuevo contacto</button>
      </div>
      <div className="table-wrap"><table className="table crm-table">
        <thead><tr><th>Nombre</th><th>Cargo</th><th>Canales</th><th>Estado</th><th>Acción</th></tr></thead>
        <tbody>{contacts.map(contact => <tr key={contact.id}>
          <td>{contact.name}</td><td>{contact.jobTitle || '—'}</td>
          <td className="crm-summary">{[contact.phone,contact.email,contact.facebook,contact.instagram].filter(Boolean).join(' · ') || '—'}</td>
          <td>{contact.noContact ? <span className="badge badge-warning">No contactar</span> : 'Permitido'}</td>
          <td><button type="button" className="text-button" aria-label={'Editar contacto: ' + contact.name}
            onClick={() => setContactEditor(contact.id)}>Editar</button></td>
        </tr>)}
        {!contacts.length && <tr><td colSpan={5}>Sin contactos.</td></tr>}</tbody>
      </table></div>
      {contactEditor && <ContactForm key={contactEditor} contact={currentContact} busy={busy}
        cancel={() => setContactEditor(null)} onSave={async input => {
          const url = path + '/contacts' + (currentContact ? '/' + currentContact.id : '');
          if (await run(url, input, currentContact ? 'PUT' : 'POST')) setContactEditor(null);
        }}/>}
    </section>
    <section className="card stack">
      <div className="card-header"><h2>Registrar actividad</h2></div>
      <form className="form-grid crm-filter" onSubmit={addActivity}>
        <Field label="Tipo de actividad"><select value={activityKind} onChange={event => setActivityKind(event.target.value)}>
          {['NOTE', 'CALL', 'MEETING', 'MESSAGE'].map(kind => <option key={kind} value={kind}>{activityNames[kind]}</option>)}
        </select></Field>
        <Field label="Contacto de la actividad"><select name="contactId" required={activityKind !== 'NOTE'} defaultValue="">
          <option value="">Sin contacto</option>
          {contacts.map(contact => <option key={contact.id} value={contact.id} disabled={contact.noContact && activityKind !== 'NOTE'}>
            {contact.name}{contact.noContact ? ' · No contactar' : ''}
          </option>)}
        </select></Field>
        <Field label="Detalle de actividad"><input name="detail" required maxLength={3000}/></Field>
        <div><button className="button button-primary" disabled={busy}>Registrar actividad</button></div>
      </form>
    </section>
    <section className="card stack">
      <div className="card-header"><h2>Próxima acción</h2></div>
      <form className="form-grid crm-filter" onSubmit={addTask}>
        <Field label="Tarea"><input name="title" required maxLength={300}/></Field>
        <Field label="Vencimiento"><input name="dueAt" type="datetime-local" required/></Field>
        <Field label="Responsable de la tarea"><OwnerSelect owners={options.owners} placeholder="Mi usuario"/></Field>
        <div><button className="button button-primary" disabled={busy}>Crear tarea</button></div>
      </form>
    </section>
    <TaskList id={id} options={options} revision={revision} busy={busy} run={run} openProspect={openProspect}/>
    <Timeline id={id} revision={revision}/>
  </div>;
}
