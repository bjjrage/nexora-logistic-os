import {useEffect,useId,useRef,useState,type FormEvent,type ReactNode} from 'react';
import HelpTip from './HelpTip';
import {accountLabel,field,label,maxPyg,money,numberField,optional,query,settlementLabel,today,useProcurement,type Account,type Command,type Document,type Lookups,type Option,type Page,type Party,type Submit} from './procurement-ui';

type Prefill={categoryId?:string;centerId?:string;paymentDate?:string;description?:string|null;documentDate?:string|null;dueDate?:string|null;reference?:string|null;totalPyg?:number|null;taxRate?:number|null;taxPyg?:number|null;netPyg?:number|null;paymentMethod?:string|null;paymentAccountId?:string;paymentReference?:string|null;imported?:boolean};
type OptionValue={value:string;label:string};

function Input({label:caption,name,type='text',required,maxLength=500,initial,min,max,help,suggestions,onChange}:{label:string;name:string;type?:string;required?:boolean;maxLength?:number;initial?:string|number|null;min?:number|string;max?:number;help?:string;suggestions?:string[];onChange?:(value:string)=>void}) {
  const id=useId();
  return <div className="field"><div className="help-label"><label htmlFor={id}>{caption}</label>{help&&<HelpTip label={caption}>{help}</HelpTip>}</div>
    <input list={suggestions?.length?id+'-options':undefined} id={id} name={name} type={type} required={required} defaultValue={initial??''} maxLength={maxLength} min={min} max={max} step={type==='number'?1:undefined}
      onChange={onChange?event=>onChange(event.target.value):undefined}/>
    {!!suggestions?.length&&<datalist id={id+'-options'}>{suggestions.map(value=><option key={value} value={value}/>)}</datalist>}
  </div>;
}
function Select({label:caption,name,options,required=false,initial,placeholder='',onChange}:{label:string;name:string;options:OptionValue[];required?:boolean;initial?:string;placeholder?:string;onChange?:(value:string)=>void}) {
  const id=useId();
  return <div className="field"><label htmlFor={id}>{caption}</label><select id={id} name={name} required={required} defaultValue={initial??''} onChange={onChange?e=>onChange(e.target.value):undefined}>
    {placeholder&&<option value="">{placeholder}</option>}{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
  </select></div>;
}
const choices=(values:string[],format=label)=>values.map(value=>({value,label:format(value)}));
const refs=(values:Option[])=>values.map(o=>({value:o.id,label:o.name}));
const availableParties=(data:Lookups)=>data.parties.filter(p=>p.active);
function Amount({label:caption='Importe (Gs.)',name='amountPyg',initial,min=1,max=maxPyg,required=true,onChange}:{label?:string;name?:string;initial?:number|null;min?:number;max?:number;required?:boolean;onChange?:(value:string)=>void}) {
  return <Input label={caption} name={name} type="number" initial={initial} min={min} max={max} required={required} onChange={onChange}/>;
}
function DateField({label:caption,name='eventDate',initial,min,required=true}:{label:string;name?:string;initial?:string|null;min?:string;required?:boolean}) {
  return <Input label={caption} name={name} type="date" required={required} min={min} initial={initial}/>;
}
export function Modal({title,busy,onClose,children}:{title:string;busy:boolean;onClose:()=>void;children:ReactNode}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const id=useId();
  useEffect(()=>{
    const node=dialog.current;
    node?.showModal();
    return ()=>node?.close();
  },[]);
  return <dialog ref={dialog} className="procurement-dialog" aria-labelledby={id} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <div className="procurement-dialog-head"><h2 id={id}>{title}</h2><button type="button" className="text-button" disabled={busy} onClick={onClose}>Cerrar</button></div>
    {children}
  </dialog>;
}
export function Form({busy,onSubmit,children,save='Guardar'}:{busy:boolean;onSubmit:(data:FormData)=>void|Promise<void>;children:ReactNode;save?:string}) {
  const [error,setError]=useState('');
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    setError('');
    try {await onSubmit(new FormData(event.currentTarget));}
    catch(error){setError(error instanceof Error?error.message:'No se pudo guardar.');}
  };
  return <form className="procurement-form" onSubmit={submit}><fieldset disabled={busy}>{children}
    {error&&<p role="alert" className="notice error">{error}</p>}
    <div className="heading-actions"><button className="button button-primary" type="submit">{busy?'Guardando…':save}</button></div>
  </fieldset></form>;
}
export function PartyForm({party,busy,submit}:{party?:Party;busy:boolean;submit:Submit}) {
  return <Form busy={busy} onSubmit={data=>submit({action:'PARTY',id:party?.id,name:field(data,'name'),ruc:optional(data,'ruc'),contact:optional(data,'contact'),kind:field(data,'kind'),active:data.has('active')})}>
    <div className="procurement-fields"><Input label="Nombre o razón social" name="name" initial={party?.name} maxLength={200} required/>
      <Select label="Tipo" name="kind" options={choices(['SUPPLIER','BENEFICIARY'])} initial={party?.kind??'SUPPLIER'} required/>
      <Input label="RUC" name="ruc" initial={party?.ruc} maxLength={17} help="Usá el número y, cuando corresponda, el dígito verificador separado por guion."/>
      <Input label="Contacto" name="contact" initial={party?.contact} maxLength={300}/>
      <label className="procurement-check"><input type="checkbox" name="active" defaultChecked={party?.active??true}/>Activo</label>
    </div>
  </Form>;
}

function PaymentFields({lookups,initialAmount,initialDate,prefill,maxAmount,onAmountChange}:{lookups:Lookups;initialAmount?:number|null;initialDate?:string|null;prefill?:Prefill;maxAmount?:number;onAmountChange?:(value:string)=>void}) {
  return <div className="procurement-fields"><Amount label="Importe del pago (Gs.)" name="paymentAmountPyg" initial={initialAmount} max={maxAmount} onChange={onAmountChange}/>
    <DateField label="Fecha del pago" name="paymentDate" initial={initialDate}/>
    <Select label="Cuenta de origen" name="accountId" options={refs(lookups.accounts)} initial={prefill?.paymentAccountId} required placeholder="Seleccionar cuenta"/>
    <Input label="Medio de pago" name="method" suggestions={lookups.paymentMethods} maxLength={60} initial={prefill?.paymentMethod} required/>
    <Input label="Referencia del pago" name="paymentReference" initial={prefill?.paymentReference} maxLength={180}/>
  </div>;
}
export function DocumentFields({lookups,partyId,pay=false,prefill}:{lookups:Lookups;partyId?:string;pay?:boolean;prefill?:Prefill}) {
  const [condition,setCondition]=useState('CASH');
  const [documentDate,setDocumentDate]=useState(prefill?.documentDate??(prefill?.imported?'':today()));
  const [rows,setRows]=useState([{id:1,total:prefill?.totalPyg??0}]);
  const nextRow=useRef(2);
  const grandTotal=rows.reduce((sum,row)=>sum+row.total,0);
  return <>
    <div className="procurement-fields">
      <Select label="Proveedor o beneficiario" name="partyId" options={refs(availableParties(lookups))} required placeholder="Seleccionar" initial={partyId}/>
      <Select label="Naturaleza" name="nature" options={choices(['EXPENSE','PURCHASE','ASSET','REMUNERATION'])} required placeholder="Seleccionar"/>
      <Select label="Categoría" name="categoryId" initial={prefill?.categoryId} options={refs(lookups.categories)} placeholder="Sin clasificar"/>
      <Select label="Centro de costo" name="centerId" initial={prefill?.centerId} options={refs(lookups.centers)} placeholder="Sin centro"/>
      <label className="field">Fecha del documento<input name="documentDate" type="date" value={documentDate} onChange={e=>setDocumentDate(e.target.value)} required/></label>
      <Select label="Condición" name="condition" options={choices(['CASH','CREDIT'])} initial="CASH" onChange={setCondition} required/>
      <DateField label="Vencimiento" name="dueDate" min={documentDate||undefined} initial={prefill?.dueDate} required={condition==='CREDIT'}/>
      <Input label="N.º de comprobante" name="reference" initial={prefill?.reference} maxLength={180}/>
    </div>
    <div className="help-label"><h3>Conceptos</h3><HelpTip label="Importes e IVA">Ingresá el total con IVA incluido y el desglose del comprobante. El IVA queda registrado según el documento recibido.</HelpTip></div>
    {rows.map((row,i)=><DocumentLine key={row.id} index={i} prefill={row.id===1?prefill:undefined} canRemove={rows.length>1}
      changeTotal={total=>setRows(current=>current.map(item=>item.id===row.id?{...item,total}:item))}
      remove={()=>setRows(current=>current.filter(item=>item.id!==row.id))}/>)}
    <div className="heading-actions"><button type="button" className="button button-secondary" disabled={rows.length===100} onClick={()=>{
      const id=nextRow.current++;
      setRows(current=>[...current,{id,total:0}]);
    }}>Agregar concepto</button>
      <output className="procurement-amounts" aria-live="polite">Total del documento <strong>{money(grandTotal)}</strong></output></div>
    {pay&&<><h3>Pago</h3><PaymentFields lookups={lookups} prefill={prefill} initialDate={prefill?.paymentDate??(prefill?.imported?undefined:today())} initialAmount={prefill?.totalPyg} maxAmount={Math.min(grandTotal,maxPyg)}/></>}
  </>;
}
function DocumentLine({index,canRemove,remove,prefill,changeTotal}:{index:number;canRemove:boolean;remove:()=>void;prefill?:Prefill;changeTotal:(value:number)=>void}) {
  const [rate,setRate]=useState(String(prefill?.taxRate??0));
  const [total,setTotal]=useState(String(prefill?.totalPyg??''));
  const [vat,setVat]=useState(String(prefill?.taxPyg??''));
  const net=Number(total)-(rate==='0'?0:Number(vat));
  return <fieldset className="procurement-line">
    <legend>Concepto {index+1}</legend>
    <div className="procurement-fields"><Input name="lineDescription" label="Descripción" initial={prefill?.description} maxLength={300} required/>
      <label className="field">Total con IVA (Gs.)<input name="lineTotal" type="number" min={1} max={maxPyg} step={1} required value={total} onChange={e=>{
        setTotal(e.target.value);changeTotal(Number(e.target.value));
      }}/></label>
      <Select label="Tasa IVA" name="lineRate" initial={rate} options={[{value:'0',label:'Exento'},{value:'5',label:'5 %'},{value:'10',label:'10 %'}]} onChange={setRate} required/>
      <label className="field">IVA del comprobante (Gs.)<input name="lineVat" type="number" min={0} max={Number(total)||maxPyg} step={1} required readOnly={rate==='0'} value={rate==='0'?'0':vat} onChange={e=>setVat(e.target.value)}/></label>
      <output className="procurement-net"><span>Neto</span><strong>{total?money(net):'—'}</strong></output>
    </div>
    {canRemove&&<button type="button" className="text-button procurement-start" onClick={remove}>Quitar concepto {index+1}</button>}
  </fieldset>;
}
export function documentCommand(data:FormData,pay:boolean):Command {
  const totals=data.getAll('lineTotal'),rates=data.getAll('lineRate'),taxes=data.getAll('lineVat');
  const lines=data.getAll('lineDescription').map((description,i)=>{
    const totalPyg=Number(totals[i]),vatPyg=Number(taxes[i]);
    return {description:String(description).trim(),totalPyg,vatRate:Number(rates[i]),vatPyg,netPyg:totalPyg-vatPyg};
  });
  const documentDate=field(data,'documentDate');
  return {action:'DOCUMENT',partyId:field(data,'partyId'),nature:field(data,'nature'),categoryId:optional(data,'categoryId'),
    centerId:optional(data,'centerId'),documentDate,dueDate:field(data,'dueDate')||documentDate,condition:field(data,'condition'),reference:optional(data,'reference'),lines,
    payment:pay?{amountPyg:numberField(data,'paymentAmountPyg'),eventDate:field(data,'paymentDate'),accountId:field(data,'accountId'),method:field(data,'method'),reference:optional(data,'paymentReference')}:undefined};
}

export function SettlementFields({lookups,kind,partyId,document,prefill}:{lookups:Lookups;kind:'PAYMENT'|'ADVANCE'|'CREDIT';partyId?:string;document?:Document;prefill?:Prefill}) {
  const [creditTotal,setCreditTotal]=useState(prefill?.totalPyg??0);
  const [creditVat,setCreditVat]=useState(prefill?.taxPyg??0);
  const [creditRate,setCreditRate]=useState(prefill?.taxRate??0);
  const [selectedParty,setSelectedParty]=useState(partyId);
  const [amount,setAmount]=useState(prefill?.totalPyg??0);
  const [apply,setApply]=useState(true);
  const canApply=Boolean(prefill?.imported&&kind==='PAYMENT'&&!document);
  return <>
    <div className="procurement-fields">
      <Select label="Proveedor o beneficiario" name="partyId" options={refs(document?lookups.parties.filter(p=>p.id===document.partyId):availableParties(lookups))} required placeholder="Seleccionar" initial={document?.partyId??partyId} onChange={canApply?setSelectedParty:undefined}/>
      <Input name="description" label="Concepto" initial={prefill?.description} maxLength={300} required={kind==='CREDIT'}/>
      {kind==='CREDIT'&&<>
        <DateField label="Fecha de la nota de crédito" initial={prefill?.documentDate??(prefill?.imported?undefined:today())}/>
        <Input label="N.º de nota de crédito" name="reference" initial={prefill?.reference} maxLength={180}/>
        <label className="field">Total con IVA (Gs.)<input name="creditTotal" type="number" min={1} max={maxPyg} step={1} required value={creditTotal||''} onChange={e=>setCreditTotal(Number(e.target.value))}/></label>
        <Select label="Tasa IVA" name="creditRate" options={[{value:'0',label:'Exento'},{value:'5',label:'5 %'},{value:'10',label:'10 %'}]} initial={String(creditRate)} onChange={value=>setCreditRate(Number(value))} required/>
        <label className="field">IVA del comprobante (Gs.)<input name="creditVat" type="number" min={0} max={creditTotal||maxPyg} required readOnly={creditRate===0} value={creditRate===0?0:creditVat} onChange={e=>setCreditVat(Number(e.target.value))}/></label>
        <output className="procurement-net"><span>Neto</span><strong>{money(creditTotal-(creditRate===0?0:creditVat))}</strong></output>
      </>}
    </div>
    {kind!=='CREDIT'&&<PaymentFields lookups={lookups} prefill={prefill} initialDate={prefill?.paymentDate??(prefill?.imported?undefined:today())}
      initialAmount={prefill?.totalPyg??document?.balancePyg} maxAmount={document?.balancePyg}
      onAmountChange={canApply?value=>setAmount(Number(value)):undefined}/>}
    {canApply&&selectedParty&&<>
      <div className="help-label"><label className="procurement-check"><input type="checkbox" checked={apply} onChange={event=>setApply(event.target.checked)}/>Aplicar a factura</label>
        <HelpTip label="Aplicar a factura">El importe aplicado reduce el saldo de la factura. Si desmarcás la opción, el pago queda disponible para aplicar después.</HelpTip></div>
      {apply&&<ImportedPaymentApplication key={selectedParty} partyId={selectedParty} amount={amount}/>}
    </>}
  </>;
}
export function settlementCommand(data:FormData,kind:'PAYMENT'|'ADVANCE'|'CREDIT',document?:Document):Command {
  const isCredit=kind==='CREDIT';
  const amountPyg=numberField(data,isCredit?'creditTotal':'paymentAmountPyg');
  const vatPyg=isCredit?numberField(data,'creditVat'):undefined;
  const importedDocumentId=optional(data,'importedDocumentId');
  const applications=document?[{documentId:document.id,amountPyg}]:
    importedDocumentId?[{documentId:importedDocumentId,amountPyg:numberField(data,'importedAppliedPyg')}]:undefined;
  return {action:'SETTLEMENT',partyId:field(data,'partyId'),kind,amountPyg,eventDate:field(data,isCredit?'eventDate':'paymentDate'),
    accountId:isCredit?undefined:field(data,'accountId'),method:isCredit?undefined:field(data,'method'),
    reference:optional(data,isCredit?'reference':'paymentReference'),description:optional(data,'description'),vatRate:isCredit?numberField(data,'creditRate'):undefined,
    vatPyg,netPyg:vatPyg===undefined?undefined:amountPyg-vatPyg,
    applications};
}

function ImportedPaymentApplication({partyId,amount}:{partyId:string;amount:number}) {
  const [row,setRow]=useState<ApplicationRow>({search:'',documentId:'',amount:''});
  return <ApplicationLine partyId={partyId} revision={0} available={amount} row={row} named
    patch={patch=>setRow(current=>({...current,...patch}))}/>;
}

export function ApplyForm({partyId,settlementId,available,revision,busy,submit}:{partyId:string;settlementId:string;available:number;revision:number;busy:boolean;submit:Submit}) {
  const [lines,setLines]=useState([{id:1,search:'',documentId:'',amount:''}]);
  const next=useRef(2);
  const used=lines.reduce((sum,row)=>sum+Number(row.amount),0);
  return <Form busy={busy} save="Aplicar" onSubmit={()=>submit({action:'APPLY',settlementId,applications:lines.map(row=>({documentId:row.documentId,amountPyg:Number(row.amount)}))})}>
    <div className="procurement-amounts"><span>Disponible <strong>{money(available)}</strong></span><span>Remanente <strong>{money(available-used)}</strong></span></div>
    {lines.map(row=><ApplicationLine key={row.id} partyId={partyId} revision={revision} available={available-used+Number(row.amount)} row={row}
      patch={patch=>setLines(current=>current.map(item=>item.id===row.id?{...item,...patch}:item))}
      remove={lines.length>1?()=>setLines(current=>current.filter(item=>item.id!==row.id)):undefined}/>)}
    <button type="button" className="button button-secondary procurement-start" disabled={lines.length===100} onClick={()=>{
      const id=next.current++;
      setLines(current=>[...current,{id,search:'',documentId:'',amount:''}]);
    }}>Agregar documento</button>
  </Form>;
}
type ApplicationRow={search:string;documentId:string;amount:string};
function ApplicationLine({partyId,revision,available,row,patch,remove,named=false}:{partyId:string;revision:number;available:number;row:ApplicationRow;patch:(patch:Partial<ApplicationRow>)=>void;remove?:()=>void;named?:boolean}) {
  const selectId=useId();
  const [page,setPage]=useState(0);
  const docs=useProcurement<Page<Document>>('/payables?'+query({partyId,q:row.search,limit:25,offset:page*25}),revision);
  const [chosen,setChosen]=useState<Document>();
  const options=docs.data?.items??[];
  const visible=chosen&&!options.some(doc=>doc.id===chosen.id)?[chosen,...options]:options;
  return <fieldset className="procurement-line"><div className="procurement-fields">
    <label className="field">Buscar documento<input type="search" value={row.search} onChange={e=>{setPage(0);patch({search:e.target.value});}}/></label>
    <div className="field"><label htmlFor={selectId}>Documento</label><select id={selectId} name={named?'importedDocumentId':undefined} required value={row.documentId} onChange={e=>{
      const match=visible.find(doc=>doc.id===e.target.value);
      setChosen(match);
      patch({documentId:e.target.value,amount:match?String(Math.min(match.balancePyg,available)):''});
    }}><option value="">{docs.loading?'Cargando…':docs.data?.items.length===0?'Sin facturas pendientes':'Seleccionar documento'}</option>{visible.map(doc=><option value={doc.id} key={doc.id}>{doc.reference||doc.description} · {doc.documentDate} · {money(doc.balancePyg)}</option>)}</select></div>
    <label className="field">Importe aplicado (Gs.)<input name={named?'importedAppliedPyg':undefined} type="number" min={1} max={Math.min(available,chosen?.balancePyg??available)} step={1} value={row.amount} required onChange={e=>patch({amount:e.target.value})}/></label>
  </div>
    {docs.error&&<p className="notice error" role="alert">{docs.error}</p>}
    {(page>0||docs.data?.hasMore)&&<div className="heading-actions">
      <button type="button" className="text-button" disabled={!page} onClick={()=>setPage(n=>n-1)}>Anteriores</button>
      <button type="button" className="text-button" disabled={!docs.data?.hasMore} onClick={()=>setPage(n=>n+1)}>Siguientes</button></div>}
    {remove&&<button type="button" className="text-button procurement-start" onClick={remove}>Quitar documento</button>}
  </fieldset>;
}
export function CorrectionForm({id,action,minDate,busy,submit}:{id:string;action:'UNAPPLY'|'VOID_DOCUMENT'|'REVERSE_SETTLEMENT'|'REVERSE_MOVEMENT';minDate?:string;busy:boolean;submit:Submit}) {
  const dated=action==='REVERSE_SETTLEMENT'||action==='REVERSE_MOVEMENT';
  return <Form busy={busy} save="Confirmar" onSubmit={data=>submit({action,id,reason:field(data,'reason'),eventDate:dated?field(data,'eventDate'):undefined})}>
    <div className="procurement-fields"><Input name="reason" label="Motivo" required/>
      {dated&&<DateField label="Fecha del reverso" min={minDate} initial={minDate&&minDate>today()?minDate:today()}/>}
    </div>
  </Form>;
}
export function CatalogForm({kind,busy,submit}:{kind:'ACCOUNT'|'CATEGORY'|'CENTER';busy:boolean;submit:Submit}) {
  return <Form busy={busy} onSubmit={data=>submit({action:kind,name:field(data,'name'),kind:kind==='ACCOUNT'?field(data,'kind'):undefined})}>
    <div className="procurement-fields"><Input label="Nombre" name="name" required maxLength={120}/>
      {kind==='ACCOUNT'&&<Select label="Tipo" name="kind" options={choices(['CASH','BANK'],accountLabel)} initial="CASH" required/>}
    </div>
  </Form>;
}
export function MovementForm({account,lookups,busy,submit}:{account:Account;lookups:Lookups;busy:boolean;submit:Submit}) {
  const [kind,setKind]=useState('ENTRY');
  return <Form busy={busy} onSubmit={data=>submit({action:'MOVEMENT',accountId:account.id,kind:field(data,'kind'),destinationAccountId:optional(data,'destinationAccountId'),amountPyg:numberField(data,'amountPyg'),eventDate:field(data,'eventDate'),reference:field(data,'reference')})}>
    <div className="procurement-fields">
      <Select label="Movimiento" name="kind" options={choices([...(!account.hasOpening?['OPENING']:[]),'ENTRY','EXIT','TRANSFER'])} initial="ENTRY" onChange={setKind} required/>
      {kind==='TRANSFER'&&<Select label="Cuenta de destino" name="destinationAccountId" options={refs(lookups.accounts.filter(a=>a.id!==account.id))} placeholder="Seleccionar cuenta" required/>}
      <DateField label="Fecha del movimiento" initial={today()}/>
      <Amount min={kind==='OPENING'?-maxPyg:1}/>
      <Input label="Referencia" name="reference" maxLength={180} required/>
    </div>
  </Form>;
}
export function BudgetForm({categories,categoryId,month,amount,busy,submit}:{categories:Option[];categoryId?:string|null;month?:string;amount?:number|null;busy:boolean;submit:Submit}) {
  return <Form busy={busy} onSubmit={data=>submit({action:'BUDGET',categoryId:field(data,'categoryId'),month:field(data,'month'),amountPyg:field(data,'amountPyg')===''?null:numberField(data,'amountPyg')})}>
    <div className="procurement-fields">
      <Select label="Categoría" name="categoryId" options={refs(categories)} initial={categoryId??undefined} placeholder="Seleccionar categoría" required/>
      <Input label="Mes" name="month" type="month" initial={month??today().slice(0,7)} required/>
      <Input label="Presupuesto (Gs.)" name="amountPyg" type="number" initial={amount} min={0} max={maxPyg} help="Dejá el campo vacío para Sin definir. Escribí 0 para definir un presupuesto de cero."/>
    </div>
  </Form>;
}
