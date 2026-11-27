import {useState} from 'react';
import HelpTip from './HelpTip';
import {Form,Modal} from './ProcurementForms';
import {Feedback,Pagination,Table,money} from './procurement-ui';

const views = {
  month:'Por mes',category:'Por categoría',costCenter:'Por centro de costo',supplier:'Por proveedor',
  paymentMethod:'Por medio de pago',documentType:'Por comprobante',historicalStatus:'Por estado',
} as const;
export type SourceDimension = keyof typeof views;
export type SourceFilter = {label:string;scope?:'included'|'paid'|'pending';group?:SourceDimension;key?:string;month?:string;from?:string;before?:string};
type Group = {key:string;label:string|null;count:number;totalPyg:number;vatPyg:number;netPyg:number;missingBreakdown:number};
type Control = {sheet:string;address:string;from:string;before:string;amountPyg:number;calculatedPyg:number;differencePyg:number};
type Plan = {
  digest:string;categories:string[];centers:string[];parties:{name:string;ruc:string|null}[];
  budgets:{category:string;month:string;amountPyg:number}[];paymentMethods:string[];conflicts:{name:string;reason:string}[];
};
export type ImportWorkspace = {
  payments:{total:number;registered:number;pending:number};
  source:{sha256:string;definedBudgets:number;unreadableBudgets:number};
  totals:{count:number;totalPyg:number;vatPyg:number;netPyg:number;incompleteBreakdown:number;
    paidPyg:number;pendingPyg:number;paidCount:number;pendingCount:number};
  groups:Record<SourceDimension,Group[]>;controls:Control[];budgetMonth:string|null;
  budgetPeriod:{from:string;before:string}|null;
  budgets:{category:string|null;key:string;budgetPyg:number|null;realPyg:number;differencePyg:number;executionRatio:number|null;
    budgetAccumulatedPyg:number|null;realAccumulatedPyg:number;differenceAccumulatedPyg:number|null;executionAccumulatedRatio:number|null}[];
  setup:Plan;configured:boolean;states:{PENDING:number;PROMOTED:number;SKIPPED:number};formulaRows:number;issues:Record<string,number>;
};

const limit = 15;
const formatPeriod = new Intl.DateTimeFormat('es-PY',{month:'long',year:'numeric',timeZone:'UTC'});
const formatPercentage = new Intl.NumberFormat('es-PY',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1});
const percentage = (value:number|null) => value===null?'—':formatPercentage.format(value);
const variance = (value:number|null) => value!==null&&value<0?'procurement-budget-negative':'';
const budgetLabel = (value:number|null) => value===null?'Sin definir':money(value);

export default function ProcurementSourceReview({workspace,filter,onFilter,busy,error,apply,onReload,showSetup=true,initialBudget=false}:{
  workspace:ImportWorkspace;filter:SourceFilter|undefined;onFilter:(value:SourceFilter|undefined)=>void;
  busy:boolean;error:string;apply:(digest:string)=>Promise<boolean>;onReload:()=>void;showSetup?:boolean;initialBudget?:boolean;
}) {
  const [view,setView]=useState<SourceDimension|'budget'>(()=>initialBudget?'budget':'month');
  const [page,setPage]=useState(0);
  const [preview,setPreview]=useState<Plan>();
  const {controls,setup,budgetMonth,budgetPeriod,budgets}=workspace;
  const pendingSetup=setup.categories.length+setup.centers.length+setup.parties.length+setup.budgets.length;
  const readyToConfigure=pendingSetup>0 || (!workspace.configured && setup.paymentMethods.length>0);
  const groups=view==='budget'?[]:workspace.groups[view];
  return <div className="procurement-source-workspace">
    {showSetup&&<>
    <div className="card-header">
      <div className="help-label"><h3>Configuración desde Excel</h3><HelpTip label="Configuración desde Excel">Reutiliza las listas del archivo y los proveedores identificados. La confirmación actualiza la configuración. Las fechas, los pagos y la apertura quedan en el histórico.</HelpTip></div>
      {readyToConfigure?<button type="button" className="button button-primary" onClick={()=>setPreview(setup)}>Revisar y cargar maestros</button>:
        workspace.configured&&<span>Configuración cargada</span>}
    </div>
    <dl className="procurement-facts">
      <div><dt>Proveedores nuevos</dt><dd>{setup.parties.length}</dd></div>
      <div><dt>Categorías nuevas</dt><dd>{setup.categories.length}</dd></div>
      <div><dt>Centros nuevos</dt><dd>{setup.centers.length}</dd></div>
      <div><dt>Medios de pago</dt><dd>{setup.paymentMethods.length}</dd></div>
      <div><dt>Presupuestos nuevos</dt><dd>{setup.budgets.length}</dd></div>
    </dl>
    {!!setup.conflicts.length&&<details><summary>{setup.conflicts.length} proveedores requieren revisión</summary>
      <ul>{setup.conflicts.map(item=><li key={item.name}>{item.name} · {item.reason}</li>)}</ul></details>}
    <div className="card-header"><div className="help-label"><h3>Conciliación del archivo</h3>
      <HelpTip label="Conciliación del archivo">Compara el total guardado en cada hoja con el Registro del mismo período. El resumen excluye las filas marcadas Anulado en el Excel. Los importes siguen en el histórico.</HelpTip></div></div>
    {controls.length?<Table heads={['Hoja / celda','Excel guardado','Registro','Diferencia','Acción']}>{controls.map(control=><tr key={control.sheet+control.address}>
      <th scope="row">{control.sheet} · {control.address}</th><td className="procurement-nowrap">{money(control.amountPyg)}</td>
      <td className="procurement-nowrap">{money(control.calculatedPyg)}</td><td className="procurement-nowrap">{money(control.differencePyg)}</td>
      <td><button type="button" className="text-button" aria-label={'Ver filas de '+control.sheet} onClick={()=>onFilter({label:control.sheet,from:control.from,before:control.before})}>Ver filas</button></td>
    </tr>)}</Table>:<p className="empty-state">Sin controles guardados para comparar.</p>}
    <dl className="procurement-facts">
      <div><dt>Filas en revisión</dt><dd>{workspace.states.PENDING}</dd></div>
      <div><dt>Operaciones registradas</dt><dd>{workspace.states.PROMOTED}</dd></div>
      <div><dt>Filas omitidas</dt><dd>{workspace.states.SKIPPED}</dd></div>
      <div><dt>Filas solo preformuladas</dt><dd>{workspace.formulaRows}</dd></div>
    </dl>
    </>}
    <nav className="procurement-tabs" aria-label="Vistas del histórico">
      {(['month','category','costCenter','supplier','budget'] as const).map(key=><button key={key}
        className={'button '+(view===key?'button-primary':'button-secondary')} type="button" aria-pressed={view===key}
        onClick={()=>{setView(key);setPage(0);onFilter(undefined);}}>{key==='budget'?'Presupuesto vs. real':views[key]}</button>)}
    </nav>
    <details><summary>Más desgloses</summary><div className="heading-actions">
      {(['paymentMethod','documentType','historicalStatus'] as const).map(key=><button key={key} type="button" aria-pressed={view===key}
        className="button button-secondary" onClick={()=>{setView(key);setPage(0);onFilter(undefined);}}>{views[key]}</button>)}
    </div></details>
    {filter&&<button type="button" className="text-button procurement-start" onClick={()=>onFilter(undefined)}>Ver todas las filas</button>}
    {view==='budget'?<>
      {budgetMonth&&<div className="help-label"><strong className="procurement-budget-period">{formatPeriod.format(new Date(budgetMonth+'-01T00:00:00Z'))}</strong>
        <HelpTip label="Presupuesto histórico">El acumulado abarca enero hasta el mes de análisis. El presupuesto acumulado multiplica el presupuesto mensual por los meses transcurridos. Para calcular la variación, un presupuesto sin definir equivale a cero, como en el Excel.</HelpTip></div>}
      {budgets.length?<Table className="procurement-budget-table" heads={['Categoría','Presupuesto mes','Real mes','Variación mes','% ejecución mes',
        'Presupuesto acumulado','Real acumulado','Variación acumulada','% ejecución acum.']}>
        {budgets.slice(page*limit,(page+1)*limit).map(item=>{
          const label=item.category??'Sin clasificar';
          return <tr key={item.key}>
            <th scope="row">{label}</th><td>{budgetLabel(item.budgetPyg)}</td>
            <td>{item.realPyg>0&&budgetMonth?<button className="text-button" type="button" aria-label={'Ver real del mes de '+label}
              onClick={()=>onFilter({group:'category',key:item.key,label,month:budgetMonth})}>{money(item.realPyg)}</button>:money(item.realPyg)}</td>
            <td className={variance(item.differencePyg)}>{money(item.differencePyg)}</td><td>{percentage(item.executionRatio)}</td>
            <td>{budgetLabel(item.budgetAccumulatedPyg)}</td>
            <td>{item.realAccumulatedPyg>0&&budgetPeriod?<button className="text-button" type="button" aria-label={'Ver real acumulado de '+label}
              onClick={()=>onFilter({group:'category',key:item.key,label:label+' · acumulado',...budgetPeriod})}>{money(item.realAccumulatedPyg)}</button>:money(item.realAccumulatedPyg)}</td>
            <td className={variance(item.differenceAccumulatedPyg)}>{money(item.differenceAccumulatedPyg)}</td>
            <td>{percentage(item.executionAccumulatedRatio)}</td>
          </tr>;
        })}
      </Table>:<p className="empty-state">Sin mes de presupuesto en el archivo.</p>}
    </>:<Table heads={[views[view],'Filas','Total según Excel',...(view==='month'?['IVA registrado','Neto registrado']:[]),'Acción']}>{groups.slice(page*limit,(page+1)*limit).map(item=>{
      const label=item.label??'Sin dato';
      return <tr key={item.key}><th scope="row">{label}</th><td>{item.count}</td><td className="procurement-nowrap">{money(item.totalPyg)}</td>
        {view==='month'&&<><td className="procurement-nowrap">{item.missingBreakdown?'—':money(item.vatPyg)}</td>
          <td className="procurement-nowrap">{item.missingBreakdown?'—':money(item.netPyg)}</td></>}
        <td><button type="button" className="text-button" aria-label={'Ver filas de '+label} onClick={()=>onFilter({group:view,key:item.key,label})}>Ver filas</button></td></tr>;
    })}</Table>}
    <Pagination page={page} hasMore={(page+1)*limit<(view==='budget'?budgets.length:groups.length)} change={setPage}/>
    {preview&&<Modal title="Cargar maestros del Excel" busy={busy} onClose={()=>setPreview(undefined)}>
      <Feedback error={error} retry={()=>{setPreview(undefined);onReload();}}/>
      <Form busy={busy} save="Cargar configuración" onSubmit={async()=>{if(await apply(preview.digest))setPreview(undefined);}}>
        {preview.parties.length>0&&<details open><summary>Proveedores · {preview.parties.length}</summary>
          <ul>{preview.parties.map(item=><li key={item.name}>{item.name}{item.ruc?' · '+item.ruc:''}</li>)}</ul></details>}
        {preview.categories.length>0&&<details><summary>Categorías · {preview.categories.length}</summary><ul>{preview.categories.map(name=><li key={name}>{name}</li>)}</ul></details>}
        {preview.centers.length>0&&<details><summary>Centros · {preview.centers.length}</summary><ul>{preview.centers.map(name=><li key={name}>{name}</li>)}</ul></details>}
        {preview.paymentMethods.length>0&&<details><summary>Medios de pago · {preview.paymentMethods.length}</summary><ul>{preview.paymentMethods.map(name=><li key={name}>{name}</li>)}</ul></details>}
        {preview.budgets.length>0&&<details open><summary>Presupuestos · {preview.budgets.length}</summary>
          <ul>{preview.budgets.map(item=><li key={item.category}>{item.category} · {item.month} · {money(item.amountPyg)}</li>)}</ul></details>}
      </Form>
    </Modal>}
  </div>;
}
