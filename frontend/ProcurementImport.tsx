import {useId,useState} from 'react';
import HelpTip from './HelpTip';
import ProcurementSourceReview,{type ImportWorkspace,type SourceFilter} from './ProcurementSourceReview';
import {documentCommand,DocumentFields,Form,Modal,settlementCommand,SettlementFields} from './ProcurementForms';
import {base,errorText,Feedback,field,fileBase64,money,Pagination,post,query,Status,Table,useCommand,useProcurement,type Document,type Lookups,type Page} from './procurement-ui';

type Issue={code:string;message:string;field?:string};
type Prior={type:'UNCHANGED'|'POSSIBLE_MATCH'|'CHANGED';batchId:string;rowId:string;rowNumber:number;state:string};
type Cells=Record<string,{address:string;value?:string|number|boolean;formatted?:string;formula?:string}>;
type Row={id:string;rowNumber:number;state:'PENDING'|'PROMOTED'|'SKIPPED';issues:Issue[];prior:Prior[];resolutionReason?:string|null;original?:Cells;outcome?:{operationId:string;action:'DOCUMENT'|'SETTLEMENT'}|null;normalized:{
  date:string|null;dueDate:string|null;documentNumber:string|null;documentType:string|null;supplier:string|null;taxId:string|null;description:string|null;
  category:string|null;costCenter:string|null;paymentMethod:string|null;totalPyg:number|null;taxRate:number|null;taxPyg:number|null;netPyg:number|null;
  historicalStatus:string|null;paidAccordingToFile:boolean;responsible:string|null;notes:string|null;
  payment?:{date:string|null;invoiceReference:string|null;account:string|null;reference:string|null};
}};
export type WorkbookBatch={id:string;filename:string;sha256:string;sheet:string;createdAt:string;summary:{rowCount:number;paymentRows?:number;totalPyg:number;historicallyPaidCount:number;unresolvedTotalCount:number;issues:Issue[];opening?:{amountPyg:number|null;state:string}|null;parameters?:{sheet:string;cells:Array<{address:string;value?:string|number;formatted?:string;formula?:string}>}|null}};
type Detail=WorkbookBatch&{rows:Row[];hasMore:boolean;included:boolean};
type Upload=Detail&{status:'IMPORTED'|'UNCHANGED'|'REVIEW_REQUIRED';activeId:string|null;payments:{total:number;registered:number;pending:number}};
type Resolution='SKIP'|'DOCUMENT'|'DOCUMENT_PAYMENT'|'PAYMENT'|'ADVANCE'|'CREDIT';
const resolutions:Record<Resolution,string>={SKIP:'Omitir fila',DOCUMENT:'Documento por pagar',DOCUMENT_PAYMENT:'Documento y pago',PAYMENT:'Registrar pago',ADVANCE:'Anticipo',CREDIT:'Nota de crédito'};
const rowStatus={PENDING:'Pendiente',SKIPPED:'Omitida',PROMOTED:'Registrada'};
const priorType={UNCHANGED:'Sin cambios',POSSIBLE_MATCH:'Posible coincidencia',CHANGED:'Versión modificada'};
const cellLabels:Record<string,string>={date:'Fecha original',documentType:'Tipo de comprobante',documentNumber:'N.º de comprobante',supplier:'Proveedor',taxId:'RUC',description:'Concepto',category:'Categoría',costCenter:'Centro de costo',paymentMethod:'Medio de pago',taxRate:'Tasa IVA',totalPyg:'Monto total',taxPyg:'IVA',netPyg:'Monto neto',historicalStatus:'Estado en archivo',dueDate:'Vencimiento',responsible:'Responsable',notes:'Observaciones',overdueDays:'Días de atraso',month:'Mes'};
Object.assign(cellLabels,{paymentDate:'Fecha de pago',invoiceReference:'N.º de factura',paymentAccount:'Cuenta de origen',paymentReference:'Referencia del pago',
  transferTotal:'Total de la transferencia (Gs.)'});
const pageSize=25;

export default function ProcurementImport({lookups,revision,onChange,onOpenOperation,activeWorkbook}:{
  lookups:Lookups|undefined;revision:number;onChange:()=>void;
  activeWorkbook:{data?:{batch:WorkbookBatch|null};error?:string;loading:boolean};
  onOpenOperation:(collection:'parties'|'documents'|'settlements',id:string)=>void;
}) {
  const [manualBatch,setBatch]=useState<WorkbookBatch>();
  const [activeRow,setActiveRow]=useState<{id:string;rowNumber:number}>();
  const [batchPage,setBatchPage]=useState(0);
  const [page,setPage]=useState(0);
  const [onlyPending,setOnlyPending]=useState(false);
  const [filter,setFilter]=useState<SourceFilter>();
  const [busy,setBusy]=useState(false);
  const [localRevision,refresh]=useState(0);
  const [bulkError,setBulkError]=useState('');
  const [notice,setNotice]=useState('');
  const batches=useProcurement<Page<WorkbookBatch>>('/imports?'+query({limit:pageSize,offset:batchPage*pageSize}),revision+localRevision);
  const availableBatches=batches.data?.items??[];
  const currentBatch=manualBatch??activeWorkbook.data?.batch;
  const batchId=currentBatch?.id??'';
  const detail=useProcurement<Detail>(batchId?'/imports/'+batchId+'?'+query({limit:pageSize,offset:page*pageSize,
    state:onlyPending?'PENDING':undefined,group:filter?.group,key:filter?.key,month:filter?.month,from:filter?.from,before:filter?.before,scope:filter?.scope}):null,revision+localRevision);
  const workspace=useProcurement<ImportWorkspace>(batchId?'/imports/'+batchId+'/workspace':null,revision+localRevision);
  const isActive=detail.data?.included;
  const paymentsOnly=Boolean(currentBatch?.summary.paymentRows&&currentBatch.summary.paymentRows===currentBatch.summary.rowCount);
  const setupCommand=useCommand();
  const activation=useCommand();
  const rows=detail.data?.rows??[];
  const selectedBatch=currentBatch&&!availableBatches.some(batch=>batch.id===batchId)?[currentBatch,...availableBatches]:availableBatches;

  async function upload(data:FormData) {
    const file=data.get('workbook');
    if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.xlsx'))throw new Error('Seleccioná un archivo .xlsx.');
    setBusy(true);setNotice('');setBulkError('');
    try {
      const contentBase64=await fileBase64(file,5*1024*1024);
      const replaceBatchId=field(data,'replaceBatchId');
      const result=await post<Upload>('/imports',{filename:file.name,contentBase64,
        ...(replaceBatchId?{mode:'replace',replaceBatchId}:{mode:'append'})});
      setBatch(result);setPage(0);setBatchPage(0);setOnlyPending(result.payments.pending>0);setFilter(undefined);activation.setError('');onChange();
      setNotice(result.status==='REVIEW_REQUIRED'?'La versión recibida no trae los presupuestos de la versión activa. Revisala antes de cambiar.':
        result.status==='UNCHANGED'?'El archivo coincide con una versión ya importada.':'Nueva versión importada y en uso.');
    } catch(error){setBulkError(errorText(error));}
    finally{setBusy(false);}
  }

  function applyFilter(next:SourceFilter|undefined) {
    setFilter(next);setPage(0);
    if(next){setOnlyPending(false);document.getElementById('procurement-source-rows')?.scrollIntoView({block:'nearest'});}
  }

  return <div className="procurement-import">
    <section className="card">
      <div className="card-header"><div className="help-label"><h2>Importación Excel</h2><HelpTip label="Importación Excel">En la hoja Pagos, ingresá una fila por factura con su importe aplicado. Repetí referencia, proveedor, fecha, cuenta y medio para aplicar una sola transferencia. Podés agregar «Total de la transferencia (Gs.)» para conciliar la suma. Formato .xlsx de hasta 5 MB.</HelpTip></div></div>
      <Form busy={busy} save="Importar versión" onSubmit={upload}>
        <label className="field">Archivo Excel<input type="file" name="workbook" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required/></label>
        {selectedBatch.length>0&&<div className="field"><label htmlFor="procurement-import-destination">Destino de la carga</label>
          <select id="procurement-import-destination" name="replaceBatchId" defaultValue=""><option value="">Agregar movimientos</option>
            {selectedBatch.map(batch=><option key={batch.id} value={batch.id}>Actualizar {batch.filename} · {batch.sha256.slice(0,8)}</option>)}
          </select></div>}
        {bulkError&&<p role="alert" className="notice error">{bulkError}</p>}
      </Form>
      {notice&&<p role="status" className="notice success">{notice}</p>}
    </section>
    <section className="card">
      <div className="field procurement-batch-select"><label htmlFor="procurement-batch">Lote</label><select id="procurement-batch" value={batchId} onChange={e=>{setBatch(selectedBatch.find(batch=>batch.id===e.target.value));activation.setError('');setPage(0);setOnlyPending(false);setFilter(undefined);setupCommand.setError('');setNotice('');}}>
        <option value="">{batches.loading?'Cargando…':'Seleccionar lote'}</option>
        {selectedBatch.map(b=> <option key={b.id} value={b.id}>{b.filename} · {b.createdAt.slice(0,10)} · {b.sha256.slice(0,8)}</option>)}
      </select></div>
      <Pagination page={batchPage} hasMore={Boolean(batches.data?.hasMore)} change={setBatchPage}/>
      <Feedback error={batches.error??activeWorkbook.error} loading={batches.loading||activeWorkbook.loading} retry={onChange}/>
      {!batchId&&activeWorkbook.data?.batch===null&&<p className="empty-state">Sin planilla cargada.</p>}
      {currentBatch&&<div className="procurement-import-detail">
        <div className="procurement-tools">
          <div className="procurement-file-name">{currentBatch.filename} · {currentBatch.sha256.slice(0,8)} · {isActive===undefined?'Cargando…':isActive?'En uso':'Vista previa'}</div>
          {isActive===false&&<button type="button" className="button button-primary" disabled={activation.busy}
            onClick={async()=>{const result=await activation.run<{id:string}>('/imports/'+batchId+'/activate',{});
              if(result){setNotice('Versión en uso.');onChange();}
            }}>Usar esta versión</button>}
        </div>
        <Feedback error={activation.error}/>
        {!!workspace.data?.payments.total&&<dl className="procurement-facts" aria-label="Resultado de pagos">
          <div><dt>Pagos registrados</dt><dd>{workspace.data.payments.registered}</dd></div>
          <div><dt>Filas de pago por revisar</dt><dd>{workspace.data.payments.pending}</dd></div>
        </dl>}
        {!paymentsOnly&&workspace.data&&<div className="procurement-file-name">
          {workspace.data.source.definedBudgets} presupuestos definidos en el archivo recibido
          {workspace.data.source.unreadableBudgets>0&&<span role="alert"> · {workspace.data.source.unreadableBudgets} sin valor legible</span>}
        </div>}
        <div className="card-header"><h2>Resumen del archivo</h2><a className="button button-secondary" href={base+'/imports/'+batchId+'/original'} download>Descargar original</a></div>
        <dl className="procurement-facts">
          <div><dt>Hoja</dt><dd>{currentBatch.sheet}</dd></div>
          <div><dt>Filas</dt><dd>{currentBatch.summary.rowCount}</dd></div>
          <div><dt>Total leído</dt><dd>{money(currentBatch.summary.totalPyg)}</dd></div>
          <div><dt>Importes sin resolver</dt><dd>{currentBatch.summary.unresolvedTotalCount}</dd></div>
          <div><dt>Pagadas según archivo</dt><dd>{currentBatch.summary.historicallyPaidCount}</dd></div>
          {currentBatch.summary.opening&&<div><dt>Saldo inicial pendiente</dt><dd>{money(currentBatch.summary.opening.amountPyg)}</dd></div>}
        </dl>
        {currentBatch.summary.issues.map(issue=><p key={issue.code} className="notice warning">{issue.message}</p>)}
        {currentBatch.summary.parameters&&<details className="procurement-source">
          <summary>Parámetros del archivo</summary>
          <Table heads={['Celda','Valor','Fórmula']}>{currentBatch.summary.parameters.cells.map(cell=><tr key={cell.address}><td>{cell.address}</td><td>{cell.formatted??String(cell.value??'—')}</td><td>{cell.formula??'—'}</td></tr>)}</Table>
        </details>}
        <Feedback loading={workspace.loading} error={workspace.error} retry={()=>refresh(n=>n+1)}/>
        {!paymentsOnly&&workspace.data&&<ProcurementSourceReview key={batchId} workspace={workspace.data} filter={filter}
          onFilter={applyFilter}
          busy={setupCommand.busy} error={setupCommand.error} onReload={()=>{setupCommand.setError('');refresh(n=>n+1);}}
          apply={async digest=>{
            const result=await setupCommand.run<{categories:number;centers:number;parties:number;budgets:number}>('/imports/'+batchId+'/setup',{digest});
            if(!result)return false;
            setNotice('Configuración cargada desde Excel.');
            onChange();
            return true;
          }}/>}
        <div id="procurement-source-rows" className="card-header"><h3>{filter?'Registro · '+filter.label:'Registro de gastos'}</h3>
          {filter&&<button type="button" className="text-button" onClick={()=>{setFilter(undefined);setPage(0);}}>Quitar filtro</button>}</div>
        <label className="procurement-check"><input type="checkbox" checked={onlyPending} onChange={e=>{setOnlyPending(e.target.checked);setPage(0);}}/>Solo pendientes</label>
        <Feedback loading={detail.loading} error={detail.error} retry={()=>refresh(n=>n+1)}/>
        {rows.length>0&&<Table heads={['Fila','Fecha original','Proveedor','Concepto','Total','Estado de origen','Revisión','Acción']}>
          {rows.map(row=><tr key={row.id}>
            <td>{row.rowNumber}</td><td>{row.normalized.date??'—'}</td><td>{row.normalized.supplier??row.normalized.taxId??'Sin proveedor'}</td>
            <td>{row.normalized.description??'—'}</td><td>{money(row.normalized.totalPyg)}</td><td>{row.normalized.paidAccordingToFile?'Pagado según archivo':row.normalized.historicalStatus??'—'}</td>
            <td><Status state={row.state}>{rowStatus[row.state]}</Status> {row.issues.length>0&&<small>
              {row.issues.find(issue=>['PAYMENT_REVIEW','PAYMENT_GROUP_REVIEW'].includes(issue.code))?.message??row.issues.length+' incidencias'}</small>}</td>
            <td><button className="text-button" type="button" onClick={()=>setActiveRow(row)} aria-label={'Revisar fila '+row.rowNumber}>Revisar</button></td>
          </tr>)}
        </Table>}
        {rows.length===0&&!detail.loading&&!detail.error&&<p className="empty-state">{onlyPending?'Sin filas pendientes.':'Sin resultados.'}</p>}
        <Pagination page={page} hasMore={Boolean(detail.data?.hasMore)} change={setPage}/>
      </div>}
    </section>
    {activeRow&&<ImportRowDialog batchId={batchId} id={activeRow.id} lookups={lookups} onClose={()=>setActiveRow(undefined)}
        onOpenOperation={onOpenOperation} onResolved={text=>{setActiveRow(undefined);setPage(0);setNotice(text);onChange();}}/>}
  </div>;
}

export function ImportRowDialog({batchId,id,lookups,onClose,onOpenOperation,onResolved}:{
  batchId:string;id:string;lookups?:Lookups;onClose:()=>void;onOpenOperation:(collection:'parties'|'documents'|'settlements',id:string)=>void;
  onResolved:(text:string)=>void;
}) {
  const [revision,refresh]=useState(0);
  const [showTransfer,setShowTransfer]=useState(false);
  const path='/imports/'+batchId+'/rows/'+id;
  const row=useProcurement<Row>(path,revision);
  const command=useCommand();
  const canReviewTransfer=Boolean(row.data?.state==='PENDING'&&row.data.normalized.payment?.reference);
  const grouped=Boolean(row.data?.issues.some(issue=>issue.code==='PAYMENT_GROUP_REVIEW'));
  const reviewing=canReviewTransfer&&(grouped||showTransfer);
  return <Modal title={reviewing?'Revisar transferencia':row.data?'Fila '+row.data.rowNumber:'Movimiento importado'} busy={command.busy} onClose={onClose}>
    <Feedback loading={row.loading} error={row.error} retry={()=>refresh(value=>value+1)}/>
    {reviewing?<TransferReview path={path+'/transfer'} command={command} onResolved={onResolved} openPayment={settlementId=>{
      onClose();onOpenOperation('settlements',settlementId);
    }}/>:row.data&&<>
      {canReviewTransfer&&<button className="button button-secondary" type="button" onClick={()=>setShowTransfer(true)}>Corregir y reprocesar</button>}
      <ReviewRow row={row.data} lookups={lookups} busy={command.busy} error={command.error} onOpenOperation={(collection,entryId)=>{
      onClose();onOpenOperation(collection,entryId);
    }} onSubmit={async body=>{
      if(await command.run(path+'/resolve',body))onResolved(body.action==='PROMOTE'?'Operación registrada.':'Fila omitida.');
    }}/></>}
  </Modal>;
}

type TransferReviewData={reference:string;settlementId:string|null;partyId:string|null;partyName:string|null;
  rows:{id:string;rowNumber:number;amountPyg:number|null;documentId:string|null;invoiceReference:string|null;originalInvoice:string|null;reason:string|null}[]};
type TransferResult={id:string;status:'POSTED'|'ALREADY_POSTED'|'PENDING';reason?:string};
const invoiceLabel=(document:Document)=>document.reference??document.description;

function TransferReview({path,command,onResolved,openPayment}:{path:string;command:ReturnType<typeof useCommand>;
  onResolved:(text:string)=>void;openPayment:(id:string)=>void}) {
  const [revision,refresh]=useState(0);
  const [rowId,setRowId]=useState<string>();
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const [corrections,setCorrections]=useState<Record<string,Document>>({});
  const [reason,setReason]=useState('');
  const selectId=useId();
  const transfer=useProcurement<TransferReviewData>(path,revision);
  const data=transfer.data;
  const docs=useProcurement<Page<Document>>(rowId&&data?.partyId?'/payables?'+query({partyId:data.partyId,q:search,limit:25,offset:page*25}):null,revision);
  const editing=data?.rows.find(row=>row.id===rowId);
  const groupReason=reason||data?.rows.find(row=>row.reason)?.reason;

  return <>
    <Feedback loading={transfer.loading} error={transfer.error} retry={()=>refresh(value=>value+1)}/>
    <Feedback error={command.error}/>
    {data?.settlementId&&<button className="button button-secondary" type="button" onClick={()=>openPayment(data.settlementId!)}>Ver pago registrado</button>}
    {data&&!data.settlementId&&<>
      <dl className="procurement-facts"><div><dt>Referencia del pago</dt><dd>{data.reference}</dd></div>
        {data.partyName&&<div><dt>Proveedor</dt><dd>{data.partyName}</dd></div>}</dl>
      {groupReason&&<p className="notice warning" role="status">{groupReason}</p>}
      <Table heads={['Fila','Factura a aplicar','Importe aplicado','Acción']}>{data.rows.map(row=>{
        const selected=corrections[row.id];
        const label=selected?invoiceLabel(selected):row.invoiceReference??(row.documentId?'Factura seleccionada':'Sin factura');
        return <tr key={row.id}>
          <th scope="row">{row.rowNumber}</th>
          <td>{label}{row.originalInvoice&&row.originalInvoice!==label&&<small>Origen: {row.originalInvoice}</small>}</td>
          <td>{money(row.amountPyg)}</td>
          <td>{data.partyId&&<button type="button" className="text-button" aria-label={'Cambiar factura de fila '+row.rowNumber} disabled={command.busy}
            onClick={()=>{setRowId(row.id);setSearch('');setPage(0);}}>Cambiar</button>}</td>
        </tr>;
      })}</Table>
      {editing&&<div className="procurement-fields">
        <label className="field">Buscar factura<input type="search" value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}}/></label>
        <div className="field"><label htmlFor={selectId}>Factura para fila {editing.rowNumber}</label>
          <select id={selectId} value="" onChange={event=>{
            const picked=docs.data?.items.find(item=>item.id===event.target.value);
            if(picked){setCorrections(current=>({...current,[editing.id]:picked}));setRowId(undefined);}
          }}><option value="">{docs.loading?'Cargando…':docs.data?.items.length===0?'Sin facturas pendientes':'Seleccionar factura'}</option>
            {docs.data?.items.map(document=><option key={document.id} value={document.id}>
              {invoiceLabel(document)} · {document.documentDate} · {money(document.balancePyg)}
            </option>)}
          </select>
        </div>
        <button type="button" className="text-button" onClick={()=>setRowId(undefined)}>Cancelar selección</button>
        <Feedback error={docs.error}/>
        <Pagination page={page} hasMore={Boolean(docs.data?.hasMore)} change={setPage}/>
      </div>}
      <div className="heading-actions">
        <button type="button" className="button button-primary" disabled={command.busy||Boolean(editing)} onClick={async()=>{
          const result=await command.run<TransferResult>(path,{corrections:Object.entries(corrections).map(([rowId,document])=>({rowId,documentId:document.id}))});
          if(!result)return;
          if(result.status==='PENDING'){
            setReason(result.reason??'');setCorrections({});refresh(value=>value+1);
          } else onResolved(result.status==='ALREADY_POSTED'?'La transferencia ya estaba registrada.':'Transferencia aplicada.');
        }}>Reprocesar transferencia</button>
      </div>
    </>}
  </>;
}

const foldName=(name:string|null|undefined)=>name?.trim().normalize('NFC').toLowerCase();

function linkedParty(source:Row['normalized'],lookups?:Lookups) {
  const parties=lookups?.parties??[];
  const byRuc=source.taxId?parties.find(party=>party.ruc===source.taxId):undefined;
  if(!source.supplier)return byRuc;
  const named=parties.filter(party=>foldName(party.name)===foldName(source.supplier));
  return byRuc??(named.length===1&&(!source.taxId||!named[0].ruc)?named[0]:undefined);
}

function ReviewRow({row,lookups,onSubmit,busy,error,onOpenOperation}:{row:Row;lookups:Lookups|undefined;onSubmit:(body:Record<string,unknown>)=>Promise<void>;busy:boolean;error:string;onOpenOperation:(collection:'parties'|'documents'|'settlements',id:string)=>void}) {
  const groupedReview=row.issues.some(issue=>issue.code==='PAYMENT_GROUP_REVIEW');
  const [kind,setKind]=useState<Resolution|''>(()=>row.normalized.payment&&!groupedReview?'PAYMENT':'');
  const [dateRole,setDateRole]=useState('');
  const source=row.normalized;
  const options=(Object.keys(resolutions) as Resolution[]).filter(option=>groupedReview?option==='SKIP':
    source.payment?['PAYMENT','SKIP'].includes(option):option!=='DOCUMENT'||!source.paidAccordingToFile);
  const duplicate=Boolean(row.prior?.length)||row.issues.some(issue=>issue.code==='POSSIBLE_DUPLICATE');
  const party=linkedParty(source,lookups);
  const partyId=party?.active?party.id:undefined;
  const prefill={description:source.description,dueDate:source.dueDate,reference:source.documentNumber,totalPyg:source.totalPyg,
    taxRate:source.taxRate,taxPyg:source.taxPyg,netPyg:source.netPyg,imported:true,paymentMethod:source.paymentMethod,
    documentDate:dateRole==='document'?source.date:undefined,paymentDate:source.payment?.date??(dateRole==='payment'?source.date??undefined:undefined),
    paymentAccountId:source.payment?.account?lookups?.accounts.find(item=>foldName(item.name)===foldName(source.payment?.account))?.id:undefined,
    paymentReference:source.payment?.reference,
    categoryId:lookups?.categories.find(item=>foldName(item.name)===foldName(source.category))?.id,
    centerId:lookups?.centers.find(item=>foldName(item.name)===foldName(source.costCenter))?.id};
  const original=row.original?Object.entries(row.original):[];
  return <>
    <dl className="procurement-facts"><div><dt>Fecha original</dt><dd>{source.date??'Por confirmar'}</dd></div>
      <div><dt>Proveedor</dt><dd>{source.supplier??party?.name??source.taxId??'—'}</dd></div><div><dt>Total original</dt><dd>{money(source.totalPyg)}</dd></div>
      <div><dt>Estado</dt><dd>{source.paidAccordingToFile?'Pagado según archivo':source.historicalStatus??'—'} · {rowStatus[row.state]}</dd></div>
      {source.payment?.invoiceReference&&<div><dt>N.º de factura</dt><dd>{source.payment.invoiceReference}</dd></div>}
      {source.description&&<div><dt>Concepto</dt><dd>{source.description}</dd></div>}
      {row.resolutionReason&&<div><dt>Motivo registrado</dt><dd>{row.resolutionReason}</dd></div>}
    </dl>
    {party&&<button type="button" className="button button-secondary" onClick={()=>onOpenOperation('parties',party.id)}>Ver proveedor</button>}
    {row.outcome&&<button type="button" className="button button-secondary" onClick={()=>onOpenOperation(row.outcome!.action==='DOCUMENT'?'documents':'settlements',row.outcome!.operationId)}>Ver operación registrada</button>}
    {row.issues.length>0&&<ul className="procurement-issues">{row.issues.map((issue,index)=><li key={issue.code+index}>{issue.message}</li>)}</ul>}
    {!!row.prior?.length&&<ul className="procurement-issues">{row.prior.map(prior=><li key={prior.rowId}>{priorType[prior.type]} · fila {prior.rowNumber} · {rowStatus[prior.state as Row['state']]??prior.state}</li>)}</ul>}
    {original.length>0&&<details className="procurement-source"><summary>Datos y fórmulas de origen</summary>
      <Table heads={['Campo','Celda','Valor','Fórmula']}>{original.map(([name,cell])=><tr key={name}>
        <td>{cellLabels[name]??name}</td><td>{cell.address}</td><td>{cell.formatted??String(cell.value??'—')}</td><td>{cell.formula??'—'}</td>
      </tr>)}</Table>
    </details>}
    {row.state==='PENDING'&&<><div className="field"><label htmlFor="procurement-import-resolution">Resolución</label><select id="procurement-import-resolution" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as Resolution|'');setDateRole('');}}>
      <option value="">Mantener pendiente</option>{options.map(option=><option key={option} value={option}>{resolutions[option]}</option>)}
    </select></div>
    {source.date&&!source.payment&&kind&&kind!=='SKIP'&&<div className="field"><label htmlFor="procurement-source-date-role">Usar fecha original como</label>
      <select id="procurement-source-date-role" value={dateRole} onChange={event=>setDateRole(event.target.value)}>
        <option value="">Completar fecha por separado</option>
        {['DOCUMENT','DOCUMENT_PAYMENT','CREDIT'].includes(kind)&&<option value="document">{kind==='CREDIT'?'Fecha de la nota':'Fecha del documento'}</option>}
        {['DOCUMENT_PAYMENT','PAYMENT','ADVANCE'].includes(kind)&&<option value="payment">Fecha del movimiento</option>}
      </select></div>}
    {kind&&<Form key={kind+'-'+dateRole} busy={busy||(!lookups&&kind!=='SKIP')} save={kind==='SKIP'?'Confirmar omisión':'Confirmar operación'} onSubmit={data=>{
      const reason=field(data,'reason');
      const acknowledgePrior=data.has('acknowledgePrior');
      if(kind==='SKIP')return onSubmit({action:'SKIP',reason});
      const operation=kind==='DOCUMENT'||kind==='DOCUMENT_PAYMENT'?documentCommand(data,kind==='DOCUMENT_PAYMENT'):settlementCommand(data,kind);
      return onSubmit({action:'PROMOTE',reason,operation,acknowledgePrior});
    }}>
      {kind!=='SKIP'&&!lookups&&<p role="status">Cargando configuración…</p>}
      {lookups&&(kind==='DOCUMENT'||kind==='DOCUMENT_PAYMENT')&&<DocumentFields lookups={lookups} partyId={partyId} pay={kind==='DOCUMENT_PAYMENT'} prefill={prefill}/>}
      {lookups&&(kind==='PAYMENT'||kind==='ADVANCE'||kind==='CREDIT')&&<SettlementFields lookups={lookups} partyId={partyId} kind={kind} prefill={prefill}/>}
      {duplicate&&kind!=='SKIP'&&<label className="procurement-check"><input type="checkbox" name="acknowledgePrior" required/>Revisé las coincidencias del archivo.</label>}
      <label className="field">Motivo de resolución<textarea name="reason" maxLength={500} required/></label>
      <Feedback error={error}/>
    </Form>}</>}
  </>;
}
