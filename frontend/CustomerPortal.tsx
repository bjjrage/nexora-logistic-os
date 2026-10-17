import CustomerStock from './CustomerStock';
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, LogOut, RefreshCw } from "lucide-react";
import Brand from "./Brand";
import { api } from "./api";

type CustomerUser = { id: string; name: string; role: string; clientId?: string | null };
type Product = { id: string; sku: string; name: string; unit: string; tracking: string };
type Location = { id: string; code: string; name: string };
type Balance = { productId: string; locationId: string; quantity: number; status?: string; condition?: string; available?: number; reserved?: number };
type Unit = { id: string; productId: string; serial: string; barcode?: string | null; locationId?: string | null; status?: string; state?: string };
type Movement = { id: string; productId?: string; action?: string; type?: string; quantity?: number; fromLocationId?: string | null; toLocationId?: string | null; createdAt: string; reason?: string | null; reference?: string | null };
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
  const [view, setView] = useState<"inventory" | "orders" | "movements">("inventory");
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
    } catch (caught) { setError(readableError(caught)); }
    finally { setLoading(false); }
  }, [orderPage]);

  useEffect(() => { void load(); }, [load]);

  const products = useMemo(() => new Map(inventory.products.map((product) => [product.id, product])), [inventory.products]);
  const locations = useMemo(() => new Map(inventory.locations.map((location) => [location.id, location])), [inventory.locations]);
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
    <div className="portal-shell">
      <header className="portal-header">
        <div><Brand compact className="portal-brand" /><span className="portal-identity">Inventario y pedidos · {user.name}</span></div>
        <div><a className="button button-secondary portal-export" href="/api/inventory/export.csv" download><Download aria-hidden="true" />Exportar inventario</a><button className="text-button" type="button" onClick={onLogout} disabled={busy}><LogOut aria-hidden="true" />Salir</button></div>
      </header>
      <main className="portal-body">
        <div className="page-heading">
          <div><p className="eyebrow">PORTAL DE CLIENTE</p><h1>Tu mercadería en Nexora</h1><p className="muted">Consultá existencias, pedidos y movimientos registrados de tu cuenta.</p></div>
          <button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" />Actualizar</button>
        </div>
        {!user.clientId && <div className="notice error" role="alert">Esta cuenta no tiene un cliente asociado. Contactá al equipo de Nexora.</div>}
        {error && <div className="notice error" role="alert">{error}</div>}
        {loading && <p className="muted" role="status">Consultando inventario y pedidos…</p>}
        <div className="inventory-metrics" aria-label="Resumen de cuenta">
          <div className="inventory-metric"><small>Productos</small><strong>{inventory.products.length}</strong></div>
          <div className="inventory-metric"><small>Unidades disponibles</small><strong>{new Intl.NumberFormat("es").format(availableTotal)}</strong></div>
          <div className="inventory-metric"><small>Unidades reservadas</small><strong>{new Intl.NumberFormat("es").format(reservedTotal)}</strong></div>
          <div className="inventory-metric"><small>En vehículo</small><strong>{new Intl.NumberFormat("es").format(vehicleTotal)}</strong></div>
          <div className="inventory-metric"><small>En cuarentena</small><strong>{new Intl.NumberFormat("es").format(quarantineTotal)}</strong></div>
        </div>

        <nav className="inventory-tabs" aria-label="Vistas de cuenta">
          {([["inventory", "Inventario"], ["orders", "Pedidos"], ["movements", "Movimientos"]] as Array<[typeof view, string]>).map(([id, label]) => <button key={id} className="inventory-tab" type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>{label}</button>)}
        </nav>

        {view === "inventory" && <CustomerStock revision={inventory.counts.movements}/>}

        {view === "orders" && <section className="card"><nav className="pagination" aria-label="Páginas de pedidos"><button disabled={loading||orderPage===0} onClick={()=>setOrderPage(p=>p-1)}>Anterior</button><span>Página {orderPage+1}</span><button disabled={loading||(orderPage+1)*25>=orderTotal} onClick={()=>setOrderPage(p=>p+1)}>Siguiente</button></nav><div className="card-header"><div><h2>Tus pedidos</h2><p>{orderTotal} pedidos</p><p>Seguimiento de estado y líneas vinculadas a tu mercadería.</p></div></div>{orders.length ? <div className="customer-orders">{orders.map((order) => <article className="customer-order" key={order.id}><header><div><h3>{order.externalId}</h3><p>{order.recipientName} · {order.destination}</p><p>{order.orderDate ? formatOrderDate(order.orderDate) : "Fecha sin informar"}</p></div><span className="badge badge-neutral">{order.status}</span></header><div className="customer-order-lines">{(order.lines ?? []).map((line, index) => <span key={line.productId + index}>{line.name || products.get(line.productId)?.name || line.sku || line.productId} · solicitado {line.requested ?? line.quantity ?? 0}{line.delivered != null ? ` · entregado ${line.delivered}` : ""}{line.returned ? ` · retorno ${line.returned}` : ""}</span>)}</div>{order.shipmentId && <div className="form-divider"><button className="button button-secondary" type="button" aria-expanded={openProofShipment === order.shipmentId} aria-controls={`proofs-${order.id}`} onClick={() => void toggleProofs(order)}>{openProofShipment === order.shipmentId ? "Ocultar comprobantes" : "Ver comprobantes de entrega"}</button>{openProofShipment === order.shipmentId && <div id={`proofs-${order.id}`} className="customer-proof-list">{proofLoadingShipment === order.shipmentId ? <p className="muted" role="status">Consultando comprobantes…</p> : proofError ? <div className="notice error" role="alert">{proofError}</div> : (proofsByShipment[order.shipmentId] ?? []).length ? (() => { const proofs = proofsByShipment[order.shipmentId as string] ?? []; const grouped = new Map<string, CustomerProof[]>(); proofs.forEach((proof) => grouped.set(proof.parcelId, [...(grouped.get(proof.parcelId) ?? []), proof])); return [...grouped.entries()].map(([parcelId, parcelProofs]) => { const result = parcelProofs[0]?.providerResult; const complete = parcelProofs.some((proof) => proof.evidenceState === "COMPLETE"); const label = result === "DELIVERED" ? complete ? "Foto y firma guardadas" : "Entrega informada, evidencia pendiente" : result === "FAILED" ? "Entrega fallida según QuadMinds" : "Resultado pendiente de sincronización"; const parcelCode = order.parcels?.find((parcel) => parcel.id === parcelId)?.code; return <div className="inventory-list-row" key={parcelId}><span><strong>{parcelCode ? `Bulto ${parcelCode}` : "Comprobante de bulto"}</strong><small>{label}{parcelProofs[0]?.reportedAt ? ` · ${new Date(parcelProofs[0].reportedAt as string).toLocaleString("es")}` : ""}{parcelProofs[0]?.receiverName ? ` · recibió ${parcelProofs[0].receiverName}` : ""}</small></span><span className="inventory-actions">{parcelProofs.filter((proof) => proof.evidenceId).map((proof) => <a key={proof.evidenceId} className="button button-secondary" href={`/api/customer-evidence/${encodeURIComponent(proof.evidenceId as string)}`} target="_blank" rel="noreferrer">{proof.kind === "PHOTO" ? "Ver foto" : proof.kind === "SIGNATURE" ? "Ver firma" : "Ver comprobante"}</a>)}</span></div>; }); })() : <p className="muted">No hay comprobantes sincronizados para este pedido.</p>}</div>}</div>}</article>)}</div> : <p className="muted">No hay pedidos registrados.</p>}</section>}

        {view === "movements" && <section className="card"><div className="card-header"><div><h2>Historial de movimientos</h2><p>Actividad registrada sobre mercadería bajo custodia.</p></div></div>{inventory.hasMore.movements && <div className="notice" role="status">Se muestran {new Intl.NumberFormat("es").format(inventory.limits.movements)} movimientos recientes de {new Intl.NumberFormat("es").format(inventory.counts.movements)} registrados.</div>}{inventory.movements.length ? <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Producto</th><th>Cantidad</th><th>Ubicación</th><th>Referencia</th></tr></thead><tbody>{inventory.movements.map((movement) => <tr key={movement.id}><td>{new Date(movement.createdAt).toLocaleString("es")}</td><td>{movement.action || movement.type || "Movimiento"}</td><td>{products.get(movement.productId ?? "")?.name || movement.productId || "—"}</td><td>{movement.quantity ?? "—"}</td><td>{locations.get(movement.fromLocationId ?? "")?.code || "—"} → {locations.get(movement.toLocationId ?? "")?.code || "—"}</td><td>{movement.reference || movement.reason || "—"}</td></tr>)}</tbody></table></div> : <p className="muted">No hay movimientos para mostrar.</p>}</section>}
      </main>
    </div>
  );
}
