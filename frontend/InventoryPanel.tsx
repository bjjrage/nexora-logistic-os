import AccountRecovery from './AccountRecovery';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, Boxes, ClipboardList, PackagePlus, Plus, RefreshCw, Shield, Trash2, Upload, Search, Settings, Activity, History, X, PackageSearch } from "lucide-react";
import BarcodeScanner from "./BarcodeScanner";
import { useModalFocus } from "./useModalFocus";
import { api as apiRequest, type ApiProblem } from "./api";
import GooglePortalAccess from "./GooglePortalAccess";
import "./inventory.css";

type Role = "ADMIN" | "OPERATIONS" | "DEPOT" | string;
type Client = { id: string; name: string };
type Vehicle = { id: string; plate: string; available?: boolean | string };
type RouteOption = { id: string; name: string; state: string; version: number };
type AssignmentOption = { routeId: string; parcelId: string; active: boolean };
type ParcelOption = { id: string; code: string; shipmentId: string };
type ReturnOption = { id: string; parcelId: string; routeId: string; state: string; depotEvidenceId?: string | null };
type EvidenceUpload = (parcelId: string | null, file: File) => Promise<string | null>;
type Section = "inventory" | "orders" | "customerAccess";
type InventoryView = "stock" | "receive" | "move" | "adjust" | "catalog" | "movements" | "settings";
type OrdersView = "list" | "import" | "history" | "returns";
type Product = { id: string; clientId?: string; clientName?: string; sku: string; barcode?: string | null; name: string; tracking: "QUANTITY" | "SERIAL"; unit: string; weightGrams?: number | null; volumeCm3?: number | null; active?: boolean };
type LocationKind = "DEPOT" | "STORAGE" | "QUARANTINE";
type Location = { id: string; code: string; name: string; kind: LocationKind; active?: boolean };
type Balance = { clientId?: string; clientName?: string; productId: string; productName?: string; sku?: string; locationId: string; locationCode?: string; quantity: number; available?: number; reserved?: number; condition?: string; status?: string; custodyId?: string | null; orderId?: string | null };
type Unit = { id?: string; clientId?: string; productId: string; serial: string; barcode?: string | null; locationId?: string | null; status?: string; state?: string; orderId?: string | null; parcelId?: string | null };
type Movement = { id: string; productId?: string; productName?: string; clientName?: string; action?: string; type?: string; quantity?: number; fromLocationId?: string | null; toLocationId?: string | null; createdAt: string; reason?: string | null; reference?: string | null };
type SnapshotCounts = { products: number; locations: number; balances: number; units: number; movements: number };
type SnapshotLimits = { products: number | null; locations: number | null; balances: number | null; units: number; movements: number };
type SnapshotHasMore = { products: boolean; locations: boolean; balances: boolean; units: boolean; movements: boolean };
type StockTotals = Record<"AVAILABLE" | "RESERVED" | "VEHICLE" | "QUARANTINE", number>;
type InventoryData = { products: Product[]; locations: Location[]; balances: Balance[]; units: Unit[]; movements: Movement[]; counts: SnapshotCounts; limits: SnapshotLimits; hasMore: SnapshotHasMore; totals?: StockTotals; clientTotals?: Record<string, StockTotals> };
type OrderLine = { id?: string; productId: string; sku?: string; productName?: string; name?: string; quantity: number; requested?: number; reserved?: number; loaded?: number; delivered?: number; returned?: number; serials?: string[] };
type OrderParcel = { id: string; code: string; productId: string; serialId?: string | null; state: string };
type Order = { id: string; clientId: string; clientName?: string; externalId: string; date?: string; orderDate?: string; windowStart?: string | null; windowEnd?: string | null; serviceMinutes?: number | null; restrictions?: string | null; state: string; status?: string; destination: string; recipientName: string; recipientPhone?: string | null; lines?: OrderLine[]; items?: OrderLine[]; shipmentId?: string; parcelIds?: string[]; parcels?: OrderParcel[]; createdAt?: string };
type DraftOrderForm = { orderDate: string; destination: string; recipientName: string; recipientPhone: string; windowStart: string; windowEnd: string; serviceMinutes: string; restrictions: string; lines: Array<{ productId: string; quantity: number }> };
type CustomerAccess = { id: string; clientId: string; clientName: string; name: string; username: string; enabled: boolean; createdAt: string };
type ImportOrder = { clientId: string; externalId: string; orderDate: string; destination: string; recipientName: string; recipientPhone?: string; windowStart?: string; windowEnd?: string; serviceMinutes?: number; restrictions?: string; lines: Array<{ productId: string; quantity: number }> };
type ImportRowError = { row: number; field?: string; code?: string; message: string };
type ImportPreviewResult = { valid: boolean; rowCount: number; acceptedCount: number; orders: Array<{ clientId: string; externalId: string; lineCount: number; unitCount: number }>; rowErrors: ImportRowError[] };
type ImportHistoryItem = { id: string; source: string; status: string; rowCount: number; acceptedCount: number; rowErrors: ImportRowError[]; createdAt: string };
type CatalogAction = "CREATE" | "UPDATE" | "UNCHANGED";
type CatalogRow = { row: number; sku: string; name: string; barcode?: string | null; tracking: "QUANTITY" | "SERIAL"; unit: string; weightGrams?: number | null; volumeCm3?: number | null; action: CatalogAction };
type CatalogRowError = { row: number; field?: string; message: string };
type CatalogPreview = { valid: boolean; rowCount: number; createCount: number; updateCount: number; unchangedCount: number; rows: CatalogRow[]; rowErrors: CatalogRowError[]; ignoredColumns?: string[] };
type CatalogSource = { clientId: string; csv?: string; filename?: string; contentBase64?: string; defaultTracking?: "QUANTITY" | "SERIAL" };
type ReceiptBasketItem = { productId: string; quantity: number; serials: string[] };
type StockRow = { key: string; clientId?: string; clientName: string; productId: string; sku: string; productName: string; serial?: string; barcode?: string | null; locationCode: string; quantity: number; unit: string; status: string; orderReference: string };
type Props = { section: Section; role: Role; clients: Client[]; initialClientId?:string; initialView?:InventoryView; onReturnToClient?:(clientId:string)=>void; companyName?:string; supportContacts?:{name:string;role:string}[]; onManageClients?:()=>void; vehicles: Vehicle[]; routes: RouteOption[]; assignments: AssignmentOption[]; parcels: ParcelOption[]; returns: ReturnOption[]; onRefresh?: () => Promise<void>; uploadEvidence: EvidenceUpload };

const blankInventory: InventoryData = { products: [], locations: [], balances: [], units: [], movements: [], counts: { products: 0, locations: 0, balances: 0, units: 0, movements: 0 }, limits: { products: null, locations: null, balances: null, units: 1000, movements: 500 }, hasMore: { products: false, locations: false, balances: false, units: false, movements: false }, totals: { AVAILABLE: 0, RESERVED: 0, VEHICLE: 0, QUARANTINE: 0 }, clientTotals: {} };
const locationKindLabels: Record<LocationKind, string> = { DEPOT: "Depósito", STORAGE: "Sector / estante", QUARANTINE: "Cuarentena" };
const stockStatusLabels: Record<string, string> = { AVAILABLE: "Disponible", RESERVED: "Reservado", VEHICLE: "En vehículo", QUARANTINE: "Cuarentena", IN_TRANSIT: "En tránsito", DELIVERED: "Entregado", RETURNED: "Devuelto", DAMAGED: "Dañado", LOST: "Perdido" };
const orderStatusLabels: Record<string, string> = { DRAFT: "Borrador", RESERVED: "Reservado", PARTIALLY_LOADED: "Carga parcial", LOADED: "Cargado", IN_TRANSIT: "En reparto", PARTIAL: "Entrega parcial", DELIVERED: "Entregado", CANCELLED: "Cancelado", EXCEPTION: "Con excepción", CLOSED: "Cerrado" };
const movementStatusLabels: Record<string, string> = { RECEIPT: "Recepcion", RECEIVED: "Recepcion", MOVEMENT: "Traslado", MOVE: "Traslado", ADJUSTMENT: "Ajuste", RESERVATION: "Reserva", LOAD: "Carga", DELIVERY: "Entrega", RETURN: "Retorno", RELEASE: "Liberacion", ARCHIVE: "Archivo" };
const csvAliases: Record<string, string[]> = {
  externalId: ["externalid", "orderid", "pedido", "referencia", "nropedido", "idpedido"],
  date: ["date", "orderdate", "fecha", "fechapedido", "fechadeentrega"],
  destination: ["destination", "destino", "direccion", "direccionentrega", "address"],
  recipientName: ["recipientname", "destinatario", "contacto", "nombre", "cliente"],
  recipientPhone: ["recipientphone", "telefono", "phone", "contacto telefono"],
  windowStart: ["windowstart", "ventanainicio", "horainicio", "desde", "horadesde"],
  windowEnd: ["windowend", "ventanafin", "horafin", "hasta", "horahasta"],
  serviceMinutes: ["serviceminutes", "minutosservicio", "tiemposervicio", "duraciondescarga"],
  restrictions: ["restrictions", "restricciones", "observaciones", "notas"],
  sku: ["sku", "productsku", "codigo", "codigoproducto", "producto"],
  quantity: ["quantity", "cantidad", "unidades", "qty"],
};

type ApiOptions = { idempotent?: boolean };
type PendingCommand = { commandId: string; touchedAt: number };
const pendingCommands = new Map<string, PendingCommand>();
const PENDING_COMMAND_LIMIT = 200;
const PENDING_COMMAND_TTL = 24 * 60 * 60 * 1000;
const INVENTORY_PAGE_SIZE = 20;
const RETRY_COMMAND_MESSAGE = " Si la respuesta se perdió, volvé a intentar la misma operación: se reutilizará su identificador seguro.";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function pendingCommandKey(path: string, method: string, payload: Record<string, unknown>): Promise<string> {
  const { commandId: _commandId, ...body } = payload;
  const source = `${method.toUpperCase()} ${path}\n${canonicalJson(body)}`;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${method.toUpperCase()} ${path}\n${fingerprint}`;
  } catch {
    return source;
  }
}

function prunePendingCommands(): void {
  const now = Date.now();
  for (const [storedKey, stored] of pendingCommands) {
    if (now - stored.touchedAt > PENDING_COMMAND_TTL) pendingCommands.delete(storedKey);
  }
}

function rememberPendingCommand(key: string, entry: PendingCommand): void {
  prunePendingCommands();
  pendingCommands.delete(key);
  pendingCommands.set(key, { ...entry, touchedAt: Date.now() });
  while (pendingCommands.size > PENDING_COMMAND_LIMIT) {
    const oldest = pendingCommands.keys().next().value;
    if (oldest === undefined) break;
    pendingCommands.delete(oldest);
  }
}

async function api<T>(path: string, method = "GET", payload?: Record<string, unknown>, options: ApiOptions = {}): Promise<T> {
  const verb = method.toUpperCase();
  const idempotent = options.idempotent ?? verb !== "GET";
  const key = payload && idempotent ? await pendingCommandKey(path, verb, payload) : null;
  prunePendingCommands();
  const command = key ? pendingCommands.get(key) : undefined;
  const requestPayload = payload && key
    ? { ...payload, commandId: command?.commandId || (typeof payload.commandId === "string" ? payload.commandId : commandId()) }
    : payload;
  if (key && requestPayload?.commandId) rememberPendingCommand(key, { commandId: String(requestPayload.commandId), touchedAt: Date.now() });

  try {
    const body = await apiRequest<T>(path, {
      method: verb,
      headers: verb === "GET" ? undefined : { "Content-Type": "application/json", "X-Requested-With": "logistics-os" },
      body: requestPayload ? JSON.stringify(requestPayload) : undefined,
    });
    if (key) pendingCommands.delete(key);
    return body;
  } catch (caught) {
    const failure = caught as ApiProblem;
    if (key) {
      if (failure.status && failure.status >= 400 && failure.status < 500) pendingCommands.delete(key);
      else rememberPendingCommand(key, { commandId: String(requestPayload?.commandId), touchedAt: Date.now() });
    }
    const message = failure instanceof Error ? failure.message : "No se pudo completar la solicitud.";
    const error = new Error(`${message}${key && (!failure.status || failure.status >= 500) ? RETRY_COMMAND_MESSAGE : ""}`) as Error & { details?: unknown };
    error.details = failure.details;
    throw error;
  }
}

function commandId(): string {
  return crypto.randomUUID();
}

function arrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"' && quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function normalizedHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseOrderCsv(text: string, clientId: string, products: Product[], orders: Order[], rowNumbers?:number[]): { imported: ImportOrder[]; issues: string[]; rowCount: number } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { imported: [], issues: ["El archivo debe incluir encabezados y al menos una línea de pedido."], rowCount: 0 };
  const header = csvCells(lines[0]).map(normalizedHeader);
  const indices: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(csvAliases)) {
    indices[field] = header.findIndex((name) => aliases.map(normalizedHeader).includes(name));
  }
  const required = ["externalId", "date", "destination", "recipientName", "sku", "quantity"];
  const missing = required.filter((field) => indices[field] < 0);
  if (missing.length) return { imported: [], issues: ["Faltan columnas: " + missing.map((field) => field === "externalId" ? "pedido" : field === "recipientName" ? "destinatario" : field === "destination" ? "destino" : field === "quantity" ? "cantidad" : field === "sku" ? "SKU" : "fecha").join(", ") + "."], rowCount: lines.length - 1 };

  const issues: string[] = [];
  const grouped = new Map<string, ImportOrder>();
  const existingIds = new Set(orders.filter((order) => order.clientId === clientId).map((order) => order.externalId.trim().toLowerCase()));
  const productIndex = new Map<string, Product>();
  products.filter((product) => product.active !== false && (!product.clientId || product.clientId === clientId)).forEach((product) => {
    productIndex.set(product.sku.trim().toLowerCase(), product);
    if (product.barcode) productIndex.set(product.barcode.trim().toLowerCase(), product);
  });

  for (let lineNo = 1; lineNo < lines.length; lineNo += 1) {
    const cells = csvCells(lines[lineNo]);
    const cell = (key: string) => cells[indices[key]]?.trim() ?? "";
    const externalId = cell("externalId");
    const date = cell("date");
    const destination = cell("destination");
    const recipientName = cell("recipientName");
    const sku = cell("sku");
    const quantity = Number(cell("quantity"));
    const windowStart = cell("windowStart");
    const windowEnd = cell("windowEnd");
    const serviceMinutesValue = cell("serviceMinutes");
    const restrictions = cell("restrictions");
    const prefix = rowNumbers ? `Fila ${rowNumbers[lineNo-1]}: ` : `Línea ${lineNo + 1}: `;
    if (!externalId || !date || !destination || !recipientName || !sku) { issues.push(prefix + "faltan pedido, fecha, destino, destinatario o SKU."); continue; }
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) { issues.push(prefix + "la fecha debe usar el formato AAAA-MM-DD."); continue; }
    if (!Number.isInteger(quantity) || quantity <= 0) { issues.push(prefix + "la cantidad debe ser un entero mayor a cero."); continue; }
    if (Boolean(windowStart) !== Boolean(windowEnd) || (windowStart && !/^([01]\d|2[0-3]):[0-5]\d$/.test(windowStart)) || (windowEnd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(windowEnd))) { issues.push(prefix + "completá ambos horarios de ventana en formato HH:mm."); continue; }
    if (windowStart && windowEnd && windowStart >= windowEnd) { issues.push(prefix + "la hora de fin debe ser posterior a la hora de inicio."); continue; }
    if (serviceMinutesValue && (!/^\d+$/.test(serviceMinutesValue) || Number(serviceMinutesValue) < 1 || Number(serviceMinutesValue) > 480)) { issues.push(prefix + "los minutos de servicio deben ser un entero entre 1 y 480."); continue; }
    const product = productIndex.get(sku.toLowerCase());
    if (!product) { issues.push(prefix + `SKU «${sku}» no encontrado para el cliente seleccionado.`); continue; }
    const key = externalId.toLowerCase();
    if (existingIds.has(key)) { issues.push(prefix + `el pedido ${externalId} ya está importado.`); continue; }
    const current = grouped.get(key);
    if (current && (current.orderDate !== date || current.destination !== destination || current.recipientName !== recipientName || current.recipientPhone !== (cell("recipientPhone") || undefined) || current.windowStart !== (windowStart || undefined) || current.windowEnd !== (windowEnd || undefined) || current.serviceMinutes !== (serviceMinutesValue ? Number(serviceMinutesValue) : undefined) || current.restrictions !== (restrictions || undefined))) {
      issues.push(prefix + `los datos del pedido ${externalId} no coinciden con sus otras líneas.`); continue;
    }
    const target = current ?? { clientId, externalId, orderDate: date, destination, recipientName, ...(cell("recipientPhone") ? { recipientPhone: cell("recipientPhone") } : {}), ...(windowStart ? { windowStart, windowEnd } : {}), ...(serviceMinutesValue ? { serviceMinutes: Number(serviceMinutesValue) } : {}), ...(restrictions ? { restrictions } : {}), lines: [] };
    const existingLine = target.lines.find((line) => line.productId === product.id);
    if (existingLine) existingLine.quantity += quantity;
    else target.lines.push({ productId: product.id, quantity });
    grouped.set(key, target);
  }
  return { imported: [...grouped.values()], issues, rowCount: lines.length - 1 };
}

function inventoryError(error: unknown): string {
  if (!(error instanceof Error)) return "Ocurrió un error inesperado.";
  const details = (error as Error & { details?: { rowErrors?: ImportRowError[] } }).details;
  const rowErrors = details?.rowErrors ?? [];
  return rowErrors.length ? `${error.message} ${rowErrors.map((item) => `Pedido ${item.row}${item.field ? ` · ${item.field}` : ""}: ${item.message}`).join("; ")}` : error.message;
}

function qtyLabel(product: Product | undefined, quantity: number): string {
  return `${new Intl.NumberFormat("es").format(quantity)} ${product?.unit || (quantity === 1 ? "unidad" : "unidades")}`;
}

function statusLabel(status: string): string {
  const normalized = status.toUpperCase().replace(/[ -]/g, "_");
  return orderStatusLabels[normalized] || stockStatusLabels[normalized] || movementStatusLabels[normalized] || status.replaceAll("_", " ");
}

function formatOrderDate(value?: string): string {
  if (!value) return "Sin fecha";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("es");
}

export default function InventoryPanel({ section, role, clients, initialClientId='',initialView='stock',onReturnToClient,companyName="Nexora", supportContacts=[], onManageClients, vehicles, routes, assignments, parcels, returns, onRefresh, uploadEvidence }: Props) {
  const isAdmin = role === "ADMIN";
  const canManage = isAdmin || role === "OPERATIONS";
  const canWarehouse = canManage || role === "DEPOT";
  const [inventory, setInventory] = useState<InventoryData>(blankInventory);
  const [orders, setOrders] = useState<Order[]>([]);
  const [accesses, setAccesses] = useState<CustomerAccess[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inventoryView, setInventoryView] = useState<InventoryView>(initialView);
  const [ordersView, setOrdersView] = useState<OrdersView>("list");
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryClientFilter, setInventoryClientFilter] = useState(initialClientId);
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState("");
  const [stockPage, setStockPage] = useState(0);
  const [movementPage, setMovementPage] = useState(0);
  const [catalogProductSearch, setCatalogProductSearch] = useState("");
  const [catalogProductPage, setCatalogProductPage] = useState(0);
  const [remoteStock,setRemoteStock]=useState<StockRow[]>([]),[stockTotal,setStockTotal]=useState(0);
  const [remoteCatalog,setRemoteCatalog]=useState<Product[]>([]),[catalogTotal,setCatalogTotal]=useState(0);
  const [ordersSearch, setOrdersSearch] = useState("");
  const [ordersStatusFilter, setOrdersStatusFilter] = useState("");
  const [ordersPage, setOrdersPage] = useState(0);
  const [ordersTotal,setOrdersTotal]=useState(0),[ordersQuery,setOrdersQuery]=useState('');
  const ordersRequest=useRef(0);
  useEffect(()=>{const timer=setTimeout(()=>setOrdersQuery(ordersSearch),250);return()=>clearTimeout(timer);},[ordersSearch]);
  const [importHistoryPage, setImportHistoryPage] = useState(0);
  const [orderCsvPreviewPage, setOrderCsvPreviewPage] = useState(0);
  const [catalogMissingCode, setCatalogMissingCode] = useState("");
  const [catalogClientId, setCatalogClientId] = useState(initialClientId);
  const [catalogDefaultTracking, setCatalogDefaultTracking] = useState<"" | "QUANTITY" | "SERIAL">("");
  const [selectedClient, setSelectedClient] = useState(initialClientId);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [receiptBasket, setReceiptBasket] = useState<Record<string, ReceiptBasketItem>>({});
  const [selectedLocation, setSelectedLocation] = useState("");
  const [returnLocationId, setReturnLocationId] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [scanCounts, setScanCounts] = useState<Record<string, number>>({});
  const [scanSerials, setScanSerials] = useState<string[]>([]);
  const [scanCodes, setScanCodes] = useState<string[]>([]);
  const [stagedReturnIds, setStagedReturnIds] = useState<string[]>([]);
  const [returnEvidenceIds, setReturnEvidenceIds] = useState<Record<string, string>>({});
  const [uploadingReturnId, setUploadingReturnId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedOrderMode, setSelectedOrderMode] = useState<"load" | "return" | "release" | null>(null);
  const [stagedReleaseParcelIds, setStagedReleaseParcelIds] = useState<string[]>([]);
  const [releaseLocationId, setReleaseLocationId] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const [editingOrderId, setEditingOrderId] = useState("");
  const [editingOrderForm, setEditingOrderForm] = useState<DraftOrderForm | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [productForm, setProductForm] = useState({ clientId: "", sku: "", barcode: "", name: "", tracking: "QUANTITY" as "QUANTITY" | "SERIAL", unit: "unidad", weightGrams: "", volumeCm3: "" });
  const [locationForm, setLocationForm] = useState({ code: "", name: "", kind: "STORAGE" as LocationKind });
  const [orderClientId, setOrderClientId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [orderFile,setOrderFile]=useState<File|null>(null);
  const [importPreview, setImportPreview] = useState<ReturnType<typeof parseOrderCsv> | null>(null);
  const [serverImportPreview, setServerImportPreview] = useState<ImportPreviewResult | null>(null);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  const [previewingImport, setPreviewingImport] = useState(false);
  const [importCommandId, setImportCommandId] = useState("");
  const [catalogFilename, setCatalogFilename] = useState("");
  const [receiptFocusSignal, setReceiptFocusSignal] = useState(0);
  const [catalogSource, setCatalogSource] = useState<CatalogSource | null>(null);
  const [catalogPreview, setCatalogPreview] = useState<CatalogPreview | null>(null);
  const [previewingCatalog, setPreviewingCatalog] = useState(false);
  const [catalogPreviewPage, setCatalogPreviewPage] = useState(0);
  const [catalogErrorPage, setCatalogErrorPage] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [accessForm, setAccessForm] = useState({ clientId: "", name: "", username: "", password: "" });

  const refreshInventory = useCallback(async () => {
    const result = await api<InventoryData>("/api/inventory");
    setInventory({ ...blankInventory, ...result });
  }, []);
  const refreshOrders = useCallback(async () => {
    const request=++ordersRequest.current;
    const params=new URLSearchParams({limit:String(INVENTORY_PAGE_SIZE),offset:String(ordersPage*INVENTORY_PAGE_SIZE),q:ordersQuery,status:ordersStatusFilter});
    const result = await api<{ items: Order[];total?:number } | Order[]>("/api/orders?"+params);
    if(request!==ordersRequest.current)return;
    setOrdersTotal(Array.isArray(result)?result.length:result.total??result.items.length);
    const rawOrders = Array.isArray(result) ? result : result.items ?? [];
    setOrders(rawOrders.map((order) => {
      const raw = order as Order;
      const rawLines = raw.lines ?? raw.items ?? [];
      return {
        ...raw,
        date: raw.date ?? raw.orderDate,
        state: raw.state ?? raw.status ?? "DRAFT",
        lines: rawLines.map((line) => ({ ...line, productName: line.productName ?? line.name, quantity: line.quantity ?? line.requested ?? 0 })),
      };
    }));
  }, [ordersPage,ordersQuery,ordersStatusFilter]);
  const refreshAccesses = useCallback(async () => {
    const result = await api<{ items: CustomerAccess[] }>("/api/customer-access");
    setAccesses(result.items ?? []);
  }, []);
  const refreshImportHistory = useCallback(async () => {
    const result = await api<{ items: ImportHistoryItem[] }>("/api/orders/imports");
    setImportHistory(result.items ?? []);
  }, []);

  useEffect(() => {
    let current = true;
    setError("");
    setLoading(true);
    const loader = section === "inventory" ? Promise.all([refreshInventory(), refreshOrders()]).then(() => undefined) : section === "orders" ? Promise.all([refreshInventory(), refreshOrders(), ...(canManage ? [refreshImportHistory()] : [])]).then(() => undefined) : refreshAccesses();
    void loader.catch((caught: unknown) => { if (current) setError(inventoryError(caught)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [section, canManage, refreshAccesses, refreshImportHistory, refreshInventory, refreshOrders]);

  useEffect(() => {
    if (!selectedClient && clients[0]) setSelectedClient(clients[0].id);
    if (!catalogClientId && clients[0]) setCatalogClientId(clients[0].id);
    if (!productForm.clientId && clients[0]) setProductForm((value) => ({ ...value, clientId: clients[0].id }));
    if (!orderClientId && clients[0]) setOrderClientId(clients[0].id);
    if (!accessForm.clientId && clients[0]) setAccessForm((value) => ({ ...value, clientId: clients[0].id }));
  }, [clients, selectedClient, catalogClientId, productForm.clientId, orderClientId, accessForm.clientId]);

  useEffect(()=>{
    if(section!=='inventory'||!['stock','catalog'].includes(inventoryView))return;
    const controller=new AbortController();const catalog=inventoryView==='catalog';
    const params=new URLSearchParams({limit:String(INVENTORY_PAGE_SIZE),offset:String((catalog?catalogProductPage:stockPage)*INVENTORY_PAGE_SIZE),q:catalog?catalogProductSearch:inventorySearch});
    const client=catalog?catalogClientId:inventoryClientFilter;if(client)params.set('clientId',client);if(!catalog)params.set('status',inventoryStatusFilter);
    const timer=setTimeout(()=>{void apiRequest<{items:(Product|StockRow)[];total:number}>('/api/inventory/'+(catalog?'products':'stock')+'?'+params,{signal:controller.signal}).then(result=>{if(controller.signal.aborted)return;if(catalog){if(catalogProductPage>0&&result.total<=catalogProductPage*INVENTORY_PAGE_SIZE){setCatalogProductPage(0);return;}setRemoteCatalog(result.items as Product[]);setCatalogTotal(result.total);}else{if(stockPage>0&&result.total<=stockPage*INVENTORY_PAGE_SIZE){setStockPage(0);return;}setRemoteStock(result.items as StockRow[]);setStockTotal(result.total);}}).catch(e=>{if(!controller.signal.aborted)setError(inventoryError(e));});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[section,inventoryView,catalogClientId,catalogProductPage,catalogProductSearch,inventoryClientFilter,inventoryStatusFilter,inventorySearch,stockPage,inventory]);
  const productById = useMemo(() => new Map(inventory.products.map((product) => [product.id, product])), [inventory.products]);
  const receiptLocations=useMemo(()=>inventory.locations.filter(location=>location.active!==false&&location.kind!=="QUARANTINE"),[inventory.locations]);
  const hasReceiptLocations=receiptLocations.length>0;
  const setupContact=supportContacts.find(person=>person.role==="ADMIN")?.name;
  useEffect(()=>{if(!receiptLocations.some(location=>location.id===selectedLocation))setSelectedLocation(receiptLocations.length===1?receiptLocations[0].id:'');},[receiptLocations,selectedLocation]);
  const locationById = useMemo(() => new Map(inventory.locations.map((location) => [location.id, location])), [inventory.locations]);
  const ordersById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const filteredStockRows = remoteStock;
  const visibleOrders = orders;
  const pageStockRows = filteredStockRows;
  const filteredCatalogProducts = remoteCatalog;
  const pageCatalogProducts = remoteCatalog;
  const pageOrders = visibleOrders;
  const pageImportHistory = importHistory.slice(importHistoryPage * INVENTORY_PAGE_SIZE, (importHistoryPage + 1) * INVENTORY_PAGE_SIZE);
  const pageOrderCsvPreview = (importPreview?.imported ?? []).slice(orderCsvPreviewPage * INVENTORY_PAGE_SIZE, (orderCsvPreviewPage + 1) * INVENTORY_PAGE_SIZE);
  const pageMovements = inventory.movements.slice(movementPage * INVENTORY_PAGE_SIZE, (movementPage + 1) * INVENTORY_PAGE_SIZE);
  const pageCatalogPreviewRows = (catalogPreview?.rows ?? []).slice(catalogPreviewPage * INVENTORY_PAGE_SIZE, (catalogPreviewPage + 1) * INVENTORY_PAGE_SIZE);
  const pageCatalogErrors = (catalogPreview?.rowErrors ?? []).slice(catalogErrorPage * INVENTORY_PAGE_SIZE, (catalogErrorPage + 1) * INVENTORY_PAGE_SIZE);
  const inventoryTotals = useMemo<StockTotals>(() => {
    const zero: StockTotals = { AVAILABLE: 0, RESERVED: 0, VEHICLE: 0, QUARANTINE: 0 };
    if (inventoryClientFilter) return inventory.clientTotals?.[inventoryClientFilter] ?? zero;
    if (inventory.totals) return inventory.totals;
    const totals = { ...zero };
    inventory.balances.forEach((balance) => {
      const status = balance.status?.toUpperCase() as keyof StockTotals | undefined;
      if (status && status in totals) totals[status] += balance.quantity;
    });
    inventory.units.forEach((unit) => {
      const status = (unit.status ?? unit.state ?? "").toUpperCase() as keyof StockTotals;
      if (status in totals) totals[status] += 1;
    });
    return totals;
  }, [inventory.balances, inventory.clientTotals, inventory.totals, inventory.units, inventoryClientFilter]);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null;
  useModalFocus(Boolean(showProductForm || showLocationForm || editingProduct || editingLocation ||
    selectedOrder && (selectedOrderMode === "load" || editingOrderId === selectedOrder.id && editingOrderForm)), () => {
    if (busy) return;
    setShowProductForm(false); setShowLocationForm(false); setEditingProduct(null); setEditingLocation(null);
    setSelectedOrderId(""); setSelectedOrderMode(null); setEditingOrderId(""); setEditingOrderForm(null);
  });
  const selectedOrderLines = selectedOrder?.lines ?? selectedOrder?.items ?? [];
  const returnOrders = orders.map((order) => ({
    order,
    returns: returns.filter((item) => item.state === "AUTHORIZED" && (order.parcelIds?.includes(item.parcelId) || parcels.some((parcel) => parcel.id === item.parcelId && parcel.shipmentId === order.shipmentId))),
  })).filter((entry) => entry.returns.length > 0);
  const releaseOrders = orders.map((order) => ({ order, quarantinedParcels: (order.parcels ?? []).filter((parcel) => parcel.state === "QUARANTINE") })).filter((entry) => entry.quarantinedParcels.length > 0);
  const assignedRoutes = selectedOrder?.parcelIds?.length ? routes.filter((route) => route.state === "READY" && selectedOrder.parcelIds?.some((parcelId) => assignments.some((assignment) => assignment.active && assignment.routeId === route.id && assignment.parcelId === parcelId))) : [];
  const eligibleProducts = inventory.products.filter((product) => product.active !== false && (!product.clientId || product.clientId === selectedClient));
  const runMutation = async (path: string, payload: Record<string, unknown>, message: string, refresh: "inventory" | "orders" | "access" | "both" = "inventory", method = "POST") => {
    setBusy(true); setError(""); setSuccess("");
    try {
      await api(path, method, { commandId: commandId(), ...payload });
      setSuccess(message);
      setReason(""); setReference(""); setScanCounts({}); setScanSerials([]); setScanCodes([]); setStagedReturnIds([]); setReturnEvidenceIds({}); setStagedReleaseParcelIds([]); setReleaseReason("");
      const refreshTasks: Promise<void>[] = [];
      if (refresh === "inventory" || refresh === "both") refreshTasks.push(refreshInventory());
      if (refresh === "orders" || refresh === "both") refreshTasks.push(refreshOrders());
      if (refresh === "access") refreshTasks.push(refreshAccesses());
      if (refresh === "orders" || refresh === "both" || path === "/api/inventory/catalog/import" || path.startsWith("/api/inventory/products")) { const parentRefresh = onRefresh?.(); if (parentRefresh) refreshTasks.push(parentRefresh); }
      try { await Promise.all(refreshTasks); }
      catch (caught) { setError(`La operación se guardó correctamente, pero no se pudo actualizar la vista. Usá «Actualizar» para volver a consultar. ${inventoryError(caught)}`); }
      return true;
    } catch (caught) { setError(inventoryError(caught)); return false; }
    finally { setBusy(false); }
  };

  const acceptInventoryScan = async (code: string) => {
    setSuccess("");
    const normalized = code.trim().toLowerCase();
    if (!normalized) return;
    let product = eligibleProducts.find((item) => item.barcode?.trim().toLowerCase() === normalized || item.sku.trim().toLowerCase() === normalized);
    let unit = inventory.units.find((item) => item.serial.trim().toLowerCase() === normalized || item.barcode?.trim().toLowerCase() === normalized);
    if(!product||!unit&&product.tracking==='SERIAL'){
      try{const result=await api<{product:Product|null;unit:Unit|null}>('/api/inventory/lookup?'+new URLSearchParams({clientId:selectedClient,code:code.trim()}));product=result.product??product;unit=result.unit??unit;
       if(result.product||result.unit)setInventory(current=>({...current,products:result.product&&!current.products.some(p=>p.id===result.product!.id)?[result.product,...current.products].slice(0,1000):current.products,units:result.unit&&!current.units.some(u=>u.id===result.unit!.id)?[result.unit,...current.units].slice(0,1000):current.units}));
      }catch(e){setError(inventoryError(e));return;}
    }
    const selected = productById.get(selectedProduct);
    if (inventoryView === "receive") {
      const resolvedForReceipt = product ?? (unit ? productById.get(unit.productId) : undefined) ?? (selected?.tracking === "SERIAL" ? selected : undefined);
      if (!resolvedForReceipt) {
        setCatalogMissingCode(code.trim());
        setError(`No está en catálogo el código «${code.trim()}». Importá el listado o elegí otro cliente.`);
        return;
      }
      if (resolvedForReceipt.clientId && resolvedForReceipt.clientId !== selectedClient) {
        setError("El código corresponde a un producto de otro cliente.");
        return;
      }
      setCatalogMissingCode("");
      const pendingReceiptProductId = Object.keys(receiptBasket)[0];
      if (pendingReceiptProductId && pendingReceiptProductId !== resolvedForReceipt.id) {
        const pendingProduct = productById.get(pendingReceiptProductId);
        setError(`${pendingProduct?.sku ?? "Este producto"} tiene lecturas pendientes. Confirmá esta recepción antes de cambiar de producto.`);
        return;
      }
      setSelectedProduct(resolvedForReceipt.id);
      if (resolvedForReceipt.tracking === "SERIAL") {
        if (product) {
          setError("");
          setSuccess(`${resolvedForReceipt.sku} listo. Escaneá ahora cada serie individual.`);
          return;
        }
        if (unit || inventory.units.some((item) => item.productId === resolvedForReceipt.id && item.serial.trim().toLowerCase() === normalized)) {
          setError("Esa serie ya existe en el inventario. Escaneá la serie nueva que recibiste.");
          return;
        }
        setReceiptBasket((current) => {
          const item = current[resolvedForReceipt.id] ?? { productId: resolvedForReceipt.id, quantity: 0, serials: [] };
          if (item.serials.some((serial) => serial.trim().toLowerCase() === normalized)) return current;
          return { ...current, [resolvedForReceipt.id]: { productId: resolvedForReceipt.id, quantity: item.quantity + 1, serials: [...item.serials, code.trim()] } };
        });
        setError("");
       setSuccess(`${resolvedForReceipt.sku} · serie ${code.trim()} agregada al lote.`);
        return;
      }
      if (!product) {
        setError("Escaneá el SKU o código de barras del producto del catálogo.");
        return;
      }
      setReceiptBasket((current) => {
        const item = current[resolvedForReceipt.id] ?? { productId: resolvedForReceipt.id, quantity: 0, serials: [] };
        return { ...current, [resolvedForReceipt.id]: { ...item, quantity: item.quantity + 1 } };
      });
      setError("");
      setSuccess(`${resolvedForReceipt.sku} agregado al lote de recepción.`);
      return;
    }
    setCatalogMissingCode("");
    const resolved = product ?? (unit ? productById.get(unit.productId) : undefined) ?? (selected?.tracking === "SERIAL" ? selected : undefined);
    if (!resolved) { setError(`No hay un producto o una serie registrada con el código «${code}».`); return; }
    if (resolved.clientId && resolved.clientId !== selectedClient) { setError("El código corresponde a un producto de otro cliente."); return; }
    setError(""); setSelectedProduct(resolved.id);
    if (resolved.tracking === "SERIAL") {
      if (!unit && product?.id === resolved.id) { setError("Ese es el código compartido del producto. Escaneá la etiqueta con la serie individual."); return; }
      if (!unit && (inventoryView === "move" || (inventoryView === "adjust" && Number(quantity) < 0))) { setError("Para trasladar o retirar existencias, escaneá una serie ya registrada en el inventario."); return; }
      const serial = unit?.serial ?? code.trim();
      if (scanSerials.includes(serial)) { setError(`La serie ${serial} ya está en esta operación.`); return; }
      setScanSerials((items) => [...items, serial]);
      setScanCounts((items) => ({ ...items, [resolved.id]: (items[resolved.id] ?? 0) + 1 }));
    } else setScanCounts((items) => ({ ...items, [resolved.id]: (items[resolved.id] ?? 0) + 1 }));
  };

  const addManualReceiptQuantity = () => {
    const item = productById.get(selectedProduct);
    const amount = Number(quantity);
    if (!item) { setError("Escaneá primero un SKU o código de barras del catálogo."); return; }
    if (item.tracking === "SERIAL") { setError("Este producto se recibe escaneando una serie por unidad."); return; }
    if (Object.keys(receiptBasket).some((productId) => productId !== item.id)) { setError("Confirmá la recepción pendiente antes de cambiar de producto."); return; }
    if (!Number.isInteger(amount) || amount <= 0) { setError("Ingresá una cantidad entera mayor que cero."); return; }
    setReceiptBasket((current) => {
      const previous = current[item.id] ?? { productId: item.id, quantity: 0, serials: [] };
      return { ...current, [item.id]: { ...previous, quantity: previous.quantity + amount } };
    });
    setError(""); setCatalogMissingCode("");
    setSuccess(`${item.sku}: ${amount} unidad(es) sumadas al lote.`);
    setQuantity("1");
  };

  const handleReceipt = async (event: FormEvent) => {
    event.preventDefault();
    const item = Object.values(receiptBasket)[0];
    if (!selectedClient || !selectedLocation || !item) { setError("Elegí cliente y ubicación, luego escaneá o agregá un producto."); return; }
    if (Object.keys(receiptBasket).length !== 1) { setError("Confirmá cada producto en una recepción independiente."); return; }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || (productById.get(item.productId)?.tracking === "SERIAL" && item.serials.length !== item.quantity)) { setError("Revisá la cantidad y las series antes de confirmar."); return; }
    const ok = await runMutation("/api/inventory/receipts", { clientId: selectedClient, productId: item.productId, locationId: selectedLocation, quantity: item.quantity, ...(item.serials.length ? { serials: item.serials.map((serial) => ({ serial })) } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }, "Recepción registrada.");
    if (ok) { setReceiptBasket({}); setSelectedProduct(""); setQuantity("1"); setReceiptFocusSignal((signal) => signal + 1); }
  };
  const handleMovement = async (event: FormEvent) => {
    event.preventDefault();
    const item = productById.get(selectedProduct);
    const amount = item?.tracking === "SERIAL" ? scanSerials.length : scanCounts[selectedProduct] ?? 0;
    if (!selectedClient || !item || !selectedLocation || !targetLocation || selectedLocation === targetLocation || !Number.isInteger(amount) || amount <= 0) { setError("Elegí producto, ubicaciones distintas y escaneá cada unidad a trasladar."); return; }
    const ok = await runMutation("/api/inventory/movements", { clientId: selectedClient, productId: item.id, quantity: amount, fromLocationId: selectedLocation, toLocationId: targetLocation, ...(item.tracking === "SERIAL" ? { serials: scanSerials } : {}), reason: reason.trim() }, "Traslado registrado.");
    if (ok) setQuantity("1");
  };

  const handleAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    const delta = Number(quantity);
    if (!selectedClient || !selectedProduct || !selectedLocation || !Number.isInteger(delta) || delta === 0 || !reason.trim()) { setError("El ajuste requiere producto, ubicación, diferencia entera distinta de cero y motivo."); return; }
    if (productById.get(selectedProduct)?.tracking === "SERIAL" && Math.abs(delta) !== scanSerials.length) { setError("Para un producto serializado, la diferencia debe coincidir con la cantidad de series escaneadas."); return; }
    await runMutation("/api/inventory/adjustments", { clientId: selectedClient, productId: selectedProduct, locationId: selectedLocation, quantityDelta: delta, ...(scanSerials.length ? { serials: scanSerials } : {}), reason: reason.trim() }, "Ajuste autorizado registrado.");
  };

  const createProduct = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await runMutation("/api/inventory/products", { ...productForm, clientId: productForm.clientId, barcode: productForm.barcode.trim() || undefined, weightGrams: productForm.weightGrams === "" ? null : Math.round(Number(productForm.weightGrams) * 1000), volumeCm3: productForm.volumeCm3 === "" ? null : Math.round(Number(productForm.volumeCm3) * 1_000_000) }, "Producto creado.");
    if (ok) { setProductForm((form) => ({ ...form, sku: "", barcode: "", name: "", weightGrams: "", volumeCm3: "" })); setShowProductForm(false); }
  };
  const createLocation = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await runMutation("/api/inventory/locations", locationForm, "Depósito o sector creado.");
    if (ok) { setLocationForm({ code: "", name: "", kind: "STORAGE" }); setShowLocationForm(false); }
  };
  const readCatalogFile = async (file?: File) => {
    if (!file) { setCatalogFilename(""); setCatalogSource(null); setCatalogPreview(null); return; }
    setCatalogFilename(file.name); setCatalogSource(null); setCatalogPreview(null); setError(""); setSuccess("");
    try {
      if (file.name.toLowerCase().endsWith(".csv")) setCatalogSource({ clientId: catalogClientId, csv: await file.text() });
      else if (file.name.toLowerCase().endsWith(".xlsx")) setCatalogSource({ clientId: catalogClientId, filename: file.name, contentBase64: arrayBufferBase64(await file.arrayBuffer()) });
      else setError("Elegí un archivo CSV o Excel .xlsx.");
    } catch (caught) { setError(inventoryError(caught)); }
  };
  const previewCatalog = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess("");
    if (!canManage || !catalogClientId || !catalogSource) { setError("Seleccioná el cliente y un archivo CSV o .xlsx antes de validar."); return; }
    setPreviewingCatalog(true);
    try {
      const source = { ...catalogSource, clientId: catalogClientId, defaultTracking: catalogDefaultTracking || undefined };
      const result = await api<CatalogPreview>("/api/inventory/catalog/preview", "POST", source, { idempotent: false });
      setCatalogSource(source); setCatalogPreview(result); setCatalogPreviewPage(0); setCatalogErrorPage(0);
      if (!result.valid) setError("La vista previa tiene errores. Corregí el archivo y volvé a validarlo.");
      else setSuccess("Vista previa lista. Revisá los conteos antes de importar.");
    } catch (caught) { setError(inventoryError(caught)); }
    finally { setPreviewingCatalog(false); }
  };
  const importCatalog = async () => {
    if (!canManage || !catalogSource || !catalogPreview?.valid || catalogPreview.rowErrors.length) { setError("La importación requiere una vista previa válida y sin errores."); return; }
    const source = { ...catalogSource, clientId: catalogClientId, defaultTracking: catalogDefaultTracking || undefined };
    const ok = await runMutation("/api/inventory/catalog/import", source, "Catálogo actualizado desde el archivo.", "inventory");
    if (ok) { setCatalogSource(null); setCatalogPreview(null); setCatalogFilename(""); setCatalogPreviewPage(0); setCatalogErrorPage(0); }
  };
  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingProduct) return;
    const { id, clientName: _clientName, ...payload } = editingProduct;
    if (await runMutation(`/api/inventory/products/${encodeURIComponent(id)}`, payload, "Producto actualizado.", "inventory", "PATCH")) setEditingProduct(null);
  };
  const saveLocation = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingLocation) return;
    if (await runMutation(`/api/inventory/locations/${encodeURIComponent(editingLocation.id)}`, { code: editingLocation.code, name: editingLocation.name, kind: editingLocation.kind, active: editingLocation.active !== false }, "Ubicación actualizada.", "inventory", "PATCH")) setEditingLocation(null);
  };
  const toggleProduct = async (product: Product) => {
    await runMutation(`/api/inventory/products/${encodeURIComponent(product.id)}`, { active: product.active === false }, product.active === false ? "Producto activado." : "Producto archivado.", "inventory", "PATCH");
  };
  const toggleLocation = async (location: Location) => {
    await runMutation(`/api/inventory/locations/${encodeURIComponent(location.id)}`, { code: location.code, name: location.name, kind: location.kind, active: location.active === false }, location.active === false ? "Ubicación activada." : "Ubicación archivada.", "inventory", "PATCH");
  };

  const previewCsv = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess("");
    if (!orderClientId) { setError("Seleccioná el cliente antes de validar el archivo."); return; }
    setPreviewingImport(true);
    let source=csvText,rowNumbers:number[]|undefined;
    setImportPreview(null);
    setServerImportPreview(null);
    setImportCommandId("");
    try {
      if(orderFile){
        const result=await api<{csv:string;rowNumbers:number[]}>('/api/orders/import/xlsx','POST',{filename:orderFile.name,contentBase64:arrayBufferBase64(await orderFile.arrayBuffer())},{idempotent:false});
        source=result.csv;rowNumbers=result.rowNumbers;
      }
      const localPreview = parseOrderCsv(source, orderClientId, inventory.products, orders,rowNumbers);
      setImportPreview(localPreview);
      if (!localPreview.imported.length || localPreview.issues.length) return;
      const serverPreview = await api<ImportPreviewResult>("/api/orders/import/preview", "POST", { commandId: commandId(), clientId: orderClientId, orders: localPreview.imported }, { idempotent: false });
      setServerImportPreview(serverPreview);
      if (serverPreview.valid && !serverPreview.rowErrors.length) setImportCommandId(commandId());
    } catch (caught: unknown) { setError(inventoryError(caught)); }
    finally { setPreviewingImport(false); }
  };
  const commitImport = async () => {
    if (!importPreview?.imported.length || importPreview.issues.length || !serverImportPreview?.valid || serverImportPreview.rowErrors.length) return;
    const ok = await runMutation("/api/orders/import", { commandId: importCommandId || commandId(), clientId: orderClientId, orders: importPreview.imported }, `${importPreview.imported.length} pedidos importados.`, "both");
    if (ok) {
      setCsvText(""); setImportPreview(null); setServerImportPreview(null); setImportCommandId("");
      if (canManage) {
        try { await refreshImportHistory(); }
        catch (caught: unknown) { setError(inventoryError(caught)); }
      }
    }
  };

  const createCustomerAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (accessForm.password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres."); return; }
    const ok = await runMutation("/api/customer-access", accessForm, "Acceso de cliente creado.", "access");
    if (ok) setAccessForm((form) => ({ ...form, name: "", username: "", password: "" }));
  };

  const cancelDraftOrder = async (order: Order) => {
    if (!canManage || order.state !== "DRAFT") return;
    const reason = window.prompt(`Motivo para cancelar el pedido ${order.externalId}:`)?.trim();
    if (!reason) return;
    await runMutation(`/api/orders/${encodeURIComponent(order.id)}/cancel`, { reason }, "Pedido borrador cancelado con motivo registrado.", "both");
  };

  const startEditingOrder = (order: Order) => {
    if (!canManage || order.state.toUpperCase() !== "DRAFT") return;
    setSelectedOrderId(order.id);
    setSelectedOrderMode(null);
    setEditingOrderId(order.id);
    setEditingOrderForm({
      orderDate: (order.orderDate ?? order.date ?? "").slice(0, 10),
      destination: order.destination,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone ?? "",
      windowStart: order.windowStart ?? "",
      windowEnd: order.windowEnd ?? "",
      serviceMinutes: order.serviceMinutes == null ? "" : String(order.serviceMinutes),
      restrictions: order.restrictions ?? "",
      lines: (order.lines ?? order.items ?? []).map((line) => ({ productId: line.productId, quantity: line.quantity ?? line.requested ?? 1 })),
    });
  };

  const saveEditedOrder = async (event: FormEvent<HTMLFormElement>, order: Order) => {
    event.preventDefault();
    if (!canManage || !editingOrderForm) return;
    const form = editingOrderForm;
    const serviceMinutes = form.serviceMinutes.trim() ? Number(form.serviceMinutes) : null;
    if (Boolean(form.windowStart) !== Boolean(form.windowEnd) || (form.windowStart && form.windowEnd && form.windowStart >= form.windowEnd)) {
      setError("Completá ambas horas de la ventana y verificá que el inicio sea anterior al fin."); return;
    }
    if (serviceMinutes != null && (!Number.isInteger(serviceMinutes) || serviceMinutes < 1 || serviceMinutes > 480)) {
      setError("El tiempo de servicio debe ser un número entero entre 1 y 480 minutos."); return;
    }
    if (!form.lines.length || form.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) {
      setError("Cada producto debe mantener una cantidad entera mayor que cero."); return;
    }
    const ok = await runMutation(`/api/orders/${encodeURIComponent(order.id)}`, {
      orderDate: form.orderDate,
      destination: form.destination.trim(),
      recipientName: form.recipientName.trim(),
      recipientPhone: form.recipientPhone.trim(),
      windowStart: form.windowStart || null,
      windowEnd: form.windowEnd || null,
      serviceMinutes,
      restrictions: form.restrictions.trim(),
      lines: form.lines,
    }, "Pedido borrador actualizado.", "both", "PATCH");
    if (ok) { setEditingOrderId(""); setEditingOrderForm(null); }
  };

  const receiveReleasedStock = async (order: Order) => {
    const selectedParcels = (order.parcels ?? []).filter((parcel) => stagedReleaseParcelIds.includes(parcel.id) && parcel.state === "QUARANTINE");
    const target = inventory.locations.find((location) => location.id === releaseLocationId && location.active !== false && location.kind !== "QUARANTINE");
    if (!canWarehouse || !selectedParcels.length || !target || !releaseReason.trim()) {
      setError("Seleccioná unidades en cuarentena, una ubicación activa de almacenamiento y el motivo de inspección."); return;
    }
    const ok = await runMutation(`/api/orders/${encodeURIComponent(order.id)}/release`, {
      locationId: target.id,
      reason: releaseReason.trim(),
      parcelIds: selectedParcels.map((parcel) => parcel.id),
    }, `${selectedParcels.length} unidad(es) liberada(s) tras inspección.`, "both");
    if (ok) { setSelectedOrderId(""); setSelectedOrderMode(null); setReleaseLocationId(""); }
  };

  const scanOrderLine = (code: string) => {
    if (!selectedOrder) { setError("Seleccioná primero el pedido que estás preparando."); return; }
    const normalized = code.trim().toLowerCase();
    if (selectedOrderMode === "return") {
      const packageParcel = parcels.find((parcel) => parcel.shipmentId === selectedOrder.shipmentId && parcel.code.trim().toLowerCase() === normalized);
      const unitBySerial = inventory.units.find((item) => item.serial.trim().toLowerCase() === normalized);
      const matchingUnitsByBarcode = inventory.units.filter((item) => item.barcode?.trim().toLowerCase() === normalized);
      const sharedProductCode = inventory.products.some((item) => item.barcode?.trim().toLowerCase() === normalized);
      const unit = unitBySerial ?? (!sharedProductCode && matchingUnitsByBarcode.length === 1 ? matchingUnitsByBarcode[0] : undefined);
      const parcelId = packageParcel?.id ?? unit?.parcelId;
      const authorizedReturn = parcelId ? returns.find((item) => item.parcelId === parcelId && item.state === "AUTHORIZED") : undefined;
      if (!authorizedReturn || !(selectedOrder.parcelIds?.includes(authorizedReturn.parcelId) || parcels.some((parcel) => parcel.id === authorizedReturn.parcelId && parcel.shipmentId === selectedOrder.shipmentId))) {
        setError(packageParcel || unit ? "El bulto no tiene un retorno autorizado para este pedido." : "Escaneá el código único del bulto o la serie. El código compartido del producto no identifica un retorno.");
        return;
      }
      if (stagedReturnIds.includes(authorizedReturn.id)) { setError("Ese bulto ya está en la recepción de retorno."); return; }
      setError("");
      setStagedReturnIds((items) => [...items, authorizedReturn.id]);
      return;
    }
    const packageParcel = parcels.find((parcel) => parcel.shipmentId === selectedOrder.shipmentId && parcel.code.trim().toLowerCase() === normalized);
    if (packageParcel) {
      if (scanCodes.includes(code.trim())) { setError(`El bulto ${code} ya se escaneó para esta carga.`); return; }
      const linkedUnit = inventory.units.find((item) => item.parcelId === packageParcel.id);
      const linkedLine = selectedOrderLines.find((item) => item.productId === linkedUnit?.productId);
      if (linkedUnit && linkedLine) {
        const product = productById.get(linkedUnit.productId);
        if ((scanCounts[linkedUnit.productId] ?? 0) >= linkedLine.quantity) { setError("Ya se alcanzó la cantidad pedida para este producto."); return; }
        if (product?.tracking === "SERIAL") {
          if (scanSerials.includes(linkedUnit.serial)) { setError(`La serie ${linkedUnit.serial} ya se escaneó para este pedido.`); return; }
          setScanSerials((items) => [...items, linkedUnit.serial]);
        }
        setScanCounts((items) => ({ ...items, [linkedUnit.productId]: (items[linkedUnit.productId] ?? 0) + 1 }));
      }
      setError(""); setScanCodes((items) => [...items, code.trim()]);
      return;
    }
    const unitBySerial = inventory.units.find((item) => item.serial.trim().toLowerCase() === normalized);
    const matchingUnitsByBarcode = inventory.units.filter((item) => item.barcode?.trim().toLowerCase() === normalized);
    const productCode = inventory.products.find((item) => item.barcode?.trim().toLowerCase() === normalized || item.sku.trim().toLowerCase() === normalized);
    const unit = unitBySerial ?? (!productCode && matchingUnitsByBarcode.length === 1 ? matchingUnitsByBarcode[0] : undefined);
    const product = productCode ?? (unit ? productById.get(unit.productId) : undefined);
    const line = selectedOrderLines.find((item) => item.productId === product?.id);
    if (!product || !line) { setError(`El código «${code}» no pertenece a las líneas de este pedido.`); return; }
    setError("");
    if (product.tracking === "SERIAL" && unit) {
      const serial = unit?.serial ?? code.trim();
      if (scanSerials.includes(serial)) { setError(`La serie ${serial} ya se escaneó para este pedido.`); return; }
      const scanned = scanCounts[product.id] ?? 0;
      if (scanned >= line.quantity) { setError("Ya se alcanzó la cantidad pedida para este producto."); return; }
      setScanSerials((items) => [...items, serial]);
      setScanCounts((items) => ({ ...items, [product.id]: (items[product.id] ?? 0) + 1 }));
    } else {
      const scanned = scanCounts[product.id] ?? 0;
      if (scanned >= line.quantity) { setError("Ya se alcanzó la cantidad pedida para este producto."); return; }
      setScanCounts((items) => ({ ...items, [product.id]: (items[product.id] ?? 0) + 1 }));
    }
    setScanCodes((items) => [...items, code.trim()]);
  };

  const loadOrder = async () => {
    const route = routes.find((item) => item.id === selectedRouteId);
    if (!selectedOrder || !route) { setError("Seleccioná una ruta lista para confirmar la carga."); return; }
    if (!scanCodes.length) { setError("Escaneá al menos un código de producto o bulto para confirmar la carga."); return; }
    const ok = await runMutation(`/api/orders/${encodeURIComponent(selectedOrder.id)}/load`, { routeId: route.id, expectedVersion: route.version, codes: scanCodes }, "Carga escaneada y registrada.", "both");
    if (ok) { setSelectedOrderId(""); setSelectedRouteId(""); }
  };

  const receiveOrderReturn = async (order: Order) => {
    if (!returnLocationId) { setError("Seleccioná la ubicación donde se recibe el retorno."); return; }
    const orderReturnIds = stagedReturnIds.filter((id) => {
      const item = returns.find((candidate) => candidate.id === id);
      return item && (order.parcelIds?.includes(item.parcelId) || parcels.some((parcel) => parcel.id === item.parcelId && parcel.shipmentId === order.shipmentId));
    });
    if (!orderReturnIds.length) { setError("Escaneá al menos un bulto con retorno autorizado para este pedido."); return; }
    if (orderReturnIds.some((id) => !returnEvidenceIds[id])) { setError("Cargá una foto de recepción para cada bulto escaneado."); return; }
    const ok = await runMutation(`/api/orders/${encodeURIComponent(order.id)}/return`, { locationId: returnLocationId, returns: orderReturnIds.map((returnId) => ({ returnId, evidenceId: returnEvidenceIds[returnId] })) }, "Retorno recibido en cuarentena; queda pendiente de inspección.", "both");
    if (ok) { setSelectedOrderId(""); setSelectedOrderMode(null); }
  };

  const uploadReturnEvidence = async (item: ReturnOption, file?: File) => {
    if (!file) return;
    setUploadingReturnId(item.id); setError("");
    try {
      const evidenceId = await uploadEvidence(item.parcelId, file);
      if (evidenceId) {
        setReturnEvidenceIds((current) => ({ ...current, [item.id]: evidenceId }));
        setSuccess("Foto de recepción cargada para el bulto.");
      } else setError("No se pudo confirmar la carga de la foto. Intentá nuevamente.");
    } catch (caught: unknown) { setError(inventoryError(caught)); }
    finally { setUploadingReturnId(null); }
  };

  const summary = (
    <>
      <div className="stock-kpis" aria-label="Resumen de existencias">
        {([ ["AVAILABLE", "Disponible", inventoryTotals.AVAILABLE], ["RESERVED", "Reservado", inventoryTotals.RESERVED], ["VEHICLE", "En vehículo", inventoryTotals.VEHICLE], ["QUARANTINE", "Cuarentena", inventoryTotals.QUARANTINE] ] as Array<[string, string, number]>).map(([status, label, total]) => <button key={status} type="button" className={`stock-kpi${inventoryStatusFilter === status ? " is-active" : ""}`} aria-pressed={inventoryStatusFilter === status} onClick={() => setInventoryStatusFilter((current) => current === status ? "" : status)}><span>{label}</span><strong>{new Intl.NumberFormat("es").format(total)}</strong></button>)}
      </div>
      <div className="inventory-primary-actions" aria-label="Acciones de inventario">
        {canWarehouse && <button className="button button-primary" type="button" onClick={() => { setInventoryView("receive"); setError(""); setSuccess(""); }}><PackagePlus aria-hidden="true" />Recibir mercadería</button>}
        {canWarehouse && <button className="button button-secondary" type="button" onClick={() => { setInventoryView("move"); setError(""); }}><ArrowRightLeft aria-hidden="true" />Trasladar stock</button>}
        {canWarehouse && <button className="button button-secondary" type="button" onClick={() => { setInventoryView("adjust"); setError(""); }}><Boxes aria-hidden="true" />Ajustar stock</button>}
        {canManage && <button className="button button-secondary" type="button" onClick={() => { setInventoryView("catalog"); setError(""); setSuccess(""); }}><Upload aria-hidden="true" />Importar catálogo</button>}
        <button className="button button-secondary" type="button" onClick={() => { setInventoryView("movements"); setError(""); }}><Activity aria-hidden="true" />Movimientos</button>
        {canManage && <button className="button button-secondary" type="button" onClick={() => { setInventoryView("settings"); setError(""); }}><Settings aria-hidden="true" />Depósitos y sectores</button>}
      </div>

    </>
  );
  const inventoryTitles={stock:'Inventario',receive:'Recibir mercadería',move:'Trasladar existencias',adjust:'Ajustar existencias',catalog:'Importar catálogo',movements:'Movimientos',settings:'Depósitos y sectores'};
  return (
    <div className="inventory-workspace">
      {section === "inventory" && onReturnToClient && <button className="text-button inventory-back" type="button" onClick={()=>onReturnToClient(inventoryView==='catalog'?catalogClientId:selectedClient)}>← Ficha de {clients.find(client=>client.id===(inventoryView==='catalog'?catalogClientId:selectedClient))?.name||'cliente'}</button>}
      {section === "inventory" && inventoryView !== "stock" && !onReturnToClient && <button className="text-button inventory-back" type="button" onClick={()=>setInventoryView("stock")}>← Inventario</button>}
      <div className="page-heading">
        <div><p className="eyebrow">OPERACIÓN DE DEPÓSITO</p><h1>{section === "inventory" ? inventoryTitles[inventoryView] : section === "orders" ? "Pedidos" : "Accesos cliente"}</h1><p className="muted">{section === "inventory" ? (inventoryView === "stock" ? "Consultá stock o registrá una entrada." : inventoryView === "receive" ? "Ingresá productos de un cliente a tu depósito." : inventoryView === "settings" ? "Configurá los lugares físicos donde guardás mercadería." : "") : section === "orders" ? "Importá pedidos, revisá las líneas y confirmá reserva y carga por escaneo." : "Habilitá cuentas de consulta limitadas a un cliente."}</p></div>
        <div className="heading-actions"><button className="button button-secondary" type="button" onClick={() => { setLoading(true); const refresh = section === "inventory" ? Promise.all([refreshInventory(), refreshOrders()]).then(() => undefined) : section === "orders" ? Promise.all([refreshInventory(), refreshOrders(), ...(canManage ? [refreshImportHistory()] : [])]).then(() => undefined) : refreshAccesses(); void refresh.catch((caught) => setError(inventoryError(caught))).finally(() => setLoading(false)); }} disabled={loading}><RefreshCw aria-hidden="true" />Actualizar</button></div>
      </div>
      {error && !(selectedOrder && selectedOrderMode === "load") && <div className="notice error" role="alert">{error}</div>}{success && !(selectedOrder && selectedOrderMode === "load") && <div className="notice success" role="status">{success}</div>}
      {loading && <p className="inventory-role-note" role="status">Actualizando información…</p>}

      {section === "inventory" && <section className="inventory-screen">
        {inventoryView === "stock" && <>
          {summary}
          <div className="inventory-filterbar"><label className="search-field"><Search aria-hidden="true" /><input aria-label="Buscar existencias" value={inventorySearch} onChange={(event) => { setInventorySearch(event.target.value); setStockPage(0); }} placeholder="Buscar cliente, SKU, serie, ubicación o pedido" /></label><label className="field"><span>Cliente</span><select value={inventoryClientFilter} onChange={(event) => { setInventoryClientFilter(event.target.value); setStockPage(0); }}><option value="">Todos los clientes</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field"><span>Estado</span><select value={inventoryStatusFilter} onChange={(event) => { setInventoryStatusFilter(event.target.value); setStockPage(0); }}><option value="">Todos los estados</option>{Object.entries(stockStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          {inventory.hasMore.units && <p className="notice" role="status">La tabla muestra {new Intl.NumberFormat("es").format(inventory.units.length)} de {new Intl.NumberFormat("es").format(inventory.counts.units)} unidades serializadas. Exportá el CSV para ver el detalle completo.</p>}
          {stockTotal > INVENTORY_PAGE_SIZE && <div className="pagination"><button type="button" className="text-button" onClick={() => setStockPage((page) => Math.max(0, page - 1))} disabled={stockPage === 0}>Anterior</button><span>Página {stockPage + 1} de {Math.ceil(stockTotal / INVENTORY_PAGE_SIZE)}</span><button type="button" className="text-button" onClick={() => setStockPage((page) => page + 1)} disabled={(stockPage + 1) * INVENTORY_PAGE_SIZE >= stockTotal}>Siguiente</button></div>}<section className="card stock-table-card"><div className="card-header"><div><h2>Existencias</h2><p>{filteredStockRows.length} resultado(s) · cantidades y series</p></div><a className="button button-secondary" href="/api/inventory/export.csv"><ArrowDownToLine aria-hidden="true" />Exportar CSV</a></div>{filteredStockRows.length ? <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Producto / serie</th><th>Ubicación</th><th>Estado</th><th>Cantidad</th><th>Pedido</th></tr></thead><tbody>{pageStockRows.map((row) => <tr key={row.key}><td>{row.clientName}</td><td><strong>{row.productName}</strong><small>{row.sku}{row.serial ? " · Serie " + row.serial : ""}{row.barcode ? " · " + row.barcode : ""}</small></td><td>{row.locationCode}</td><td><span className="badge badge-neutral">{statusLabel(row.status)}</span></td><td>{new Intl.NumberFormat("es").format(row.quantity)} {row.unit}</td><td>{row.orderReference}</td></tr>)}</tbody></table></div> : <div className="empty-state"><PackageSearch aria-hidden="true" /><h3>No encontramos existencias</h3><p>Probá cambiar la búsqueda o los filtros.</p></div>}</section>
        </>}
        {inventoryView === "receive" && (!clients.length||!hasReceiptLocations)&&<section className="card task-card setup-needed" aria-labelledby="receipt-setup-title"><h2 id="receipt-setup-title">{!clients.length?'Primero agregá un cliente':'Primero creá un depósito o sector'}</h2><p>{!clients.length?'El cliente es la empresa dueña de los productos, por ejemplo Universo.':'Es el lugar físico donde vas a guardar la mercadería, por ejemplo Depósito central · Sector A.'}</p>{canManage?<button className="button button-primary" onClick={()=>{if(!clients.length){onManageClients?.();return;}setEditingLocation(null);setLocationForm({code:'',name:'',kind:'DEPOT'});setShowLocationForm(true);}}>{!clients.length?'Agregar cliente':'Crear depósito o sector'}</button>:<div className="setup-owner"><strong>Lo configura Administración de {companyName}.</strong><p>Entrá con la cuenta administradora y abrí Inventario → Depósitos y sectores.{setupContact?' Cuenta administradora: '+setupContact+'.':''}</p></div>}</section>}
        {inventoryView === "receive" && !!clients.length && hasReceiptLocations && <section className="card task-card"><div className="card-header"><div><h2>Mercadería del cliente</h2><p>Elegí de quién son los productos y dónde los vas a guardar.</p></div></div><form className="stack" onSubmit={(event) => void handleReceipt(event)}><div className="inventory-form-grid"><label className="field"><span>Cliente dueño de la mercadería</span><select required value={selectedClient} onChange={(event) => { if (Object.keys(receiptBasket).length) { setError("Confirmá esta recepción antes de cambiar de cliente."); return; } setSelectedClient(event.target.value); setSelectedProduct(""); }}><option value="">Seleccionar cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field"><span>Dónde se guarda</span><select required value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}><option value="">Elegir depósito o sector</option>{inventory.locations.filter((location) => location.active !== false && location.kind !== "QUARANTINE").map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label><label className="field"><span>Referencia</span><input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Remito u orden" /></label><label className="field"><span>Observación</span><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>{!inventory.locations.some((location) => location.active !== false && location.kind !== "QUARANTINE") && <p className="notice error">{role === "DEPOT" ? "Tu administrador debe crear un depósito o sector." : "Creá un depósito o sector en Inventario → Depósitos y sectores."}</p>}<BarcodeScanner focusSignal={receiptFocusSignal} onScan={acceptInventoryScan} disabled={busy || !selectedClient || !selectedLocation} label="Escanear SKU o código de barras" />
          {catalogMissingCode && <div className="catalog-missing"><strong>No está en el catálogo</strong><span>El código “{catalogMissingCode}” no se agregó al stock.</span>{canManage ? <button type="button" className="button button-secondary" onClick={() => { setCatalogClientId(selectedClient); setInventoryView("catalog"); setCatalogMissingCode(""); }}>Importar catálogo</button> : <small>Administración o Coordinación logística debe importar el catálogo de este cliente.</small>}</div>}
          {selectedProduct && <div className="receipt-product"><span><small>Producto reconocido</small><strong>{productById.get(selectedProduct)?.name || "Producto"}</strong><small>SKU {productById.get(selectedProduct)?.sku || "—"} · {productById.get(selectedProduct)?.tracking === "SERIAL" ? "por serie" : "por cantidad"}</small></span>{productById.get(selectedProduct)?.tracking === "QUANTITY" && <div className="receipt-manual-quantity"><label className="field"><span>Sumar cantidad</span><input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={addManualReceiptQuantity} disabled={busy}>Agregar cantidad</button></div>}</div>}
          {!!Object.keys(receiptBasket).length && <section className="receipt-basket"><div className="card-header"><div><h3>Recepción pendiente</h3><p>Confirmá antes de escanear otro SKU.</p></div><button className="text-button" type="button" onClick={() => { setReceiptBasket({}); setSelectedProduct(""); setError(""); }}>Vaciar</button></div>{Object.values(receiptBasket).map((item) => { const product = productById.get(item.productId); return <div className="receipt-basket-row" key={item.productId}><span><strong>{product?.name || "Producto"}</strong><small>{product?.sku || "SKU"} · {item.quantity} {product?.unit || "unidades"}</small>{item.serials.length > 0 && <small>Series: {item.serials.join(", ")}</small>}</span><button className="text-button" type="button" onClick={() => { setReceiptBasket({}); setSelectedProduct(""); }} disabled={busy}>Quitar</button></div>; })}<button className="button button-primary" type="submit" disabled={busy || !selectedLocation}><PackagePlus aria-hidden="true" />Confirmar recepción</button></section>}</form></section>}
        {(inventoryView === "move" || inventoryView === "adjust") && <section className="card task-card"><div className="card-header"><div><h2>{inventoryView === "move" ? "Trasladar stock" : "Ajustar stock"}</h2><p>{inventoryView === "move" ? "Escaneá desde la ubicación de origen." : "Registrá la diferencia y el motivo de auditoría."}</p></div></div><form className="stack" onSubmit={(event) => void (inventoryView === "move" ? handleMovement(event) : handleAdjustment(event))}><div className="inventory-form-grid"><label className="field"><span>Cliente</span><select required value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)}><option value="">Seleccionar cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field"><span>Producto (opcional si escaneás)</span><select value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}><option value="">Seleccionar producto</option>{eligibleProducts.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label><label className="field"><span>{inventoryView === "move" ? "Origen" : "Ubicación"}</span><select required value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}><option value="">Seleccionar</option>{inventory.locations.filter((location) => location.active !== false && (inventoryView !== "move" || location.kind !== "QUARANTINE")).map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>{inventoryView === "move" && <label className="field"><span>Destino</span><select required value={targetLocation} onChange={(event) => setTargetLocation(event.target.value)}><option value="">Seleccionar</option>{inventory.locations.filter((location) => location.active !== false && location.kind !== "QUARANTINE").map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>}<label className="field"><span>{inventoryView === "move" ? "Cantidad" : "Diferencia (+/-)"}</span><input required type="number" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label className="field"><span>Motivo</span><input required={inventoryView === "adjust"} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><BarcodeScanner onScan={acceptInventoryScan} disabled={busy || !selectedClient} label="Escanear SKU, serie o código de unidad" />{!!scanSerials.length && <p className="notice">Series: {scanSerials.join(", ")}</p>}<button className="button button-primary" type="submit" disabled={busy || !canWarehouse}>{inventoryView === "move" ? <><ArrowRightLeft aria-hidden="true" />Confirmar traslado</> : "Registrar ajuste"}</button></form></section>}
        {inventoryView === "catalog" && <div className="inventory-flow-grid"><section className="card task-card"><div className="card-header"><div><h2>Actualizar catálogo</h2><p>La validación no modifica productos ni existencias.</p></div><a className="text-button" href="/api/inventory/catalog/template.csv" download>Descargar plantilla CSV</a></div>{!canManage ? <p className="notice error">Administración y Coordinación logística pueden importar catálogos.</p> : <form className="stack" onSubmit={(event) => void previewCatalog(event)}><label className="field"><span>Cliente</span><select required value={catalogClientId} onChange={(event) => { setCatalogClientId(event.target.value); setCatalogSource(null); setCatalogPreview(null); }}><option value="">Seleccionar cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field"><span>Seguimiento para filas nuevas sin tipo</span><select value={catalogDefaultTracking} onChange={(event) => { setCatalogDefaultTracking(event.target.value as "" | "QUANTITY" | "SERIAL"); setCatalogPreview(null); }}><option value="">El archivo debe indicarlo</option><option value="QUANTITY">Por cantidad</option><option value="SERIAL">Por serie</option></select></label><label className="field"><span>Archivo CSV o Excel (.xlsx)</span><input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void readCatalogFile(event.target.files?.[0])} /><small>{catalogFilename || "Elegí un archivo para validar."}</small></label><div className="inventory-actions"><button className="button button-primary" type="submit" disabled={previewingCatalog || busy || !catalogSource || !catalogClientId}><Search aria-hidden="true" />{previewingCatalog ? "Validando…" : "Validar archivo"}</button>{catalogPreview && <button className="button button-secondary" type="button" onClick={() => { setCatalogPreview(null); setCatalogSource(null); setCatalogFilename(""); }}>Elegir otro archivo</button>}</div></form>}
          {catalogPreview && <div className={catalogPreview.valid && !catalogPreview.rowErrors.length ? "catalog-preview is-valid" : "catalog-preview has-errors"} aria-live="polite"><h3>{catalogPreview.valid && !catalogPreview.rowErrors.length ? "Vista previa validada" : "Revisá los errores"}</h3><div className="catalog-counts"><span><strong>{catalogPreview.rowCount}</strong> filas</span><span><strong>{catalogPreview.createCount}</strong> nuevos</span><span><strong>{catalogPreview.updateCount}</strong> actualizados</span><span><strong>{catalogPreview.unchangedCount}</strong> sin cambios</span></div>{catalogPreview.valid && !catalogPreview.rowErrors.length && <div className="notice"><strong>La validación terminó.</strong><p>Para guardar los productos, confirmá la importación.</p><button className="button button-primary" type="button" onClick={() => void importCatalog()} disabled={!canManage || busy || !catalogPreview.valid || !!catalogPreview.rowErrors.length}><Upload aria-hidden="true" />Confirmar importación</button></div>}{!catalogPreview.valid && <div className="notice error" role="alert"><strong>No se guardó ningún producto.</strong><p>Revisá los errores antes de continuar. Para productos nuevos, elegí el seguimiento: por cantidad o por serie.</p><ul>{catalogPreview.rowErrors.slice(0, 5).map((item,index)=><li key={index}>Fila {item.row}: {item.message}</li>)}</ul></div>}{!!catalogPreview.ignoredColumns?.length && <p className="muted">Columnas omitidas: {catalogPreview.ignoredColumns.join(", ")}</p>}{!!catalogPreview.rows.length && <><h4>Productos detectados</h4><div className="table-wrap"><table><thead><tr><th>Fila</th><th>SKU</th><th>Producto</th><th>Seguimiento</th><th>Acción</th></tr></thead><tbody>{pageCatalogPreviewRows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.sku}</td><td>{row.name}</td><td>{row.tracking === "SERIAL" ? "Por serie" : row.tracking === "QUANTITY" ? "Por cantidad" : "Sin indicar"}</td><td>{row.action === "CREATE" ? "Nuevo" : row.action === "UPDATE" ? "Actualizar" : row.action === "UNCHANGED" ? "Sin cambios" : "Revisar"}</td></tr>)}</tbody></table></div>{catalogPreview.rows.length > INVENTORY_PAGE_SIZE && <div className="pagination"><button type="button" className="text-button" onClick={() => setCatalogPreviewPage((page) => Math.max(0, page - 1))} disabled={catalogPreviewPage === 0}>Anterior</button><span>Filas {catalogPreviewPage * INVENTORY_PAGE_SIZE + 1}–{Math.min((catalogPreviewPage + 1) * INVENTORY_PAGE_SIZE, catalogPreview.rows.length)} de {catalogPreview.rows.length}</span><button type="button" className="text-button" onClick={() => setCatalogPreviewPage((page) => page + 1)} disabled={(catalogPreviewPage + 1) * INVENTORY_PAGE_SIZE >= catalogPreview.rows.length}>Siguiente</button></div>}</>}{!!catalogPreview.rowErrors.length && <><h4>Errores por fila</h4><ul className="catalog-errors">{pageCatalogErrors.map((item, index) => <li key={String(item.row) + "-" + index}>Fila {item.row}{item.field ? " · " + item.field : ""}: {item.message}</li>)}</ul>{catalogPreview.rowErrors.length > INVENTORY_PAGE_SIZE && <div className="pagination"><button type="button" className="text-button" onClick={() => setCatalogErrorPage((page) => Math.max(0, page - 1))} disabled={catalogErrorPage === 0}>Anterior</button><span>Error {catalogErrorPage * INVENTORY_PAGE_SIZE + 1}–{Math.min((catalogErrorPage + 1) * INVENTORY_PAGE_SIZE, catalogPreview.rowErrors.length)} de {catalogPreview.rowErrors.length}</span><button type="button" className="text-button" onClick={() => setCatalogErrorPage((page) => page + 1)} disabled={(catalogErrorPage + 1) * INVENTORY_PAGE_SIZE >= catalogPreview.rowErrors.length}>Siguiente</button></div>}</>}</div>}</section>
          {canManage && !catalogSource && !catalogPreview && <section className="card"><div className="card-header"><div><h2>Productos registrados</h2><p>Archivar conserva la trazabilidad.</p></div><button className="button button-secondary" type="button" onClick={() => { setProductForm((form) => ({ ...form, clientId: catalogClientId || form.clientId })); setEditingProduct(null); setShowProductForm(true); }}>Agregar producto</button></div><label className="search-field catalog-product-search"><Search aria-hidden="true" /><input aria-label="Buscar productos del catálogo" value={catalogProductSearch} onChange={(event) => { setCatalogProductSearch(event.target.value); setCatalogProductPage(0); }} placeholder="Buscar SKU, nombre o código de barras" /></label>{catalogTotal > INVENTORY_PAGE_SIZE && <div className="pagination"><button type="button" className="text-button" onClick={() => setCatalogProductPage((page) => Math.max(0, page - 1))} disabled={catalogProductPage === 0}>Anterior</button><span>Página {catalogProductPage + 1} de {Math.ceil(catalogTotal / INVENTORY_PAGE_SIZE)}</span><button type="button" className="text-button" onClick={() => setCatalogProductPage((page) => page + 1)} disabled={(catalogProductPage + 1) * INVENTORY_PAGE_SIZE >= catalogTotal}>Siguiente</button></div>}<div className="table-wrap"><table><thead><tr><th>Cliente</th><th>SKU / producto</th><th>Seguimiento</th><th>Estado</th><th></th></tr></thead><tbody>{pageCatalogProducts.map((product) => <tr key={product.id}><td>{clients.find((client) => client.id === product.clientId)?.name || product.clientName || "Cliente"}</td><td><strong>{product.sku}</strong><small>{product.name}</small></td><td>{product.tracking === "SERIAL" ? "Por serie" : "Por cantidad"}</td><td>{product.active === false ? "Archivado" : "Activo"}</td><td><button className="text-button" type="button" onClick={() => setEditingProduct({ ...product })}>Editar</button> <button className="text-button" type="button" disabled={busy} onClick={() => void toggleProduct(product)}>{product.active === false ? "Activar" : "Archivar"}</button></td></tr>)}</tbody></table></div></section>}</div>}
        {inventoryView === "movements" && <section className="card task-card"><div className="card-header"><div><h2>Movimientos</h2><p>Registro reciente con referencias legibles.</p></div></div>{inventory.hasMore.movements && <p className="notice" role="status">Se muestran los últimos 500 movimientos de {new Intl.NumberFormat("es").format(inventory.counts.movements)} registrados.</p>}{inventory.movements.length ? <>{inventory.movements.length > INVENTORY_PAGE_SIZE && <div className="pagination"><button type="button" className="text-button" onClick={() => setMovementPage((page) => Math.max(0, page - 1))} disabled={movementPage === 0}>Anterior</button><span>Página {movementPage + 1} de {Math.ceil(inventory.movements.length / INVENTORY_PAGE_SIZE)}</span><button type="button" className="text-button" onClick={() => setMovementPage((page) => page + 1)} disabled={(movementPage + 1) * INVENTORY_PAGE_SIZE >= inventory.movements.length}>Siguiente</button></div>}<div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Origen</th><th>Destino</th><th>Referencia / motivo</th></tr></thead><tbody>{pageMovements.map((movement) => <tr key={movement.id}><td>{new Date(movement.createdAt).toLocaleString("es")}</td><td>{movement.clientName || "Cliente"}</td><td>{movement.productName || productById.get(movement.productId || "")?.name || "Producto"}</td><td>{statusLabel((movement.action || movement.type || "Movimiento").toUpperCase())}</td><td>{movement.quantity ?? "—"}</td><td>{locationById.get(movement.fromLocationId || "")?.code || "—"}</td><td>{locationById.get(movement.toLocationId || "")?.code || "—"}</td><td>{movement.reference || movement.reason || "—"}</td></tr>)}</tbody></table></div></> : <p className="empty-state">Todavía no hay movimientos.</p>}</section>}
        {inventoryView === "settings" && <section className="card task-card"><div className="card-header"><div><h2>Depósitos y sectores de {companyName}</h2><p>Lugares físicos donde tu equipo guarda mercadería de los clientes.</p></div>{canManage && <button className="button button-primary" type="button" onClick={() => { setEditingLocation(null); setLocationForm({ code: "", name: "", kind: inventory.locations.length ? "STORAGE" : "DEPOT" }); setShowLocationForm(true); }}><Plus aria-hidden="true" />Agregar depósito o sector</button>}</div>{inventory.locations.length ? <div className="table-wrap"><table><thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>{inventory.locations.map((location) => <tr key={location.id}><td><strong>{location.code}</strong></td><td>{location.name}</td><td>{locationKindLabels[location.kind] || "Almacenamiento"}</td><td>{location.active === false ? "Archivada" : "Activa"}</td><td>{canManage && <><button className="text-button" type="button" onClick={() => setEditingLocation({ ...location })}>Editar</button> <button className="text-button" type="button" disabled={busy} onClick={() => void toggleLocation(location)}>{location.active === false ? "Activar" : "Archivar"}</button></>}</td></tr>)}</tbody></table></div> : <p className="empty-state">Todavía no creaste depósitos ni sectores. Agregá el lugar donde vas a recibir mercadería.</p>}{!canManage && <p className="inventory-role-note">Administración y Coordinación logística configuran los depósitos y sectores.</p>}</section>}
        {(showProductForm || editingProduct) && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="product-modal-title"><div className="card-header"><div><h2 id="product-modal-title">{editingProduct ? "Editar producto" : "Nuevo producto"}</h2><p>Peso y volumen son opcionales y permiten comprobar la capacidad de carga.</p></div><button className="text-button" type="button" onClick={() => { setEditingProduct(null); setShowProductForm(false); }}>Cerrar</button></div>{editingProduct ? <form className="stack" onSubmit={(event) => void saveProduct(event)}><div className="inventory-form-grid"><label className="field"><span>Cliente</span><select value={editingProduct.clientId || ""} onChange={(event) => setEditingProduct((current) => current ? { ...current, clientId: event.target.value } : null)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field"><span>SKU</span><input value={editingProduct.sku} onChange={(event) => setEditingProduct((current) => current ? { ...current, sku: event.target.value } : null)} /></label><label className="field"><span>Nombre</span><input value={editingProduct.name} onChange={(event) => setEditingProduct((current) => current ? { ...current, name: event.target.value } : null)} /></label><label className="field"><span>Código de barras</span><input value={editingProduct.barcode || ""} onChange={(event) => setEditingProduct((current) => current ? { ...current, barcode: event.target.value } : null)} /></label><label className="field"><span>Seguimiento</span><input readOnly value={editingProduct.tracking === "SERIAL" ? "Por serie" : "Por cantidad"} title="El seguimiento de un SKU existente se conserva." /></label><label className="field"><span>Unidad</span><input value={editingProduct.unit} onChange={(event) => setEditingProduct((current) => current ? { ...current, unit: event.target.value } : null)} /></label><label className="field"><span>Peso (kg)</span><input type="number" min="0" step="0.001" value={editingProduct.weightGrams == null ? "" : String(editingProduct.weightGrams / 1000)} onChange={(event) => setEditingProduct((current) => current ? { ...current, weightGrams: event.target.value === "" ? null : Math.round(Number(event.target.value) * 1000) } : null)} /></label><label className="field"><span>Volumen (m³)</span><input type="number" min="0" step="0.000001" value={editingProduct.volumeCm3 == null ? "" : String(editingProduct.volumeCm3 / 1000000)} onChange={(event) => setEditingProduct((current) => current ? { ...current, volumeCm3: event.target.value === "" ? null : Math.round(Number(event.target.value) * 1000000) } : null)} /></label></div><button className="button button-primary" type="submit" disabled={busy}>Guardar producto</button></form> : <form className="stack" onSubmit={(event) => void createProduct(event)}><div className="inventory-form-grid"><label className="field"><span>Cliente</span><select required value={productForm.clientId} onChange={(event) => setProductForm({ ...productForm, clientId: event.target.value })}><option value="">Seleccionar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field"><span>SKU</span><input required value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} /></label><label className="field"><span>Nombre</span><input required value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} /></label><label className="field"><span>Código de barras</span><input value={productForm.barcode} onChange={(event) => setProductForm({ ...productForm, barcode: event.target.value })} /></label><label className="field"><span>Seguimiento</span><select value={productForm.tracking} onChange={(event) => setProductForm({ ...productForm, tracking: event.target.value as "QUANTITY" | "SERIAL" })}><option value="QUANTITY">Por cantidad</option><option value="SERIAL">Por serie</option></select></label><label className="field"><span>Unidad</span><input required value={productForm.unit} onChange={(event) => setProductForm({ ...productForm, unit: event.target.value })} /></label><label className="field"><span>Peso (kg) · opcional</span><input type="number" min="0.001" step="0.001" value={productForm.weightGrams} onChange={(event) => setProductForm({ ...productForm, weightGrams: event.target.value })} /></label><label className="field"><span>Volumen (m³) · opcional</span><input type="number" min="0.000001" step="0.000001" value={productForm.volumeCm3} onChange={(event) => setProductForm({ ...productForm, volumeCm3: event.target.value })} /></label></div><div className="inventory-actions"><button className="button button-primary" type="submit" disabled={busy}>Crear producto</button><button className="button button-secondary" type="button" onClick={() => setShowProductForm(false)}>Cancelar</button></div></form>}</section></div>}
        {(showLocationForm || editingLocation) && <div className="modal-backdrop"><section className="modal-card modal-card-narrow" role="dialog" aria-modal="true" aria-labelledby="location-modal-title"><div className="card-header"><h2 id="location-modal-title">{editingLocation ? "Editar depósito o sector" : "Nuevo depósito o sector"}</h2><button className="text-button" type="button" onClick={() => { setEditingLocation(null); setShowLocationForm(false); }}>Cerrar</button></div>{editingLocation ? <form className="stack" onSubmit={(event) => void saveLocation(event)}><label className="field"><span>Código interno</span><input value={editingLocation.code} onChange={(event) => setEditingLocation((current) => current ? { ...current, code: event.target.value } : null)} /></label><label className="field"><span>Nombre del depósito o sector</span><input value={editingLocation.name} onChange={(event) => setEditingLocation((current) => current ? { ...current, name: event.target.value } : null)} /></label><label className="field"><span>Tipo</span><select value={editingLocation.kind} onChange={(event) => setEditingLocation((current) => current ? { ...current, kind: event.target.value as LocationKind } : null)}><option value="DEPOT">Depósito</option><option value="STORAGE">Sector o estante dentro del depósito</option><option value="QUARANTINE">Cuarentena</option></select></label><button className="button button-primary" type="submit" disabled={busy}>Guardar depósito o sector</button></form> : <form className="stack" onSubmit={(event) => void createLocation(event)}><label className="field"><span>Código interno</span><input required placeholder="DEP-CENTRAL" value={locationForm.code} onChange={(event) => setLocationForm({ ...locationForm, code: event.target.value })} /></label><label className="field"><span>Nombre del depósito o sector</span><input required placeholder="Depósito central · Sector A" value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} /></label><label className="field"><span>Tipo</span><select value={locationForm.kind} onChange={(event) => setLocationForm({ ...locationForm, kind: event.target.value as LocationKind })}><option value="DEPOT">Depósito</option><option value="STORAGE">Sector o estante dentro del depósito</option><option value="QUARANTINE">Cuarentena</option></select></label><button className="button button-primary" type="submit" disabled={busy}>Crear depósito o sector</button></form>}</section></div>}
      </section>}
      {section === "orders" && <section className="orders-screen"><nav className="workflow-tabs" aria-label="Vistas de pedidos"><button type="button" className={ordersView === "list" ? "workflow-tab is-active" : "workflow-tab"} aria-current={ordersView === "list" ? "page" : undefined} onClick={() => setOrdersView("list")}><ClipboardList aria-hidden="true" />Pedidos</button>{canManage && <button type="button" className={ordersView === "import" ? "workflow-tab is-active" : "workflow-tab"} aria-current={ordersView === "import" ? "page" : undefined} onClick={() => setOrdersView("import")}><Upload aria-hidden="true" />Importar</button>}{canManage && <button type="button" className={ordersView === "history" ? "workflow-tab is-active" : "workflow-tab"} aria-current={ordersView === "history" ? "page" : undefined} onClick={() => setOrdersView("history")}><History aria-hidden="true" />Historial</button>}{canWarehouse && <button type="button" className={ordersView === "returns" ? "workflow-tab is-active" : "workflow-tab"} aria-current={ordersView === "returns" ? "page" : undefined} onClick={() => setOrdersView("returns")}><ArrowRightLeft aria-hidden="true" />Retornos y cuarentena</button>}</nav>
        {ordersView === "list" && <section className="card"><div className="card-header"><div><h2>Pedidos</h2><p>{visibleOrders.length} de {ordersTotal} pedidos</p></div>{canManage && <button className="button button-primary" type="button" onClick={() => setOrdersView("import")}><Upload aria-hidden="true" />Importar pedido</button>}</div><div className="inventory-filterbar"><label className="search-field"><Search aria-hidden="true" /><input aria-label="Buscar pedidos" value={ordersSearch} onChange={(event) => { setOrdersSearch(event.target.value); setOrdersPage(0); }} placeholder="Buscar referencia, cliente, destinatario o dirección" /></label><label className="field"><span>Estado</span><select value={ordersStatusFilter} onChange={(event) => { setOrdersStatusFilter(event.target.value); setOrdersPage(0); }}><option value="">Todos los estados</option>{Object.entries(orderStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{visibleOrders.length ? <>{ordersTotal > INVENTORY_PAGE_SIZE && <div className="pagination"><button type="button" className="text-button" onClick={() => setOrdersPage((page) => Math.max(0, page - 1))} disabled={ordersPage === 0}>Anterior</button><span>Página {ordersPage + 1} de {Math.ceil(ordersTotal / INVENTORY_PAGE_SIZE)}</span><button type="button" className="text-button" onClick={() => setOrdersPage((page) => page + 1)} disabled={(ordersPage + 1) * INVENTORY_PAGE_SIZE >= ordersTotal}>Siguiente</button></div>}<div className="orders-list">{pageOrders.map((order) => <article className="order-card" key={order.id}><div className="order-card-main"><div className="order-card-heading"><div><p className="eyebrow">{order.clientName || clients.find((client) => client.id === order.clientId)?.name || "Cliente"}</p><h3>{order.externalId || "Pedido sin referencia externa"}</h3><p>{order.recipientName} · {order.destination}</p></div><span className="badge badge-neutral">{statusLabel(order.state)}</span></div><div className="order-meta"><span>{formatOrderDate(order.orderDate || order.date)}</span>{order.windowStart && order.windowEnd && <span>Ventana {order.windowStart}–{order.windowEnd}</span>}{order.serviceMinutes ? <span>{order.serviceMinutes} min</span> : null}{order.restrictions ? <span>{order.restrictions}</span> : null}</div><div className="order-lines-preview">{(order.lines ?? order.items ?? []).map((line) => <span key={line.productId}>{line.productName || productById.get(line.productId)?.name || line.sku || "Producto"} × {line.quantity}</span>)}</div></div><div className="order-card-actions">{canWarehouse && !["CANCELLED", "DELIVERED"].includes(order.state.toUpperCase()) && <button className="button button-primary" type="button" onClick={() => { setSelectedOrderId(order.id); setSelectedOrderMode("load"); setScanCounts({}); setScanSerials([]); setScanCodes([]); setSelectedRouteId(""); setError(""); setSuccess(""); }}>Preparar / cargar</button>}{canManage && order.state.toUpperCase() === "DRAFT" && <><button className="button button-secondary" type="button" onClick={() => startEditingOrder(order)}>Editar borrador</button><button className="text-button" type="button" disabled={busy} onClick={() => void cancelDraftOrder(order)}>Cancelar</button></>}</div></article>)}</div></> : <div className="empty-state"><ClipboardList aria-hidden="true" /><h3>No hay pedidos para mostrar</h3><p>Importá un archivo o ajustá los filtros.</p>{canManage && <button className="button button-primary" type="button" onClick={() => setOrdersView("import")}>Importar pedidos</button>}</div>}{!canManage && <p className="inventory-role-note">Operaciones importa pedidos; Depósito puede reservar, preparar y registrar retornos.</p>}</section>}
        {ordersView === "import" && canManage && <section className="card task-card"><div className="card-header"><div><h2>Importar pedidos</h2><p>Validá los datos en el servidor antes de confirmar.</p></div></div><form className="stack" onSubmit={(event) => void previewCsv(event)}><label className="field"><span>Cliente</span><select required disabled={previewingImport || busy} value={orderClientId} onChange={(event) => { setOrderClientId(event.target.value); setImportPreview(null); setServerImportPreview(null); }}><option value="">Seleccionar cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="field"><span>Archivo Excel (.xlsx)</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={previewingImport || busy} onChange={(event) => { const file=event.target.files?.[0] ?? null; setOrderFile(file); setImportPreview(null); setServerImportPreview(null); setError(""); if(file && file.size > 5*1024*1024){setOrderFile(null);setError("El Excel debe pesar hasta 5 MB.");event.target.value="";} }} /><small>{orderFile?.name || "Elegí el Excel de pedidos."}</small></label><details><summary>O pegar contenido CSV</summary><label className="field"><span>Contenido CSV</span><textarea rows={8} disabled={!!orderFile || previewingImport} value={csvText} onChange={(event) => { setCsvText(event.target.value); setImportPreview(null); setServerImportPreview(null); }} placeholder="externalId,date,destination,recipientName,sku,quantity" /><small>Incluí pedido, fecha, dirección, destinatario, SKU y cantidad.</small></label></details><div className="inventory-actions"><button className="button button-primary" type="submit" disabled={previewingImport || busy || (!orderFile && !csvText.trim())}><Search aria-hidden="true" />{previewingImport ? "Validando…" : "Validar pedidos"}</button><span className="muted">Importar crea pedidos, no aumenta existencias.</span></div></form>{importPreview && <div className="csv-preview"><h3>Vista previa local · {importPreview.imported.length} pedidos · {importPreview.rowCount} filas</h3>{importPreview.issues.length > 0 && <div className="csv-errors" role="alert"><strong>Corregí estos problemas:</strong><ul>{importPreview.issues.slice(0, 12).map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}{importPreview.imported.length > 0 && <>{importPreview.imported.length > INVENTORY_PAGE_SIZE && <div className="pagination"><button type="button" className="text-button" onClick={() => setOrderCsvPreviewPage((page) => Math.max(0, page - 1))} disabled={orderCsvPreviewPage === 0}>Anterior</button><span>Página {orderCsvPreviewPage + 1} de {Math.ceil(importPreview.imported.length / INVENTORY_PAGE_SIZE)}</span><button type="button" className="text-button" onClick={() => setOrderCsvPreviewPage((page) => page + 1)} disabled={(orderCsvPreviewPage + 1) * INVENTORY_PAGE_SIZE >= importPreview.imported.length}>Siguiente</button></div>}<div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Fecha</th><th>Destino</th><th>Destinatario</th><th>Ventana</th><th>Artículos</th></tr></thead><tbody>{pageOrderCsvPreview.map((order) => <tr key={order.externalId}><td>{order.externalId}</td><td>{formatOrderDate(order.orderDate)}</td><td>{order.destination}</td><td>{order.recipientName}</td><td>{order.windowStart ? order.windowStart + "–" + order.windowEnd : "Sin ventana"}</td><td>{order.lines.map((line) => (productById.get(line.productId)?.sku || "Producto") + " × " + line.quantity).join(", ")}</td></tr>)}</tbody></table></div></>}{serverImportPreview && <div className={serverImportPreview.valid ? "server-import-preview is-valid" : "server-import-preview has-errors"} role={serverImportPreview.valid ? "status" : "alert"}><strong>{serverImportPreview.valid ? "Validación completada" : "El servidor encontró problemas"}</strong><p>{serverImportPreview.acceptedCount} pedido(s) de {serverImportPreview.rowCount} aceptados.</p>{serverImportPreview.rowErrors.map((item, index) => <p key={String(item.row) + index}>Fila {item.row}{item.field ? " · " + item.field : ""}: {item.message}</p>)}</div>}<button className="button button-primary" type="button" onClick={() => void commitImport()} disabled={busy || previewingImport || !importPreview.imported.length || !!importPreview.issues.length || serverImportPreview?.valid !== true || Boolean(serverImportPreview?.rowErrors.length)}><Upload aria-hidden="true" />Importar validados</button></div>}</section>}
        {ordersView === "history" && canManage && <section className="card"><div className="card-header"><div><h2>Historial de importaciones</h2><p>Se conservan origen, conteos y errores, no el archivo original.</p></div></div>{importHistory.length ? <>{importHistory.length > INVENTORY_PAGE_SIZE && <div className="pagination"><button type="button" className="text-button" onClick={() => setImportHistoryPage((page) => Math.max(0, page - 1))} disabled={importHistoryPage === 0}>Anterior</button><span>Página {importHistoryPage + 1} de {Math.ceil(importHistory.length / INVENTORY_PAGE_SIZE)}</span><button type="button" className="text-button" onClick={() => setImportHistoryPage((page) => page + 1)} disabled={(importHistoryPage + 1) * INVENTORY_PAGE_SIZE >= importHistory.length}>Siguiente</button></div>}<div className="orders-list">{pageImportHistory.map((item) => <article className="history-card" key={item.id}><div><strong>{new Date(item.createdAt).toLocaleString("es")} · {item.source}</strong><span>{item.rowCount} filas · {item.acceptedCount} pedidos</span>{item.rowErrors?.length > 0 && <span>{item.rowErrors.length} error(es): {item.rowErrors.slice(0, 3).map((entry) => "fila " + entry.row + ": " + entry.message).join(" · ")}</span>}</div><span className="badge badge-neutral">{statusLabel(item.status)}</span></article>)}</div></> : <p className="empty-state">Todavía no hay importaciones.</p>}</section>}
        {ordersView === "returns" && canWarehouse && <section className="card"><div className="card-header"><div><h2>Retornos y cuarentena</h2><p>Los retornos autorizados entran en cuarentena y se liberan tras inspección.</p></div></div>{!returnOrders.length && !releaseOrders.length && <p className="empty-state">No hay retornos autorizados ni unidades pendientes de inspección.</p>}
          {!!returnOrders.length && <section className="return-workflow"><h3>Recepción de retornos autorizados</h3><label className="field"><span>Ubicación de cuarentena</span><select value={returnLocationId} onChange={(event) => setReturnLocationId(event.target.value)}><option value="">Seleccionar</option>{inventory.locations.filter((location) => location.active !== false && location.kind === "QUARANTINE").map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>{!inventory.locations.some((location) => location.active !== false && location.kind === "QUARANTINE") && <p className="notice error" role="alert">{role === "DEPOT" ? "Administración debe crear un sector de cuarentena en Inventario → Depósitos y sectores." : "Creá una ubicación de tipo Cuarentena."}</p>}<div className="orders-list">{returnOrders.map(({ order, returns: authorized }) => <article className="return-order-card" key={order.id}><div><strong>{order.externalId || "Pedido"} · {order.recipientName}</strong><p>{order.destination} · {authorized.length} retorno(s)</p></div><button className="button button-secondary" type="button" onClick={() => { setSelectedOrderId(order.id); setSelectedOrderMode("return"); setStagedReturnIds([]); setReturnEvidenceIds({}); setScanCodes([]); setError(""); }}>Escanear retorno</button>{selectedOrderId === order.id && selectedOrderMode === "return" && <div className="return-evidence-list"><BarcodeScanner onScan={scanOrderLine} disabled={busy} label="Escanear bulto o serie del retorno" />{authorized.filter((entry) => stagedReturnIds.includes(entry.id)).map((entry) => { const parcel = parcels.find((item) => item.id === entry.parcelId); const evidenceId = returnEvidenceIds[entry.id]; return <label className="return-evidence-item" key={entry.id}><span><strong>{parcel?.code || "Bulto"}</strong><small>{evidenceId ? "Foto de recepción guardada" : "Falta foto de recepción"}</small></span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Foto de recepción" disabled={busy || uploadingReturnId === entry.id} onChange={(event) => { setReturnEvidenceIds((current) => ({ ...current, [entry.id]: "" })); void uploadReturnEvidence(entry, event.target.files?.[0]); }} />{uploadingReturnId === entry.id && <span role="status">Subiendo foto…</span>}</label>; })}<button className="button button-primary" type="button" onClick={() => void receiveOrderReturn(order)} disabled={busy || !returnLocationId || !stagedReturnIds.length || stagedReturnIds.some((id) => !returnEvidenceIds[id])}>Registrar en cuarentena</button></div>}</article>)}</div></section>}
          {!!releaseOrders.length && <section className="return-workflow"><h3>Unidades en cuarentena</h3><p>Seleccioná unidades inspeccionadas, el destino y un motivo.</p>{!inventory.locations.some((location) => location.active !== false && location.kind !== "QUARANTINE") && <p className="notice error">{role === "DEPOT" ? "Administración debe crear un depósito o sector en Inventario → Depósitos y sectores." : "Creá una ubicación activa de Depósito o Almacenamiento."}</p>}<div className="orders-list">{releaseOrders.map(({ order, quarantinedParcels }) => <article className="return-order-card" key={order.id}><div><strong>{order.externalId || "Pedido"} · {order.recipientName}</strong><p>{quarantinedParcels.length} unidad(es) en cuarentena</p></div><button className="button button-secondary" type="button" onClick={() => { setSelectedOrderId(order.id); setSelectedOrderMode("release"); setStagedReleaseParcelIds([]); setReleaseLocationId(""); setReleaseReason(""); }}>Inspeccionar</button>{selectedOrderId === order.id && selectedOrderMode === "release" && <div className="quarantine-release"><div className="table-wrap"><table><thead><tr><th>Seleccionar</th><th>Bulto</th><th>Producto / serie</th><th>Ubicación</th></tr></thead><tbody>{quarantinedParcels.map((parcel) => { const unit = inventory.units.find((entry) => entry.parcelId === parcel.id); const product = productById.get(parcel.productId); const bal = inventory.balances.find((entry) => entry.productId === parcel.productId && entry.orderId === order.id && entry.status?.toUpperCase() === "QUARANTINE"); const loc = inventory.locations.find((entry) => entry.id === (unit?.locationId ?? bal?.locationId)); return <tr key={parcel.id}><td><input type="checkbox" aria-label={"Seleccionar bulto " + parcel.code} checked={stagedReleaseParcelIds.includes(parcel.id)} onChange={(event) => setStagedReleaseParcelIds((current) => event.target.checked ? [...current, parcel.id] : current.filter((id) => id !== parcel.id))} /></td><td>{parcel.code}</td><td>{product?.name || "Producto"}{unit?.serial ? <small>Serie {unit.serial}</small> : <small>{product?.sku || "Producto"} · unidad por cantidad</small>}</td><td>{loc?.code || "Cuarentena"}</td></tr>; })}</tbody></table></div><div className="inventory-form-grid"><label className="field"><span>Destino de almacenamiento</span><select value={releaseLocationId} onChange={(event) => setReleaseLocationId(event.target.value)}><option value="">Seleccionar</option>{inventory.locations.filter((location) => location.active !== false && location.kind !== "QUARANTINE").map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label><label className="field"><span>Motivo</span><input value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} /></label></div><button className="button button-primary" type="button" onClick={() => void receiveReleasedStock(order)} disabled={busy || !stagedReleaseParcelIds.length || !releaseLocationId || !releaseReason.trim()}>Liberar inspeccionados ({stagedReleaseParcelIds.length})</button></div>}</article>)}</div></section>}
        </section>}
        {selectedOrder && selectedOrderMode === "load" && <div className="modal-backdrop"><section className="modal-card order-prep-modal" role="dialog" aria-modal="true" aria-labelledby="order-prep-title"><div className="card-header"><div><p className="eyebrow">{selectedOrder.externalId || "Pedido"}</p><h2 id="order-prep-title">Preparar y cargar</h2><p>{selectedOrder.recipientName} · {selectedOrder.destination}</p></div><button className="text-button" type="button" onClick={() => { setSelectedOrderId(""); setSelectedOrderMode(null); setError(""); setSuccess(""); }}>Cerrar</button></div>{error && <div className="notice error" role="alert"><strong>No se pudo completar la operación.</strong><p>{error}</p>{error.includes("Faltan unidades") && <p>Ingresá la mercadería del cliente en Inventario → Recibir mercadería y después volvé a reservar.</p>}</div>}{success && <div className="notice success" role="status">{success}</div>}<p className="muted">Estado del pedido: {statusLabel(selectedOrder.state)}</p><button className="button button-secondary" type="button" onClick={() => void runMutation("/api/orders/" + encodeURIComponent(selectedOrder.id) + "/reserve", {}, "Pedido reservado.", "both")} disabled={busy || !canWarehouse || selectedOrder.state.toUpperCase() !== "DRAFT"}><Boxes aria-hidden="true" />{busy ? "Guardando…" : selectedOrder.state.toUpperCase() === "DRAFT" ? "Reservar stock" : "Reserva registrada"}</button><BarcodeScanner onScan={scanOrderLine} disabled={busy} label="Escanear bulto, serie o SKU" /><div className="table-wrap"><table><thead><tr><th>Producto</th><th>Solicitado</th><th>Escaneado</th><th>Estado</th></tr></thead><tbody>{selectedOrderLines.map((line) => <tr key={line.productId}><td>{line.productName || productById.get(line.productId)?.name || line.sku || "Producto"}</td><td>{qtyLabel(productById.get(line.productId), line.quantity)}</td><td>{qtyLabel(productById.get(line.productId), scanCounts[line.productId] || 0)}</td><td>{(scanCounts[line.productId] || 0) === line.quantity ? "Completo" : "Pendiente"}</td></tr>)}</tbody></table></div><label className="field"><span>Ruta lista asignada</span><select value={selectedRouteId} onChange={(event) => setSelectedRouteId(event.target.value)}><option value="">Seleccionar ruta</option>{assignedRoutes.map((route) => <option key={route.id} value={route.id}>{route.name} · v{route.version}</option>)}</select></label><button className="button button-primary" type="button" onClick={() => void loadOrder()} disabled={busy || !canWarehouse}><ArrowDownToLine aria-hidden="true" />Confirmar carga</button></section></div>}
        {canManage && selectedOrder && editingOrderId === selectedOrder.id && editingOrderForm && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-order-title"><div className="card-header"><div><h2 id="edit-order-title">Editar borrador · {selectedOrder.externalId}</h2><p>Los productos se mantienen; podés ajustar cantidades.</p></div><button className="text-button" type="button" onClick={() => { setEditingOrderId(""); setEditingOrderForm(null); }}>Cerrar</button></div><form className="stack" onSubmit={(event) => void saveEditedOrder(event, selectedOrder)}><div className="inventory-form-grid"><label className="field"><span>Fecha</span><input required type="date" value={editingOrderForm.orderDate} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, orderDate: event.target.value } : current)} /></label><label className="field"><span>Destino</span><input required value={editingOrderForm.destination} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, destination: event.target.value } : current)} /></label><label className="field"><span>Destinatario</span><input required value={editingOrderForm.recipientName} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, recipientName: event.target.value } : current)} /></label><label className="field"><span>Teléfono</span><input value={editingOrderForm.recipientPhone} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, recipientPhone: event.target.value } : current)} /></label><label className="field"><span>Ventana desde</span><input type="time" value={editingOrderForm.windowStart} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, windowStart: event.target.value } : current)} /></label><label className="field"><span>Ventana hasta</span><input type="time" value={editingOrderForm.windowEnd} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, windowEnd: event.target.value } : current)} /></label><label className="field"><span>Minutos de servicio</span><input type="number" min="1" max="480" value={editingOrderForm.serviceMinutes} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, serviceMinutes: event.target.value } : current)} /></label><label className="field span-all"><span>Restricciones</span><textarea value={editingOrderForm.restrictions} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, restrictions: event.target.value } : current)} /></label></div><div className="draft-order-lines"><h3>Productos y cantidades</h3>{editingOrderForm.lines.map((line, index) => { const product = productById.get(line.productId); return <label className="field draft-order-line" key={line.productId}><span>{product?.sku || "SKU"} · {product?.name || "Producto"}</span><input type="number" min="1" step="1" value={line.quantity} onChange={(event) => setEditingOrderForm((current) => current ? { ...current, lines: current.lines.map((entry, idx) => idx === index ? { ...entry, quantity: Number(event.target.value) } : entry) } : current)} /></label>; })}</div><button className="button button-primary" type="submit" disabled={busy}>Guardar cambios</button></form></section></div>}
      </section>}

      {section === "customerAccess" && <section className="customer-access-form">
        {!isAdmin ? <p className="notice error" role="alert">Solo Administración puede crear o revocar accesos de cliente.</p> : <>
          <header className="page-heading customer-access-heading"><div><h1>Dar acceso al portal</h1><p className="muted">Elegí cómo entra cada cliente.</p></div></header>
          <div className="customer-access-methods">
            <GooglePortalAccess clients={clients} />
            <section className="card customer-access-method" aria-labelledby="password-access-title">
              <div className="card-header"><div><h2 id="password-access-title">Crear usuario y contraseña</h2><p>Para clientes sin acceso con Google. Solo verá su información.</p></div></div>
              <form className="stack" onSubmit={(event) => void createCustomerAccess(event)}>
                <div className="inventory-form-grid">
                  <label className="field"><span>Cliente</span><select required value={accessForm.clientId} onChange={(event) => setAccessForm({ ...accessForm, clientId: event.target.value })}><option value="">Seleccionar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
                  <label className="field"><span>Nombre visible</span><input required value={accessForm.name} onChange={(event) => setAccessForm({ ...accessForm, name: event.target.value })} /></label>
                  <label className="field"><span>Usuario</span><input required autoComplete="off" value={accessForm.username} onChange={(event) => setAccessForm({ ...accessForm, username: event.target.value })} /></label>
                  <label className="field"><span>Contraseña inicial</span><input required minLength={6} type="password" autoComplete="new-password" value={accessForm.password} onChange={(event) => setAccessForm({ ...accessForm, password: event.target.value })} /><small>Mínimo 6 caracteres.</small></label>
                </div>
                <button className="button button-primary" type="submit" disabled={busy}><Shield aria-hidden="true" />Crear usuario</button>
              </form>
            </section>
          </div>
          <details className="task-disclosure customer-access-existing" open={accesses.length>0}>
            <summary>Usuarios creados <span className="customer-access-count">{accesses.length}</span></summary>
            <div className="task-disclosure-body">{accesses.length ? <div className="inventory-list">{accesses.map((access) => <div className="inventory-list-row" key={access.id}><span><strong>{access.name} · {access.username}</strong><small>{access.clientName} · creado {new Date(access.createdAt).toLocaleDateString("es")}</small></span><span className="inventory-actions"><span className={access.enabled ? "badge badge-success" : "badge badge-neutral"}>{access.enabled ? "Activo" : "Revocado"}</span>{isAdmin&&access.enabled&&<AccountRecovery id={access.id} kind="CUSTOMER"/>}{isAdmin && access.enabled && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void runMutation(`/api/customer-access/${encodeURIComponent(access.id)}/revoke`, {}, "Acceso revocado.", "access")}><Trash2 aria-hidden="true" />Revocar</button>}</span></div>)}</div> : <p className="muted">No hay usuarios creados.</p>}</div>
          </details>
        </>}
      </section>}
    </div>
  );
}
