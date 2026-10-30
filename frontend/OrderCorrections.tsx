import {useRef,useState} from 'react';
import {api} from './api';
type Order={id:string;reference?:string;external_id?:string;units?:number;loaded?:number;orderUnits?:number;orderLoaded?:number;lines?:{quantity:number}[]};
export default function OrderCorrections({orders,onChanged,onError,onWorking,onSuccess,disabled=false,allowRequeue=false}:{orders:Order[];onChanged:()=>Promise<void>;onError:(message:string)=>void;onWorking?:(value:boolean)=>void;onSuccess?:(message:string)=>void;disabled?:boolean;allowRequeue?:boolean}){
 const [working,setWorking]=useState(false),[message,setMessage]=useState('');
 const command=useRef<{key:string;id:string}|null>(null);
 const loaded=orders.reduce((n,o)=>n+(o.orderLoaded??o.loaded??0),0);
 async function run(mode:'RELEASE'|'REQUEUE'){
  const names=orders.map(o=>o.reference??o.external_id).join(', '),effect=mode==='RELEASE'?'Se libera la reserva completa de cada pedido seleccionado. Sus artículos vuelven al stock Disponible y los pedidos a Borrador.':'Los pedidos conservan su reserva y vuelven a Por organizar, sin camión asignado.';
  if(!window.confirm(`${names}\n\n${loaded?`Confirmá primero que bajaste físicamente los ${loaded} bultos del camión al depósito.\n\n`:''}${effect}`))return;
  setWorking(true);onWorking?.(true);setMessage('');onError('');const key=JSON.stringify([orders.map(o=>o.id),mode,loaded>0]);if(command.current?.key!==key)command.current={key,id:crypto.randomUUID()};
  try{const result=await api<{released:number;unloaded:number}>('/api/routing/correct-orders',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:JSON.stringify({commandId:command.current.id,orderIds:orders.map(o=>o.id),mode,confirmUnloaded:loaded>0})},{timeoutMs:120000});const text=mode==='RELEASE'?`Reserva liberada: ${result.released} bultos disponibles. Los pedidos volvieron a Borrador.`:'Pedidos devueltos a Por organizar; la reserva se conserva.';setMessage(text);onSuccess?.(text);await onChanged();command.current=null;}catch(e){onError((e as Error).message);}finally{setWorking(false);onWorking?.(false);}
 }
 return <div className="dispatch-corrections"><div className="button-row">{allowRequeue&&<button type="button" className="button button-secondary" disabled={disabled||working||!orders.length} onClick={()=>void run('REQUEUE')}>{loaded?'Bajar y devolver a pendientes':'Quitar del reparto'}</button>}<button type="button" className="button button-secondary" disabled={disabled||working||!orders.length} onClick={()=>void run('RELEASE')}>{working?'Actualizando…':loaded?'Bajar y desreservar':orders.length>1?'Desreservar seleccionados':'Desreservar pedido'}</button></div>{message&&<p role="status">{message}</p>}</div>;
}
