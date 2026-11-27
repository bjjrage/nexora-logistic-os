import {randomUUID} from 'node:crypto';
import type {Actor} from './auth.ts';
import type {Database,Row} from './database.ts';
import type {Procurement} from './procurement.ts';
import type {HistoricalRow,ImportIssue} from './procurement-workbook.ts';

export const paymentKey=(value:string|null|undefined)=>value?.trim().normalize('NFC').toLowerCase()??'';
const key=paymentKey;
const identity=(left:string,right:string)=>left+'\n'+key(right);

function uniqueIndex(rows:Row[],id:(row:Row)=>string) {
  const map=new Map<string,Row|null>();
  for(const row of rows) {
    const value=id(row);
    if(value)map.set(value,map.has(value)?null:row);
  }
  return map;
}

export function paymentPartyLookup(parties:Row[]) {
  const byRuc=new Map(parties.filter(row=>row.ruc).map(row=>[row.ruc,row]));
  const byName=uniqueIndex(parties,row=>key(row.name));
  return (source:HistoricalRow)=>{
    const named=byName.get(key(source.supplier));
    const party=source.taxId?byRuc.get(source.taxId):named;
    return party&&Number(party.active)&&(!named||named.id===party.id)?party:undefined;
  };
}

export async function applyImportedPayments(store:Database,procurement:Pick<Procurement,'execute'>,actor:Actor,batchId:string,onlyRows?:ReadonlySet<string>) {
  const org=actor.orgId;
  const pending=(await store.all(`SELECT id,normalized_json,issues_json,prior_json FROM procurement_import_rows
    WHERE org_id=? AND batch_id=? AND state='PENDING' ORDER BY row_number`,org,batchId)).flatMap(row=>{
    if(onlyRows&&!onlyRows.has(row.id))return [];
    const source=JSON.parse(row.normalized_json) as HistoricalRow;
    return source.payment?[{row,source,payment:source.payment,
      issues:(JSON.parse(row.issues_json) as ImportIssue[]).filter(issue=>!issue.code.startsWith('PAYMENT_'))}]:[];
  });
  if(!pending.length)return;

  const [parties,accounts,documents,settlements]=await Promise.all([
    store.all('SELECT id,name,ruc,active FROM procurement_parties WHERE org_id=?',org),
    store.all(`SELECT a.id,a.name,m.event_date AS opening_date FROM procurement_accounts a
      LEFT JOIN procurement_movements m ON m.org_id=a.org_id AND m.account_id=a.id AND m.kind='OPENING'
        AND NOT EXISTS (SELECT 1 FROM procurement_movements r WHERE r.org_id=m.org_id AND r.reversal_of=m.id)
      WHERE a.org_id=?`,org),
    store.all(`SELECT d.id,d.party_id,d.reference,d.document_date,d.total_pyg-COALESCE(a.applied,0) AS balance
      FROM procurement_documents d LEFT JOIN (
        SELECT org_id,document_id,SUM(amount_pyg) AS applied FROM procurement_applications
        WHERE org_id=? AND reversed_at IS NULL GROUP BY org_id,document_id
      ) a ON a.org_id=d.org_id AND a.document_id=d.id
      WHERE d.org_id=? AND d.voided_at IS NULL`,org,org),
    store.all(`SELECT party_id,account_id,reference FROM procurement_settlements
      WHERE org_id=? AND kind IN ('PAYMENT','ADVANCE') AND reference IS NOT NULL`,org),
  ]);
  const findParty=paymentPartyLookup(parties);
  const byAccount=uniqueIndex(accounts,row=>key(row.name));
  const byInvoice=uniqueIndex(documents,row=>row.reference?identity(row.party_id,row.reference):'');
  const byInvoiceId=new Map(documents.map(row=>[row.id,row]));
  const paidByAccount=new Set(settlements.map(row=>identity(row.account_id,row.reference)));
  const paidByParty=new Set(settlements.map(row=>identity(row.party_id,row.reference)));
  const check=({row,source,payment,issues}:typeof pending[number])=>{
    if(issues.some(issue=>issue.code==='POSSIBLE_EXAMPLE'))return 'Fila marcada como ejemplo.';
    if(source.historicalStatus&&!['pagado','confirmado','aplicado'].includes(key(source.historicalStatus)))return 'El estado del archivo no indica un pago confirmado.';
    const required=[
      [source.taxId||source.supplier,'proveedor o RUC'],[payment.invoiceDocumentId||payment.invoiceReference,'número de factura'],
      [payment.reference,'referencia del pago'],[payment.date,'fecha de pago'],[source.totalPyg,'importe'],
      [payment.account,'cuenta de origen'],[source.paymentMethod,'medio de pago'],
    ] as const;
    const missing=required.filter(([value])=>!value).map(([,label])=>label);
    if(missing.length)return 'Datos faltantes o inválidos: '+missing.join(', ')+'.';
    const {date,invoiceReference,account,reference}=payment;
    const amount=source.totalPyg,method=source.paymentMethod;
    if(!date||!account||!reference||!amount||!method)return 'Faltan datos obligatorios.';
    if(reference.length>180||method.length>60)return 'La referencia o el medio de pago supera el largo permitido.';
    const party=findParty(source);
    if(!party)return 'El proveedor no coincide con una contraparte activa única.';
    const origin=byAccount.get(key(account));
    if(!origin)return 'La cuenta de origen no coincide con una cuenta única.';
    const accountKey=identity(origin.id,reference),partyKey=identity(party.id,reference);
    if(paidByAccount.has(accountKey)||paidByParty.has(partyKey))return 'La referencia del pago ya está registrada.';
    const prior=JSON.parse(row.prior_json) as {state:string;type:string}[];
    if(prior.some(match=>match.state==='PROMOTED'&&match.type!=='POSSIBLE_MATCH'))return 'Una versión anterior de esta fila ya fue registrada.';
    const document=payment.invoiceDocumentId?byInvoiceId.get(payment.invoiceDocumentId):
      invoiceReference?byInvoice.get(identity(party.id,invoiceReference)):undefined;
    if(!document||document.party_id!==party.id)return 'El número de factura no coincide con una factura vigente única del proveedor.';
    if(date<document.document_date||origin.opening_date&&date<origin.opening_date)return 'La fecha del pago es anterior a la factura o a la apertura de la cuenta.';
    if(BigInt(amount)>BigInt(document.balance))return 'El importe supera el saldo pendiente de la factura.';
    return {document,partyId:party.id,accountId:origin.id,eventDate:date,amountPyg:amount,method,reference};
  };

  const groups=new Map<string,typeof pending>();
  for(const item of pending) {
    const reference=key(item.payment.reference);
    const groupKey=reference?'ref:'+reference:'row:'+item.row.id;
    const group=groups.get(groupKey)??[];
    group.push(item);
    groups.set(groupKey,group);
  }

  const transfers=[...groups.values()].map(items=>{
    const checked=items.map(check);
    const matches=checked.filter(result=>typeof result!=='string');
    const first=matches[0];
    const total=matches.reduce((sum,result)=>sum+BigInt(result.amountPyg),0n);
    const declared=new Set(items.flatMap(item=>item.payment.transferTotal===undefined?[]:[item.payment.transferTotal]));
    let reason=checked.find(result=>typeof result==='string');
    if(!reason&&matches.some(result=>result.partyId!==first.partyId||result.accountId!==first.accountId||
        result.eventDate!==first.eventDate||key(result.method)!==key(first.method))) {
      reason='La referencia tiene distinto proveedor, cuenta, fecha o medio de pago.';
    }
    if(!reason&&new Set(matches.map(result=>result.document.id)).size!==matches.length) {
      reason='La misma factura figura más de una vez para esta transferencia.';
    }
    if(!reason&&(declared.size>1||[...declared].some(amount=>amount===null||BigInt(amount)!==total))) {
      reason='El total de la transferencia difiere de la suma aplicada a las facturas.';
    }
    if(!reason&&(matches.length>100||total>BigInt(Number.MAX_SAFE_INTEGER))) {
      reason='La transferencia supera el límite de facturas o de importe.';
    }
    return {items,matches,first,total,reason};
  });

  const invoiceTotals=new Map<string,bigint>();
  for(const transfer of transfers)if(!transfer.reason)for(const match of transfer.matches) {
    const id=match.document.id;
    invoiceTotals.set(id,(invoiceTotals.get(id)??0n)+BigInt(match.amountPyg));
  }
  for(const {items,matches,first,total,reason} of transfers) {
    const problem=reason??(matches.some(match=>(invoiceTotals.get(match.document.id)??0n)>BigInt(match.document.balance))
      ?'Los pagos de la planilla superan juntos el saldo de la factura.':undefined);
    if(problem) {
      const code=items.length>1?'PAYMENT_GROUP_REVIEW':'PAYMENT_REVIEW';
      const message=items.length>1?'Transferencia por revisar. '+problem:problem;
      for(const {row,issues} of items)await store.run('UPDATE procurement_import_rows SET issues_json=? WHERE org_id=? AND id=?',
        JSON.stringify([...issues,{code,message}]),org,row.id);
      continue;
    }
    const commandId=randomUUID();
    const financial=await procurement.execute(actor,{commandId,action:'SETTLEMENT',kind:'PAYMENT',
      partyId:first.partyId,accountId:first.accountId,eventDate:first.eventDate,method:first.method,reference:first.reference,
      amountPyg:Number(total),description:items[0].source.description?.slice(0,300)??undefined,
      applications:matches.map(match=>({documentId:match.document.id,amountPyg:match.amountPyg})),
    },items[0].row.id);
    const outcome={operationId:financial.id,action:'SETTLEMENT',commandId};
    const resolvedAt=new Date().toISOString();
    for(const {row,issues} of items)await store.run(`UPDATE procurement_import_rows SET state='PROMOTED',outcome_json=?,issues_json=?,resolution_reason=?,resolved_by=?,resolved_at=?
      WHERE org_id=? AND id=?`,JSON.stringify(outcome),JSON.stringify(issues),'Pago aplicado desde la planilla por coincidencia de factura.',
    actor.id,resolvedAt,org,row.id);
  }
}
