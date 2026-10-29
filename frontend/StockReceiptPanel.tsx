import {useCallback,useEffect,useRef,useState} from 'react';
import {FileSpreadsheet,History,PackagePlus,Plus,Search,Trash2} from 'lucide-react';
import BarcodeScanner from './BarcodeScanner';
import {api,type ApiProblem} from './api';
import type {ReceiptPreview,ReceiptRow} from '../server/stock-receipts';

type FileSource={csv?:string;filename?:string;contentBase64?:string};
export type ReceiptSeed=FileSource&{token:string};
type ReadResult={rows:ReceiptRow[];sheets:string[];sheet:string;fields:string[]};
type Product={id:string;sku:string;name:string;tracking:'QUANTITY'|'SERIAL'};
type HistoryItem={id:string;reference:string;status:string;source:string;filename?:string;client_name:string;actor_name:string;row_count:number;product_count:number;unit_count:number;created_at:string};
type Props={active:boolean;clients:Array<{id:string;name:string}>;locations:Array<{id:string;code:string;name:string}>;clientId:string;locationId:string;onClientChange:(id:string)=>void;onLocationChange:(id:string)=>void;onReceived:()=>Promise<void>;onShowStock:()=>void;onShowCatalog:()=>void;seed:ReceiptSeed|null};
const PAGE_SIZE=20;
const referenceFor=(id:string)=>'REC-'+id.slice(0,8).toUpperCase();
async function post<T>(path:string,payload:unknown){return api<T>(path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:JSON.stringify(payload)});}
function problem(caught:unknown){
 const error=caught as ApiProblem&{details?:{rowErrors?:Array<{row:number;message:string}>}};
 return (error instanceof Error?error.message:'No se pudo completar la operación.')+(error.details?.rowErrors?.length?' '+error.details.rowErrors.slice(0,5).map(e=>`Fila ${e.row}: ${e.message}`).join(' '):'');
}
async function fileSource(file:File):Promise<FileSource>{
 if(file.size>5*1024*1024)throw new Error('El archivo admite hasta 5 MB.');
 if(/\.csv$/i.test(file.name))return {csv:await file.text(),filename:file.name};
 if(!/\.xlsx$/i.test(file.name))throw new Error('Elegí un archivo .xlsx o .csv.');
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return {filename:file.name,contentBase64:btoa(binary)};
}

export default function StockReceiptPanel({active,clients,locations,clientId,locationId,onClientChange,onLocationChange,onReceived,onShowStock,onShowCatalog,seed}:Props){
 const [initialId]=useState(()=>crypto.randomUUID());
 const [commandId,setCommandId]=useState(initialId);
 const [reference,setReference]=useState(()=>referenceFor(initialId));
 const [reason,setReason]=useState('');
 const [mode,setMode]=useState<'file'|'paste'|'scan'>('file');
 const [rows,setRows]=useState<ReceiptRow[]>([]);
 const [source,setSource]=useState<FileSource|null>(null);
 const [sourceType,setSourceType]=useState<'XLSX'|'CSV'|'MANUAL'>('MANUAL');
 const [sheets,setSheets]=useState<string[]>([]),[sheet,setSheet]=useState('');
 const [showAdvanced,setShowAdvanced]=useState(false);
 const [paste,setPaste]=useState('');
 const [preview,setPreview]=useState<ReceiptPreview|null>(null);
 const [allowRepeated,setAllowRepeated]=useState(false);
 const [completeSheet,setCompleteSheet]=useState(false);
 const [page,setPage]=useState(0),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[success,setSuccess]=useState('');
 const [serialProduct,setSerialProduct]=useState<Product|null>(null);
 const [catalogSearch,setCatalogSearch]=useState(''),[catalogPage,setCatalogPage]=useState(0);
 const [catalog,setCatalog]=useState<Product[]>([]),[catalogTotal,setCatalogTotal]=useState(0);
 const [history,setHistory]=useState<HistoryItem[]>([]),[showHistory,setShowHistory]=useState(false);
 const [historyError,setHistoryError]=useState(''),[historyBusy,setHistoryBusy]=useState(false);
 const generation=useRef(0),reading=useRef(0),scanQueue=useRef(Promise.resolve()),serialProductRef=useRef<Product|null>(null),scannedSerials=useRef(new Set<string>());
 const context=useRef({active,clientId,locationId});context.current={active,clientId,locationId};
 useEffect(()=>{setCatalogPage(0);setCatalogSearch('');serialProductRef.current=null;scannedSerials.current.clear();setSerialProduct(null);},[clientId]);
 useEffect(()=>{
  if(!active||mode!=='scan'||!clientId)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{void api<{items:Product[];total:number}>('/api/inventory/products?'+new URLSearchParams({clientId,q:catalogSearch,limit:String(PAGE_SIZE),offset:String(catalogPage*PAGE_SIZE)}),{signal:controller.signal}).then(result=>{setCatalog(result.items);setCatalogTotal(result.total);}).catch(caught=>{if(!controller.signal.aborted)setError(problem(caught));});},200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[active,mode,clientId,catalogSearch,catalogPage]);
 const invalidate=useCallback(()=>{generation.current++;setPreview(null);setAllowRepeated(false);setError('');setSuccess('');setCommandId(crypto.randomUUID());},[]);
 const read=useCallback(async(nextSource:FileSource,nextSheet?:string)=>{
  const request=++reading.current;invalidate();setBusy(true);
  try{
   const result=await post<ReadResult>('/api/inventory/receipts/read',{...nextSource,...(nextSheet?{sheet:nextSheet}:{})});
   if(request!==reading.current)return;
   setRows(result.rows);setSheets(result.sheets);setSheet(result.sheet);setSource(nextSource);setPage(0);setSerialProduct(null);serialProductRef.current=null;scannedSerials.current.clear();
   setShowAdvanced(result.rows.some(row=>!!(row.serial||row.barcode||row.locationCode)));
   setSourceType(nextSource.contentBase64?'XLSX':'CSV');
  }catch(caught){if(request===reading.current)setError(problem(caught));}
  finally{if(request===reading.current)setBusy(false);}
 },[invalidate]);
 useEffect(()=>{if(seed){setMode('file');void read(seed);}return()=>{reading.current++;};},[seed,read]);
 const loadHistory=useCallback(async()=>{
  setHistoryBusy(true);setHistoryError('');
  try{const result=await api<{items:HistoryItem[]}>('/api/inventory/receipts/imports'+(clientId?'?clientId='+encodeURIComponent(clientId):''));setHistory(result.items);}
  catch(caught){setHistoryError(problem(caught));}finally{setHistoryBusy(false);}
 },[clientId]);
 useEffect(()=>{if(showHistory)void loadHistory();},[showHistory,loadHistory]);
 const payload=()=>({clientId,locationId,reference,reason,source:sourceType,filename:source?.filename??'',rows,allowRepeatedContent:allowRepeated,mode:completeSheet?'COMPLETE_SHEET':'ADD'});
 const validate=async()=>{
  setBusy(true);setError('');setSuccess('');const version=generation.current;
  try{
   const report=await post<ReceiptPreview>('/api/inventory/receipts/preview',payload());
   if(version!==generation.current)return;
   if(completeSheet&&(report.mode!=='COMPLETE_SHEET'||!/^[a-f0-9]{64}$/.test(report.planHash??''))){setPreview(null);setError('El servidor todavía no habilitó Solo faltantes. Actualizá la página en unos instantes; no se recibió stock.');return;}
   setPreview(report);
  }
  catch(caught){setError(problem(caught));}finally{setBusy(false);}
 };
 const confirm=async()=>{
  if(!preview?.valid||!preview.unitCount||preview.repeatedContent&&!allowRepeated||completeSheet&&(preview.mode!=='COMPLETE_SHEET'||!preview.planHash))return;
  setBusy(true);setError('');
  try{
   const result=await post<ReceiptPreview&{reference:string;status:string}>('/api/inventory/receipts/batch',{...payload(),commandId,...(completeSheet?{expectedPlanHash:preview.planHash}:{})});
   if(result.status==='UNCHANGED'){setPreview(result);setSuccess('La hoja ya está cubierta. No se agregó stock.');return;}
   setSuccess(`${result.reference} · ${result.productCount} productos · ${result.unitCount} unidades recibidas.`);
   setRows([]);setPreview(null);setSource(null);setSheets([]);setSheet('');setPaste('');setSerialProduct(null);serialProductRef.current=null;scannedSerials.current.clear();setAllowRepeated(false);setPage(0);setSourceType('MANUAL');setShowAdvanced(false);
   const nextId=crypto.randomUUID();setCommandId(nextId);setReference(referenceFor(nextId));generation.current++;
   try{await onReceived();if(showHistory)await loadHistory();}catch{setError('La recepción se guardó. No se pudo actualizar la vista; consultá el stock antes de volver a cargar.');}
  }catch(caught){
   setError(problem(caught));
   const status=(caught as ApiProblem).status;if(status&&status>=400&&status<500){setPreview(null);setCommandId(crypto.randomUUID());}
  }finally{setBusy(false);}
 };
 const change=(index:number,field:keyof ReceiptRow,value:string)=>{invalidate();setRows(current=>current.map((r,i)=>i===index?{...r,[field]:value}:r));};
 const addRow=()=>{invalidate();setRows(current=>[...current,{row:Math.max(1,...current.map(r=>r.row))+1,sku:'',quantity:'1',locationCode:'',serial:'',barcode:''}]);setPage(Math.floor(rows.length/PAGE_SIZE));};
 const clear=()=>{invalidate();setRows([]);setSource(null);setSheets([]);setSheet('');setSerialProduct(null);serialProductRef.current=null;scannedSerials.current.clear();setPage(0);setSourceType('MANUAL');setShowAdvanced(false);};
 const performScan=async(value:string)=>{
  const start={...context.current};
  setError('');
  try{
   const result=await api<{product:Product|null;unit:{serial:string}|null}>('/api/inventory/lookup?'+new URLSearchParams({clientId:start.clientId,code:value.trim()}));
   if(!start.active||!context.current.active||context.current.clientId!==start.clientId||context.current.locationId!==start.locationId)return;
   if(result.unit)throw new Error('Esa unidad ya está registrada en el inventario.');
   if(result.product?.tracking==='SERIAL'){serialProductRef.current=result.product;setSerialProduct(result.product);setShowAdvanced(true);setSuccess(`${result.product.sku}: escaneá las series nuevas o elegí otro SKU.`);return;}
   const product=result.product??serialProductRef.current;
   if(!product)throw new Error('Código desconocido. Agregá el SKU al catálogo o corregí la fila.');
   const serial=result.product?'':value.trim();
   const serialKey=product.sku+':'+serial.toLowerCase();
   if(serial&&(scannedSerials.current.has(serialKey)||rows.some(r=>r.sku===product.sku&&r.serial.toLowerCase()===serial.toLowerCase())))throw new Error('La serie ya está en este lote.');
   if(serial)scannedSerials.current.add(serialKey);
   invalidate();
   setRows(current=>{
    const existing=product.tracking==='QUANTITY'?current.findIndex(r=>r.sku===product.sku&&!r.locationCode&&!r.serial):-1;
    if(existing>=0)return current.map((r,i)=>i===existing?{...r,quantity:String(Number(r.quantity)+1)}:r);
    return [...current,{row:Math.max(1,...current.map(r=>r.row))+1,sku:product.sku,quantity:'1',locationCode:'',serial,barcode:''}];
   });
   if(result.product){serialProductRef.current=null;setSerialProduct(null);}
  }catch(caught){setError(problem(caught));}
 };
 const scan=(value:string)=>{scanQueue.current=scanQueue.current.then(()=>performScan(value));};
 const draftUnits=rows.reduce((sum,row)=>sum+(Number.isSafeInteger(Number(row.quantity))?Number(row.quantity):0),0);
 const pageRows=rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
 const previewByRow=new Map(preview?.rows.map(row=>[row.row,row]));
 return <section className="card task-card stock-receipt-panel">
  <div className="card-header"><div><h2>{completeSheet?'Completar hoja de stock':'Nueva recepción'}</h2><p>{completeSheet?'Completá el objetivo de la hoja descontando las recepciones ya registradas.':'Cargá varios productos y confirmá una sola recepción. Las cantidades se suman al stock disponible.'}</p></div><a className="text-button" href="/api/inventory/receipts/template.xlsx" download><FileSpreadsheet aria-hidden="true"/>Plantilla Excel</a></div>
  {success&&<div className="notice" role="status"><strong>{success}</strong>{!rows.length&&<button className="text-button" type="button" onClick={onShowStock}>Ver stock actualizado</button>}</div>}
  {error&&<div className="notice error" role="alert">{error}</div>}
  <fieldset disabled={busy} className="receipt-fieldset">
   <div className="inventory-form-grid">
    <label className="field"><span>Cliente dueño de la mercadería</span><select required value={clientId} onChange={event=>{invalidate();onClientChange(event.target.value);setSerialProduct(null);}}><option value="">Seleccionar cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="field"><span>Dónde se guarda</span><select required value={locationId} onChange={event=>{invalidate();onLocationChange(event.target.value);}}><option value="">Elegir depósito o sector</option>{locations.map(l=><option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></label>
    <label className="field"><span>Referencia de la recepción</span><input required maxLength={160} value={reference} onChange={event=>{invalidate();setReference(event.target.value);}} placeholder="Remito o referencia del ingreso"/><small>Debe ser única para este cliente.</small></label>
    <label className="field"><span>Observación</span><input maxLength={500} value={reason} onChange={event=>{invalidate();setReason(event.target.value);}}/></label>
   </div>
   <div className="receipt-completion-option"><label className="receipt-checkbox"><input type="checkbox" checked={completeSheet} onChange={event=>{invalidate();setCompleteSheet(event.target.checked);}}/>Cargar solo lo que falta de la hoja</label><p className="muted">{completeSheet?"Cada cantidad es el total a completar. Se descuenta lo ya recibido para este cliente, incluso lo reservado, cargado o entregado. No se reducen los excedentes.":"Recepción nueva: las cantidades de la hoja se suman al stock existente."}</p></div><nav className="workflow-tabs" aria-label="Cómo cargar mercadería">{([['file','Subir Excel o CSV'],['paste','Pegar tabla'],['scan','Escanear o agregar']] as const).map(([value,label])=><button key={value} type="button" className={mode===value?'workflow-tab is-active':'workflow-tab'} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</nav>
   {mode==='file'&&<div className="stack receipt-source"><label className="field"><span>Archivo de stock</span><input type="file" accept=".xlsx,.csv" disabled={rows.length>0} onChange={event=>{const file=event.target.files?.[0];if(file)void fileSource(file).then(next=>read(next)).catch(caught=>setError(problem(caught)));event.target.value='';}}/><small>{source?.filename||'Incluí SKU y Cantidad. Podés usar la hoja Stock sugerido del catálogo de prueba.'}{rows.length>0?' Vaciá el lote para reemplazar el archivo.':''}</small></label>{sheets.length>0&&<label className="field"><span>Hoja de stock</span><select value={sheet} onChange={event=>{if(source)void read(source,event.target.value);}}>{sheets.map(name=><option key={name}>{name}</option>)}</select></label>}</div>}
   {mode==='paste'&&<div className="stack receipt-source"><label className="field"><span>Tabla copiada desde Excel</span><textarea rows={5} value={paste} onChange={event=>setPaste(event.target.value)} placeholder={'SKU\tCantidad\nMOCK-NX-0001\t25'}/><small>Incluí los encabezados. Acepta tabulaciones, coma o punto y coma.</small></label><button type="button" className="button button-secondary" disabled={!paste.trim()||rows.length>0} onClick={()=>void read({csv:paste})}>Leer tabla</button></div>}
   {mode==='scan'&&<div className="stack receipt-source"><BarcodeScanner onScan={scan} disabled={!active||!clientId||!locationId||busy} label="Escanear SKU, código de barras o serie"/><label className="field"><span>Buscar producto</span><input value={catalogSearch} onChange={event=>{setCatalogSearch(event.target.value);setCatalogPage(0);}} placeholder="Nombre, SKU o código de barras"/></label><div className="receipt-product-picker">{catalog.filter(product=>(product as Product&{active?:boolean}).active!==false).map(product=><button type="button" className="button button-secondary" key={product.id} disabled={!clientId||!locationId} onClick={()=>scan(product.sku)}>{product.name} · {product.sku}</button>)}</div>{catalogTotal>PAGE_SIZE&&<div className="pagination"><button type="button" className="text-button" disabled={catalogPage===0} onClick={()=>setCatalogPage(value=>value-1)}>Productos anteriores</button><span>{catalogPage+1} de {Math.ceil(catalogTotal/PAGE_SIZE)}</span><button type="button" className="text-button" disabled={(catalogPage+1)*PAGE_SIZE>=catalogTotal} onClick={()=>setCatalogPage(value=>value+1)}>Más productos</button></div>}{serialProduct&&<p className="notice">{serialProduct.sku}: escaneando series individuales. <button type="button" className="text-button" onClick={()=>{serialProductRef.current=null;setSerialProduct(null);}}>Cambiar producto</button></p>}<button className="button button-secondary" type="button" onClick={addRow}><Plus aria-hidden="true"/>Agregar producto</button></div>}
   {rows.length>0&&<>
    <div className="receipt-summary"><strong>{rows.length} filas · {draftUnits.toLocaleString('es-PY')} {completeSheet?'unidades objetivo':'unidades por recibir'}</strong><button className="text-button" type="button" onClick={clear}><Trash2 aria-hidden="true"/>Vaciar lote</button></div>
    <p className="muted">{completeSheet?"Validá para calcular lo que falta de cada SKU. Las filas ya cubiertas agregan cero unidades.":"Estas cantidades se suman al stock actual. Revisá «Disponible después» antes de confirmar."}</p><button className="text-button" type="button" aria-expanded={showAdvanced} onClick={()=>setShowAdvanced(value=>!value)}>{showAdvanced?"Ocultar ubicación y series por fila":"Mostrar ubicación y series por fila"}</button>
    <div className="table-wrap receipt-editor"><table><thead><tr><th>Fila</th><th>SKU o código</th><th>{completeSheet?"Objetivo hoja":"Cantidad"}</th>{showAdvanced&&<><th>Ubicación opcional</th><th>Serie opcional</th><th>Código individual</th></>}{preview&&<><th>Producto</th>{completeSheet&&<><th>Ya recibido (SKU)</th><th>Falta recibir</th></>}<th>Disponible actual</th><th>Disponible después</th></>}<th>Acción</th></tr></thead><tbody>{pageRows.map((row,index)=>{
     const at=page*PAGE_SIZE+index,validated=previewByRow.get(row.row),issues=preview?.rowErrors.filter(issue=>issue.row===row.row)??[];
     return <tr key={row.row} className={issues.length?'receipt-invalid':undefined}><td>{row.row}{issues.map((issue,i)=><small key={i} className="receipt-row-error">{issue.message}</small>)}</td>{(['sku','quantity',...(showAdvanced?['locationCode','serial','barcode'] as const:[])] as const).map(field=><td key={field}><input aria-label={`${field==='quantity'?'Cantidad':field==='sku'?'SKU':field==='locationCode'?'Ubicación':field==='serial'?'Serie':'Código individual'} fila ${row.row}`} inputMode={field==='quantity'?'numeric':undefined} maxLength={field==='quantity'?8:160} value={row[field]} onChange={event=>change(at,field,event.target.value)}/></td>)}{preview&&<><td>{validated?.productName??'Revisar SKU'}</td>{completeSheet&&<><td>{validated?.alreadyReceived??'—'}</td><td>{validated?.incoming??'—'}</td></>}<td>{validated?.current??'—'}</td><td>{validated?.after??'—'}</td></>}<td><button type="button" className="text-button" aria-label={`Quitar fila ${row.row}`} onClick={()=>{invalidate();setRows(current=>current.filter((_,i)=>i!==at));setPage(p=>Math.min(p,Math.max(0,Math.ceil((rows.length-1)/PAGE_SIZE)-1)));}}>Quitar</button></td></tr>;
    })}</tbody></table></div>
    {rows.length>PAGE_SIZE&&<div className="pagination"><button type="button" className="text-button" onClick={()=>setPage(p=>p-1)} disabled={page===0}>Anterior</button><span>Página {page+1} de {Math.ceil(rows.length/PAGE_SIZE)}</span><button type="button" className="text-button" onClick={()=>setPage(p=>p+1)} disabled={(page+1)*PAGE_SIZE>=rows.length}>Siguiente</button></div>}
    <div className="inventory-actions"><button className="button button-secondary" type="button" onClick={addRow}><Plus aria-hidden="true"/>Agregar fila</button><button className="button button-primary" type="button" disabled={!clientId||!locationId||!reference.trim()} onClick={()=>void validate()}><Search aria-hidden="true"/>{busy?'Validando…':'Validar recepción'}</button></div>
   </>}
  </fieldset>
  {preview&&<div className={preview.valid?'server-import-preview is-valid':'server-import-preview has-errors'} role={preview.valid?'status':'alert'}>
   <strong>{preview.valid?(preview.unitCount?`${preview.productCount} productos · ${preview.unitCount} unidades listas para recibir`:'Hoja ya cubierta: no falta recibir mercadería.'):'Corregí el lote antes de recibir'}</strong>
   {!!preview.rowErrors.length&&<><ul>{preview.rowErrors.slice(0,12).map((issue,i)=><li key={i}>Fila {issue.row}: {issue.message}</li>)}</ul>{preview.rowErrors.length>12&&<p>{preview.rowErrors.length} errores en total. Revisalos en las filas de la tabla.</p>}<button type="button" className="text-button" onClick={onShowCatalog}>Abrir catálogo del cliente</button></>}
   {preview.warnings.map((warning,i)=><p key={i}>{warning}</p>)}
   {preview.repeatedContent&&<label className="receipt-checkbox"><input type="checkbox" checked={allowRepeated} disabled={busy} onChange={event=>{setAllowRepeated(event.target.checked);setCommandId(crypto.randomUUID());}}/>Es una recepción nueva de mercadería con las mismas cantidades.</label>}
   {preview.valid&&preview.unitCount>0&&<button className="button button-primary" type="button" disabled={busy||preview.repeatedContent&&!allowRepeated} onClick={()=>void confirm()}><PackagePlus aria-hidden="true"/>{busy?'Recibiendo…':'Confirmar recepción del lote'}</button>}
  </div>}
  {busy&&<p role="status">Procesando la recepción…</p>}
  <div className="receipt-history"><button type="button" className="text-button" aria-expanded={showHistory} onClick={()=>setShowHistory(value=>!value)}><History aria-hidden="true"/>Historial de recepciones</button>{showHistory&&<div className="stack">{historyBusy&&<p role="status">Consultando recepciones…</p>}{historyError&&<p role="alert">{historyError}</p>}{!historyBusy&&!history.length&&!historyError&&<p className="muted">Todavía no hay recepciones por lote para este cliente.</p>}{history.map(item=><article key={item.id} className="history-card"><div><strong>{item.reference} · {item.status==='IMPORTED'?'Recibido':'Rechazado'}</strong><span>{item.client_name} · {item.product_count} productos · {item.unit_count} unidades</span><span>{item.actor_name} · {new Intl.DateTimeFormat('es-PY',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.created_at))} · {item.filename||'Carga manual'}</span></div></article>)}</div>}</div>
 </section>;
}
