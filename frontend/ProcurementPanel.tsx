import {lazy,Suspense,useId,useState,type FormEvent,type ReactNode} from 'react';
import {Download,Plus,RefreshCw,Settings,Upload} from 'lucide-react';
import HelpTip from './HelpTip';
import ProcurementSemester,{type SemesterReport} from './ProcurementSemester';
import StatCard from './StatCard';
import {ApplyForm,BudgetForm,CatalogForm,CorrectionForm,documentCommand,DocumentFields,Form,Modal,MovementForm,PartyForm,settlementCommand,SettlementFields} from './ProcurementForms';
import {accountLabel,base,Feedback,field,fileBase64,label,money,Pagination,query,settlementLabel,size,Status,Table,today,useCommand,useLookups,useProcurement,
  type Account,type Budget,type Command,type CommandResult,type Document,type Lookups,type Movement,type Page,type Party,type Settlement} from './procurement-ui';
import {DetailDrawer,DocumentTable,MovementTable,PartyTable,SettlementTable} from './ProcurementDetails';
import './procurement.css';

import type {WorkbookBatch} from './ProcurementImport';

const ProcurementImport=lazy(()=>import('./ProcurementImport'));
const ImportRowDialog=lazy(()=>import('./ProcurementImport').then(module=>({default:module.ImportRowDialog})));
const tabs={overview:'Resumen',parties:'Proveedores',documents:'Compras y gastos',settlements:'Pagos y anticipos',payables:'Cuentas por pagar',reports:'Reportes y presupuesto'} as const;
type Tab=keyof typeof tabs;
export type Screen=Tab|'settings'|'import';
export type Detail={collection:'parties'|'documents'|'settlements'|'accounts'|'movements';id:string};
const reportViews={expenses:'Gastos',monthly:'Resumen mensual',semester:'Resumen Jul–Dic',payments:'Pagos',payables:'Pendientes',overdue:'Vencidas',advances:'Anticipos disponibles',assets:'Activos',movements:'Movimientos de cuentas',budgets:'Presupuesto y ejecución'} as const;
type ReportView=keyof typeof reportViews;
type Report=Page<Document|Settlement|Movement|Budget>&{totalPyg:number;count:number;budgetTotalPyg?:number|null;budgetCount?:number};
type RegisterEntry={id:string;batchId:string|null;origin:'MANUAL'|'IMPORTED';date:string|null;partyId:string|null;partyName:string|null;
  categoryName:string|null;centerName:string|null;reference:string|null;description:string|null;state:string;totalPyg:number|null;
  balancePyg:number|null;paidPyg:number|null;dueDate:string|null};
type RegisterPage=Page<RegisterEntry>&{totals:{count:number;totalPyg:number;vatPyg:number;netPyg:number;incompleteBreakdown:number}};
type MonthlyTotals=RegisterPage['totals']&{month:string};
export type Filters={q?:string;from?:string;to?:string;partyId?:string;categoryId?:string;centerId?:string;nature?:string;state?:string;accountId?:string;kind?:string;month?:string};
export type Open=(collection:Detail['collection'],id:string)=>void;
type Correction='UNAPPLY'|'VOID_DOCUMENT'|'REVERSE_SETTLEMENT'|'REVERSE_MOVEMENT';
export type Editor =
  | {kind:'party';party?:Party}
  | {kind:'document';pay:boolean;partyId?:string}
  | {kind:'settlement';settlementKind:Settlement['kind'];document?:Document;partyId?:string}
  | {kind:'apply';settlement:Settlement}
  | {kind:'correction';action:Correction;id:string;minDate?:string}
  | {kind:'catalog';catalog:'ACCOUNT'|'CATEGORY'|'CENTER'}
  | {kind:'movement';account:Account}
  | {kind:'budget';budget?:Budget}
  | {kind:'attachment';detail:Detail};
const headings:Record<Correction,string>={UNAPPLY:'Deshacer aplicación',VOID_DOCUMENT:'Anular documento',REVERSE_SETTLEMENT:'Revertir pago o crédito',REVERSE_MOVEMENT:'Revertir movimiento'};
const consequence:Record<Correction,string>={UNAPPLY:'Se restablecen el saldo pendiente y el disponible de la aplicación.',VOID_DOCUMENT:'El documento anulado deja de generar saldo pendiente.',REVERSE_SETTLEMENT:'Se deshacen sus aplicaciones y se revierte la salida vinculada cuando corresponda.',REVERSE_MOVEMENT:'Se registra el contramovimiento. Una transferencia se revierte en ambas cuentas.'};
const fileTypes=['application/pdf','image/jpeg','image/png','image/webp'];

export default function ProcurementPanel() {
  const [initialLink]=useState(()=>new URLSearchParams(location.search));
  const budgetLink=initialLink.get('vista')==='presupuesto';
  const semesterLink=initialLink.get('vista')==='jul-dic';
  const [screen,setScreen]=useState<Screen>(()=>budgetLink||semesterLink?'reports':'overview');
  const [filter,setFilter]=useState<Filters>({});
  const [page,setPage]=useState(0);
  const [view,setView]=useState<ReportView>(()=>budgetLink?'budgets':semesterLink?'semester':'expenses');
  const [semesterYear,setSemesterYear]=useState(()=>{
    const year=initialLink.get('anio')??'';
    return /^(19\d{2}|[2-9]\d{3})$/.test(year)?year:today().slice(0,4);
  });
  const [detail,setDetail]=useState<Detail>();
  const [editor,setEditor]=useState<Editor>();
  const [revision,refresh]=useState(0);
  const [catalogRevision,refreshCatalog]=useState(0);
  const [notice,setNotice]=useState('');
  const [reportOpen,setReportOpen]=useState(true);
  const [importRow,setImportRow]=useState<{batchId:string;id:string}>();
  const command=useCommand();
  const lookup=useLookups(catalogRevision);
  const params=query({...filter,limit:size,offset:page*size});
  const reportParams=query({...filter,view,limit:size,offset:page*size});
  const activeWorkbook=useProcurement<{batch:WorkbookBatch|null}>(screen==='import'?'/imports/active':null,revision);
  const inOperation=screen!=='overview'&&screen!=='settings'&&screen!=='import';
  const registerView=screen==='overview'||screen==='reports'?'expenses':'documents';
  const useRegister=screen==='overview'||screen==='documents'||screen==='reports'&&view==='expenses';
  const registerParams=query({...filter,view:registerView,limit:size,offset:page*size});
  const register=useProcurement<RegisterPage>(useRegister?'/register?'+registerParams:null,revision);
  const budgetReport=screen==='reports'&&view==='budgets';
  const monthlyReport=screen==='reports'&&view==='monthly';
  const semesterReport=screen==='reports'&&view==='semester';
  const list=useProcurement<Page<Party|Document|Settlement>>(inOperation&&screen!=='reports'&&screen!=='documents'?'/'+screen+'?'+params:null,revision);
  const report=useProcurement<Report>(screen==='reports'&&!useRegister&&!monthlyReport&&!semesterReport?(budgetReport?'/register/budget?'+params:'/reports?'+reportParams):null,revision);
  const monthly=useProcurement<Page<MonthlyTotals>>(monthlyReport?'/register/monthly?'+params:null,revision);
  const semester=useProcurement<SemesterReport>(semesterReport?'/register/semester?'+query({year:semesterYear}):null,revision);
  const settingsAccounts=useProcurement<Page<Account>>(screen==='settings'?'/accounts?'+query({limit:size,offset:page*size}):null,revision);
  const detailQuery=useProcurement<Party|Document|Settlement|Account|Movement>(detail?'/'+detail.collection+'/'+detail.id:null,revision);
  const lookups=lookup.data;
  const hasParty=Boolean(lookups?.parties.some(p=>p.active));
  const disableCash=!hasParty||!lookups?.accounts.length;
  const open:Open=(collection,id)=>setDetail({collection,id});

  function go(next:Screen,filters:Filters={}) {
    setScreen(next);setFilter(filters);setPage(0);setDetail(undefined);setNotice('');
  }
  function selectReport(next:ReportView) {
    setView(next);setDetail(undefined);setPage(0);setReportOpen(true);
    setFilter(({state:_state,kind:_kind,accountId:_accountId,...rest})=>rest);
  }
  function setFilters(next:Filters) {setFilter(next);setPage(0);setDetail(undefined);}
  function showEditor(value:Editor) {command.setError('');setNotice('');setEditor(value);}
  function retry() {refresh(n=>n+1);refreshCatalog(n=>n+1);}
  function onSaved(text:string) {
    setEditor(undefined);setNotice(text);refresh(n=>n+1);
  }
  async function save(payload:Command) {
    const result=await command.run<CommandResult>('/commands',payload);
    if(!result)return;
    onSaved('Registro guardado.');
    if(['PARTY','CATEGORY','CENTER','ACCOUNT'].includes(payload.action))refreshCatalog(n=>n+1);
    if(payload.action==='DOCUMENT'&&screen==='documents')open('documents',result.id);
    if(payload.action==='SETTLEMENT'&&screen==='settlements')open('settlements',result.id);
  }
  async function attach(collection:Detail['collection'],id:string,form:FormData) {
    const file=form.get('attachment');
    if(!(file instanceof File)||!fileTypes.includes(file.type))throw new Error('Seleccioná un PDF o una imagen JPG, PNG o WebP.');
    const dataBase64=await fileBase64(file,5*1024*1024);
    const result=await command.run<CommandResult>('/'+collection+'/'+id+'/attachments',{filename:file.name,mimeType:file.type,dataBase64});
    if(result)onSaved('Comprobante adjuntado.');
  }
  function budgetDetail(budget:Budget) {
    const {q:_q,...executionFilters}=filter;
    setFilters({...executionFilters,categoryId:budget.categoryId??'unclassified',month:budget.month});
    setView('expenses');setReportOpen(true);
  }
  function openEntry(entry:RegisterEntry) {
    if(entry.batchId)setImportRow({batchId:entry.batchId,id:entry.id});
    else open('documents',entry.id);
  }
  const exportUrl=base+(useRegister?'/register.csv?'+registerParams:budgetReport?'/register/budget.csv?'+params:monthlyReport?'/register/monthly.csv?'+params:
    '/export.csv?'+query({...filter,view:screen==='reports'?view:'payables'}));
  return <section className="procurement">
    <header className="page-heading procurement-heading">
      <h1>Proveedores y Gastos</h1>
      <div className="heading-actions">
        <button type="button" className="button button-secondary" onClick={()=>go(screen==='import'?'overview':'import')} aria-pressed={screen==='import'}><Upload aria-hidden="true"/> Importar Excel</button>
        <button type="button" className="button button-secondary" onClick={()=>go(screen==='settings'?'parties':'settings')} aria-pressed={screen==='settings'}><Settings aria-hidden="true"/> Configuración</button>
      </div>
    </header>
    <nav aria-label="Proveedores y Gastos" className="procurement-tabs">
      {(Object.keys(tabs) as Tab[]).map(tab=><button key={tab} className={'button '+(screen===tab?'button-primary':'button-secondary')}
        type="button" aria-current={screen===tab?'page':undefined} onClick={()=>go(tab)}>{tabs[tab]}</button>)}
    </nav>
    <Feedback error={lookup.error} retry={retry}/>
    {notice&&<p className="notice success" role="status">{notice}</p>}
    {screen==='import'&&<Suspense fallback={<p role="status">Cargando datos…</p>}>
      <ProcurementImport activeWorkbook={activeWorkbook} lookups={lookups} revision={revision} onChange={retry}
        onOpenOperation={(collection,id)=>{go(collection);open(collection,id);}}/>
    </Suspense>}
    {inOperation&&<>
      <div className="procurement-tools">
        <div className="heading-actions">
          {screen==='parties'&&<Action onClick={()=>showEditor({kind:'party'})}>Nuevo proveedor</Action>}
          {screen==='documents'&&<>
            <Action disabled={!hasParty} onClick={()=>showEditor({kind:'document',pay:false})}>Registrar operación</Action>
            <Action secondary disabled={disableCash} onClick={()=>showEditor({kind:'document',pay:true})}>Registrar y pagar</Action>
          </>}
          {screen==='settlements'&&<>
            <Action disabled={disableCash} onClick={()=>showEditor({kind:'settlement',settlementKind:'PAYMENT'})}>Registrar pago</Action>
            <Action secondary disabled={disableCash} onClick={()=>showEditor({kind:'settlement',settlementKind:'ADVANCE'})}>Registrar anticipo</Action>
            <Action secondary disabled={!hasParty} onClick={()=>showEditor({kind:'settlement',settlementKind:'CREDIT'})}>Registrar nota de crédito</Action>
          </>}
          {screen==='reports'&&view==='budgets'&&<Action disabled={!lookups?.categories.length} onClick={()=>showEditor({kind:'budget'})}>Definir presupuesto</Action>}
        </div>
        <div className="heading-actions">
          {(screen==='documents'||screen==='payables'||screen==='reports'&&!semesterReport)&&<a className="button button-secondary" href={exportUrl} download><Download aria-hidden="true"/> Exportar CSV</a>}
          <button type="button" className="button button-secondary procurement-refresh" onClick={retry} aria-label="Actualizar"><RefreshCw aria-hidden="true"/></button>
        </div>
      </div>
      {lookups&&screen==='documents'&&!hasParty&&<button className="text-button procurement-start" type="button" onClick={()=>go('parties')}>Dar de alta un proveedor</button>}
      {lookups&&(screen==='documents'||screen==='settlements')&&!lookups.accounts.length&&<button className="text-button procurement-start" type="button" onClick={()=>go('settings')}>Configurar cuenta de origen</button>}
      {screen==='reports'&&<div className="field procurement-report-select"><label htmlFor="procurement-report">Reporte</label>
        <select id="procurement-report" value={view} onChange={e=>selectReport(e.target.value as ReportView)}>
          {(Object.keys(reportViews) as ReportView[]).map(value=><option key={value} value={value}>{reportViews[value]}</option>)}
        </select>
      </div>}
      {semesterReport?<form className="procurement-search" key={semesterYear} onSubmit={event=>{
        event.preventDefault();setSemesterYear(field(new FormData(event.currentTarget),'year'));
      }}>
        <label className="field">Año<input name="year" type="number" min={1900} max={9999} step={1} required defaultValue={semesterYear}/></label>
        <button type="submit" className="button button-secondary">Consultar</button>
      </form>:<FilterForm key={screen+'|'+view+'|'+JSON.stringify(filter)} applied={filter} screen={screen} view={view} lookups={lookups} change={setFilters}/>}
      {screen==='reports'&&report.data&&<div className="stat-grid procurement-stats">
        <StatCard label={view==='budgets'?'Ejecución · PYG con IVA':reportViews[view]} value={money(report.data.totalPyg)}
          caption={reportOpen?'Ocultar desglose':'Ver operaciones'} aria-expanded={reportOpen} aria-controls="procurement-report-rows" onClick={()=>setReportOpen(s=>!s)}/>
        {view==='budgets'&&<StatCard label="Presupuesto definido" value={report.data.budgetCount?money(report.data.budgetTotalPyg):'Sin definir'}
          caption={reportOpen?'Ocultar desglose':'Ver categorías'} aria-expanded={reportOpen} aria-controls="procurement-report-rows" onClick={()=>setReportOpen(s=>!s)}/>}
      </div>}
    </>}
    <div className={'procurement-layout'+(detail?' with-detail':'')}>
      <div className="procurement-list">
        {useRegister&&<section className="card">
          {screen==='overview'&&<div className="card-header"><h2>Resumen de gastos</h2>
            <button type="button" className="button button-secondary" onClick={()=>{go('reports');setView('expenses');}}>Ver reportes</button></div>}
          <Feedback loading={register.loading} error={register.error} retry={retry}/>
          {register.data&&<>
            {screen!=='documents'&&<RegisterKpis totals={register.data.totals} onOpen={()=>go('documents',filter)}/>}
            {register.data.items.length>0?<RegisterTable rows={register.data.items} open={openEntry} openParty={id=>open('parties',id)}/>:
              <p className="empty-state">{Object.keys(filter).length?'Sin resultados para estos filtros.':'Sin compras ni gastos.'}</p>}
            <Pagination page={page} hasMore={register.data.hasMore} change={setPage}/>
          </>}
        </section>}
        {screen==='settings'&&<SettingsView accounts={settingsAccounts} lookups={lookups} page={page} changePage={setPage} open={open} edit={showEditor} retry={retry}/>}
        {semesterReport&&<div className="procurement-semester">
          <Feedback loading={semester.loading} error={semester.error} retry={retry}/>
          {semester.data&&<ProcurementSemester report={semester.data}
            onOpen={()=>go('documents',{from:semesterYear+'-07-01',to:semesterYear+'-12-31'})}
            onMonth={month=>{setFilters({month});setView('expenses');}}/>}
        </div>}
        {monthlyReport&&<section className="card">
          <Feedback loading={monthly.loading} error={monthly.error} retry={retry}/>
          {monthly.data&&<>
            {monthly.data.items.length?<Table heads={['Mes','Registros','Gastos con IVA','IVA incluido','Neto sin IVA','Acción']}>
              {monthly.data.items.map(row=><tr key={row.month}><th scope="row">{row.month||'Sin fecha'}</th><td>{row.count}</td>
                <td>{money(row.totalPyg)}</td><td>{money(row.incompleteBreakdown?null:row.vatPyg)}</td><td>{money(row.incompleteBreakdown?null:row.netPyg)}</td>
                <td>{row.month&&<button type="button" className="text-button" onClick={()=>{
                  setFilters({...filter,month:row.month});setView('expenses');
                }}>Ver gastos</button>}</td>
              </tr>)}</Table>:<p className="empty-state">Sin resultados para estos filtros.</p>}
            <Pagination page={page} hasMore={monthly.data.hasMore} change={setPage}/>
          </>}
        </section>}
        {inOperation&&screen!=='reports'&&!useRegister&&<>
          <Feedback loading={list.loading} error={list.error} retry={retry}/>
          {list.data&&<section className="card">
            {!list.data.items.length?<p className="empty-state">{Object.keys(filter).length?'Sin resultados para estos filtros.':screen==='parties'?'Sin proveedores o beneficiarios.':screen==='settlements'?'Sin pagos, anticipos ni créditos.':'Sin obligaciones pendientes.'}</p>:
              screen==='parties'?<PartyTable rows={list.data.items as Party[]} open={open}/>:
              screen==='settlements'?<SettlementTable rows={list.data.items as Settlement[]} open={open}/>:
              <DocumentTable rows={list.data.items as Document[]} open={open}/>}
            <Pagination page={page} hasMore={list.data.hasMore} change={setPage}/>
          </section>}
        </>}
        {inOperation&&screen==='reports'&&!useRegister&&!monthlyReport&&!semesterReport&&<section id="procurement-report-rows" hidden={!reportOpen} className="card">
          <Feedback loading={report.loading} error={report.error} retry={retry}/>
          {report.data&&<>
            <div className="help-label procurement-subhead"><span>{reportCriterion(view)}</span>
              <HelpTip label="Criterio del reporte">{reportHelp(view)}</HelpTip></div>
            {report.data.items.length>0?<ReportTable view={view} items={report.data.items} open={open} budgetDetail={budgetDetail} edit={showEditor}/>:
              <p className="empty-state">Sin operaciones para este criterio.</p>}
            <Pagination page={page} hasMore={report.data.hasMore} change={setPage}/>
          </>}
        </section>}
      </div>
      {detail&&<DetailDrawer key={detail.collection+detail.id} detail={detail} result={detailQuery} close={()=>setDetail(undefined)} retry={retry} open={open}
        edit={showEditor} canCash={Boolean(lookups?.accounts.length)} go={go} showAccountMovements={accountId=>{
          go('reports',{accountId});setView('movements');setReportOpen(true);
        }}/>}
    </div>
    {importRow&&<Suspense fallback={<p role="status">Cargando datos…</p>}>
      <ImportRowDialog {...importRow} lookups={lookups} onClose={()=>setImportRow(undefined)} onOpenOperation={open}
        onResolved={text=>{setImportRow(undefined);setPage(0);setNotice(text);retry();}}/>
    </Suspense>}
    {editor&&<Modal title={editorTitle(editor)} busy={command.busy} onClose={()=>setEditor(undefined)}>
      <Feedback error={command.error}/>
      <EditorForm editor={editor} lookups={lookups} busy={command.busy} revision={revision} save={save} attach={attach} month={filter.month}/>
    </Modal>}
  </section>;
}


function Action({children,onClick,disabled,secondary}:{children:ReactNode;onClick:()=>void;disabled?:boolean;secondary?:boolean}) {
  return <button type="button" className={'button '+(secondary?'button-secondary':'button-primary')} disabled={disabled} onClick={onClick}><Plus aria-hidden="true"/>{children}</button>;
}
function RegisterKpis({totals,onOpen}:{totals:RegisterPage['totals'];onOpen:()=>void}) {
  return <section className="procurement-workbook-kpis" aria-label="Indicadores de gastos">
    <div className="stat-grid procurement-kpi-grid">
      <StatCard label="Gastos con IVA" value={money(totals.totalPyg)} caption="Ver registro" onClick={onOpen}/>
      <StatCard label="IVA incluido" value={money(totals.incompleteBreakdown?null:totals.vatPyg)}
        caption={totals.incompleteBreakdown?'Desglose incompleto':'Ver registro'} onClick={onOpen}/>
      <StatCard label="Neto sin IVA" value={money(totals.incompleteBreakdown?null:totals.netPyg)}
        caption={totals.incompleteBreakdown?'Desglose incompleto':'Ver registro'} onClick={onOpen}/>
      <StatCard label="Registros" value={totals.count} caption="Ver registro" onClick={onOpen}/>
    </div>
  </section>;
}
function RegisterTable({rows,open,openParty}:{rows:RegisterEntry[];open:(row:RegisterEntry)=>void;openParty:(id:string)=>void}) {
  const wide='procurement-workbook-wide';
  function supplier(row:RegisterEntry) {
    return row.partyId?<button type="button" className="text-button" aria-label={'Ver proveedor '+row.partyName}
      onClick={()=>openParty(row.partyId!)}>{row.partyName}</button>:row.partyName??'Sin proveedor';
  }
  return <Table className="procurement-workbook-table" heads={['Fecha','Proveedor','Concepto','Categoría','Total','Pagado','Saldo','Vencimiento','Estado','Origen','Acción']}
    columnClasses={[wide,wide,'',wide,'',wide,wide,wide,wide,wide,'']}>
    {rows.map(row=>{
      const origin=row.origin==='IMPORTED'?'Importación':'Carga manual';
      const title=row.description??row.reference??'Sin concepto';
      return <tr key={row.id}>
        <td className={wide}>{row.date??'—'}</td><td className={wide}>{supplier(row)}</td>
        <td><span className="procurement-workbook-concept">{title}</span>{row.reference&&row.description&&<small>{row.reference}</small>}
          <div className="procurement-mobile-meta"><small>{row.date??'—'} · {origin}</small><small>{supplier(row)}</small><Status state={row.state}/></div></td>
        <td className={wide}>{row.categoryName??'Sin clasificar'}</td>
        <td className="procurement-nowrap">{money(row.totalPyg)}</td><td className={wide}>{money(row.paidPyg)}</td>
        <td className={wide}>{money(row.balancePyg)}</td><td className={wide}>{row.dueDate??'—'}</td>
        <td className={wide}><Status state={row.state}/></td><td className={wide}>{origin}</td>
        <td><button className="text-button" type="button" onClick={()=>open(row)} aria-label={row.batchId?'Ver movimiento '+title:'Abrir documento '+(row.reference||title)}>
          {row.batchId?'Ver':'Abrir'}</button></td>
      </tr>;
    })}
  </Table>;
}
function FilterForm({applied,screen,view,lookups,change}:{applied:Filters;screen:Exclude<Screen,'settings'|'import'|'overview'>;view:ReportView;lookups?:Lookups;change:(values:Filters)=>void}) {
  const filterId=useId();
  const [showAll,setShowAll]=useState(Object.keys(applied).some(key=>key!=='q'));
  const parties=screen==='parties';
  const reports=screen==='reports';
  const movements=reports&&view==='movements';
  const settlement=screen==='settlements'||reports&&(view==='payments'||view==='advances'||view==='movements');
  const states=parties?['ACTIVE','INACTIVE']:settlement?['AVAILABLE','APPLIED','REVERSED']:['OPEN','PARTIAL','PAID','OVERDUE','VOID'];
  if(screen==='documents'||reports&&['expenses','budgets','monthly'].includes(view))states.push('REVIEW');
  const stateLabel=(state:string)=>state==='ACTIVE'?'Activo':state==='INACTIVE'?'Inactivo':label(state);
  const combo=(name:keyof Filters,caption:string,options:Array<[string,string]>)=><div className="field"><label htmlFor={filterId+name}>{caption}</label>
    <select id={filterId+name} name={name} defaultValue={applied[name]??''}><option value="">Todos</option>{options.map(([value,title])=><option value={value} key={value}>{title}</option>)}</select>
  </div>;
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    change(Object.fromEntries(Array.from(data.keys()).filter(key=>field(data,key)).map(key=>[key,field(data,key)])));
  };
  return <form className="procurement-filters" aria-label="Filtrar registros" onSubmit={submit}>
    <div className="procurement-search">
      <label className="field">Buscar<input type="search" name="q" maxLength={200} defaultValue={applied.q??''} placeholder={parties?'Nombre o RUC':screen==='documents'?'Proveedor, RUC, concepto o comprobante':'Buscar registros'}/></label>
      <div className="heading-actions">
        <button type="submit" className="button button-secondary">Consultar</button>
        <button type="button" className="text-button" aria-controls="procurement-filters-extra" aria-expanded={showAll} onClick={()=>setShowAll(value=>!value)}>Filtros</button>
        {Object.keys(applied).length>0&&<button type="button" className="text-button" onClick={()=>change({})}>Limpiar</button>}
      </div>
    </div>
    <div className="procurement-fields procurement-filter-more" id="procurement-filters-extra" hidden={!showAll}>
      {!parties&&<>
        <label className="field">Desde<input name="from" type="date" defaultValue={applied.from}/></label>
        <label className="field">Hasta<input name="to" type="date" defaultValue={applied.to}/></label>
        {reports&&<label className="field">Mes<input name="month" type="month" defaultValue={applied.month}/></label>}
        {combo('partyId','Proveedor',(lookups?.parties??[]).map(p=>[p.id,p.name]))}
        {combo('categoryId','Categoría',[['unclassified','Sin clasificar'],...(lookups?.categories??[]).map(c=>[c.id,c.name] as [string,string])])}
        {combo('centerId','Centro de costo',(lookups?.centers??[]).map(c=>[c.id,c.name]))}
        {combo('nature','Naturaleza',['EXPENSE','PURCHASE','ASSET','REMUNERATION'].map(k=>[k,label(k)]))}
      </>}
      {combo('state',movements?'Estado del pago':'Estado',states.map(k=>[k,stateLabel(k)]))}
      {settlement&&combo('accountId','Cuenta',(lookups?.accounts??[]).map(a=>[a.id,a.name]))}
      {screen==='settlements'&&combo('kind','Tipo',['PAYMENT','ADVANCE','CREDIT'].map(k=>[k,settlementLabel(k)]))}
      {movements&&combo('kind','Tipo',['OPENING','ENTRY','EXIT','TRANSFER','REVERSAL'].map(k=>[k,label(k)]))}
      {parties&&combo('kind','Tipo',['SUPPLIER','BENEFICIARY'].map(k=>[k,label(k)]))}
    </div>
  </form>;
}
function ReportTable({view,items,open,edit,budgetDetail}:{view:ReportView;items:Report['items'];open:Open;edit:(editor:Editor)=>void;budgetDetail:(item:Budget)=>void}) {
  if(view==='payments'||view==='advances')return <SettlementTable rows={items as Settlement[]} open={open}/>;
  if(view==='movements')return <MovementTable rows={items as Movement[]} open={open}/>;
  if(view!=='budgets')return <DocumentTable rows={items as Document[]} open={open}/>;
  return <Table heads={['Mes','Categoría','Presupuesto','Ejecución','Disponible','Acciones']}>{(items as Budget[]).map(item=><tr key={(item.categoryId??'unclassified')+item.month}>
    <td>{item.month}</td><td>{item.categoryName??'Sin clasificar'}</td><td>{item.budgetPyg===null?'Sin definir':money(item.budgetPyg)}</td>
    <td>{money(item.executedPyg)}</td><td>{money(item.remainingPyg)}</td>
    <td><div className="heading-actions"><button type="button" className="text-button" onClick={()=>budgetDetail(item)}>Ver gastos</button>
      {item.categoryId&&<button type="button" className="text-button" onClick={()=>edit({kind:'budget',budget:item})}>Editar</button>}</div></td>
  </tr>)}</Table>;
}
function reportCriterion(view:ReportView) {
  if(view==='budgets'||view==='expenses')return 'Fecha del documento · PYG con IVA incluido';
  if(view==='payments')return 'Fecha del pago · PYG';
  if(view==='movements')return 'Fecha del movimiento · PYG';
  if(view==='advances')return 'Fecha del anticipo · PYG disponible';
  if(view==='payables'||view==='overdue')return 'Fecha del documento · Saldo PYG';
  return 'Fecha del documento · PYG';
}
function reportHelp(view:ReportView) {
  if(view==='budgets'||view==='expenses')return 'Compras, gastos y remuneraciones confirmadas. Los activos, anticipos, aperturas y transferencias quedan fuera del gasto corriente.';
  if(view==='payments'||view==='movements'||view==='advances')return 'Los filtros de clasificación consultan los documentos con aplicaciones vigentes. Cada fila muestra el importe íntegro de la operación.';
  if(view==='payables'||view==='overdue')return 'Saldo de documentos confirmados después de pagos, anticipos y notas de crédito. El vencimiento se calcula por la fecha de la organización.';
  return 'Compras de activos confirmadas.';
}
function SettingsView({accounts,lookups,page,changePage,open,edit,retry}:{accounts:{data?:Page<Account>;loading:boolean;error?:string};lookups?:Lookups;page:number;changePage:(n:number)=>void;open:Open;edit:(editor:Editor)=>void;retry:()=>void}) {
  return <section className="procurement-settings">
    <div className="card"><div className="card-header"><div className="help-label"><h2>Cajas y bancos</h2><HelpTip label="Saldos de cuentas">El saldo se calcula con la apertura definida y los movimientos guardados en el OS. La conciliación bancaria se realiza aparte.</HelpTip></div>
      <Action onClick={()=>edit({kind:'catalog',catalog:'ACCOUNT'})}>Nueva cuenta</Action>
    </div>
      <Feedback loading={accounts.loading} error={accounts.error} retry={retry}/>
      {accounts.data&&<>{accounts.data.items.length?<Table heads={['Cuenta','Tipo','Apertura','Movimientos','Saldo según registro','Acción']}>
        {accounts.data.items.map(account=><tr key={account.id}><td><strong>{account.name}</strong></td><td>{accountLabel(account.kind)}</td>
          <td>{account.hasOpening?money(account.openingPyg):'Sin apertura'}</td><td>{money(account.movementPyg)}</td>
          <td>{account.hasOpening?money(account.signedTotalPyg):'—'}</td>
          <td><button className="text-button" type="button" onClick={()=>open('accounts',account.id)} aria-label={'Abrir cuenta '+account.name}>Abrir</button></td>
        </tr>)}
      </Table>:<p className="empty-state">Sin cuentas.</p>}
      <Pagination page={page} hasMore={accounts.data.hasMore} change={changePage}/></>}
    </div>
    <div className="procurement-config-grid">
      {([['CATEGORY','Categorías','Nueva categoría','categories'],['CENTER','Centros de costo','Nuevo centro','centers']] as const).map(([catalog,title,action,source])=><section className="card" key={catalog}>
        <div className="card-header"><h2>{title}</h2><Action secondary onClick={()=>edit({kind:'catalog',catalog})}>{action}</Action></div>
        {!lookups?<p role="status">Cargando…</p>:lookups[source].length?<ul className="procurement-name-list">{lookups[source].map(item=><li key={item.id}>{item.name}</li>)}</ul>:<p className="empty-state">Sin registros.</p>}
      </section>)}
    </div>
  </section>;
}
function editorTitle(editor:Editor) {
  switch(editor.kind){
    case 'party':return editor.party?'Editar proveedor o beneficiario':'Nuevo proveedor o beneficiario';
    case 'document':return editor.pay?'Registrar y pagar':'Registrar operación';
    case 'settlement':return 'Registrar '+settlementLabel(editor.settlementKind).toLowerCase();
    case 'apply':return 'Aplicar '+settlementLabel(editor.settlement.kind).toLowerCase();
    case 'correction':return headings[editor.action];
    case 'catalog':return {ACCOUNT:'Nueva cuenta',CATEGORY:'Nueva categoría',CENTER:'Nuevo centro de costo'}[editor.catalog];
    case 'movement':return 'Movimiento · '+editor.account.name;
    case 'budget':return 'Presupuesto mensual';
    case 'attachment':return 'Adjuntar comprobante';
  }
}
function EditorForm({editor,lookups,busy,revision,save,attach,month}:{editor:Editor;lookups?:Lookups;busy:boolean;revision:number;save:(command:Command)=>Promise<void>;attach:(collection:Detail['collection'],id:string,data:FormData)=>Promise<void>;month?:string}) {
  if(editor.kind==='party')return <PartyForm party={editor.party} busy={busy} submit={save}/>;
  if(editor.kind==='catalog')return <CatalogForm kind={editor.catalog} busy={busy} submit={save}/>;
  if(editor.kind==='apply')return <ApplyForm partyId={editor.settlement.partyId} settlementId={editor.settlement.id} available={editor.settlement.availablePyg} revision={revision} busy={busy} submit={save}/>;
  if(editor.kind==='correction')return <><p className="notice warning">{consequence[editor.action]}</p><CorrectionForm id={editor.id} action={editor.action} minDate={editor.minDate} busy={busy} submit={save}/></>;
  if(editor.kind==='attachment')return <Form busy={busy} save="Adjuntar" onSubmit={data=>attach(editor.detail.collection,editor.detail.id,data)}>
    <div className="help-label"><h3>Archivo del comprobante</h3><HelpTip label="Formatos de comprobante">PDF, JPG, PNG o WebP. Hasta 5 MB.</HelpTip></div>
    <label className="field">Seleccionar archivo<input type="file" name="attachment" accept={fileTypes.join(',')} required/></label>
  </Form>;
  if(!lookups)return <p role="status">Cargando configuración…</p>;
  if(editor.kind==='movement')return <MovementForm account={editor.account} lookups={lookups} busy={busy} submit={save}/>;
  if(editor.kind==='budget')return <BudgetForm categories={lookups.categories} busy={busy} categoryId={editor.budget?.categoryId} month={editor.budget?.month??month} amount={editor.budget?.budgetPyg} submit={save}/>;
  if(editor.kind==='document')return <Form busy={busy} save={editor.pay?'Confirmar y pagar':'Confirmar documento'} onSubmit={data=>save(documentCommand(data,editor.pay))}>
    <DocumentFields lookups={lookups} pay={editor.pay} partyId={editor.partyId}/>
  </Form>;
  return <Form busy={busy} onSubmit={data=>save(settlementCommand(data,editor.settlementKind,editor.document))}>
    <SettlementFields lookups={lookups} document={editor.document} partyId={editor.partyId} kind={editor.settlementKind}/>
  </Form>;
}
