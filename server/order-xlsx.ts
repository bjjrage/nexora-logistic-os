import * as XLSX from 'xlsx';
import {z} from 'zod';
import {ensure} from './errors.ts';
import {preflightZip,MAX_FILE_BYTES} from './catalog-import.ts';

const fields=['externalId','date','destination','recipientName','sku','quantity','recipientPhone','windowStart','windowEnd','serviceMinutes','restrictions'] as const;
const aliases:Record<typeof fields[number],string[]>={externalId:['externalid','orderid','pedido','referencia','nropedido','idpedido'],date:['date','orderdate','fecha','fechapedido','fechadeentrega'],destination:['destination','destino','direccion','direccionentrega','address'],recipientName:['recipientname','destinatario','contacto','nombre','cliente'],sku:['sku','codigo','codigoproducto','productsku','producto'],quantity:['quantity','cantidad','qty','unidades'],recipientPhone:['recipientphone','telefono','phone','contactotelefono'],windowStart:['windowstart','ventanainicio','horainicio','desde','horadesde'],windowEnd:['windowend','ventanafin','horafin','hasta','horahasta'],serviceMinutes:['serviceminutes','minutosservicio','tiemposervicio','duraciondescarga'],restrictions:['restrictions','restricciones','observaciones','notas']};
const normalize=(s:unknown)=>String(s??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const encode=(s:unknown)=>'"'+String(s??'').replaceAll('"','""')+'"';

export function parseOrdersXlsx(input:unknown){
 const {filename,contentBase64}=z.object({filename:z.string().max(255),contentBase64:z.string().min(1).max(Math.ceil(MAX_FILE_BYTES/3)*4)}).strict().parse(input);
 ensure(/\.xlsx$/i.test(filename)&&!/[\\/]/.test(filename),'VALIDATION_ERROR','Seleccioná un archivo Excel .xlsx.',400);
 ensure(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64),'VALIDATION_ERROR','No se pudo leer el archivo Excel.',400);
 const buffer=Buffer.from(contentBase64,'base64');ensure(buffer.length>0&&buffer.length<=MAX_FILE_BYTES,'VALIDATION_ERROR','El Excel debe pesar hasta 5 MB.',400);
 const error=preflightZip(buffer);ensure(!error,'VALIDATION_ERROR',error??'',400);
 let book:XLSX.WorkBook;try{book=XLSX.read(buffer,{type:'buffer',cellFormula:true,cellNF:true,cellText:true,cellDates:false,WTF:true});}catch{ensure(false,'VALIDATION_ERROR','No se pudo abrir el archivo Excel.',400);}
 const matches:{sheet:XLSX.WorkSheet;name:string;row:number;cols:Map<string,number>}[]=[];
 for(const [i,name] of book.SheetNames.entries()){
  if(book.Workbook?.Sheets?.[i]?.Hidden)continue;
  const sheet=book.Sheets[name];if(!sheet?.['!ref'])continue;
  const range=XLSX.utils.decode_range(sheet['!ref']);
  ensure(range.e.r-range.s.r<=10020&&range.e.c-range.s.c<32,'VALIDATION_ERROR',`La hoja «${name}» supera el límite de filas o columnas.`,400);
  for(let row=range.s.r;row<=Math.min(range.e.r,range.s.r+19);row++){
   const cols=new Map<string,number>();let duplicate=false;
   for(let c=range.s.c;c<=range.e.c;c++){
    const cell=sheet[XLSX.utils.encode_cell({r:row,c})];const key=normalize(cell?.v);if(!key)continue;
    const field=fields.find(f=>aliases[f].includes(key));if(field){if(cols.has(field))duplicate=true;cols.set(field,c);}
   }
   if(fields.slice(0,6).every(f=>cols.has(f))){ensure(!duplicate,'VALIDATION_ERROR',`La hoja «${name}» tiene columnas duplicadas en la fila ${row+1}.`,400);matches.push({sheet,name,row,cols});break;}
  }
 }
 ensure(matches.length===1,'VALIDATION_ERROR',matches.length?'Hay más de una hoja con columnas de pedidos. Dejá una sola hoja de pedidos en el archivo.':'No encontré una hoja con pedido, fecha, dirección, destinatario, SKU y cantidad.',400);
 const {sheet,name,row,cols}=matches[0],range=XLSX.utils.decode_range(sheet['!ref']!),rows:string[][]=[],rowNumbers:number[]=[];
 for(let r=row+1;r<=range.e.r;r++){
  const cells=fields.map(field=>{const c=cols.get(field);return c===undefined?undefined:sheet[XLSX.utils.encode_cell({r,c})];});
  const values=cells.map(cell=>String(cell?.v??'').trim());
  if(values.every(v=>!v))continue;
  const allCells=Array.from({length:range.e.c-range.s.c+1},(_,i)=>sheet[XLSX.utils.encode_cell({r,c:range.s.c+i})]);
  const footer=allCells.map(c=>String(c?.v??'').trim()).filter(Boolean);
  if(footer.length===2&&/^total\s+(unidades|paradas)$/i.test(footer[0])&&/^\d+$/.test(footer[1]))continue;
  for(let i=0;i<cells.length;i++){
   const cell=cells[i];if(!cell)continue;
   ensure(!cell.f&&!cell.F,'VALIDATION_ERROR',`Hoja «${name}», fila ${r+1}: no se admiten fórmulas en ${fields[i]}.`,400);
   if(['externalId','sku'].includes(fields[i])&&typeof cell.v==='number')ensure(Number.isSafeInteger(cell.v)&&String(cell.v).length<=15&&(!cell.w||cell.w===String(cell.v)),'VALIDATION_ERROR',`Fila ${r+1}: guardá ${fields[i]==='sku'?'el SKU':'el pedido'} como texto para conservar todos sus dígitos.`,400);
   ensure(!/[\r\n]/.test(values[i]),'VALIDATION_ERROR',`Fila ${r+1}: quitá los saltos de línea dentro de las celdas.`,400);
  }
  const date=cells[1];if(date&&typeof date.v==='number'){
   const parsed=XLSX.SSF.parse_date_code(date.v,{date1904:!!book.Workbook?.WBProps?.date1904});
   ensure(parsed&&parsed.y>=1900&&parsed.y<=9999,'VALIDATION_ERROR',`Fila ${r+1}: fecha inválida.`,400);
   values[1]=`${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
  }else{const m=values[1].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)values[1]=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
  rows.push(values);rowNumbers.push(r+1);
 }
 ensure(rows.length>0&&rows.length<=10000,'VALIDATION_ERROR','La hoja debe contener entre 1 y 10.000 filas de pedidos.',400);
 return {sheet:name,rowNumbers,csv:[fields.join(','),...rows.map(values=>values.map(encode).join(','))].join('\n')};
}
