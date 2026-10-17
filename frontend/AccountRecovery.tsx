import {useState} from 'react';
import {api} from './api';
export default function AccountRecovery({id,kind='USER'}:{id:string;kind?:'USER'|'CUSTOMER'}){
 const [link,setLink]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const issue=async()=>{if(busy)return;setBusy(true);setError('');setLink('');try{const value=await api<{token:string}>('/api/password-recovery/issue',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:JSON.stringify({id,kind})});setLink(`${location.origin}/#restablecer=${value.token}`);}catch(e){setError(e instanceof Error?e.message:'No se pudo emitir el enlace.');}finally{setBusy(false);}};
 return <div><button className="text-button" disabled={busy} onClick={()=>void issue()}>{busy?'Preparando…':'Restablecer acceso'}</button>{link&&<div className="notice"><p>Compartí este enlace en privado con la persona. Vence en 15 minutos. Generar otro invalida el anterior.</p><input aria-label="Enlace privado de recuperación" readOnly value={link} onFocus={e=>e.target.select()}/><button className="button button-secondary" onClick={()=>void navigator.clipboard.writeText(link).catch(()=>setError('Seleccioná y copiá el enlace manualmente.'))}>Copiar enlace</button><button className="text-button" onClick={()=>setLink('')}>Ocultar</button></div>}{error&&<p role="alert">{error}</p>}</div>;
}
