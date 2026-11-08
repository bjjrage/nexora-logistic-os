import CustomerStock,{type CustomerStockFilter} from './CustomerStock';
import CustomerMovements from './CustomerMovements';
import { useCallback, useEffect, useMemo, useState } from "react";
import {ArrowRight,ArrowLeftRight,Boxes,ClipboardList,Download,LayoutDashboard,LogOut,RefreshCw} from 'lucide-react';
import Brand from "./Brand";
import { api } from "./api";
import HelpTip from './HelpTip';
import StatCard from './StatCard';
import ClientLocations,{type ClientLocation} from './ClientLocations';
import {customerBadge,customerState,movementLabels} from './customer-labels';
import './customer-portal.css';

type CustomerUser = { id: string; name: string; role: string; clientId?: string | null };
type Product = { id: string; sku: string; name: string; unit: string; tracking: string };
type Location = { id: string; code: string; name: string };
type Balance = { productId: string; locationId: string; quantity: number; status?: string; condition?: string; available?: number; reserved?: number };
type Unit = { id: string; productId: string; serial: string; barcode?: string | null; locationId?: string | null; status?: string; state?: string };
type Movement = { id: string; productId?: string; action?: string; type?: string; quantity?: number; fromLocationId?: string | null; toLocationId?: string | null; fromLocationName?:string|null;toLocationName?:string|null; createdAt: string; reason?: string | null; reference?: string | null };
type SnapshotCounts = { products: number; locations: number; balances: number; units: number; movements: number };
type SnapshotLimits = { products: number | null; locations: number | null; balances: number | null; units: number; movements: number };
type SnapshotHasMore = { products: boolean; locations: boolean; balances: boolean; units: boolean; movements: boolean };
type Inventory = { products: Product[]; locations: Location[]; balances: Balance[]; units: Unit[]; movements: Movement[]; counts: SnapshotCounts; limits: SnapshotLimits; hasMore: SnapshotHasMore; totals?: Record<"AVAILABLE"|"RESERVED"|"VEHICLE"|"QUARANTINE",number> };
type OrderLine = { productId: string; sku?: string; name?: string; requested?: number; quantity?: number; delivered?: number; reserved?: number; loaded?: number; returned?: number };
type Order = { id: string; externalId: string; orderDate?: string; status: string; destination: string; recipientName: string; lines?: OrderLine[]; shipmentId?: string | null; parcels?: Array<{ id: string; code: string }> };
type CustomerProof = { parcelId: string; providerResult: "PENDING" | "DELIVERED" | "FAILED" | null; evidenceState: "PENDING" | "MISSING" | "COMPLETE" | null; reportedAt?: string | null; receiverName?: string | null; kind: "PHOTO" | "SIGNATURE" | null; evidenceId: string | null };
type Props = { user: CustomerUser; busy: boolean; onLogout: () => void };

async function getJson<T>(path: string): Promise<T> {
  return api<T>(path,undefined,{timeoutMs:15000});
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudieron consultar tus datos.";
}

function formatOrderDate(value: string): string {
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (calendarDate) {
    const year = Number(calendarDate[1]);
    const month = Number(calendarDate[2]);
    const day = Number(calendarDate[3]);
    const validated = new Date(Date.UTC(year, month - 1, day));
    if (validated.getUTCFullYear() === year && validated.getUTCMonth() === month - 1 && validated.getUTCDate() === day) {
      return `${calendarDate[3]}/${calendarDate[2]}/${calendarDate[1]}`;
    }
    return value;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleDateString("es");
}

export default function CustomerPortal({ user, busy, onLogout }: Props) {
  const [view, setView] = useState<'home'|'inventory'|'orders'|'movements'>('home');
  const [stockFilter,setStockFilter]=useState<CustomerStockFilter>('');
  const [locationFilter,setLocationFilter]=useState<ClientLocation|null>(null);
  const [revision,setRevision] = useState(0);
  const exports = {
    home:{href:'/api/inventory/export.csv',label:'Exportar inventario'},
    inventory:{href:'/api/inventory/export.csv'+(locationFilter?'?'+new URLSearchParams({locationId:locationFilter.id}):''),label:'Exportar inventario'},
    orders:{href:'/api/orders/export.csv',label:'Exportar pedidos'},
    movements:{href:'/api/inventory/movements/export.csv',label:'Exportar movimientos'}
  };
  const [inventory, setInventory] = useState<Inventory>({ products: [], locations: [], balances: [], units: [], movements: [], counts: { products: 0, locations: 0, balances: 0, units: 0, movements: 0 }, limits: { products: null, locations: null, balances: null, units: 1000, movements: 500 }, hasMore: { products: false, locations: false, balances: false, units: false, movements: false } });
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderPage,setOrderPage]=useState(0),[orderTotal,setOrderTotal]=useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openProofShipment, setOpenProofShipment] = useState<string | null>(null);
  const [proofsByShipment, setProofsByShipment] = useState<Record<string, CustomerProof[]>>({});
  const [proofLoadingShipment, setProofLoadingShipment] = useState<string | null>(null);
  const [proofError, setProofError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [stock, orderResult] = await Promise.all([
        getJson<Inventory>("/api/inventory"),
        getJson<{ items: Order[];total:number } | Order[]>("/api/orders/read?limit=25&offset="+orderPage*25),
      ]);
      setInventory({ products: stock.products ?? [], locations: stock.locations ?? [], balances: stock.balances ?? [], units: stock.units ?? [], movements: stock.movements ?? [], counts: stock.counts, limits: stock.limits, hasMore: stock.hasMore,totals:stock.totals });
      setOrders(Array.isArray(orderResult) ? orderResult : orderResult.items ?? []);
      setOrderTotal(Array.isArray(orderResult)?orderResult.length:orderResult.total);
      setRevision(current=>current+1);
    } catch (caught) { setError(readableError(caught)); }
    finally { setLoading(false); }
  }, [orderPage]);

  useEffect(() => { void load(); }, [load]);

  const products = useMemo(() => new Map(inventory.products.map((product) => [product.id, product])), [inventory.products]);
  const totals = useMemo(() => {
    if (inventory.totals) return inventory.totals;
    const result: Record<"AVAILABLE" | "RESERVED" | "VEHICLE" | "QUARANTINE", number> = { AVAILABLE: 0, RESERVED: 0, VEHICLE: 0, QUARANTINE: 0 };
    inventory.balances.forEach((item) => {
      const status = item.status?.toUpperCase() as keyof typeof result | undefined;
      if (status && status in result) result[status] += item.quantity;
    });
    inventory.units.forEach((item) => {
      const status = (item.status ?? item.state ?? "").toUpperCase() as keyof typeof result;
      if (status in result) result[status] += 1;
    });
    return result;
  }, [inventory.balances, inventory.units, inventory.totals]);
  const availableTotal = totals.AVAILABLE;
  const reservedTotal = totals.RESERVED;
  const vehicleTotal = totals.VEHICLE;
  const quarantineTotal = totals.QUARANTINE;
  const titles={home:'Mi mercadería',inventory:'Inventario',orders:'Pedidos',movements:'Movimientos'};
  const selectView=(next:typeof view)=>{if(next==='home')setOrderPage(0);setView(next);};
  const navigation=[{id:'home',label:'Inicio',icon:<LayoutDashboard/>},{id:'inventory',label:'Inventario',icon:<Boxes/>},{id:'orders',label:'Pedidos',icon:<ClipboardList/>},{id:'movements',label:'Movimientos',icon:<ArrowLeftRight/>}] as const;
  const showStock=(status:CustomerStockFilter)=>{setStockFilter(status);setLocationFilter(null);setView('inventory');};
  const metrics=[
    {label:'Productos',value:inventory.counts.products,status:'' as const,action:'Ver inventario completo'},
    {label:'Disponibles',value:availableTotal,status:'AVAILABLE' as const,action:'Ver stock disponible'},
    {label:'Reservadas',value:reservedTotal,status:'RESERVED' as const,action:'Ver stock reservado'},
    {label:'En vehículo',value:vehicleTotal,status:'VEHICLE' as const,action:'Ver stock en vehículo'},
    {label:'En cuarentena',value:quarantineTotal,status:'QUARANTINE' as const,action:'Ver stock en cuarentena'}
  ];

  const toggleProofs = async (order: Order) => {
    if (!order.shipmentId) { setProofError("Este pedido todavía no tiene un envío asociado."); return; }
    if (openProofShipment === order.shipmentId) { setOpenProofShipment(null); setProofError(""); return; }
    setOpenProofShipment(order.shipmentId); setProofError("");
    if (proofsByShipment[order.shipmentId]) return;
    setProofLoadingShipment(order.shipmentId);
    try {
      const result = await getJson<{ items: CustomerProof[] }>(`/api/quadminds/shipments/${encodeURIComponent(order.shipmentId)}/proofs`);
      setProofsByShipment((items) => ({ ...items, [order.shipmentId as string]: result.items ?? [] }));
    } catch (caught) { setProofError(readableError(caught)); }
    finally { setProofLoadingShipment(null); }
  };

  return (
    <div className="app-shell customer-workspace">
      <aside className="sidebar" aria-label="Panel del cliente">
        <div className="brand"><Brand/><span className="brand-caption">Portal de cliente</span></div>
        <nav className="nav-list" aria-label="Navegación del cliente">{navigation.map(item=><button key={item.id} type="button" className={'nav-link '+(view===item.id?'active':'')} aria-current={view===item.id?'page':undefined} onClick={()=>selectView(item.id)}><span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-footer"><div className="user-chip"><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><span><strong>{user.name}</strong><small>Cliente</small></span></div><button type="button" className="text-button signout" onClick={onLogout} disabled={busy}><LogOut aria-hidden="true"/>Cerrar sesión</button></div>
      </aside>
      <main className="workspace">
        <header className="topbar"><div><Brand compact className="mobile-brand"/><span className="topbar-label">{user.name}</span><span className="topbar-separator">/</span><span>{titles[view]}</span></div><div className="topbar-meta"><span className={'connection-indicator'+(error?' is-stale':'')}/><span>{error?'Sin actualizar':loading?'Actualizando…':'Conectado'}</span><button type="button" className="text-button mobile-signout" onClick={onLogout} disabled={busy}>Salir</button></div></header>
        <div className="content">
        <div className="page-heading">
          <div className="help-label"><h1>{titles[view]}</h1><HelpTip label={titles[view]}>Consultá y exportá tu mercadería y operaciones. Las recepciones, ajustes y despachos los registra Nexora.</HelpTip></div>
          <div className="heading-actions"><a className="button button-secondary" href={exports[view].href} download><Download aria-hidden="true"/>{exports[view].label}</a><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" />Actualizar</button></div>
        </div>
        {!user.clientId && <div className="notice error" role="alert">Esta cuenta no tiene un cliente asociado. Contactá al equipo de Nexora.</div>}
        {error && <div className="notice error" role="alert">{error}</div>}
        {loading && <p className="muted" role="status">Consultando inventario y pedidos…</p>}
        {(view==='home'||view==='inventory')&&<section className="stat-grid customer-metrics" aria-label="Resumen de cuenta">{metrics.map(metric=><StatCard key={metric.label} label={metric.label} value={loading?'—':new Intl.NumberFormat('es').format(metric.value)} caption={metric.action} aria-label={metric.action} aria-pressed={view==='inventory'&&stockFilter===metric.status} onClick={()=>showStock(metric.status)}/>)}</section>}
        {(view==='home'||view==='inventory')&&<ClientLocations revision={revision} onSelect={location=>{setLocationFilter(location);setStockFilter('');setView('inventory');}}/>}
        {view==='home'&&<div className="customer-overview">
          <section className="card"><div className="card-header"><div className="help-label"><h2>Pedidos</h2><span className="badge badge-neutral">{orderTotal}</span></div><button type="button" className="text-button" aria-label="Ver todos los pedidos" onClick={()=>setView('orders')}>Ver todos<ArrowRight aria-hidden="true"/></button></div>
            {orders.length?<div className="customer-summary-list">{orders.slice(0,4).map(order=><button type="button" className="customer-summary-row" key={order.id} onClick={()=>setView('orders')}><span><strong>{order.externalId}</strong><small>{order.recipientName}</small></span><span className={customerBadge(order.status)}>{customerState(order.status)}</span></button>)}</div>:!loading&&<p className="empty-state">Sin pedidos.</p>}
          </section>
          <section className="card"><div className="card-header"><h2>Últimos movimientos</h2><button type="button" className="text-button" aria-label="Ver todos los movimientos" onClick={()=>setView('movements')}>Ver todos<ArrowRight aria-hidden="true"/></button></div>
            {inventory.movements.length?<div className="timeline">{inventory.movements.slice(0,5).map(movement=><div className="timeline-item" key={movement.id}><span className="timeline-dot"/><div><strong>{movementLabels[movement.action??movement.type??'']??movement.action??'Movimiento'} · {movement.quantity??'—'}</strong><small>{products.get(movement.productId??'')?.name??'Producto'} · {new Date(movement.createdAt).toLocaleDateString('es')}</small>{(movement.fromLocationName||movement.toLocationName)&&<small>{movement.fromLocationName??'—'} → {movement.toLocationName??'—'}</small>}</div></div>)}</div>:!loading&&<p className="empty-state">Sin movimientos.</p>}
          </section>
        </div>}
        {view === "inventory" && <CustomerStock key={stockFilter+':'+(locationFilter?.id??'')} revision={revision} status={stockFilter} locationId={locationFilter?.id} locationName={locationFilter?.name} onClearLocation={()=>setLocationFilter(null)} onClearFilter={()=>setStockFilter('')}/>}

        {view === "orders" && <section className="card"><nav className="pagination" aria-label="Páginas de pedidos"><button disabled={loading||orderPage===0} onClick={()=>setOrderPage(p=>p-1)}>Anterior</button><span>Página {orderPage+1}</span><button disabled={loading||(orderPage+1)*25>=orderTotal} onClick={()=>setOrderPage(p=>p+1)}>Siguiente</button></nav><div className="card-header"><h2>Pedidos</h2><span className="badge badge-neutral">{orderTotal}</span></div>{orders.length ? <div className="customer-orders">{orders.map((order) => <article className="customer-order" key={order.id}><header><div><h3>{order.externalId}</h3><p>{order.recipientName} · {order.destination}</p><p>{order.orderDate ? formatOrderDate(order.orderDate) : "Fecha sin informar"}</p></div><span className={customerBadge(order.status)}>{customerState(order.status)}</span></header><div className="customer-order-lines">{(order.lines ?? []).map((line, index) => <span key={line.productId + index}>{line.name || products.get(line.productId)?.name || line.sku || line.productId} · solicitado {line.requested ?? line.quantity ?? 0}{line.delivered != null ? ` · entregado ${line.delivered}` : ""}{line.returned ? ` · retorno ${line.returned}` : ""}</span>)}</div>{order.shipmentId && <div className="form-divider"><button className="button button-secondary" type="button" aria-expanded={openProofShipment === order.shipmentId} aria-controls={`proofs-${order.id}`} onClick={() => void toggleProofs(order)}>{openProofShipment === order.shipmentId ? "Ocultar comprobantes" : "Ver comprobantes de entrega"}</button>{openProofShipment === order.shipmentId && <div id={`proofs-${order.id}`} className="customer-proof-list">{proofLoadingShipment === order.shipmentId ? <p className="muted" role="status">Consultando comprobantes…</p> : proofError ? <div className="notice error" role="alert">{proofError}</div> : (proofsByShipment[order.shipmentId] ?? []).length ? (() => { const proofs = proofsByShipment[order.shipmentId as string] ?? []; const grouped = new Map<string, CustomerProof[]>(); proofs.forEach((proof) => grouped.set(proof.parcelId, [...(grouped.get(proof.parcelId) ?? []), proof])); return [...grouped.entries()].map(([parcelId, parcelProofs]) => { const result = parcelProofs[0]?.providerResult; const complete = parcelProofs.some((proof) => proof.evidenceState === "COMPLETE"); const label = result === "DELIVERED" ? complete ? "Foto y firma guardadas" : "Entrega informada, evidencia pendiente" : result === "FAILED" ? "Entrega fallida según QuadMinds" : "Resultado pendiente de sincronización"; const parcelCode = order.parcels?.find((parcel) => parcel.id === parcelId)?.code; return <div className="inventory-list-row" key={parcelId}><span><strong>{parcelCode ? `Bulto ${parcelCode}` : "Comprobante de bulto"}</strong><small>{label}{parcelProofs[0]?.reportedAt ? ` · ${new Date(parcelProofs[0].reportedAt as string).toLocaleString("es")}` : ""}{parcelProofs[0]?.receiverName ? ` · recibió ${parcelProofs[0].receiverName}` : ""}</small></span><span className="inventory-actions">{parcelProofs.filter((proof) => proof.evidenceId).map((proof) => <a key={proof.evidenceId} className="button button-secondary" href={`/api/customer-evidence/${encodeURIComponent(proof.evidenceId as string)}`} target="_blank" rel="noreferrer">{proof.kind === "PHOTO" ? "Ver foto" : proof.kind === "SIGNATURE" ? "Ver firma" : "Ver comprobante"}</a>)}</span></div>; }); })() : <p className="muted">No hay comprobantes sincronizados para este pedido.</p>}</div>}</div>}</article>)}</div> : <p className="muted">Sin pedidos.</p>}</section>}

        {view === "movements" && <CustomerMovements revision={revision}/>}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Navegación móvil">{navigation.map(item=><button key={item.id} type="button" className={'nav-link '+(view===item.id?'active':'')} aria-current={view===item.id?'page':undefined} onClick={()=>selectView(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</nav>
    </div>
  );
}
