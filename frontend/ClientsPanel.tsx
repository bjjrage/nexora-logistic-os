import {useMemo,useState,type FormEvent} from 'react';
import {Plus,Pencil,ArrowRight} from 'lucide-react';
import {useModalFocus} from './useModalFocus';
import CustomerAccessPanel from './CustomerAccessPanel';
import ClientLocations from './ClientLocations';
import HelpTip from './HelpTip';
import {api} from './api';

export type ClientRecord={id:string;name:string;legalName?:string|null;taxId?:string|null;contactName?:string|null;phone?:string|null;email?:string|null;address?:string|null;city?:string|null;notes?:string|null;catalogProductCount?:number|string};
type ClientForm={name:string;legalName:string;taxId:string;contactName:string;phone:string;email:string;address:string;city:string;notes:string};
type Props={profileEnabled:boolean;initialClientId?:string;clients:ClientRecord[];shipments:{clientId:string}[];canManage:boolean;canManageAccess?:boolean;busy:boolean;actionError:string;onInventory:(clientId:string,view:'catalog'|'receive')=>void;action:(path:string,payload:Record<string,unknown>,message:string,onResult?:(result:Record<string,unknown>)=>void)=>Promise<boolean>};
const emptyForm:ClientForm={name:'',legalName:'',taxId:'',contactName:'',phone:'',email:'',address:'',city:'',notes:''};
const requiredDetails={legalName:'razón social',taxId:'RUC / identificación fiscal',contactName:'persona de contacto',phone:'teléfono',address:'dirección'};
const missingDetails=(client:ClientRecord)=>Object.entries(requiredDetails).filter(([key])=>!String(client[key as keyof ClientRecord]??'').trim()).map(([,label])=>label);
const value=(text?:string|null)=>text?.trim()||'Sin completar';
type RemovalPreview={name:string;totals:{products:number;orders:number;shipments:number;stockUnits:number};roadParcels:number;blocked:boolean};
type Field={key:keyof ClientForm;label:string;max:number;type?:string;placeholder?:string;wide?:boolean};
const groups:{title:string;fields:Field[]}[]=[
 {title:'Empresa',fields:[{key:'name',label:'Nombre comercial *',max:500,placeholder:'Ej. Universo',wide:true},{key:'legalName',label:'Razón social',max:500,placeholder:'Nombre fiscal de la empresa'},{key:'taxId',label:'RUC / identificación fiscal',max:80}]},
 {title:'Persona de contacto',fields:[{key:'contactName',label:'Nombre del contacto',max:200},{key:'phone',label:'Teléfono / WhatsApp',max:80,type:'tel',placeholder:'+595…'},{key:'email',label:'Correo electrónico',max:254,type:'email',wide:true}]},
 {title:'Dirección de la empresa',fields:[{key:'address',label:'Dirección',max:500,placeholder:'Calle, número y referencia'},{key:'city',label:'Ciudad',max:160},{key:'notes',label:'Observaciones internas',max:2000,type:'textarea',wide:true,placeholder:'Acuerdos de recepción o indicaciones del cliente'}]}
];

export default function ClientsPanel({profileEnabled,initialClientId='',clients,shipments,canManage,canManageAccess=false,busy,actionError,action,onInventory}:Props){
 const [editing,setEditing]=useState<ClientRecord|null>(null),[creating,setCreating]=useState(false),[form,setForm]=useState<ClientForm>(emptyForm),[failed,setFailed]=useState(false);
 const [selectedId,setSelectedId]=useState(initialClientId);
 const [clientView,setClientView]=useState<'profile'|'depot'>('profile');
 const [deliveryProvider,setDeliveryProvider]=useState('NEXORA');
 const [checkingRemoval,setCheckingRemoval]=useState(false);
 const [removalError,setRemovalError]=useState<{id:string;message:string}|null>(null);
 const selected=clients.find(client=>client.id===selectedId);
 const open=creating||!!editing,close=()=>{if(!busy){setCreating(false);setEditing(null);setFailed(false);}};
 useModalFocus(open,close);
 const counts=useMemo(()=>{const map=new Map<string,number>();shipments.forEach(s=>map.set(s.clientId,(map.get(s.clientId)??0)+1));return map;},[shipments]);
 const edit=(client:ClientRecord)=>{setEditing(client);setCreating(false);setForm(Object.fromEntries(Object.keys(emptyForm).map(key=>[key,client[key as keyof ClientRecord]??''])) as ClientForm);setFailed(false);};
 const submit=async(event:FormEvent)=>{
  event.preventDefault();setFailed(false);
  if(!profileEnabled)return;
  const payload=Object.fromEntries(Object.entries(form).map(([key,text])=>[key,text.trim()]));
  if(!editing)payload.deliveryProvider=deliveryProvider;
  const saved=await action(editing?'/api/clients/'+editing.id:'/api/clients',payload,editing?'Ficha del cliente actualizada.':'Cliente registrado.',result=>{if(typeof result.id==='string')setSelectedId(result.id);});
  if(saved){setCreating(false);setEditing(null);}else setFailed(true);
 };
 const remove=async(client:ClientRecord)=>{
  setCheckingRemoval(true);setRemovalError(null);
  const path='/api/clients/'+encodeURIComponent(client.id);
  try{
   const preview=await api<RemovalPreview>(path+'/removal');
   if(preview.blocked){
    const detail=preview.roadParcels?` (${preview.roadParcels} bultos)`:'';
    setRemovalError({id:client.id,message:`Mercadería cargada o en reparto${detail}. Terminá el reparto o devolvé la carga al depósito para eliminar al cliente.`});
    return;
   }
   const {products,orders,shipments,stockUnits}=preview.totals;
   if(!window.confirm(`¿Eliminar definitivamente a ${preview.name}? Se borrarán ${products} SKU, ${stockUnits} unidades de stock, ${orders} pedidos, ${shipments} envíos y los demás registros propios del cliente.`))return;
   if(await action(path+'/delete',{expectedName:preview.name,expectedTotals:preview.totals},'Cliente y registros eliminados.')){
    setSelectedId('');setClientView('profile');
   }
  }catch(error){
   setRemovalError({id:client.id,message:error instanceof Error?error.message:'No se pudo verificar el borrado.'});
  }finally{setCheckingRemoval(false);}
 };
 if(!profileEnabled)return <><div className="page-heading"><div><p className="eyebrow">CLIENTES DE NEXORA</p><h1>Clientes</h1></div></div><p className="notice" role="status">Estamos actualizando la ficha de clientes. Tus registros existentes se conservan.</p><section className="card"><h2>Clientes registrados</h2>{clients.map(client=><p key={client.id}>{client.name}</p>)}</section></>;
 const editor=open&&<div className="modal-backdrop"><section className="modal-card client-editor" role="dialog" aria-modal="true" aria-labelledby="client-editor-title">
  <div className="card-header"><div><h2 id="client-editor-title">{editing?'Editar ficha del cliente':'Registrar cliente'}</h2><p>Datos de la empresa que entrega su mercadería a Nexora.</p></div><button className="text-button" onClick={close} disabled={busy}>Cerrar</button></div>
  <form className="stack" onSubmit={submit}><fieldset disabled={busy}>{groups.map(group=><fieldset key={group.title}><legend>{group.title}</legend><div className="client-form-grid">{group.fields.map(item=><label key={item.key} className={'field'+(item.wide?' client-field-wide':'')}><span>{item.label}</span>{item.type==='textarea'?<textarea rows={2} maxLength={item.max} value={form[item.key]} placeholder={item.placeholder} onChange={e=>setForm(current=>({...current,[item.key]:e.target.value}))}/>:<input required={item.key==='name'} type={item.type??'text'} maxLength={item.max} value={form[item.key]} placeholder={item.placeholder} onChange={e=>setForm(current=>({...current,[item.key]:e.target.value}))}/>}</label>)}</div></fieldset>)}</fieldset>
   {!editing&&<label className="field"><span>Sistema de reparto</span><select aria-label="Sistema de reparto" value={deliveryProvider} disabled={busy} onChange={e=>setDeliveryProvider(e.target.value)}><option value="NEXORA">Nexora · Camiones propios y GPS Traccar</option><option value="QUADMINDS">QuadMinds · Reparto externo</option></select><small>Los pedidos de Nexora se organizan automáticamente desde Rutas.</small></label>}
   <div className="client-form-actions"><p className="muted">* Obligatorio. Podés guardar una ficha parcial y completar los datos después.</p>
   {failed&&<p className="notice error" role="alert">{actionError||'No se pudo guardar la ficha.'}</p>}
   <button className="button button-primary" disabled={busy||!form.name.trim()}>{busy?'Guardando…':editing?'Guardar ficha':'Registrar cliente'}</button></div>
  </form></section></div>;
 if(selected){
  const missing=missingDetails(selected),productCount=Number(selected.catalogProductCount??0);
  return <>
   <button className="text-button inventory-back" onClick={()=>{setSelectedId('');setClientView('profile');}}>← Clientes</button>
   <div className="page-heading"><div><p className="eyebrow">FICHA DEL CLIENTE</p><h1>{selected.name}</h1></div><div className="button-row">
    {canManage&&<button className="button button-secondary" onClick={()=>edit(selected)}><Pencil size={15}/>Editar ficha</button>}
    {canManageAccess&&<button className="button button-secondary" type="button" disabled={busy||checkingRemoval} onClick={()=>void remove(selected)}>Eliminar cliente</button>}
   </div></div>
   {removalError?.id===selected.id&&<p className="notice error" role="alert">{removalError.message}</p>}
   <nav className="workspace-tabs secondary-tabs" aria-label="Secciones del cliente">
    <button type="button" aria-pressed={clientView==='profile'} onClick={()=>setClientView('profile')}>Ficha</button>
    <button type="button" aria-pressed={clientView==='depot'} onClick={()=>setClientView('depot')}>Depósito</button>
   </nav>
   {clientView==='depot'?<>
    <section className="card"><div className="card-header"><div className="help-label"><h2>Mercadería en depósito</h2><HelpTip label="Mercadería en depósito">Catálogo y recepción de {selected.name}.</HelpTip></div></div>
     <div className="inventory-actions"><button type="button" className="button button-primary" onClick={()=>onInventory(selected.id,'receive')}>Recibir mercadería</button><button type="button" className="button button-secondary" onClick={()=>onInventory(selected.id,'catalog')}>Ver catálogo / importar</button></div>
    </section>
    <ClientLocations key={'locations-'+selected.id} clientId={selected.id}/>
    {canManageAccess?<CustomerAccessPanel key={selected.id} clientId={selected.id} clientName={selected.name}/>:<section className="card"><div className="help-label"><h2>Acceso al portal</h2><HelpTip label="Acceso al portal">Administración habilita los usuarios de este cliente para consultar su mercadería.</HelpTip></div></section>}
   </>:<>
   <section className="card"><div className="card-header"><h2>Datos del cliente</h2><span className="badge badge-neutral">{missing.length?'Datos por completar':'Ficha completa'}</span></div>
    <dl className="client-details"><div><dt>Razón social</dt><dd>{value(selected.legalName)}</dd></div><div><dt>RUC / identificación fiscal</dt><dd>{value(selected.taxId)}</dd></div><div><dt>Contacto</dt><dd>{value(selected.contactName)}</dd></div><div><dt>Teléfono / WhatsApp</dt><dd>{value(selected.phone)}</dd></div><div><dt>Correo electrónico</dt><dd>{value(selected.email)}</dd></div><div><dt>Dirección y ciudad</dt><dd>{[selected.address,selected.city].filter(Boolean).join(' · ')||'Sin completar'}</dd></div></dl>
    {selected.notes&&<details className="tracking-help"><summary>Observaciones internas</summary><p>{selected.notes}</p></details>}
    {missing.length>0&&<p className="client-missing">Por completar: {missing.join(', ')}.</p>}
   </section>
   <section aria-labelledby="client-next-steps"><h2 id="client-next-steps">Seguí con este cliente</h2><div className="client-steps">
    <article className="client-step"><span className="client-step-number">1</span><h3>Ficha del cliente</h3><p>{missing.length?'Completá sus datos de empresa y contacto.':'Datos de empresa y contacto registrados.'}</p>{canManage&&<button className="button button-secondary" onClick={()=>edit(selected)}>Completar / editar ficha</button>}</article>
    <article className="client-step"><span className="client-step-number">2</span><h3>Recibir mercadería</h3><button className="button button-primary" onClick={()=>onInventory(selected.id,'receive')}>Ir a recepción<ArrowRight size={15}/></button></article>
    <article className="client-step"><h3>Catálogo de productos</h3><p>{productCount} SKU registrados</p><button className="button button-secondary" onClick={()=>onInventory(selected.id,'catalog')}>Importar catálogo<ArrowRight size={15}/></button></article>
   </div></section>
   <section className="card"><div className="card-header"><div className="help-label"><h2>Portal del cliente</h2><HelpTip label="Portal del cliente">Habilitá sus usuarios desde Depósito para consultar y exportar su inventario, movimientos y pedidos.</HelpTip></div></div><button type="button" className="button button-secondary" onClick={()=>setClientView('depot')}>Abrir depósito<ArrowRight size={15}/></button></section>
   </>}
   {editor}</>;
 }
 return <>
  <div className="page-heading"><div><p className="eyebrow">CLIENTES DE NEXORA</p><h1>Clientes</h1><p className="muted">Registrá la empresa y su contacto antes de recibir su mercadería.</p></div>{canManage&&<button className="button button-primary" onClick={()=>{setForm({...emptyForm});setDeliveryProvider('NEXORA');setCreating(true);setEditing(null);setFailed(false);}}><Plus size={16}/>Registrar cliente</button>}</div>
  <section className="card"><div className="card-header"><h2>Clientes registrados</h2></div>{clients.length?<div className="table-wrap"><table className="table"><thead><tr><th>Cliente / RUC</th><th>Contacto</th><th>Ficha</th><th>Acciones</th></tr></thead><tbody>{clients.map(client=><tr key={client.id}><td><strong>{client.name}</strong><small>{client.taxId||'RUC sin completar'}</small></td><td>{client.contactName||'Sin contacto'}<small>{client.phone||'Teléfono sin completar'}</small></td><td>{missingDetails(client).length?'Datos por completar':'Completa'}<small>{counts.get(client.id)??0} envíos en la vista</small></td><td><div className="client-row-actions"><button className="button button-secondary" onClick={()=>{setSelectedId(client.id);}}>Abrir ficha</button>{canManage&&<button className="text-button" onClick={()=>edit(client)}>Editar</button>}</div></td></tr>)}</tbody></table></div>:<p className="empty-state">Registrá la primera empresa que te entrega mercadería.</p>}</section>
  {editor}</>;
}

