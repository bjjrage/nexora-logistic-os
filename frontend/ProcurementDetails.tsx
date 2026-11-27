import {useEffect,useRef,type ReactNode} from 'react';
import {Plus} from 'lucide-react';
import HelpTip from './HelpTip';
import {accountLabel,base,Feedback,label,money,settlementLabel,Status,Table,type Account,type Application,type Attachment,type AuditEvent,type Document,type Movement,type Party,type Settlement} from './procurement-ui';
import type {Detail,Editor,Filters,Open,Screen} from './ProcurementPanel';

function DetailButton({children='Abrir',onClick,description}:{children?:ReactNode;onClick:()=>void;description:string}) {
  return <button className="text-button" type="button" onClick={onClick} aria-label={description}>{children}</button>;
}
export function PartyTable({rows,open}:{rows:Party[];open:Open}) {
  return <Table heads={['Nombre o razón social','Tipo','RUC','Contacto','Estado','Acción']}>{rows.map(party=><tr key={party.id}>
    <td><strong>{party.name}</strong></td><td>{label(party.kind)}</td><td>{party.ruc??'—'}</td><td>{party.contact??'—'}</td>
    <td><Status state={party.active?'ACTIVE':'INACTIVE'}>{party.active?'Activo':'Inactivo'}</Status></td>
    <td><DetailButton description={'Abrir '+party.name} onClick={()=>open('parties',party.id)}/></td>
  </tr>)}</Table>;
}
export function DocumentTable({rows,open,compact=false}:{rows:Document[];open:Open;compact?:boolean}) {
  const heads=compact?['Fecha','Concepto','Total','Saldo','Acción']:['Fecha','Proveedor','Concepto','Clasificación','Total','Pagado','Saldo','Vencimiento','Estado','Acción'];
  const wide='procurement-wide';
  return <Table heads={heads} className={compact?undefined:'procurement-documents-full'} columnClasses={compact?undefined:[wide,wide,'',wide,wide,wide,'','',wide,'']}>{rows.map(doc=><tr key={doc.id}>
    <td className="procurement-nowrap procurement-wide">{doc.documentDate}</td>{!compact&&<td className={wide}>{doc.partyName}</td>}
    <td><strong>{doc.description}</strong>{doc.reference&&<small>{doc.reference}</small>}
      {!compact&&<div className="procurement-mobile-meta"><small>{doc.partyName}</small><Status state={doc.state}/></div>}</td>
    {!compact&&<td className={wide}>{label(doc.nature)}<small>{doc.categoryName??'Sin clasificar'}{doc.centerName?' · '+doc.centerName:''}</small></td>}
    <td className="procurement-nowrap procurement-wide">{money(doc.totalPyg)}</td>{!compact&&<td className="procurement-nowrap procurement-wide">{money(doc.paidPyg)}</td>}
    <td className="procurement-nowrap">{money(doc.balancePyg)}</td>{!compact&&<><td className="procurement-nowrap">{doc.dueDate??'—'}</td><td className={wide}><Status state={doc.state}/></td></>}
    <td><DetailButton description={'Abrir documento '+(doc.reference||doc.description)} onClick={()=>open('documents',doc.id)}/></td>
  </tr>)}</Table>;
}
export function SettlementTable({rows,open,compact=false}:{rows:Settlement[];open:Open;compact?:boolean}) {
  const heads=compact?['Fecha','Operación','Importe','Disponible','Acción']:['Fecha','Proveedor','Operación','Cuenta','Importe','Aplicado','Disponible','Estado','Acción'];
  return <Table heads={heads}>{rows.map(item=><tr key={item.id}>
    <td className="procurement-nowrap">{item.eventDate}</td>{!compact&&<td>{item.partyName}</td>}
    <td><strong>{settlementLabel(item.kind)}</strong>{(item.reference||item.description)&&<small>{item.reference||item.description}</small>}</td>
    {!compact&&<td>{item.accountName??'—'}{item.method&&<small>{item.method}</small>}</td>}
    <td className="procurement-nowrap">{money(item.amountPyg)}</td>{!compact&&<td className="procurement-nowrap">{money(item.appliedPyg)}</td>}
    <td className="procurement-nowrap">{money(item.availablePyg)}</td>{!compact&&<td><Status state={item.state}/></td>}
    <td><DetailButton description={'Abrir '+settlementLabel(item.kind).toLowerCase()+' de '+item.partyName} onClick={()=>open('settlements',item.id)}/></td>
  </tr>)}</Table>;
}
export function MovementTable({rows,open,compact=false}:{rows:Movement[];open:Open;compact?:boolean}) {
  return <Table heads={['Fecha',...(compact?[]:['Cuenta']),'Tipo','Referencia','Importe','Acción']}>{rows.map(move=><tr key={move.id}>
    <td className="procurement-nowrap">{move.eventDate}</td>{!compact&&<td>{move.accountName}</td>}
    <td>{label(move.kind)}{move.reversed&&<small>Revertido</small>}</td>
    <td>{move.reference??'—'}{move.actorName&&<small>{move.actorName}</small>}</td>
    <td className="procurement-nowrap">{money(move.amountPyg)}</td>
    <td><DetailButton description={'Abrir movimiento '+(move.reference??label(move.kind))} onClick={()=>open('movements',move.id)}/></td>
  </tr>)}</Table>;
}
type Entity=Party|Document|Settlement|Account|Movement;
const auditActions:Record<string,string>={CREATE_PARTY:'Alta de contraparte',UPDATE_PARTY:'Edición de contraparte',CREATE_ACCOUNTS:'Alta de cuenta',
  CONFIRM_DOCUMENT:'Confirmación de documento',REGISTER_PAYMENT:'Registro de pago',REGISTER_ADVANCE:'Registro de anticipo',
  REGISTER_CREDIT:'Registro de nota de crédito',APPLY_SETTLEMENT:'Aplicación',UNAPPLY_SETTLEMENT:'Aplicación deshecha',
  TRANSFER_OUT:'Transferencia saliente',TRANSFER_IN:'Transferencia entrante',ATTACH:'Adjunto guardado',ATTACHMENT_ADDED:'Adjunto guardado'};
type DetailProps={detail:Detail;result:{data?:Entity;error?:string;loading:boolean};close:()=>void;retry:()=>void;open:Open;edit:(editor:Editor)=>void;canCash:boolean;go:(screen:Screen,filter?:Filters)=>void;showAccountMovements:(id:string)=>void};
export function DetailDrawer({detail,result,close,retry,open,edit,canCash,go,showAccountMovements}:DetailProps) {
  const title={parties:'Cuenta corriente',documents:'Documento',settlements:'Pago, anticipo o crédito',accounts:'Cuenta',movements:'Movimiento'}[detail.collection];
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    heading.current?.focus({preventScroll:true});
    if(matchMedia('(max-width:1040px)').matches)heading.current?.scrollIntoView({block:'start'});
  },[]);
  const data=result.data;
  return <aside className="procurement-detail" aria-labelledby="procurement-detail-title">
    <div className="card-header"><h2 id="procurement-detail-title" ref={heading} tabIndex={-1}>{title}</h2>
      <button type="button" className="text-button" onClick={close}>Cerrar detalle</button></div>
    <Feedback error={result.error} loading={result.loading} retry={retry}/>
    {data&&detail.collection==='parties'&&<PartyDetail party={data as Party} open={open} edit={edit} go={go} canCash={canCash}/>}
    {data&&detail.collection==='documents'&&<DocumentDetail document={data as Document} open={open} edit={edit} canCash={canCash} go={go}/>}
    {data&&detail.collection==='settlements'&&<SettlementDetail settlement={data as Settlement} open={open} edit={edit}/>}
    {data&&detail.collection==='accounts'&&<AccountDetail account={data as Account} open={open} edit={edit} showAccountMovements={showAccountMovements}/>}
    {data&&detail.collection==='movements'&&<MovementDetail move={data as Movement} open={open} edit={edit}/>}
    {data&&data.events&&<Audit events={data.events}/>}
  </aside>;
}
function Facts({items}:{items:Array<[string,ReactNode]>}) {
  return <dl className="procurement-facts">{items.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value??'—'}</dd></div>)}</dl>;
}
function Primary({children,onClick,disabled}:{children:ReactNode;onClick:()=>void;disabled?:boolean}) {
  return <button type="button" className="button button-primary" onClick={onClick} disabled={disabled}><Plus aria-hidden="true"/>{children}</button>;
}
function PartyDetail({party,open,edit,go,canCash}:{party:Party;open:Open;edit:(editor:Editor)=>void;go:(screen:Screen,filter?:Filters)=>void;canCash:boolean}) {
  return <div className="procurement-detail-stack">
    <h3>{party.name}</h3>
    <Facts items={[[ 'RUC',party.ruc],['Contacto',party.contact],['Tipo',label(party.kind)],['Estado',party.active?'Activo':'Inactivo'],['Saldo pendiente',money(party.balancePyg)],['Anticipos disponibles',money(party.availableAdvancePyg)]]}/>
    <div className="heading-actions"><button type="button" className="button button-secondary" onClick={()=>edit({kind:'party',party})}>Editar</button>
      {party.active&&<>
        <Primary onClick={()=>edit({kind:'document',pay:false,partyId:party.id})}>Registrar operación</Primary>
        {canCash?<button type="button" className="button button-secondary" onClick={()=>edit({kind:'settlement',settlementKind:'PAYMENT',partyId:party.id})}>Registrar pago</button>:
          <button type="button" className="text-button" onClick={()=>go('settings')}>Configurar cuenta de origen</button>}
      </>}
    </div>
    <div><div className="card-header"><h3>Documentos recientes</h3><button type="button" className="text-button" onClick={()=>go('documents',{partyId:party.id})}>Ver todos</button></div>
      {party.documents?.length?<DocumentTable rows={party.documents} open={open} compact/>:<p className="empty-state">Sin documentos.</p>}</div>
    <div><div className="card-header"><h3>Pagos y créditos recientes</h3><button type="button" className="text-button" onClick={()=>go('settlements',{partyId:party.id})}>Ver todos</button></div>
      {party.settlements?.length?<SettlementTable rows={party.settlements} open={open} compact/>:<p className="empty-state">Sin operaciones.</p>}</div>
  </div>;
}
function DocumentDetail({document:doc,open,edit,canCash,go}:{document:Document;open:Open;edit:(editor:Editor)=>void;canCash:boolean;go:(screen:Screen,filter?:Filters)=>void}) {
  return <div className="procurement-detail-stack">
    <div className="heading-actions"><h3>{doc.reference||doc.description}</h3><Status state={doc.state}/></div>
    <Facts items={[[ 'Proveedor',doc.partyName],['Fecha',doc.documentDate],['Vencimiento',doc.dueDate],['Condición',label(doc.condition)],['Naturaleza',label(doc.nature)],
      ['Categoría',doc.categoryName??'Sin clasificar'],['Centro de costo',doc.centerName],['Responsable',doc.actorName],['Total',money(doc.totalPyg)],['Pagado',money(doc.paidPyg)],['Créditos',money(doc.creditPyg)],['Saldo',money(doc.balancePyg)]]}/>
    <div className="heading-actions">
      {doc.balancePyg>0&&<><Primary disabled={!canCash} onClick={()=>edit({kind:'settlement',settlementKind:'PAYMENT',document:doc})}>Pagar documento</Primary>
        <button type="button" className="button button-secondary" onClick={()=>go('settlements',{partyId:doc.partyId,state:'AVAILABLE'})}>Ver disponibles para aplicar</button></>}
      {doc.state!=='VOID'&&doc.appliedPyg===0&&<button type="button" className="text-button" onClick={()=>edit({kind:'correction',action:'VOID_DOCUMENT',id:doc.id})}>Anular documento</button>}
    </div>
    <div><div className="help-label procurement-subhead"><h3>Conceptos</h3><HelpTip label="IVA del comprobante">Desglose del documento recibido. Su registro no acredita validación de crédito fiscal.</HelpTip></div>
      <Table heads={['Concepto','Tasa IVA','IVA','Neto','Total']}>{doc.lines?.map((line,index)=><tr key={index}>
        <td>{line.description}</td><td className="procurement-nowrap">{line.vatRate===0?'Exento':line.vatRate+' %'}</td>
        <td className="procurement-nowrap">{money(line.vatPyg)}</td><td className="procurement-nowrap">{money(line.netPyg)}</td><td className="procurement-nowrap">{money(line.totalPyg)}</td>
      </tr>)}</Table>
    </div>
    <Applications rows={doc.applications??[]} mode="document" edit={edit} open={open}/>
    <Attachments rows={doc.attachments??[]} edit={()=>edit({kind:'attachment',detail:{collection:'documents',id:doc.id}})}/>
  </div>;
}


function SettlementDetail({settlement:item,open,edit}:{settlement:Settlement;open:Open;edit:(editor:Editor)=>void}) {
  return <div className="procurement-detail-stack">
    <div className="heading-actions"><h3>{settlementLabel(item.kind)}</h3><Status state={item.state}/></div>
    <Facts items={[[ 'Proveedor',item.partyName],['Fecha',item.eventDate],['Cuenta',item.accountName],['Medio',item.method],['Referencia',item.reference],['Concepto',item.description],
      ['Responsable',item.actorName],['Importe',money(item.amountPyg)],['Aplicado',money(item.appliedPyg)],['Disponible',money(item.availablePyg)],
      ...(item.kind==='CREDIT'&&item.vatPyg!==null&&item.vatPyg!==undefined?[['IVA del comprobante',money(item.vatPyg)],['Neto',money(item.netPyg)]] as Array<[string,string]>:[])]}/>
    <div className="heading-actions">
      {item.availablePyg>0&&<Primary onClick={()=>edit({kind:'apply',settlement:item})}>Aplicar {settlementLabel(item.kind).toLowerCase()}</Primary>}
      {item.state!=='REVERSED'&&<button type="button" className="text-button" onClick={()=>edit({kind:'correction',action:'REVERSE_SETTLEMENT',id:item.id,minDate:item.eventDate})}>
        Revertir {settlementLabel(item.kind).toLowerCase()}
      </button>}
    </div>
    <Applications rows={item.applications??[]} mode="settlement" edit={edit} open={open}/>
    <Attachments rows={item.attachments??[]} edit={()=>edit({kind:'attachment',detail:{collection:'settlements',id:item.id}})}/>
  </div>;
}
function Applications({rows,mode,edit,open}:{rows:Application[];mode:'document'|'settlement';edit:(editor:Editor)=>void;open:Open}) {
  return <div><h3 className="procurement-subhead">Aplicaciones</h3>
    {rows.length?<Table heads={[mode==='document'?'Origen':'Documento','Importe','Estado','Acción']}>{rows.map(row=><tr key={row.id}>
      <td>{mode==='document'?<DetailButton description="Abrir origen de la aplicación" onClick={()=>open('settlements',row.settlementId)}>{settlementLabel(row.settlementKind??'PAYMENT')}</DetailButton>:
        <DetailButton description="Abrir documento aplicado" onClick={()=>open('documents',row.documentId)}>{row.documentDescription??'Documento'}</DetailButton>}</td>
      <td className="procurement-nowrap">{money(row.amountPyg)}</td><td>{row.reversedAt?'Deshecha':'Vigente'}</td>
      <td>{row.reversedAt?'—':<button type="button" className="text-button" onClick={()=>edit({kind:'correction',action:'UNAPPLY',id:row.id})}>Deshacer aplicación</button>}</td>
    </tr>)}</Table>:<p className="empty-state">Sin aplicaciones.</p>}
  </div>;
}
function Attachments({rows,edit}:{rows:Attachment[];edit:()=>void}) {
  return <div><div className="card-header"><h3>Comprobantes</h3><button type="button" className="button button-secondary" onClick={edit}>Adjuntar</button></div>
    {rows.length?<ul className="procurement-name-list">{rows.map(row=><li key={row.id}><a href={base+'/attachments/'+row.id} download>{row.filename}</a></li>)}</ul>:
      <p className="empty-state">Sin adjuntos.</p>}
  </div>;
}
function AccountDetail({account,open,edit,showAccountMovements}:{account:Account;open:Open;edit:(editor:Editor)=>void;showAccountMovements:(id:string)=>void}) {
  return <div className="procurement-detail-stack"><h3>{account.name}</h3>
    <Facts items={[[ 'Tipo',accountLabel(account.kind)],['Saldo inicial',account.hasOpening?money(account.openingPyg):'Sin apertura definida'],
      ['Fecha de apertura',account.openingDate],['Movimientos netos',money(account.movementPyg)],['Saldo según registro',account.hasOpening?money(account.signedTotalPyg):'—']]}/>
    <div className="heading-actions"><Primary onClick={()=>edit({kind:'movement',account})}>Registrar movimiento</Primary></div>
    <div><div className="card-header"><h3>Movimientos recientes</h3><button type="button" className="text-button" onClick={()=>showAccountMovements(account.id)}>Ver todos</button></div>
      {account.movements?.length?<MovementTable rows={account.movements} open={open} compact/>:<p className="empty-state">Sin movimientos.</p>}</div>
  </div>;
}
function MovementDetail({move,open,edit}:{move:Movement;open:Open;edit:(editor:Editor)=>void}) {
  return <div className="procurement-detail-stack"><h3>{label(move.kind)} {move.reversed&&<Status state="REVERSED"/>}</h3>
    <Facts items={[[ 'Cuenta',move.accountName],['Fecha',move.eventDate],['Importe',money(move.amountPyg)],
      ['Referencia',move.reference],['Responsable',move.actorName]]}/>
    <div className="heading-actions">
      {move.settlementId&&<button type="button" className="button button-secondary" onClick={()=>open('settlements',move.settlementId!)}>Ver operación vinculada</button>}
      {!move.settlementId&&!move.reversed&&move.kind!=='REVERSAL'&&<button type="button" className="text-button" onClick={()=>edit({kind:'correction',action:'REVERSE_MOVEMENT',id:move.id,minDate:move.eventDate})}>Revertir movimiento</button>}
    </div>
    {!!move.related?.length&&<><h3>Movimientos vinculados</h3><MovementTable rows={move.related} open={open} compact/></>}
  </div>;
}
function Audit({events}:{events:AuditEvent[]}) {
  if(!events.length)return null;
  return <details className="procurement-source"><summary>Historial de cambios</summary>
    <Table heads={['Fecha','Acción','Responsable','Motivo']}>{events.map(event=><tr key={event.id}>
      <td>{event.createdAt?new Date(event.createdAt).toLocaleString('es-PY',{timeZone:'America/Asuncion'}):'—'}</td>
      <td>{auditActions[event.action??'']??label(event.action??event.kind??event.event??'—')}</td><td>{event.actorName??event.actorId??'—'}</td><td>{event.reason??'—'}</td>
    </tr>)}</Table>
  </details>;
}
