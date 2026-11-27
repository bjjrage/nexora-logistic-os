import {useEffect,useRef,useState,type ReactNode} from 'react';
import {api} from './api';

export const base='/api/procurement';
export const size=25;
export type Page<T>={items:T[];hasMore:boolean;limit:number;offset:number};
export type Option={id:string;name:string};
export type Nature='EXPENSE'|'PURCHASE'|'ASSET'|'REMUNERATION';
export type Party=Option&{ruc?:string|null;contact?:string|null;kind:'SUPPLIER'|'BENEFICIARY';active:boolean;documents?:Document[];settlements?:Settlement[];events?:AuditEvent[];balancePyg?:number;availableAdvancePyg?:number};
export type Line={description:string;totalPyg:number;vatRate:number;vatPyg:number;netPyg:number};
export type Application={id:string;documentId:string;settlementId:string;amountPyg:number;state?:string;reversedAt?:string|null;voidedAt?:string|null;createdAt?:string;eventDate?:string;documentDescription?:string;settlementKind?:string};
export type Attachment={id:string;filename:string;mime?:string;createdAt:string};
export type AuditEvent={id:string;action?:string;kind?:string;event?:string;actorId?:string;actorName?:string;createdAt?:string;reason?:string|null};
export type Document={id:string;partyId:string;partyName:string;nature:Nature;categoryId:string|null;categoryName:string|null;centerId:string|null;centerName:string|null;documentDate:string;dueDate:string;condition:'CASH'|'CREDIT';reference:string|null;description:string;totalPyg:number;vatPyg:number;netPyg:number;paidPyg:number;creditPyg:number;appliedPyg:number;balancePyg:number;state:string;actorName?:string;lines?:Line[];applications?:Application[];attachments?:Attachment[];events?:AuditEvent[]};
export type Settlement={id:string;partyId:string;partyName:string;kind:'PAYMENT'|'ADVANCE'|'CREDIT';amountPyg:number;eventDate:string;accountId?:string|null;accountName?:string|null;method?:string|null;reference?:string|null;description?:string|null;availablePyg:number;appliedPyg:number;state:string;vatRate?:number|null;vatPyg?:number|null;netPyg?:number|null;actorId?:string;actorName?:string;applications?:Application[];attachments?:Attachment[];events?:AuditEvent[]};
export type Account=Option&{kind:'BANK'|'CASH';hasOpening:boolean;openingPyg:number|null;openingDate?:string|null;movementPyg:number;signedTotalPyg:number|null;movements?:Movement[];events?:AuditEvent[]};
export type Movement={id:string;accountId:string;accountName:string;kind:string;eventDate:string;amountPyg:number;reference?:string|null;reversed?:boolean;settlementId?:string|null;actorName?:string;related?:Movement[];events?:AuditEvent[]};
export type Budget={categoryId:string|null;categoryName:string|null;month:string;budgetPyg:number|null;executedPyg:number;remainingPyg:number|null};
export type Lookups={parties:Party[];categories:Option[];centers:Option[];accounts:Account[];paymentMethods:string[]};
export type Command=Record<string,unknown>&{action:string};
export type CommandResult={id:string};
export type Submit=(command:Command)=>Promise<void>;

const labels:Record<string,string>={SUPPLIER:'Proveedor',BENEFICIARY:'Beneficiario',EXPENSE:'Gasto',PURCHASE:'Compra',ASSET:'Activo',REMUNERATION:'Remuneración',CASH:'Contado',CREDIT:'Crédito',PAYMENT:'Pago',ADVANCE:'Anticipo',BANK:'Banco',OPEN:'Pendiente',PARTIAL:'Parcial',PAID:'Pagado',OVERDUE:'Vencido',VOID:'Anulado',AVAILABLE:'Disponible',APPLIED:'Aplicado',REVERSED:'Revertido',OPENING:'Apertura',ENTRY:'Entrada',EXIT:'Salida',TRANSFER:'Transferencia',REVERSAL:'Reverso',PARTY:'Contraparte',DOCUMENT:'Confirmación de documento',SETTLEMENT:'Registro de pago o crédito',APPLY:'Aplicación',UNAPPLY:'Aplicación deshecha',VOID_DOCUMENT:'Anulación de documento',REVERSE_SETTLEMENT:'Reversión de pago o crédito',MOVEMENT:'Movimiento',REVERSE_MOVEMENT:'Reversión de movimiento'};
export const label=(key:string)=>key==='REVIEW'?'Por revisar':labels[key]??key;
export const settlementLabel=(key:string)=>key==='CREDIT'?'Nota de crédito':label(key);
export const accountLabel=(key:string)=>key==='CASH'?'Caja':label(key);
const pyg=new Intl.NumberFormat('es-PY',{style:'currency',currency:'PYG',maximumFractionDigits:0});
export const money=(n:number|null|undefined)=>n===null||n===undefined?'—':pyg.format(n);
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const errorText=(error:unknown)=>error instanceof Error?error.message:'No se pudo completar la solicitud.';
export const field=(data:FormData,name:string)=>String(data.get(name)??'').trim();
export const numberField=(data:FormData,name:string)=>Number(field(data,name));
export const optional=(data:FormData,name:string)=>field(data,name)||undefined;
export const maxPyg=Number.MAX_SAFE_INTEGER;

export function query(values:Record<string,string|number|undefined|null>) {
  const params=new URLSearchParams();
  Object.entries(values).forEach(([key,value])=>{if(value!==''&&value!==undefined&&value!==null)params.set(key,String(value));});
  return params.toString();
}
export function post<T>(path:string,body:object) {
  return api<T>(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:JSON.stringify(body)});
}
export function useProcurement<T>(path:string|null,revision=0) {
  const [request,setRequest]=useState<{key:string;data?:T;error?:string}>();
  useEffect(()=>{
    if(!path)return;
    const controller=new AbortController();
    const key=path+'#'+revision;
    void api<T>(base+path,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setRequest({key,data});
    }).catch(error=>{
      if(!controller.signal.aborted)setRequest({key,error:errorText(error)});
    });
    return ()=>controller.abort();
  },[path,revision]);
  const result=request?.key===path+'#'+revision?request:undefined;
  return {data:result?.data,error:result?.error,loading:Boolean(path&&!result)};
}

async function allPages<T>(path:string,signal:AbortSignal) {
  const items:T[]=[];
  let offset=0;
  for (;;) {
    const result=await api<Page<T>>(base+'/'+path+'?'+query({limit:100,offset}),{signal});
    items.push(...result.items);
    if(!result.hasMore)return items;
    offset+=result.limit;
  }
}
export function useLookups(revision:number) {
  const [data,setData]=useState<Lookups>();
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    setError('');
    void Promise.all([
      allPages<Party>('parties',controller.signal), allPages<Option>('categories',controller.signal),
      allPages<Option>('centers',controller.signal), allPages<Account>('accounts',controller.signal), api<{paymentMethods:string[]}>(base+'/imports/options',{signal:controller.signal}),
    ]).then(([parties,categories,centers,accounts,{paymentMethods}])=>{
      if(!controller.signal.aborted)setData({parties,categories,centers,accounts,paymentMethods});
    }).catch(error=>{if(!controller.signal.aborted)setError(errorText(error));});
    return ()=>controller.abort();
  },[revision]);
  return {data,error};
}

export function useCommand() {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const inFlight=useRef(false);
  const pending=useRef(new Map<string,string>());
  async function run<T>(path:string,body:Record<string,unknown>):Promise<T|undefined> {
    if(inFlight.current)return;
    const key=JSON.stringify([path,body]);
    const commandId=pending.current.get(key)??crypto.randomUUID();
    pending.current.set(key,commandId);
    inFlight.current=true;
    setBusy(true);
    setError('');
    try {
      const result=await post<T>(path,{...body,commandId});
      pending.current.delete(key);
      return result;
    } catch(error) {setError(errorText(error));}
    finally {inFlight.current=false;setBusy(false);}
  }
  return {busy,error,setError,run};
}

export async function fileBase64(file:File,maxBytes:number) {
  if(!file.size||file.size>maxBytes)throw new Error('El tamaño del archivo no es válido.');
  const url=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
  return url.slice(url.indexOf(',')+1);
}

export function Feedback({loading,error,retry}:{loading?:boolean;error?:string;retry?:()=>void}) {
  return <>{loading&&<p role="status">Cargando…</p>}{error&&<div className="notice error procurement-feedback" role="alert"><span>{error}</span>
    {retry&&<button type="button" className="text-button" onClick={retry}>Reintentar</button>}</div>}</>;
}
export function Status({state,children}:{state:string;children?:ReactNode}) {
  const tone=state==='OVERDUE'?'warning':state==='PAID'||state==='ACTIVE'?'success':'neutral';
  return <span className={'badge badge-'+tone}>{children??label(state)}</span>;
}
export function Table({heads,children,columnClasses,className}:{heads:string[];children:ReactNode;columnClasses?:string[];className?:string}) {
  return <div className="table-wrap" tabIndex={0}><table className={className}><thead><tr>{heads.map((head,index)=><th scope="col" key={head} className={columnClasses?.[index]}>{head}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export function Pagination({page,hasMore,change}:{page:number;hasMore:boolean;change:(page:number)=>void}) {
  if(page===0&&!hasMore)return null;
  return <nav className="pagination procurement-pagination" aria-label="Páginas de resultados">
    <button type="button" className="button button-secondary" disabled={page===0} onClick={()=>change(page-1)}>Anterior</button>
    <span>{page+1}</span>
    <button type="button" className="button button-secondary" disabled={!hasMore} onClick={()=>change(page+1)}>Siguiente</button>
  </nav>;
}
