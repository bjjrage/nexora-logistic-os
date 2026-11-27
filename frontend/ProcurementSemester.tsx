import HelpTip from './HelpTip';
import StatCard from './StatCard';
import {money,Table} from './procurement-ui';
import type {ProcurementRegister} from '../server/procurement-register';

export type SemesterReport=Awaited<ReturnType<ProcurementRegister['semester']>>;
type Kpi=keyof SemesterReport['kpis'];
const labels={
  totalPyg:'Gastos con IVA',vatPyg:'IVA incluido',netPyg:'Neto sin IVA',pendingPyg:'Pendiente de pago',
  count:'Comprobantes',averagePyg:'Promedio por mes con gasto',peakMonth:'Mes de mayor gasto',peakPyg:'Monto del mes de mayor gasto',
  budgetPyg:'Presupuesto del período',remainingPyg:'Variación del presupuesto',executionRatio:'Ejecución del presupuesto',
} satisfies Record<Kpi,string>;
const indicators=Object.keys(labels) as Kpi[];
const period=new Intl.DateTimeFormat('es-PY',{month:'long',year:'numeric',timeZone:'UTC'});
const decimalMoney=new Intl.NumberFormat('es-PY',{style:'currency',currency:'PYG',minimumFractionDigits:2,maximumFractionDigits:2});
const percent=new Intl.NumberFormat('es-PY',{style:'percent',maximumFractionDigits:1,minimumFractionDigits:1});
const decimal=new Intl.NumberFormat('es-PY',{maximumFractionDigits:1,minimumFractionDigits:1});
const number=new Intl.NumberFormat('es-PY');
const monthName=(value:string)=>period.format(new Date(value+'-01T12:00:00Z'));
function display(indicator:Kpi,value:number|string|null) {
  if(value===null)return '—';
  if(typeof value==='string')return monthName(value);
  if(indicator==='count')return number.format(value);
  if(indicator==='averagePyg')return decimalMoney.format(value);
  if(indicator==='executionRatio')return percent.format(value);
  return money(value);
}
function difference(indicator:Kpi,excel:number|string|null,actual:number|string|null) {
  if(excel===null||actual===null)return '—';
  if(excel===actual)return 'Coincide';
  if(typeof excel==='string'||typeof actual==='string')return 'Difiere';
  const delta=actual-excel;
  if(Math.abs(delta)<1e-8)return 'Coincide';
  return indicator==='executionRatio'?decimal.format(delta*100)+' pp':display(indicator,delta);
}

export default function ProcurementSemester({report,onOpen,onMonth}:{report:SemesterReport;onOpen:()=>void;onMonth:(month:string)=>void}) {
  const {year,kpis,months,comparison}=report;
  return <>
    <section className="card" aria-label="Indicadores del semestre">
      <div className="card-header"><div className="help-label"><h2>Julio–diciembre {year}</h2>
        <HelpTip label="Indicadores del semestre">El total reúne los gastos registrados en el OS. El promedio usa los meses con gasto. Los pendientes de documentos confirmados se calculan con su saldo vigente.</HelpTip></div></div>
      <div className="stat-grid procurement-kpi-grid">
        {indicators.slice(0,8).map(indicator=><StatCard key={indicator} label={labels[indicator]} value={display(indicator,kpis[indicator])}
          caption="Ver gastos" onClick={()=>{
            const peak=indicator==='peakMonth'||indicator==='peakPyg';
            if(peak&&kpis.peakMonth)onMonth(kpis.peakMonth);
            else onOpen();
          }}/>)}
      </div>
    </section>
    <section className="card">
      <div className="card-header"><h3>Evolución mensual</h3></div>
      <Table heads={['Mes','Gastos con IVA','IVA incluido','Neto sin IVA','Pendiente','Comprobantes','Acumulado','Acción']}>
        {months.map(month=><tr key={month.month}><th scope="row">{monthName(month.month)}</th>
          <td>{money(month.totalPyg)}</td><td>{money(month.incompleteBreakdown?null:month.vatPyg)}</td>
          <td>{money(month.incompleteBreakdown?null:month.netPyg)}</td><td>{money(month.pendingPyg)}</td>
          <td>{number.format(month.count)}</td><td>{money(month.accumulatedPyg)}</td>
          <td><button type="button" className="text-button" onClick={()=>onMonth(month.month)}>Ver gastos</button></td>
        </tr>)}
      </Table>
    </section>
    <section className="card">
      <div className="card-header"><div className="help-label"><h3>Conciliación con la planilla</h3>
        <HelpTip label="Conciliación con la planilla">La comparación usa los valores guardados en la hoja indicada y los gastos de esa misma importación. El presupuesto de la planilla aplica su monto mensual a seis meses.</HelpTip></div></div>
      {comparison?<><dl className="procurement-facts">
        <div><dt>Planilla de referencia</dt><dd>{comparison.filename} · {comparison.sheet}</dd></div>
        <div><dt>Otros registros del OS</dt><dd>{number.format(comparison.others.count)} · {money(comparison.others.totalPyg)}</dd></div>
      </dl>
      <Table className="procurement-semester-comparison" heads={['Indicador','Excel','Planilla en el OS','Diferencia']}>
        {indicators.map(indicator=><tr key={indicator}><th scope="row">{labels[indicator]}</th>
          <td>{display(indicator,comparison.excel[indicator])}</td><td>{display(indicator,comparison.imported[indicator])}</td>
          <td>{difference(indicator,comparison.excel[indicator],comparison.imported[indicator])}</td></tr>)}
      </Table></>:<p className="empty-state">Sin planilla de referencia para {year}.</p>}
    </section>
  </>;
}
