import {useState,type FormEvent} from 'react';
import {useModalFocus} from './useModalFocus';
export default function Reauthentication({busy,error,onAuthenticate}:{busy:boolean;error:string;onAuthenticate:(path:string,body:Record<string,unknown>)=>Promise<void>}){
 const [username,setUsername]=useState(''),[password,setPassword]=useState('');useModalFocus(true,()=>{});
 const submit=async(e:FormEvent)=>{e.preventDefault();await onAuthenticate('/api/login',{username:username.trim(),password});};
 return <div className="modal-backdrop"><section className="modal-card modal-card-narrow" role="dialog" aria-modal="true" aria-labelledby="reauth-title"><h2 id="reauth-title">Tu sesión venció</h2><p>El formulario sigue abierto. Ingresá con la misma cuenta para continuar sin perder lo escrito.</p><form className="stack" onSubmit={submit}><label className="field"><span>Usuario</span><input required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label><label className="field"><span>Contraseña</span><input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="notice error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy?'Ingresando…':'Continuar con mi formulario'}</button></form></section></div>;
}
