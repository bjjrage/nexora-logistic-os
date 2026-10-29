import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';
import {z} from 'zod';
import type {Database,Row} from './database.ts';
import {Inventory,type InventoryActor} from './inventory.ts';
import {DomainError,ensure} from './errors.ts';
import {preflightZip,MAX_FILE_BYTES} from './catalog-import.ts';

export const MAX_RECEIPT_ROWS=5_000;
export type ReceiptRow={row:number;sku:string;quantity:string;locationCode:string;serial:string;barcode:string};
export type ReceiptIssue={row:number;field?:string;message:string};
export type ReceiptPreview={valid:boolean;rowCount:number;productCount:number;unitCount:number;rowErrors:ReceiptIssue[];warnings:string[];repeatedContent:boolean;mode:'ADD'|'COMPLETE_SHEET';planHash:string;rows:Array<ReceiptRow&{productName:string;locationName:string;current:number;incoming:number;after:number;alreadyReceived?:number}>};
const text=z.string().trim();
const receiptRow=z.object({row:z.number().int().min(1),sku:text.max(160),quantity:z.union([z.string(),z.number()]).transform(String),locationCode:text.max(160).default(''),serial:text.max(160).default(''),barcode:text.max(160).default('')});
const body=z.object({clientId:z.uuid(),locationId:z.uuid(),reference:text.min(1).max(160),reason:text.max(500).default(''),source:z.enum(['XLSX','CSV','MANUAL']).default('MANUAL'),filename:text.max(255).default(''),rows:z.array(receiptRow).min(1).max(MAX_RECEIPT_ROWS),allowRepeatedContent:z.boolean().default(false),mode:z.enum(['ADD','COMPLETE_SHEET']).default('ADD'),expectedPlanHash:text.regex(/^[a-f0-9]{64}$/).optional()});
type Input=z.infer<typeof body>;
type ReceiptItem={productId:string;locationId:string;quantity:number;serials?:Array<{serial:string;barcode?:string}>};
const normalize=(s:unknown)=>String(s??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const code=(s:unknown)=>String(s??'').trim().toLowerCase();
const hash=(s:unknown)=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
const aliases={sku:['sku','codigo','codigoproducto','codigosku','productcode','productsku'],quantity:['cantidad','quantity','qty','unidades','stock','existencias','recepcionsugerida'],locationCode:['ubicacion','location','locationcode','codigoubicacion','deposito','sector'],serial:['serie','serial','numeroserie','numerodeserie'],barcode:['codigobarrasunidad','barcodeunidad','unitbarcode','barcode','codigobarras']} as const;
type Field=keyof typeof aliases;
type SourceCell={v?:unknown;f?:string;F?:string;w?:string;z?:string};
function cellText(cell:SourceCell|undefined,identifier=false):string{
 if(!cell)return '';
 ensure(!cell.f&&!cell.F,'VALIDATION_ERROR','No se admiten fórmulas; pegá valores en el archivo.',400);
 if(identifier&&typeof cell.v==='number'){
  ensure(Number.isSafeInteger(cell.v),'VALIDATION_ERROR','Un código numérico perdió precisión. Guardá los códigos como texto.',400);
  if(/^0{2,}$/.test(cell.z??''))return cell.w??String(cell.v).padStart(cell.z!.length,'0');
 }
 return String(cell.v??'').trim();
}
function columns(values:unknown[]):Map<Field,number>|null{
 const result=new Map<Field,number>();
 for(let i=0;i<values.length;i++){
  const key=normalize(values[i]);
  const field=(Object.keys(aliases) as Field[]).find(f=>(aliases[f] as readonly string[]).includes(key));
  if(field){ensure(!result.has(field),'VALIDATION_ERROR',`Hay más de una columna para ${field}.`,400);result.set(field,i);}
 }
 return result.has('sku')&&result.has('quantity')?result:null;
}
function csvRecords(source:string):string[][]{
 const clean=source.replace(/^\uFEFF/,'');
 // Detect delimiters outside quoted cells in the first record.
 const counts=new Map([[',',0],[';',0],['\t',0]]);let quoted=false;
 for(let i=0;i<clean.length;i++){const ch=clean[i];if(ch==='"'){if(quoted&&clean[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(!quoted){if(ch==='\r'||ch==='\n')break;if(counts.has(ch))counts.set(ch,counts.get(ch)!+1);}}
 const delimiter=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
 const rows:string[][]=[];let cells:string[]=[],field='';quoted=false;
 const finish=()=>{cells.push(field);if(cells.some(s=>s.trim()))rows.push(cells);ensure(cells.length<=32&&rows.length<=MAX_RECEIPT_ROWS+20,'VALIDATION_ERROR','El archivo supera las 5.000 filas o 32 columnas.',400);cells=[];field='';};
 for(let i=0;i<clean.length;i++){
  const ch=clean[i];
  if(quoted){if(ch==='"'&&clean[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}
  else if(ch==='"'&&!field)quoted=true;
  else if(ch===delimiter){cells.push(field);field='';ensure(cells.length<=32,'VALIDATION_ERROR','Se admiten hasta 32 columnas.',400);}
  else if(ch==='\n'||ch==='\r'){finish();if(ch==='\r'&&clean[i+1]==='\n')i++;}
  else field+=ch;
 }
 ensure(!quoted,'VALIDATION_ERROR','El archivo tiene una comilla sin cerrar.',400);
 if(field||cells.length)finish();return rows;
}
export function readReceiptFile(input:unknown){
 const parsed=z.object({csv:z.string().max(MAX_FILE_BYTES).optional(),filename:text.max(255).optional(),contentBase64:z.string().max(Math.ceil(MAX_FILE_BYTES/3)*4).optional(),sheet:text.max(100).optional()}).parse(input);
 const rows:ReceiptRow[]=[];const sheets:string[]=[];let sheetName='';let headerFields:string[]=[];
 const append=(number:number,cols:Map<Field,number>,get:(i:number)=>string)=>{
  const value=(f:Field)=>cols.has(f)?get(cols.get(f)!):'';
  const row={row:number,sku:value('sku'),quantity:value('quantity'),locationCode:value('locationCode'),serial:value('serial'),barcode:value('barcode')};
  if(Object.values(row).slice(1).some(v=>String(v).trim()))rows.push(row);
  ensure(rows.length<=MAX_RECEIPT_ROWS,'VALIDATION_ERROR','Se admiten hasta 5.000 filas por lote.',400);
 };
 if(parsed.csv!==undefined){
  ensure(parsed.contentBase64===undefined&&Buffer.byteLength(parsed.csv,'utf8')<=MAX_FILE_BYTES,'VALIDATION_ERROR','Enviá una tabla CSV de hasta 5 MB.',400);
  const records=csvRecords(parsed.csv);let found=false;
  for(let i=0;i<Math.min(20,records.length);i++){
   const cols=columns(records[i]);if(!cols)continue;
   headerFields=[...cols.keys()];
   for(let r=i+1;r<records.length;r++){ensure(records[r].length===records[i].length,'VALIDATION_ERROR',`Fila ${r+1}: la cantidad de columnas no coincide con el encabezado.`,400);append(r+1,cols,c=>records[r][c]??'');}
   found=true;break;
  }
  ensure(found,'VALIDATION_ERROR','Incluí los encabezados SKU y Cantidad.',400);
 }else{
  ensure(parsed.filename&&/\.xlsx$/i.test(parsed.filename)&&!/[\\/]/.test(parsed.filename),'VALIDATION_ERROR','Elegí un archivo Excel .xlsx.',400);
  ensure(parsed.contentBase64&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parsed.contentBase64),'VALIDATION_ERROR','El contenido Excel no es válido.',400);
  const buffer=Buffer.from(parsed.contentBase64,'base64');
  ensure(buffer.length>0&&buffer.length<=MAX_FILE_BYTES,'VALIDATION_ERROR','El Excel admite hasta 5 MB.',400);
  const zipError=preflightZip(buffer);ensure(!zipError,'VALIDATION_ERROR',zipError??'',400);
  let book:XLSX.WorkBook;try{book=XLSX.read(buffer,{type:'buffer',cellFormula:true,cellNF:true,cellText:true,WTF:true});}catch{throw new DomainError('VALIDATION_ERROR','No se pudo abrir el archivo Excel.',400);}
  const candidates:Array<{name:string;header:number;cols:Map<Field,number>}>=[];
  for(const [i,name] of book.SheetNames.entries()){
   if(book.Workbook?.Sheets?.[i]?.Hidden)continue;
   const sheet=book.Sheets[name];if(!sheet['!ref'])continue;
   const range=XLSX.utils.decode_range(sheet['!ref']);
   ensure(range.e.r-range.s.r<MAX_RECEIPT_ROWS+20&&range.e.c-range.s.c<32,'VALIDATION_ERROR',`La hoja «${name}» supera las 5.000 filas o 32 columnas.`,400);
   for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+19);r++){
    const values=Array.from({length:range.e.c+1},(_,c)=>sheet[XLSX.utils.encode_cell({r,c})]?.v);
    // An unrelated catalog may contain several barcode aliases; only inspect stock tables.
    if(!values.some(v=>(aliases.quantity as readonly string[]).includes(normalize(v)))||!values.some(v=>(aliases.sku as readonly string[]).includes(normalize(v))))continue;
    const cols=columns(values);if(cols){candidates.push({name,header:r,cols});break;}
   }
  }
  sheets.push(...candidates.map(c=>c.name));
  const chosen=parsed.sheet?candidates.find(c=>c.name===parsed.sheet):candidates.find(c=>normalize(c.name)==='stocksugerido')??candidates[0];
  ensure(chosen,'VALIDATION_ERROR','No encontré una hoja con columnas SKU y Cantidad. Elegí una hoja de existencias.',400);
  sheetName=chosen.name;headerFields=[...chosen.cols.keys()];const sheet=book.Sheets[sheetName],range=XLSX.utils.decode_range(sheet['!ref']!);
  for(const c of chosen.cols.values())cellText(sheet[XLSX.utils.encode_cell({r:chosen.header,c})]);
  for(let r=chosen.header+1;r<=range.e.r;r++)append(r+1,chosen.cols,c=>cellText(sheet[XLSX.utils.encode_cell({r,c})],[chosen.cols.get('sku'),chosen.cols.get('serial'),chosen.cols.get('barcode'),chosen.cols.get('locationCode')].includes(c)));
 }
 ensure(rows.length>0,'VALIDATION_ERROR','La tabla no tiene filas de stock.',400);
 return {rows,sheets,sheet:sheetName,fields:headerFields};
}

export class StockReceipts{
 private store:Database;
 private inventory:Inventory;
 constructor(store:Database){this.store=store;this.inventory=new Inventory(store);}
 private allow(actor:InventoryActor){ensure(['ADMIN','OPERATIONS','DEPOT'].includes(actor.role),'FORBIDDEN','Tu rol no permite recibir mercadería.',403);}
 private async client(actor:InventoryActor,id:string){ensure(await this.store.one('SELECT id FROM clients WHERE org_id=? AND id=?',actor.orgId,id),'NOT_FOUND','El cliente no pertenece a esta empresa.',404);}
 read(actor:InventoryActor,input:unknown){this.allow(actor);return readReceiptFile(input);}
 template(actor:InventoryActor){
  this.allow(actor);const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['SKU','Cantidad','Ubicacion','Serie','CodigoBarrasUnidad']]);
  sheet['!cols']=[{wch:26},{wch:14},{wch:24},{wch:26},{wch:26}];XLSX.utils.book_append_sheet(book,sheet,'Stock');
  return XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:true}) as Buffer;
 }
 private async plan(actor:InventoryActor,input:Input){
  await this.client(actor,input.clientId);
  const [products,locations,units,balances,received]=await Promise.all([
   this.store.all('SELECT * FROM inventory_products WHERE org_id=? AND client_id=?',actor.orgId,input.clientId),
   this.store.all('SELECT * FROM inventory_locations WHERE org_id=?',actor.orgId),
   this.store.all('SELECT product_id,client_id,serial,barcode FROM inventory_units WHERE org_id=?',actor.orgId),
   this.store.all("SELECT product_id,location_id,SUM(quantity) AS quantity FROM inventory_balances WHERE org_id=? AND client_id=? AND status='AVAILABLE' GROUP BY product_id,location_id",actor.orgId,input.clientId),
   input.mode==='COMPLETE_SHEET'?this.store.all("SELECT product_id,SUM(quantity) AS quantity FROM inventory_movements WHERE org_id=? AND client_id=? AND action='RECEIVE' GROUP BY product_id",actor.orgId,input.clientId):Promise.resolve([]),
  ]);
  const byCode=new Map<string,Row>();for(const p of products)for(const v of [p.sku,p.barcode])if(v)byCode.set(code(v),p);
  const byLocation=new Map<string,Row>();for(const l of locations)for(const v of [l.id,l.code])byLocation.set(code(v),l);
  const existingSerials=new Set(units.filter(u=>u.client_id===input.clientId).map(u=>`${u.product_id}:${code(u.serial)}`));
  const existingBarcodes=new Set(units.filter(u=>u.barcode).map(u=>code(u.barcode)));
  const productCodes=new Set(products.flatMap(p=>[code(p.sku),code(p.barcode)]).filter(Boolean));
  const available=new Map(balances.map(b=>[`${b.product_id}:${b.location_id}`,Number(b.quantity)]));
  const rowErrors:ReceiptIssue[]=[],warnings:string[]=[],rows:ReceiptPreview['rows']=[];
  const groups=new Map<string,ReceiptItem>();const seenSerials=new Set<string>(),seenBarcodes=new Set<string>();let unitCount=0;
  const defaultLocation=byLocation.get(code(input.locationId));
  if(!defaultLocation?.active||defaultLocation.kind==='QUARANTINE')rowErrors.push({row:1,field:'locationId',message:'Elegí un depósito o sector activo para recibir stock disponible.'});
  for(const row of input.rows){
   const error=(field:string,message:string)=>rowErrors.push({row:row.row,field,message});
   const product=byCode.get(code(row.sku));const location=row.locationCode?byLocation.get(code(row.locationCode)):defaultLocation;
   const qty=Number(row.quantity);const start=rowErrors.length;
   if(!product?.active)error('sku','SKU o código de barras inexistente o archivado para este cliente.');
   if(!location?.active||location.kind==='QUARANTINE')error('locationCode','Ubicación inexistente, archivada o de cuarentena.');
   if(!/^\d+$/.test(row.quantity.trim())||!Number.isSafeInteger(qty)||qty<1||qty>100_000)error('quantity','La cantidad debe ser un entero entre 1 y 100.000.');
   if(product?.tracking==='SERIAL'){
    if(input.mode==='COMPLETE_SHEET')error('serial','Completar la hoja solo admite productos por cantidad. Para series, usá una recepción nueva con sus identificadores.');
    if(!row.serial||qty!==1)error('serial','Para productos por serie, indicá una serie y cantidad 1 por fila.');
    const serialKey=`${product.id}:${code(row.serial)}`;
    if(row.serial&&(existingSerials.has(serialKey)||seenSerials.has(serialKey)||productCodes.has(code(row.serial))))error('serial','La serie ya existe, está repetida o coincide con un código de producto.');
    if(row.barcode&&(existingBarcodes.has(code(row.barcode))||seenBarcodes.has(code(row.barcode))||productCodes.has(code(row.barcode))))error('barcode','El código individual ya existe, está repetido o identifica un producto.');
    seenSerials.add(serialKey);if(row.barcode)seenBarcodes.add(code(row.barcode));
   }else if(product&&row.serial)error('serial','Este producto se controla por cantidad; dejá la serie vacía.');
   if(product?.tracking==='QUANTITY'&&row.barcode&&code(row.barcode)!==code(product.barcode))error('barcode','El código individual solo se usa para productos por serie.');
   if(rowErrors.length!==start)continue;
   unitCount+=qty;const key=`${product!.id}:${location!.id}`;const group:ReceiptItem=groups.get(key)??{productId:product!.id,locationId:location!.id,quantity:0,...(product!.tracking==='SERIAL'?{serials:[]}: {})};
   group.quantity+=qty;if(group.serials)group.serials.push({serial:row.serial,...(row.barcode?{barcode:row.barcode}:{})});groups.set(key,group);
   rows.push({...row,sku:product!.sku,productName:product!.name,locationName:location!.name,current:0,incoming:qty,after:0});
  }
  if(unitCount>100_000)rowErrors.push({row:1,field:'quantity',message:'El lote supera el máximo de 100.000 unidades.'});
  if(input.mode==='COMPLETE_SHEET'){
   const receivedByProduct=new Map(received.map(item=>[item.product_id,Number(item.quantity)]));
   const credit=new Map(receivedByProduct);
   for(const group of groups.values())group.quantity=0;
   unitCount=0;
   // Consume each SKU's previous receipts once, even across duplicate rows or depots.
   for(const row of rows){
    const product=byCode.get(code(row.sku))!,location=row.locationCode?byLocation.get(code(row.locationCode))!:defaultLocation!;
    const remainingCredit=credit.get(product.id)??0,target=Number(row.quantity);
    row.alreadyReceived=receivedByProduct.get(product.id)??0;
    row.incoming=Math.max(0,target-remainingCredit);credit.set(product.id,Math.max(0,remainingCredit-target));
    groups.get(`${product.id}:${location.id}`)!.quantity+=row.incoming;unitCount+=row.incoming;
   }
  }
  // Count serial stock only in the receiving location and AVAILABLE condition.
  const serialBalances=products.some(p=>p.tracking==='SERIAL')?await this.store.all("SELECT product_id,location_id,COUNT(*) AS quantity FROM inventory_units WHERE org_id=? AND client_id=? AND status='AVAILABLE' GROUP BY product_id,location_id",actor.orgId,input.clientId):[];
  for(const b of serialBalances)available.set(`${b.product_id}:${b.location_id}`,Number(b.quantity));
  for(const row of rows){const p=byCode.get(code(row.sku))!,l=row.locationCode?byLocation.get(code(row.locationCode))!:defaultLocation!;const key=`${p.id}:${l.id}`;row.current=available.get(key)??0;row.after=row.current+groups.get(key)!.quantity;}
  const items=[...groups.values()].filter(item=>item.quantity>0);
  const contentHash=hash(items.map(i=>({...i,serials:i.serials?.map(s=>({serial:code(s.serial),barcode:code(s.barcode)})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>`${a.productId}:${a.locationId}`.localeCompare(`${b.productId}:${b.locationId}`)));
  const priorReference=await this.store.one("SELECT reference FROM inventory_receipt_batches WHERE org_id=? AND client_id=? AND reference_key=? AND status='IMPORTED'",actor.orgId,input.clientId,code(input.reference));
  if(priorReference)rowErrors.push({row:1,field:'reference',message:`La referencia ${priorReference.reference} ya fue recibida. Usá otra para una entrada nueva.`});
  const priorContent=input.mode==='ADD'&&items.length?await this.store.one("SELECT reference FROM inventory_receipt_batches WHERE org_id=? AND client_id=? AND content_hash=? AND status='IMPORTED' ORDER BY created_at DESC LIMIT 1",actor.orgId,input.clientId,contentHash):undefined;
  if(priorContent)warnings.push(`Este contenido coincide con la recepción ${priorContent.reference}. Confirmá que se trata de una entrada de mercadería nueva.`);
  const report:ReceiptPreview={valid:rowErrors.length===0,rowCount:input.rows.length,productCount:new Set(items.map(i=>i.productId)).size,unitCount,rowErrors:rowErrors.slice(0,500),warnings,repeatedContent:!!priorContent,mode:input.mode,planHash:contentHash,rows};
  return {report,items,contentHash};
 }
 async preview(actor:InventoryActor,input:unknown){this.allow(actor);return (await this.plan(actor,body.parse(input))).report;}
 async commit(actor:InventoryActor,input:unknown){
  this.allow(actor);const parsed=body.extend({commandId:z.uuid()}).parse(input);const {commandId,mode,expectedPlanHash,...legacyPayload}=parsed;
  // Preserve hashes of ADD commands that were stored before this option existed.
  const digest=hash(mode==='ADD'?legacyPayload:{...legacyPayload,mode,expectedPlanHash});
  await this.client(actor,parsed.clientId);
  const result=await this.store.transaction(async()=>{
   const prior=await this.store.one('SELECT * FROM inventory_receipt_batches WHERE org_id=? AND command_id=?',actor.orgId,commandId);
   if(prior){ensure(prior.actor_id===actor.id&&prior.body_hash===digest,'DUPLICATE_COMMAND','El identificador del lote ya se usó con otros datos o por otro usuario.');return {status:prior.status,...JSON.parse(prior.result)};}
   const {report,items,contentHash}=await this.plan(actor,parsed);
   if(mode==='COMPLETE_SHEET'){
    ensure(expectedPlanHash&&expectedPlanHash===report.planHash,'RECEIPT_CHANGED','Los faltantes cambiaron desde la validación. Volvé a validar la recepción antes de confirmar.',409);
    if(report.valid&&!items.length)return {status:'UNCHANGED',...report,imported:false,batchId:commandId,reference:parsed.reference};
   }
   if(report.repeatedContent&&!parsed.allowRepeatedContent)report.rowErrors.push({row:1,field:'allowRepeatedContent',message:'Confirmá que este contenido repetido corresponde a una recepción nueva.'});
   report.valid=report.rowErrors.length===0;
   if(report.valid)await this.inventory.receiveBatch(actor,{commandId,clientId:parsed.clientId,reference:parsed.reference,reason:parsed.reason,items});
   const response={...report,imported:report.valid,batchId:commandId,reference:parsed.reference};
   const status=report.valid?'IMPORTED':'REJECTED';
   await this.store.run('INSERT INTO inventory_receipt_batches(id,org_id,client_id,actor_id,command_id,body_hash,content_hash,reference,reference_key,source,filename,status,row_count,product_count,unit_count,result,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',commandId,actor.orgId,parsed.clientId,actor.id,commandId,digest,contentHash,parsed.reference,code(parsed.reference),parsed.source,parsed.filename||null,status,report.rowCount,report.productCount,report.unitCount,JSON.stringify(response),new Date().toISOString());
   return {status,...response};
  });
  if(result.status==='REJECTED')throw new DomainError('VALIDATION_ERROR','El lote contiene errores. No se recibió ninguna unidad.',400,{batchId:result.batchId,rowErrors:result.rowErrors});
  return result;
 }
 async history(actor:InventoryActor,clientId?:string){
  this.allow(actor);if(clientId)await this.client(actor,clientId);
  const items=await this.store.all(`SELECT b.id,b.reference,b.status,b.source,b.filename,b.row_count,b.product_count,b.unit_count,b.created_at,c.name AS client_name,u.name AS actor_name FROM inventory_receipt_batches b JOIN clients c ON c.id=b.client_id AND c.org_id=b.org_id JOIN users u ON u.id=b.actor_id AND u.org_id=b.org_id WHERE b.org_id=?${clientId?' AND b.client_id=?':''} ORDER BY b.created_at DESC,b.id DESC LIMIT 100`,actor.orgId,...(clientId?[clientId]:[]));
  return {items};
 }
}
