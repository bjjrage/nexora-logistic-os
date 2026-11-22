import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import HelpTip from '../HelpTip';
import StatCard from '../StatCard';
import { LoadStatus, Pager, ProspectDetail, TaskList } from './detail';
import { CompanyForm, Field } from './forms';
import {
  crmPath, fieldValue, initialFilters, stages, useCrmAction, useCrmQuery,
  type Dashboard, type Filters, type Options, type Page, type Prospect, type RunAction, type Stage,
} from './model';
import './crm.css';
import OutreachPanel from './OutreachPanel';

type View = 'prospects' | 'funnel' | 'tasks' | 'dashboard' | 'outreach';
const views = {prospects: 'Prospectos', funnel: 'Funnel', tasks: 'Tareas', dashboard: 'Dashboard', outreach: 'Bandeja'} as const;
const emptyOptions: Options = {owners: [], campaigns: [], sources: []};

type ImportIssue = {row: number; field: string; message: string};
type Preview = {
  previewId: string; total: number; valid: number; errors: ImportIssue[]; duplicates: ImportIssue[];
  sample: {row: number; name: string; sector: string; city: string}[];
};

function ImportCsv({busy, run, close}: {busy: boolean; run: RunAction; close: () => void}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{csv: string; plan: Preview; commandId: string}>();
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<number>();
  const sequence = useRef(0);

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    if (file.size > 2_000_000) { setError('Elegí un CSV de hasta 2 MB.'); return; }
    const attempt = ++sequence.current;
    setReviewing(true);
    setError('');
    setPreview(undefined);
    try {
      const csv = await file.text();
      const plan = await api<Preview>(crmPath('/import/preview'), {
        method: 'POST', headers: {'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os'},
        body: JSON.stringify({csv}),
      });
      if (attempt === sequence.current) setPreview({csv, plan, commandId: crypto.randomUUID()});
    } catch (failure) {
      if (attempt === sequence.current) setError((failure as Error).message);
    } finally {
      if (attempt === sequence.current) setReviewing(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    const result = await run('/import', {csv: preview.csv, previewId: preview.plan.previewId}, 'POST', preview.commandId);
    if (result?.imported !== undefined) {
      setImported(result.imported);
      setPreview(undefined);
    }
  }

  const issues = preview ? [...preview.plan.errors, ...preview.plan.duplicates].sort((x, y) => x.row - y.row) : [];
  return <section className="card stack">
    <div className="card-header"><h2>Importar prospectos</h2><HelpTip label="Formato CSV">
      Encabezados: nombre, rubro, ciudad, departamento, origen, campaña, facebook, instagram, web, teléfono, email, etiquetas, notas.
      Nombre es obligatorio. Usá | entre etiquetas y cargá solo datos obtenidos legítimamente.
    </HelpTip></div>
    <form onSubmit={inspect} className="crm-actions">
      <Field label="Archivo CSV"><input required type="file" accept=".csv,text/csv" disabled={reviewing || busy}
        onChange={event => {setFile(event.target.files?.[0] ?? null); setImported(undefined); setPreview(undefined); setError('');}}/></Field>
      <button className="button button-primary" disabled={!file || reviewing || busy}>
        {reviewing ? 'Validando…' : 'Ver vista previa'}
      </button>
      <button type="button" className="button button-secondary" onClick={close} disabled={busy || reviewing}>Cerrar importación</button>
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {imported !== undefined && <p role="status">{imported} prospectos importados.</p>}
    {preview && <div className="stack">
      <div className="crm-actions" role="status">
        <span>{preview.plan.total} filas</span><span>{preview.plan.valid} válidas</span>
        <span>{preview.plan.duplicates.length} duplicadas</span>
        <span>{new Set(preview.plan.errors.map(issue => issue.row)).size} con errores</span>
      </div>
      {preview.plan.sample.length > 0 && <div className="table-wrap"><table className="table">
        <caption>Muestra de empresas válidas</caption>
        <thead><tr><th>Fila</th><th>Empresa</th><th>Rubro</th><th>Ciudad</th></tr></thead>
        <tbody>{preview.plan.sample.map(row => <tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.sector || '—'}</td><td>{row.city || '—'}</td></tr>)}</tbody>
      </table></div>}
      {issues.length > 0 && <details><summary>Duplicados y errores por fila</summary>
        <ol className="crm-import-errors">
          {issues.map((issue, index) => <li key={index}>Fila {issue.row} · {issue.field} · {issue.message}</li>)}
        </ol>
      </details>}
      <div><button type="button" className="button button-primary" disabled={busy || !preview.plan.valid}
        onClick={() => void confirm()}>Importar {preview.plan.valid} válidas</button></div>
    </div>}
  </section>;
}

function FiltersForm({filters, options, onChange}: {
  filters: Filters; options: Options; onChange: (filters: Filters) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(Object.keys(initialFilters).map(key => [key, fieldValue(form, key)])) as Filters;
    onChange(values);
  }
  return <form className="card stack" key={JSON.stringify(filters)} onSubmit={submit}>
    <div className="form-grid crm-filter">
      <Field label="Buscar prospectos"><input type="search" name="q" maxLength={120} defaultValue={filters.q}/></Field>
      <Field label="Etapa"><select name="stage" defaultValue={filters.stage}>
        <option value="">Todas</option>
        {Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></Field>
      <Field label="Campaña"><input name="campaign" list="crm-campaigns" maxLength={150} defaultValue={filters.campaign}/></Field>
      <Field label="Origen"><input name="source" list="crm-sources" maxLength={150} defaultValue={filters.source}/></Field>
      <datalist id="crm-campaigns">{options.campaigns.map(value => <option value={value} key={value}/>)}</datalist>
      <datalist id="crm-sources">{options.sources.map(value => <option value={value} key={value}/>)}</datalist>
      <Field label="Responsable"><select name="ownerId" defaultValue={filters.ownerId}>
        <option value="">Todos</option>
        {options.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
      </select></Field>
      <div className="crm-actions">
        <button className="button button-primary">Filtrar</button>
        <button type="button" className="button button-secondary" onClick={event => {event.currentTarget.form?.reset(); onChange({...initialFilters});}}>Limpiar</button>
      </div>
    </div>
    <details open={Boolean(filters.sector || filters.city || filters.department || filters.tag) || undefined}>
      <summary>Más filtros</summary>
      <div className="form-grid">
        <Field label="Rubro"><input name="sector" maxLength={150} defaultValue={filters.sector}/></Field>
        <Field label="Ciudad"><input name="city" maxLength={150} defaultValue={filters.city}/></Field>
        <Field label="Departamento"><input name="department" maxLength={150} defaultValue={filters.department}/></Field>
        <Field label="Etiqueta"><input name="tag" maxLength={60} defaultValue={filters.tag}/></Field>
      </div>
    </details>
  </form>;
}

function Funnel({data, stage, select}: {data: Dashboard; stage: Stage | ''; select: (stage: Stage) => void}) {
  return <section className="card stack" aria-label="Tablero de etapas">
    <div className="card-header"><h2>Funnel comercial</h2><span>{data.total} prospectos</span></div>
    <div className="crm-funnel">
      {data.stages.map(item => <button type="button" className="button button-secondary" key={item.stage}
        aria-pressed={stage === item.stage} onClick={() => select(item.stage)}>
        <span>{stages[item.stage]}</span><strong>{item.total}</strong>
      </button>)}
    </div>
  </section>;
}

function ProspectTable({data, open, onPage}: {data: Page<Prospect>; open: (id: string) => void; onPage: (offset: number) => void}) {
  return <section className="card stack">
    <div className="card-header"><h2>Empresas prospecto</h2><span>{data.total} resultados</span></div>
    <div className="table-wrap"><table className="table crm-table">
      <thead><tr><th>Empresa</th><th>Rubro</th><th>Ciudad</th><th>Campaña</th><th>Etapa</th><th>Responsable</th><th>Score</th></tr></thead>
      <tbody>{data.rows.map(row => <tr key={row.id}>
        <td><button type="button" className="text-button" onClick={() => open(row.id)}>{row.name}</button></td>
        <td>{row.sector || '—'}</td><td>{row.city || '—'}</td><td>{row.campaign || '—'}</td>
        <td><span className="badge badge-neutral">{stages[row.stage]}</span></td>
        <td>{row.ownerName}</td><td>{row.score}</td>
      </tr>)}
      {data.rows.length === 0 && <tr><td colSpan={7}>Sin prospectos para estos filtros.</td></tr>}</tbody>
    </table></div>
    <Pager data={data} label="Páginas de prospectos" onChange={onPage}/>
  </section>;
}

export default function CrmPanel() {
  const [view, setView] = useState<View>('prospects');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [offset, setOffset] = useState(0);
  const [id, setId] = useState<string>();
  const [editor, setEditor] = useState<'create' | 'import'>();
  const [revision, setRevision] = useState(0);
  const {run, busy, error, clearError} = useCrmAction(() => setRevision(current => current + 1));
  const options = useCrmQuery<Options>(crmPath('/options'), revision);
  const shouldList = !id && (view === 'prospects' || view === 'funnel');
  const list = useCrmQuery<Page<Prospect>>(shouldList ? crmPath('/prospects', {...filters, offset}) : null, revision);
  const shouldDashboard = !id && (view === 'dashboard' || view === 'funnel');
  const dashboard = useCrmQuery<Dashboard>(shouldDashboard ?
    crmPath('/dashboard', {...filters, stage: view === 'funnel' ? '' : filters.stage}) : null, revision);

  const apply = (next: Filters) => {setFilters(next); setOffset(0);};
  const open = (next: string) => {setId(next); setEditor(undefined); clearError();};
  const chooseView = (tab: View, overdue = false) => {setView(tab); setOverdueOnly(overdue); setEditor(undefined); setOffset(0); clearError();};
  const available = options?.data ?? emptyOptions;

  return <div className="stack">
    {error && <p className="notice error" role="alert">{error}</p>}
    {options?.error && <LoadStatus error={options.error}/>}
    {id ? <ProspectDetail key={id} id={id} revision={revision} options={available} busy={busy} run={run}
      back={() => {setId(undefined); clearError();}} openProspect={open}/> : <>
      <div className="page-heading">
        <h1>CRM comercial</h1>
        <div className="crm-actions">
          <button type="button" className="button button-primary" onClick={() => {setEditor('create'); clearError();}}>Nuevo prospecto</button>
          <button type="button" className="button button-secondary" onClick={() => {setEditor('import'); clearError();}}>Importar CSV</button>
        </div>
      </div>
      {editor === 'create' && <CompanyForm owners={available.owners} busy={busy}
        cancel={() => setEditor(undefined)} onSave={async input => {
          const result = await run('/prospects', input);
          if (result?.id) open(result.id);
        }}/>}
      {editor === 'import' && <ImportCsv busy={busy} run={run} close={() => {setEditor(undefined); clearError();}}/>}
      <nav className="workspace-tabs" aria-label="Secciones del CRM">
        {Object.entries(views).map(([key,label]) => <button type="button" key={key} aria-pressed={view === key}
          onClick={() => chooseView(key as View)}>{label}</button>)}
      </nav>
      {view !== 'tasks' && view !== 'outreach' && <FiltersForm filters={filters} options={available} onChange={apply}/>}
      {view === 'funnel' && (dashboard?.data ? <Funnel data={dashboard.data} stage={filters.stage}
        select={stage => apply({...filters, stage: stage === filters.stage ? '' : stage})}/> : <LoadStatus error={dashboard?.error}/>)}
      {view === 'dashboard' && (dashboard?.data ? <section className="stat-grid" aria-label="Indicadores comerciales">
        <StatCard label="Prospectos" value={dashboard.data.total} caption="Ver prospectos" onClick={() => chooseView('prospects')}/>
        <StatCard label="Llegaron a conversación" value={dashboard.data.reached.CONVERSING ?? 0} caption="Ver funnel" onClick={() => chooseView('funnel')}/>
        <StatCard label="Llegaron a piloto" value={dashboard.data.reached.PILOT ?? 0} caption="Ver funnel" onClick={() => chooseView('funnel')}/>
        <StatCard label="Llegaron a activado" value={dashboard.data.reached.ACTIVATED ?? 0} caption="Ver funnel" onClick={() => chooseView('funnel')}/>
        <StatCard label="Tareas vencidas" value={dashboard.data.overdue} caption="Ver tareas vencidas" onClick={() => chooseView('tasks', true)}/>
      </section> : <LoadStatus error={dashboard?.error}/>)}
      {view === 'outreach' && <OutreachPanel revision={revision} busy={busy} run={run}/>}
       {view === 'tasks' && <TaskList key={String(overdueOnly)} initialState={overdueOnly ? 'OVERDUE' : 'OPEN'}
        revision={revision} options={available} busy={busy} run={run} openProspect={open}/>}
      {shouldList && (list?.data ? <ProspectTable data={list.data} open={open} onPage={setOffset}/> : <LoadStatus error={list?.error}/>)}
    </>}
  </div>;
}
