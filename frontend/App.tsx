import RouteOrderManagement from './RouteOrderManagement';
import RouteItinerary from './RouteItinerary';
import ReservedDispatch from './ReservedDispatch';
import { ChangeEvent, Component, ErrorInfo, FormEvent, ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MaintenancePanel from './MaintenancePanel';
import TaskDisclosure from './TaskDisclosure';
import ReturnOperations from './ReturnOperations';
import DriverDocumentsPanel from './DriverDocumentsPanel';
import Brand from './Brand';
import QuadMindsPanel from './QuadMindsPanel';
import ClientDeliveryPanel from './ClientDeliveryPanel';
import RouteSetup from './RouteSetup';
import RouteLoadPanel from './RouteLoadPanel';
import RouteParcelActions from './RouteParcelActions';
import KpiDetails, { type KpiKind } from './KpiDetails';
import InventoryPanel from './InventoryPanel';
import type {ReceiptSeed} from './StockReceiptPanel';
import CustomerPortal from './CustomerPortal';
import ClientsPanel, {type ClientRecord} from './ClientsPanel';
import CompanyPanel from './CompanyPanel';
import AccountRecovery from './AccountRecovery';
const BillingPanel=lazy(()=>import('./BillingPanel'));
import {api,type ApiProblem} from './api';
import {reportClientError,sourcePosition} from './diagnostics';
import PasswordReset from './PasswordReset';
import Reauthentication from './Reauthentication';
import PublicTrackingLinks from './PublicTrackingLinks';
import QuadOperationsPanel from './QuadOperationsPanel';
import { LayoutDashboard, Package, Route as RouteIcon, Truck, Users, Radio, Plus, ArrowUpRight, ArrowRight, LogOut, ChevronRight, CircleAlert, Boxes, ClipboardList, Shield } from 'lucide-react';

type Role = "ADMIN" | "OPERATIONS" | "DEPOT" | "DRIVER" | "CUSTOMER" | string;
type User = { id: string; name: string; role: Role; driverId?: string | null; clientId?: string | null; isSuperAdmin?: boolean };
type Session = { user: User | null; setupRequired: boolean };
type Entity = { id: string; [key: string]: unknown };
type Client = Entity & ClientRecord;
type Driver = Entity & { name: string; available?: boolean | string };
type Vehicle = Entity & {
  plate: string;
  capacityWeightGrams: number | null;
  capacityVolumeCm3: number | null;
  odometer: number | null;
  available?: boolean | string;
};
type Shipment = Entity & {
  clientId: string;
  reference: string;
  originText: string;
  destinationText: string;
  recipientName: string;
  recipientPhone?: string | null;
  proofPolicy: string;
  counts: { expected: number; received: number; delivered: number; pending: number; returned: number; missing: number };
};
type Parcel = Entity & {
  shipmentId: string;
  code: string;
  product?: { name: string; sku: string; serial?:string|null } | null;
  state: string;
  custodyType: string;
  custodyId: string | null;
  weightGrams: number | null;
  volumeCm3: number | null;
};
type Route = Entity & {
  name: string;
  driverId: string;
  vehicleId: string;
  state: string;
  version: number;
  startAt: string;
  endAt: string;
};
type Stop = Entity & { routeId: string; shipmentId: string; sequence: number; state: string; kind?: string };
type Assignment = Entity & { routeId: string; parcelId: string; pickup: boolean; active: boolean };
type Attempt = Entity & {
  stopId: string;
  receiverName: string;
  reasonCode: string;
  nextAction: string;
  evidenceIds: string[];
  createdAt: string;
  items: unknown[];
};
type CustodyEvent = Entity & {
  parcelId: string;
  action: string;
  fromType: string | null;
  toType: string | null;
  createdAt: string;
};
type Incident = Entity & {
  parcelId: string;
  routeId: string;
  reasonCode: string;
  nextAction: string;
  state: string;
};
type ReturnItem = Entity & { parcelId: string; routeId: string; state: string; depotEvidenceId?: string | null; senderEvidenceId?: string | null };
type Defect = Entity & { vehicleId: string; severity: string; note: string; state: string };
type VehicleDocument = Entity & { vehicleId: string; name: string; expiresAt: string; blocksDispatch: boolean };
type DriverDocument = Entity & { driverId: string; name: string; expiresAt: string; blocksDispatch: boolean };
type InspectionItem = { label: string; severity: "OK" | "MINOR" | "CRITICAL"; note: string };
type Inspection = Entity & { vehicleId: string; odometer: number; fuelPercent: number; items: InspectionItem[]; createdAt: string };
type Maintenance = Entity & {
  vehicleId: string;
  description: string;
  dueAt: string | null;
  dueOdometer: number | null;
  state: string;
  completionNote?: string | null;
  evidenceId?: string | null;
};
type EvidenceRecord = Entity & { parcelId: string | null; filename: string; mimeType: string; createdAt: string };
type AuditItem = Entity & { action: string; entityId: string; createdAt: string };
type Bootstrap = {
  clientProfilesEnabled?:boolean;
  limits?: {perCollection:number;hasMore:boolean;message:string};
  organization: { name: string; timezone: string; testMode?:boolean; supportContacts?:{name:string;role:string}[] };
  user: User;
  clients: Client[];
  drivers: Driver[];
  vehicles: Vehicle[];
  shipments: Shipment[];
  parcels: Parcel[];
  routes: Route[];
  stops: Stop[];
  assignments: Assignment[];
  attempts: Attempt[];
  custodyEvents: CustodyEvent[];
  incidents: Incident[];
  returns: ReturnItem[];
  defects: Defect[];
  documents: VehicleDocument[];
  driverDocuments: DriverDocument[];
  inspections: Inspection[];
  maintenance: Maintenance[];
  evidence: EvidenceRecord[];
  audit: AuditItem[];
  tracking: { status: string; message: string };
};

type Page = "home" | "shipments" | "routes" | "fleet" | "clients" | "tracking" | "inventory" | "orders" | "customerAccess" | "company" | "billing";
type Action = (path: string, payload: Record<string, unknown>, successMessage: string,onResult?:(result:Record<string,unknown>)=>void) => Promise<boolean>;
type EvidenceUpload = (parcelId: string | null, file: File) => Promise<string | null>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

function mutationKey(path: string, payload: Record<string, unknown>): string {
  const { commandId: _ignored, ...body } = payload;
  return path + "|" + stableJson(body);
}

function fileMutationKey(parcelId: string | null, file: File): string {
  return ["/api/evidence", parcelId ?? "", file.name, file.size, file.lastModified, file.type].join("|");
}

const emptyBootstrap = (value: Bootstrap): Bootstrap => ({
  ...value,
  clients: value.clients ?? [],
  drivers: value.drivers ?? [],
  vehicles: value.vehicles ?? [],
  shipments: value.shipments ?? [],
  parcels: value.parcels ?? [],
  routes: value.routes ?? [],
  stops: value.stops ?? [],
  assignments: value.assignments ?? [],
  attempts: value.attempts ?? [],
  custodyEvents: value.custodyEvents ?? [],
  incidents: value.incidents ?? [],
  returns: value.returns ?? [],
  defects: value.defects ?? [],
  documents: value.documents ?? [],
  driverDocuments: value.driverDocuments ?? [],
  inspections: value.inspections ?? [],
  maintenance: value.maintenance ?? [],
  evidence: value.evidence ?? [],
  audit: value.audit ?? [],
});

function commandId(): string {
  return crypto.randomUUID();
}

function displayState(value?: string | null): string {
  if (!value) return "Sin estado";
  const labels: Record<string,string> = {ADMIN:'Administración',OPERATIONS:'Coordinación logística',DEPOT:'Depósito',DRIVER:'Chofer',EXPECTED:'Esperado',RECEIVED:'Recibido',LOADED:'Cargado',IN_TRANSIT:'En tránsito',DELIVERED:'Entregado',RETURN_PENDING:'Retorno pendiente',RETURNED_TO_DEPOT:'Devuelto al depósito',RETURNED_TO_SENDER:'Devuelto al remitente',DRAFT:'Borrador',READY:'Ruta confirmada',IN_PROGRESS:'En curso',OPERATIONALLY_CLOSED:'Cerrada operativamente',PENDING:'Pendiente',PARTIAL:'Parcial',COMPLETED:'Completada',FAILED:'Intento fallido',OPEN:'Abierta',RETURN_AUTHORIZED:'Devolución autorizada',RESOLVED:'Resuelta',AUTHORIZED:'Autorizada',AT_DEPOT:'En depósito',SENT_TO_SENDER:'Entregada al remitente',RECEIVER:'Nombre del receptor',RECEIVER_PHOTO:'Receptor y foto',CRITICAL:'Crítico',MINOR:'Menor',OK:'Correcto',SENDER:'Remitente',VEHICLE:'Vehículo',RECIPIENT:'Destinatario',PICKUP:'Retiro',DELIVERY:'Entrega',ABSENT:'Ausente',REFUSED:'Rechazado',ADDRESS_ISSUE:'Problema de dirección',DAMAGED:'Dañado',OTHER:'Otro'};
  if(labels[value.toUpperCase()]) return labels[value.toUpperCase()];
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function auditLabel(action:string):string {
  const operation=action.replace(/\.[a-f0-9-]{36}\./i,'.');
  const controls:Record<string,string>={'drivers.documents.create':'Documento de chofer registrado','driver-documents.renew':'Documento de chofer renovado','returns.depotEvidence':'Evidencia de recepción subsanada'};
  if (controls[operation]) return controls[operation];
  if(operation==='routes.unload')return 'Bulto bajado al depósito';
  if(operation==='routes.unassign')return 'Bulto quitado de la ruta';
  if(operation==='routes.unload-selected')return 'Bultos bajados al depósito';
  if(operation==='routes.unassign-selected')return 'Bultos quitados de la ruta';
  if(operation==='routes.update')return 'Ruta actualizada';
  const labels:Record<string,string>={'clients.create':'Cliente registrado','drivers.create':'Chofer registrado','users.create':'Usuario habilitado','vehicles.create':'Vehículo registrado','shipments.create':'Envío registrado','receipts.create':'Recepción registrada','routes.create':'Ruta creada','routes.assign':'Bultos asignados','routes.order':'Paradas ordenadas','routes.ready':'Ruta confirmada','routes.load':'Carga verificada','routes.dispatch':'Ruta despachada','routes.close':'Ruta cerrada','stops.pickup':'Retiro registrado','stops.attempt':'Intento registrado','incidents.return':'Devolución autorizada','returns.receive':'Retorno recibido en depósito','returns.sender':'Entrega al remitente confirmada','vehicles.inspect':'Inspección registrada','vehicles.document':'Documento registrado','defects.resolve':'Defecto resuelto','vehicles.maintenance':'Mantenimiento programado','maintenance.complete':'Mantenimiento completado','evidence.store':'Evidencia guardada'};
  return labels[operation]??'Movimiento registrado';
}

function formatDate(value: string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short",
  }).format(date);
}

function timeZoneHint(operationTimeZone: string): string {
  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "zona del dispositivo";
  return deviceTimeZone === operationTimeZone ? "Hora local · " + operationTimeZone : "Ingresá la hora de tu equipo (" + deviceTimeZone + "). Se mostrará en " + operationTimeZone + ".";
}

function formatMeasure(value: number | null | undefined, unit: string): string {
  return value == null ? "Sin declarar" : new Intl.NumberFormat("es").format(value) + " " + unit;
}

function StateBadge({ value, label }: { value: string; label?:string }) {
  const normalized = value.toUpperCase();
  const tone = /DELIVER|CLOSED|COMPLETE|RESOLVED|READY|RECEIVED|OK/.test(normalized)
    ? "badge-success"
    : /BLOCK|MISSING|FAIL|CRITICAL|CANCEL|OVERDUE/.test(normalized)
      ? "badge-danger"
    : /PENDING|PLANN|OPEN|RETURN|IN_PROGRESS|IN_TRANSIT|LOADED|ASSIGNED|DRAFT/.test(normalized)
        ? "badge-warning"
        : "badge-neutral";
  return <span className={"badge " + tone}>{label??displayState(value)}</span>;
}

function SectionTitle({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Panel({ title, description, children, className = "" }: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"card " + className}>
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {description && <p className="muted">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

function ErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return <div className="notice error" role="alert">{error}</div>;
}

function SuccessBanner({ message }: { message: string }) {
  if (!message) return null;
  return <div className="notice success" role="status">{message}</div>;
}

function AuthScreen({ setupRequired, busy, error, onAuth }: {
  setupRequired: boolean;
  busy: boolean;
  error: string;
  onAuth: (path: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [organizationName, setOrganizationName] = useState("");
  const [timezone, setTimezone] = useState("America/Asuncion");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onAuth(setupRequired ? "/api/setup" : "/api/login", setupRequired
      ? { organizationName: organizationName.trim(), timezone: timezone.trim(), username: username.trim(), password }
      : { username: username.trim(), password });
  };

  return (
    <main className="auth-shell">
      <aside className="auth-story" aria-label="Nexora operaciones">
        <div className="auth-wordmark">NEXORA <span>/</span> OPERACIONES</div>
        <div><h2>Distribución<br /><span>inteligente.</span></h2><p>Recepción, rutas y entregas en un solo espacio de trabajo.</p></div>
        <footer>Distribución inteligente. Confianza en movimiento.</footer>
      </aside>
      <div className="auth-form-area">
      <section className="auth-card">
        <Brand />
        <p className="eyebrow">ACCESO AL OS</p>
        <h1>{setupRequired ? "Configurá tu operación" : "Bienvenido de nuevo"}</h1>
        <p className="muted">
          {setupRequired
            ? "Configurá la organización y la primera cuenta administradora."
            : "Ingresá con tu cuenta."}
        </p>
        <ErrorBanner error={error} />
        <form className="stack" onSubmit={submit}>
          <fieldset disabled={busy}>
            {setupRequired && (
              <div className="stack">
                <Field label="Nombre de tu empresa logística" hint="Por ejemplo Nexora Logistic. Los clientes, como Universo, se agregan después.">
                  <input required value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} autoComplete="organization" />
                </Field>
                <Field label="Zona horaria" hint="Usá una zona IANA, por ejemplo America/Asuncion.">
                  <input required value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Asuncion" />
                </Field>
              </div>
            )}
            <Field label="Usuario">
              <input required value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </Field>
            <Field label="Contraseña" hint={setupRequired ? "Mínimo 6 caracteres." : undefined}>
              <input
                required
                minLength={setupRequired ? 12 : undefined}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={setupRequired ? "new-password" : "current-password"}
              />
            </Field>
          </fieldset>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Procesando…" : setupRequired ? "Crear espacio y cuenta" : "Ingresar"}
          </button>
        </form>
      </section>
      </div>
    </main>
  );
}

function AppContent() {
  const [session, setSession] = useState<Session | null>(null);
  const [reauthentication,setReauthentication]=useState(false);
  useEffect(()=>{const expired=()=>setReauthentication(true);window.addEventListener('nexora:session-expired',expired);return()=>window.removeEventListener('nexora:session-expired',expired);},[]);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [preferredRouteId, setPreferredRouteId] = useState("");
  const [preferredShipmentId, setPreferredShipmentId] = useState("");
  const [preferredClientId,setPreferredClientId]=useState('');
  const [inventoryEntry,setInventoryEntry]=useState<{clientId:string;view:'catalog'|'receive'|'settings';seed?:ReceiptSeed}|null>(null);
  const [orderEntry,setOrderEntry]=useState<{id:string;reference:string;clientId:string}|null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inFlight = useRef(false);
  const idempotencyKeys = useRef(new Map<string, string>());

  const refreshBootstrap = useCallback(async () => {
    const value = await api<Bootstrap>("/api/bootstrap");
    setBootstrap(emptyBootstrap(value));
  }, []);

  const refreshSession = useCallback(async () => {
    const value = await api<Session>("/api/session");
    setSession(value);
    if (value.user && value.user.role !== "CUSTOMER") {
      await refreshBootstrap();
      setPage(value.user.role === "DRIVER" ? "routes" : "home");
    } else {
      setBootstrap(null);
    }
  }, [refreshBootstrap]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await api<Session>("/api/session");
        if (!active) return;
        setSession(value);
        if (value.user && value.user.role !== "CUSTOMER") {
          const data = await api<Bootstrap>("/api/bootstrap");
          if (!active) return;
          setBootstrap(emptyBootstrap(data));
          setPage(value.user.role === "DRIVER" ? "routes" : "home");
        }
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const mutate: Action = useCallback(async (path, payload, successMessage,onResult) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError("");
    setSuccess("");
    const key = mutationKey(path, payload);
    let stableCommandId = idempotencyKeys.current.get(key);
    if (!stableCommandId) {
      stableCommandId = commandId();
      idempotencyKeys.current.set(key, stableCommandId);
    }
    const { commandId: _callerCommandId, ...body } = payload;
    try {
      const result=await api<Record<string,unknown>>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "logistics-os" },
        body: JSON.stringify({ ...body, commandId: stableCommandId }),
      });
      idempotencyKeys.current.delete(key);
      setSuccess(successMessage);
      onResult?.(result);
      try{await refreshBootstrap();}
      catch(caught){setError('La operación se guardó, pero no se pudo actualizar la vista. Usá Actualizar para consultar el resultado. '+errorMessage(caught));}
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [refreshBootstrap]);

  const uploadEvidence: EvidenceUpload = useCallback(async (parcelId, file) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setError("");
    setSuccess("");
    const key = fileMutationKey(parcelId, file);
    let stableCommandId = idempotencyKeys.current.get(key);
    if (!stableCommandId) {
      stableCommandId = commandId();
      idempotencyKeys.current.set(key, stableCommandId);
    }
    try {
      const dataBase64 = await fileToBase64(file);
      const result = await api<{ id: string }>("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "logistics-os" },
        body: JSON.stringify({ commandId: stableCommandId, ...(parcelId ? { parcelId } : {}), filename: file.name, mimeType: file.type, dataBase64 }),
      });
      try {
        await refreshBootstrap();
        idempotencyKeys.current.delete(key);
      } catch (caught) {
        setError("La evidencia quedó guardada, pero no se pudo actualizar el espacio: " + errorMessage(caught));
      }
      setSuccess(parcelId ? "Evidencia cargada y vinculada al bulto." : "Evidencia de la corrección cargada.");
      return result.id;
    } catch (caught) {
      setError(errorMessage(caught));
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [refreshBootstrap]);

  const authenticate = async (path: string, body: Record<string, unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await api(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "logistics-os" },
        body: JSON.stringify(body),
      });
      setSuccess("");
      if(reauthentication){const restored=await api<Session>('/api/session');if(restored.user?.id!==session?.user?.id){await api('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:'{}'});throw new Error('Ingresá con la misma cuenta que abrió este formulario.');}setSession(restored);await refreshBootstrap();setError('');setReauthentication(false);}else await refreshSession();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const logout = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await api("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "logistics-os" },
        body: JSON.stringify({}),
      });
      setSession({ user: null, setupRequired: false });
      setBootstrap(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  if (loading) {
    return <main className="auth-shell"><div className="auth-card"><p className="eyebrow">OS DE LOGÍSTICA</p><p className="muted">Cargando el espacio de trabajo…</p></div></main>;
  }
  if (!session) {
    return <main className="auth-shell"><div className="auth-card"><h1>No se pudo conectar</h1><ErrorBanner error={error} /><button className="button button-secondary" onClick={() => { setLoading(true); setError(""); void refreshSession().catch((caught) => setError(errorMessage(caught))).finally(() => setLoading(false)); }}>Reintentar</button></div></main>;
  }
  if (session.user?.role === "CUSTOMER") {
    return <CustomerPortal user={session.user} busy={pending} onLogout={logout} />;
  }
  if (!session.user || !bootstrap) {
    return <AuthScreen setupRequired={session.setupRequired} busy={pending} error={error} onAuth={authenticate} />;
  }

  const isDriver = session.user.role === "DRIVER";
  const role = session.user.role;
  const nav: { id: Page; label: string; icon: ReactNode }[] = isDriver
    ? [{ id: "routes", label: "Mis rutas", icon: <RouteIcon /> }, { id: "tracking", label: "Tracking", icon: <Radio /> }]
    : role === "DEPOT" ? [
      {id:"home",label:"Inicio",icon:<LayoutDashboard/>},
      {id:"inventory",label:"Inventario",icon:<Boxes/>},
      {id:"orders",label:"Preparar pedidos",icon:<ClipboardList/>},
      {id:"shipments",label:"Envíos",icon:<Package/>},
      {id:"routes",label:"Carga de reparto",icon:<Truck/>},
    ]
    : [
      { id: "home", label: "Inicio", icon: <LayoutDashboard /> },
      { id: "inventory", label: "Inventario", icon: <Boxes /> },
      { id: "orders", label: "Pedidos", icon: <ClipboardList /> },
      { id: "shipments", label: "Envíos", icon: <Package /> },
      { id: "routes", label: "Rutas", icon: <RouteIcon /> },
      { id: "tracking", label: "Tracking", icon: <Radio /> },
      ...(role === "ADMIN" ? [{ id: "billing" as Page, label: "Facturación", icon: <ClipboardList /> }] : []),
      ...(role === "ADMIN" ? [{ id: "company" as Page, label: "Empresa y equipo", icon: <Users /> }] : []),
      { id: "clients", label: "Clientes", icon: <Users /> },
      { id: "fleet", label: "Flota", icon: <Truck /> },
      ...(role === "ADMIN" ? [{ id: "customerAccess" as Page, label: "Accesos cliente", icon: <Shield /> }] : []),
    ];

  const changePage = (next: Page, recordId = "") => { setPreferredRouteId(next==='routes'?recordId:''); setPreferredShipmentId(next==='shipments'?recordId:''); setPreferredClientId(next==='clients'?recordId:''); setInventoryEntry(null); setOrderEntry(null); setPage(next); setError(""); setSuccess(""); };

  return (
    <div className="app-shell">
      {reauthentication&&<Reauthentication busy={pending} error={error} onAuthenticate={authenticate}/>}
      <aside className="sidebar" inert={reauthentication} aria-hidden={reauthentication||undefined}>
        <div className="brand">
          <Brand />
          <span className="brand-caption">Centro de operaciones</span>
        </div>
        <div className="organization-switch" aria-label={'Empresa operadora: '+bootstrap.organization.name}><span className="organization-dot" /><span>{bootstrap.organization.name}<small className="operator-caption">Empresa operadora</small></span></div>
        <div><nav className="nav-list" aria-label="Navegación principal">
          {[{label:isDriver?'Mi trabajo':role==='DEPOT'?'Trabajo de depósito':'Operación diaria',items:nav.filter(item=>!['clients','fleet','company','customerAccess'].includes(item.id))},{label:'Configuración',items:nav.filter(item=>['clients','fleet','company','customerAccess'].includes(item.id))}].filter(group=>group.items.length).map(group=><div className="nav-group" key={group.label}><p className="rail-label">{group.label}</p>{group.items.map((item) => (
            <button key={item.id} aria-current={page===item.id?'page':undefined} className={"nav-link " + (page === item.id ? "active" : "")} onClick={() => changePage(item.id)}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}</div>)}
        </nav></div>
        <div className="sidebar-footer">
          <a className="text-button" href="/manual.html" target="_blank" rel="noreferrer">Guía interactiva ↗</a>
          <div className="user-chip" aria-label={'Cuenta en uso: '+bootstrap.user.name}><span className="avatar">{bootstrap.user.name.slice(0, 1).toUpperCase()}</span><span><strong>{bootstrap.user.name}</strong><small>{bootstrap.user.isSuperAdmin?'Super Admin':displayState(bootstrap.user.role)}</small></span></div>
          <button className="text-button signout" onClick={logout} disabled={pending}><LogOut aria-hidden="true" />Cerrar sesión</button>
        </div>
      </aside>
      <main className="workspace" inert={reauthentication} aria-hidden={reauthentication||undefined}>
        <header className="topbar">
          <div><Brand compact className="mobile-brand" /><span className="topbar-label">{bootstrap.organization.name}</span><span className="topbar-separator">/</span><span>{pageLabel(page)}</span></div>
          <div className="topbar-meta"><span className="connection-indicator" /><span className="local-label">{['127.0.0.1','localhost'].includes(location.hostname)?'Entorno local':'OS online'}</span><button className="text-button mobile-signout" aria-label="Cerrar sesión" onClick={logout} disabled={pending}>Salir</button></div>
        </header>
        <div className="content">
          {bootstrap.organization.name.startsWith('DEMO') && <div className="notice demo-notice" role="status">DEMO · Datos ficticios · Base separada de la operación</div>}
          {bootstrap.organization.testMode && <div className="notice demo-notice" role="status">MODO DE PRUEBA ACTIVO · Se permite entregar sin foto. Usá únicamente pedidos de prueba.</div>}
          {bootstrap.limits?.hasMore && <div className="notice" role="status">{bootstrap.limits.message}</div>}
          {(error||success)&&<div className="operation-feedback"><ErrorBanner error={error} /><SuccessBanner message={success} /></div>}
          {page === "home" && !isDriver && <HomeView data={bootstrap} go={changePage} role={role} />}
          {page === "shipments" && !isDriver && <ShipmentsView initialShipmentId={preferredShipmentId} data={bootstrap} action={mutate} busy={pending} uploadEvidence={uploadEvidence} role={role} />}
          {page === "routes" && <RoutesView initialRouteId={preferredRouteId} onConfigureDepot={role==="ADMIN"?()=>changePage("company"):undefined} data={bootstrap} action={mutate} busy={pending} operationError={error} onClearError={()=>setError('')} onRefresh={async()=>{await refreshBootstrap();setError('');setSuccess('');}} uploadEvidence={uploadEvidence} role={role} driverId={isDriver ? session.user.driverId ?? null : null} />}
          {page === "fleet" && !isDriver && <FleetView data={bootstrap} action={mutate} busy={pending} uploadEvidence={uploadEvidence} role={role} onPrepareRoute={()=>changePage('routes','new')} />}
          {page === "clients" && isOpsRole(role) && <ClientsPanel profileEnabled={bootstrap.clientProfilesEnabled===true} initialClientId={preferredClientId} clients={bootstrap.clients} shipments={bootstrap.shipments} canManage={true} action={mutate} busy={pending} actionError={error} onInventory={(clientId,view)=>{changePage('inventory');setInventoryEntry({clientId,view});}}/>}
          {page === "company" && role === "ADMIN" && <CompanyPanel onDepots={()=>{changePage("inventory");setInventoryEntry({clientId:"",view:"settings"});}} organization={bootstrap.organization} currentUserId={session.user.id} action={mutate} busy={pending} actionError={error} onFleet={()=>changePage('fleet')}/>}
          {page === "billing" && role === "ADMIN" && <Suspense fallback={<p role="status">Cargando facturación…</p>}><BillingPanel clients={bootstrap.clients}/></Suspense>}
          {page === "inventory" && !isDriver && <InventoryPanel key={inventoryEntry?inventoryEntry.clientId+':'+inventoryEntry.view:'inventory'} initialClientId={inventoryEntry?.clientId} initialView={inventoryEntry?.view} initialReceiptSeed={inventoryEntry?.seed} onReturnToOrder={inventoryEntry?.seed?.order?()=>{const order=inventoryEntry.seed!.order!;changePage('orders');setOrderEntry({id:order.orderId,reference:order.orderReference,clientId:order.clientId});}:undefined} onReturnToClient={inventoryEntry&&!inventoryEntry.seed?.order?(clientId)=>changePage('clients',clientId):undefined} section="inventory" role={role} clients={bootstrap.clients} companyName={bootstrap.organization.name} supportContacts={bootstrap.organization.supportContacts} onManageClients={()=>changePage('clients')} vehicles={bootstrap.vehicles} routes={bootstrap.routes} assignments={bootstrap.assignments} parcels={bootstrap.parcels} returns={bootstrap.returns} uploadEvidence={uploadEvidence} onRefresh={refreshBootstrap} />}
          {page === "orders" && !isDriver && <InventoryPanel key={orderEntry?.id??'orders'} initialOrder={orderEntry??undefined} initialClientId={orderEntry?.clientId} section="orders" role={role} clients={bootstrap.clients} companyName={bootstrap.organization.name} supportContacts={bootstrap.organization.supportContacts} onManageClients={()=>changePage('clients')} onOpenRoutes={(routeId)=>changePage('routes',routeId)} onReceiveStock={(order)=>{changePage('inventory');setInventoryEntry({clientId:order.clientId,view:'receive',seed:{token:crypto.randomUUID(),order}});}} vehicles={bootstrap.vehicles} routes={bootstrap.routes} assignments={bootstrap.assignments} parcels={bootstrap.parcels} returns={bootstrap.returns} uploadEvidence={uploadEvidence} onRefresh={refreshBootstrap} />}
          {page === "customerAccess" && role === "ADMIN" && <InventoryPanel section="customerAccess" role={role} clients={bootstrap.clients} companyName={bootstrap.organization.name} supportContacts={bootstrap.organization.supportContacts} onManageClients={()=>changePage('clients')} vehicles={bootstrap.vehicles} routes={bootstrap.routes} assignments={bootstrap.assignments} parcels={bootstrap.parcels} returns={bootstrap.returns} uploadEvidence={uploadEvidence} onRefresh={refreshBootstrap} />}
          {page === "tracking" && <TrackingView data={bootstrap} action={mutate} busy={pending} onRefresh={refreshBootstrap} onPrepareRoute={()=>changePage('routes','new')} />}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Navegación móvil" inert={reauthentication} aria-hidden={reauthentication||undefined}>
        {nav.map((item) => <button key={item.id} aria-current={page===item.id?'page':undefined} className={"nav-link " +(page === item.id ? "active" : "")} onClick={() => changePage(item.id)}><span>{item.icon}</span>{item.label}</button>)}
      </nav>
    </div>
  );
}

function HomeView({ data, go, role }: { data: Bootstrap; go: (page: Page, routeId?: string) => void; role: Role }) {
  const [activeKpi,setActiveKpi] = useState<KpiKind|null>(null);
  const kpiTrigger = useRef<HTMLButtonElement|null>(null);
  const actions = isOpsRole(role)
    ? [
      { page: "inventory" as Page, symbol: <Boxes />, title: "Inventario", detail: "Recibir mercadería y consultar existencias" },
      { page: "orders" as Page, symbol: <ClipboardList />, title: "Pedidos del día", detail: "Importar y preparar pedidos" },
      { page: "routes" as Page, symbol: <RouteIcon />, title: "Planificar una ruta", detail: "Asignar bultos recibidos a una ruta" },
      
    ]
    : [
      { page: "inventory" as Page, symbol: <Boxes />, title: "Recibir mercadería", detail: "Escanear SKU y registrar entrada" },
      { page: "routes" as Page, symbol: <Truck />, title: "Controlar carga", detail: "Escanear bultos en rutas listas" },
      { page: "orders" as Page, symbol: <ClipboardList />, title: "Preparar pedidos", detail: "Reservar y cargar mercadería para reparto" },
    ];
  const pendingParcels = data.parcels.filter((parcel) => !isFinalParcel(parcel.state)).length;
  const openIncidents = data.incidents.filter((item) => !isClosed(item.state)).length;
  const activeRoutes = data.routes.filter((route) => !isClosed(route.state)).length;
  const assigned = new Set(data.assignments.filter(a=>a.active).map(a=>a.parcelId));
  const queue = [
    {label:'Bultos anunciados por recibir',count:data.parcels.filter(p=>p.state==='EXPECTED').length,page:'shipments' as Page},
    {label:'Bultos en depósito sin ruta',count:data.parcels.filter(p=>['RECEIVED','RETURNED_TO_DEPOT'].includes(p.state)&&!assigned.has(p.id)).length,page:'routes' as Page},
    {label:'Rutas confirmadas',count:data.routes.filter(r=>r.state==='READY').length,page:'routes' as Page},
    {label:'Incidencias por resolver',count:openIncidents,page:'routes' as Page},
    {label:'Defectos críticos abiertos',count:data.defects.filter(d=>d.severity==='CRITICAL'&&d.state==='OPEN').length,page:'fleet' as Page},
  ].filter(q=>q.count>0&&(q.page!=='fleet'||isOpsRole(role)));
  const stats = [
    { id:'shipments' as const, label: "Envíos registrados", value: data.shipments.length, caption: "Ver envíos" },
    { id:'parcels' as const, label: "Bultos en operación", value: pendingParcels, caption: "Ver bultos pendientes" },
    { id:'routes' as const, label: "Rutas abiertas", value: activeRoutes, caption: "Ver rutas sin cerrar" },
    { id:'incidents' as const, label: "Incidencias abiertas", value: openIncidents, caption: "Ver incidencias por resolver" },
  ];
  return (
    <>
      <SectionTitle eyebrow="CENTRO DE OPERACIONES" title="Operación" description="Recepción, despacho y entregas." action={<div className="heading-actions"><button className="button button-primary" onClick={()=>go('inventory')}><Boxes aria-hidden="true" />Gestionar inventario</button></div>} />
      <div className="stat-grid">
        {stats.map(stat => <button type="button" className="stat-card" key={stat.id} aria-label={'Ver '+stat.label.toLowerCase()+' ('+stat.value+')'} aria-expanded={activeKpi===stat.id} aria-controls="kpi-details" onClick={event=>{kpiTrigger.current=event.currentTarget;setActiveKpi(current=>current===stat.id?null:stat.id);}}><span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.caption}<ArrowUpRight aria-hidden="true" /></small></button>)}
      </div>
      {activeKpi && <KpiDetails kind={activeKpi} data={data} go={go} onClose={()=>{setActiveKpi(null);kpiTrigger.current?.focus({preventScroll:true});}} stateLabel={displayState} isFinalParcel={isFinalParcel} isClosed={isClosed} />}
      <div className="action-list" aria-label="Acciones de operación">
        {actions.map(item=><button className="button button-secondary" key={item.title} title={item.detail} onClick={()=>go(item.page)}>{item.symbol}{item.title}<ArrowUpRight aria-hidden="true" /></button>)}
      </div>
      <div className="home-grid">
        <div>
          <Panel title="Trabajo pendiente" description="Lo que necesita una acción para avanzar.">
            {queue.length ? <div className="work-queue">{queue.map(q=><button className="action-row" key={q.label} onClick={()=>go(q.page)}><span className="queue-count">{q.count}</span><strong>{q.label}</strong><ChevronRight className="action-arrow" aria-hidden="true" /></button>)}</div> : <p className="muted">No hay obligaciones pendientes en la vista cargada.</p>}
          </Panel>
          <Panel title="Rutas abiertas" description="Manifiesto y avance de entregas registradas.">
            {data.routes.filter(route=>!isClosed(route.state)).length===0 ? <EmptyState>No hay rutas abiertas.</EmptyState> : data.routes.filter(route=>!isClosed(route.state)).map(route=>{
              const parcelIds=new Set(data.assignments.filter(assignment=>assignment.routeId===route.id).map(assignment=>assignment.parcelId));
              const parcels=data.parcels.filter(parcel=>parcelIds.has(parcel.id));
              const delivered=parcels.filter(parcel=>parcel.state==='DELIVERED').length;
              return <article className="home-route-row" key={route.id}>
                <div className="row"><strong>{route.name}</strong><StateBadge value={route.state} /></div>
                <div className="home-route-meta"><span><Truck aria-hidden="true" />{data.vehicles.find(vehicle=>vehicle.id===route.vehicleId)?.plate??'Vehículo asignado'}</span><small>{delivered} / {parcels.length} entregados</small></div>
                <div className="progress" role="progressbar" aria-label={'Entregas de '+route.name} aria-valuenow={delivered} aria-valuemin={0} aria-valuemax={Math.max(1,parcels.length)}><div className="progress-bar" style={{width:(parcels.length?delivered/parcels.length*100:0)+'%'}} /></div>
                <div className="home-route-meta"><small>{data.drivers.find(driver=>driver.id===route.driverId)?.name??'Chofer asignado'}</small><button className="text-button" onClick={()=>go('routes',route.id)}>Ver ruta<ArrowRight aria-hidden="true" /></button></div>
              </article>;
            })}
          </Panel>
        </div>
        <Panel className="home-activity" title="Actividad reciente" description="Últimos movimientos registrados.">
          {data.audit.length === 0 ? <EmptyState>Aún no hay actividad registrada.</EmptyState> : (
            <div className="timeline">
              {data.audit.slice(0, 6).map((item) => <div className="timeline-item" key={item.id}><span className="timeline-dot" /><div><strong>{auditLabel(item.action)}</strong><small>{formatDate(item.createdAt, data.organization.timezone)}</small></div></div>)}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function ShipmentsView({ data, action, busy, uploadEvidence, role, initialShipmentId = "" }: {
  data: Bootstrap; action: Action; busy: boolean; uploadEvidence: EvidenceUpload; role: Role; initialShipmentId?:string;
}) {
  const canCreate = isOpsRole(role);
  const canReceive = canDepotRole(role);
  const [selectedId, setSelectedId] = useState(initialShipmentId);
  const [shipmentTask,setShipmentTask] = useState('list');
  const [clientId, setClientId] = useState("");
  const [reference, setReference] = useState("");
  const [originText, setOriginText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [parcelCount, setParcelCount] = useState("1");
  const [weightGrams, setWeightGrams] = useState("");
  const [volumeCm3, setVolumeCm3] = useState("");
  const [proofPolicy, setProofPolicy] = useState("");
  const [receivedIds, setReceivedIds] = useState<string[]>([]);
  const [receiptLocation, setReceiptLocation] = useState("");
  const selected = data.shipments.find((shipment) => shipment.id === selectedId);
  const parcels = selected ? data.parcels.filter((parcel) => parcel.shipmentId === selected.id) : [];
  const receiptOptions = parcels.filter((parcel) => parcel.state === "EXPECTED" && parcel.custodyType === "SENDER");
  const clientNames = useMemo(() => new Map(data.clients.map((client) => [client.id, client.name])), [data.clients]);
  const selectedParcelIds = new Set(parcels.map((parcel) => parcel.id));
  const selectedStopIds = new Set(data.stops.filter((stop) => stop.shipmentId === selected?.id).map((stop) => stop.id));
  const shipmentTimeline = [
    ...data.custodyEvents.filter((event) => selectedParcelIds.has(event.parcelId)).map((event) => ({
      id: event.id, title: displayState(event.action),
      subtitle: [parcels.find((parcel) => parcel.id === event.parcelId)?.code, event.fromType && displayState(event.fromType), event.toType && displayState(event.toType)].filter(Boolean).join(" · "),
      createdAt: event.createdAt,
    })),
    ...data.attempts.filter((attempt) => selectedStopIds.has(attempt.stopId)).map((attempt) => ({
      id: attempt.id, title: "Intento de entrega",
      subtitle: [attempt.receiverName, attempt.reasonCode && displayState(attempt.reasonCode), attempt.nextAction].filter(Boolean).join(" · "),
      createdAt: attempt.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action("/api/shipments", {
      clientId, reference: reference.trim(), originText: originText.trim(), destinationText: destinationText.trim(),
      recipientName: recipientName.trim(), recipientPhone: recipientPhone.trim() || null,
      parcelCount: Number(parcelCount), weightGrams: weightGrams === "" ? null : Number(weightGrams),
      volumeCm3: volumeCm3 === "" ? null : Number(volumeCm3), proofPolicy,
    }, "Envío registrado.");
    if (ok) {
      setReference(""); setOriginText(""); setDestinationText(""); setRecipientName(""); setRecipientPhone("");
      setParcelCount("1"); setWeightGrams(""); setVolumeCm3(""); setProofPolicy("");
    }
  };

  const submitReceipt = async (event: FormEvent) => {
    event.preventDefault();
    const codes = parcels.filter((parcel) => receivedIds.includes(parcel.id)).map((parcel) => parcel.code);
    const ok = await action("/api/receipts", { shipmentId: selected?.id, codes, location: receiptLocation.trim(), commandId: commandId() }, "Recepción registrada.");
    if (ok) { setReceivedIds([]); setReceiptLocation(""); }
  };

  return (
    <>
      <SectionTitle eyebrow="INGRESO Y CONTROL" title="Envíos" description="Consultá cada envío y sus bultos." action={<div className="heading-actions">{canCreate && <button className="button button-primary" onClick={()=>setShipmentTask(value=>value==='create'?'list':'create')}><Plus aria-hidden="true" />{shipmentTask==='create'?'Cerrar alta':'Nuevo envío'}</button>}{canReceive && <button className="button button-secondary" onClick={()=>setShipmentTask(value=>value==='receive'?'list':'receive')}>{shipmentTask==='receive'?'Cerrar recepción':'Recibir bultos'}</button>}</div>} />
      <div>
        {canCreate && shipmentTask === "create" && <Panel title="Registrar envío" description="Los bultos llegan preparados para su distribución.">
          {data.clients.length === 0 ? <div className="notice notice-neutral">Primero registrá un cliente para declarar un envío.</div> : (
            <form className="stack" onSubmit={submitCreate}>
              <fieldset disabled={busy}>
                <div className="form-grid">
                  <Field label="Cliente"><select required value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Seleccionar cliente</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field>
                  <Field label="Referencia del envío"><input required value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
                  <Field label="Origen"><input required value={originText} onChange={(event) => setOriginText(event.target.value)} /></Field>
                  <Field label="Destino"><input required value={destinationText} onChange={(event) => setDestinationText(event.target.value)} /></Field>
                  <Field label="Destinatario"><input required value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></Field>
                  <Field label="Teléfono del destinatario"><input type="tel" value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} /></Field>
                  <Field label="Bultos declarados"><input required type="number" min="1" step="1" value={parcelCount} onChange={(event) => setParcelCount(event.target.value)} /></Field>
                  <Field label="Peso por bulto (g)" hint="Dejalo vacío si todavía no se conoce."><input type="number" min="1" step="1" value={weightGrams} onChange={(event) => setWeightGrams(event.target.value)} /></Field>
                  <Field label="Volumen por bulto (cm³)" hint="Dejalo vacío si todavía no se conoce."><input type="number" min="1" step="1" value={volumeCm3} onChange={(event) => setVolumeCm3(event.target.value)} /></Field>
                  <Field label="Política de prueba de entrega"><select required value={proofPolicy} onChange={(event) => setProofPolicy(event.target.value)}><option value="">Elegir según el servicio</option><option value="RECEIVER">Nombre de quien recibe</option><option value="RECEIVER_PHOTO">Nombre y foto</option></select></Field>
                </div>
              </fieldset>
              <button className="button button-primary" type="submit" disabled={busy || !clientId || !proofPolicy}>{busy ? "Guardando…" : "Registrar envío"}</button>
            </form>
          )}
        </Panel>}
        {canReceive && shipmentTask === "receive" && <Panel title="Registrar recepción" description="Marcá solamente los bultos que llegaron físicamente.">
          {data.shipments.length === 0 ? <EmptyState>No hay envíos para recibir.</EmptyState> : (
            <form className="stack" onSubmit={submitReceipt}>
              <fieldset disabled={busy}>
                <Field label="Envío"><select value={selected?.id ?? ""} onChange={(event) => { setSelectedId(event.target.value); setReceivedIds([]); }}><option value="">Seleccionar envío</option>{data.shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.reference} · {clientNames.get(shipment.clientId) ?? shipment.clientId}</option>)}</select></Field>
                <Field label="Lugar de recepción" hint="Registrá el lugar observado; no se consulta GPS."><input required value={receiptLocation} onChange={(event) => setReceiptLocation(event.target.value)} /></Field>
                <div className="parcel-picker">
                  {receiptOptions.length === 0 ? <EmptyState>Este envío no tiene bultos pendientes de recepción.</EmptyState> : receiptOptions.map((parcel) => (
                    <label className="parcel-row" key={parcel.id}>
                      <input type="checkbox" checked={receivedIds.includes(parcel.id)} onChange={() => setReceivedIds((current) => current.includes(parcel.id) ? current.filter((id) => id !== parcel.id) : [...current, parcel.id])} />
                      <span><strong>{parcel.code}</strong><small>{displayState(parcel.state)} · {displayState(parcel.custodyType)}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button className="button button-primary" type="submit" disabled={busy || receivedIds.length === 0 || !receiptLocation.trim()}>{busy ? "Registrando…" : "Confirmar recepción seleccionada"}</button>
            </form>
          )}
        </Panel>}
      </div>
      <Panel title="Envíos registrados" description="Seleccioná un envío para ver conteos, bultos y trazabilidad.">
        {data.shipments.length === 0 ? <EmptyState>Cuando registres el primer envío, aparecerá aquí.</EmptyState> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Referencia</th><th>Cliente</th><th>Destino</th><th>Recibidos</th><th>Entregados</th><th>Pendientes</th></tr></thead>
            <tbody>{data.shipments.map((shipment) => <tr key={shipment.id} className={selected?.id === shipment.id ? "row-selected" : ""} onClick={() => setSelectedId(shipment.id)}>
              <td><button className="text-button" onClick={(event) => { event.stopPropagation(); setSelectedId(shipment.id); }}>{shipment.reference}</button></td>
              <td>{clientNames.get(shipment.clientId) ?? shipment.clientId}</td><td>{shipment.destinationText}</td>
              <td>{shipment.counts.received} / {shipment.counts.expected}</td><td>{shipment.counts.delivered}</td><td>{shipment.counts.pending}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Panel>
      {selected && <div className="grid-2">
        <Panel title={"Detalle · " + selected.reference}>
          <div className="detail-grid">
            <div><small>Origen</small><strong>{selected.originText}</strong></div><div><small>Destino</small><strong>{selected.destinationText}</strong></div>
            <div><small>Destinatario</small><strong>{selected.recipientName}</strong></div><div><small>Política de entrega</small><strong>{displayState(selected.proofPolicy)}</strong></div>
          </div>
          <div className="count-strip"><span>Esperados <b>{selected.counts.expected}</b></span><span>Recibidos <b>{selected.counts.received}</b></span><span>Entregados <b>{selected.counts.delivered}</b></span><span>Faltantes <b>{selected.counts.missing}</b></span></div>
          <PublicTrackingLinks codes={parcels.map(parcel=>parcel.code)} />
        </Panel>
        <Panel title="Cronología del envío" description="Eventos de custodia e intentos informados por el servidor.">
          {parcels.length === 0 ? <EmptyState>El envío aún no tiene bultos asociados.</EmptyState> : shipmentTimeline.length === 0
            ? <div className="timeline">{parcels.map((parcel) => <div className="timeline-item" key={parcel.id}><span className="timeline-dot" /><div><strong>{parcel.code} <StateBadge value={parcel.state} /></strong><small>{displayState(parcel.custodyType)}</small></div></div>)}</div>
            : <div className="timeline">{shipmentTimeline.map((entry) => <div className="timeline-item" key={entry.id}><span className="timeline-dot" /><div><strong>{entry.title}</strong><small>{entry.subtitle} · {formatDate(entry.createdAt, data.organization.timezone)}</small></div></div>)}</div>}
        </Panel>
      </div>}
    </>
  );
}

function RoutesView({ data, action, busy, operationError,onClearError,onRefresh,uploadEvidence, driverId, role, onConfigureDepot, initialRouteId = "" }: {
  data: Bootstrap; action: Action; busy: boolean; operationError:string;onClearError:()=>void;onRefresh:()=>Promise<void>;uploadEvidence: EvidenceUpload; driverId: string | null; role: Role; onConfigureDepot?:()=>void; initialRouteId?: string;
}) {
  const canPlan = isOpsRole(role);
  const canLoad = canDepotRole(role);
  const canOperateRoad = canRoadRole(role);
  const canReceiveReturns = canDepotRole(role);
  const [justCreated,setJustCreated]=useState<Route|null>(null);
  const [createError,setCreateError]=useState(''),[refreshing,setRefreshing]=useState(false);
  const availableRoutes=justCreated&&!data.routes.some(route=>route.id===justCreated.id)?[justCreated,...data.routes]:data.routes;
  const visibleRoutes = driverId ? availableRoutes.filter((route) => route.driverId === driverId) : availableRoutes;
  const [selectedRouteId, setSelectedRouteId] = useState(initialRouteId);
  const [showCreate, setShowCreate] = useState(initialRouteId==='new');
  const [editRouteId,setEditRouteId]=useState('');
  const [routeTab, setRouteTab] = useState(()=>{
    const route=visibleRoutes.find(item=>item.id===initialRouteId);
    return route&&['DRAFT','READY'].includes(route.state)&&canLoad?'loading':'stops';
  });
  const [routeSearch, setRouteSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState('ALL');
  const [routePage, setRoutePage] = useState(0);
  const filteredRoutes = visibleRoutes.filter(route => (routeFilter !== 'ALL'||route.state!=='DRAFT'||data.assignments.some(a=>a.active&&a.routeId===route.id)) && (routeFilter === 'ALL' || route.state === routeFilter) && (route.name + ' ' + (data.drivers.find(d=>d.id===route.driverId)?.name??'') + ' ' + (data.vehicles.find(v=>v.id===route.vehicleId)?.plate??'')).toLocaleLowerCase().includes(routeSearch.toLocaleLowerCase()));
  const displayedRoutes = filteredRoutes.slice(routePage*8,routePage*8+8);
  const [assignmentIds, setAssignmentIds] = useState<string[]>([]);
  const [pickupMode, setPickupMode] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [stopId, setStopId] = useState("");
  const [deliveredIds, setDeliveredIds] = useState<string[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [receiverName, setReceiverName] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<Array<{id:string;parcelId:string}>>([]);
  const [driverInspectionOdometer, setDriverInspectionOdometer] = useState("");
  const [driverFuelPercent, setDriverFuelPercent] = useState("");
  const [driverInspectionItems, setDriverInspectionItems] = useState<InspectionItem[]>([{ label: "", severity: "OK", note: "" }]);
  const selectedRoute = visibleRoutes.find((route) => route.id === selectedRouteId);
  const resetRouteTask = () => {
    setEditRouteId(''); setAssignmentIds([]); setPickupMode(false); setScanCode(''); setStopId('');
    setDeliveredIds([]); setFailedIds([]); setReceiverName(''); setReasonCode(''); setNextAction('');
    setEvidenceIds([]);
    setDriverInspectionOdometer(''); setDriverFuelPercent('');
    setDriverInspectionItems([{ label: '', severity: 'OK', note: '' }]);
  };
  const backToRoutes = () => { resetRouteTask(); setSelectedRouteId(''); setShowCreate(false); setCreateError(''); };
  const stops = selectedRoute ? data.stops.filter((stop) => stop.routeId === selectedRoute.id).sort((a, b) => a.sequence - b.sequence) : [];
  const routeAssignmentIds = new Set(data.assignments.filter((assignment) => assignment.routeId === selectedRoute?.id && assignment.active).map((assignment) => assignment.parcelId));
  const routeParcels = data.parcels.filter((parcel) => routeAssignmentIds.has(parcel.id));
  const isLoadedHere=(parcel:Parcel)=>parcel.state==='LOADED'&&parcel.custodyType==='VEHICLE'&&parcel.custodyId===selectedRoute?.vehicleId;
  const loadedParcels=routeParcels.filter(isLoadedHere);
  const removableParcels=routeParcels.filter(parcel=>['EXPECTED','RECEIVED','RETURNED_TO_DEPOT'].includes(parcel.state)&&['SENDER','DEPOT'].includes(parcel.custodyType));
  const depotLoadParcels = routeParcels.filter(parcel=>data.assignments.some(a=>a.routeId===selectedRoute?.id&&a.parcelId===parcel.id&&a.active&&!a.pickup));
  const pendingLoadCount=depotLoadParcels.filter(p=>!(p.state==='LOADED'&&p.custodyType==='VEHICLE'&&p.custodyId===selectedRoute?.vehicleId)).length;
  const capacityIncomplete = routeParcels.some((parcel) => parcel.weightGrams == null || parcel.volumeCm3 == null);
  const activeAssignmentIds = new Set(data.assignments.filter((assignment) => assignment.active).map((assignment) => assignment.parcelId));
  const pendingReturnParcelIds = new Set(data.returns.filter(item => item.state !== 'SENT_TO_SENDER').map(item => item.parcelId));
  const assignableParcels = data.parcels.filter((parcel) => !activeAssignmentIds.has(parcel.id) && !pendingReturnParcelIds.has(parcel.id) && (pickupMode
    ? parcel.state === "EXPECTED" && parcel.custodyType === "SENDER"
    : !parcel.product && isReceivedAndAtDepot(parcel)));
  const pendingStops = stops.filter((stop) => !isClosed(stop.state));
  const openIncidents = selectedRoute ? data.incidents.filter((item) => item.routeId === selectedRoute.id && item.state === "OPEN") : [];
  const routeReturnItems = selectedRoute ? data.returns.filter((item) => item.routeId === selectedRoute.id) : [];
  const missingChecklist=Boolean(selectedRoute&&['DRAFT','READY'].includes(selectedRoute.state)&&canOperateRoad&&operationError.toLocaleLowerCase().includes('checklist'));

  useEffect(()=>{
    if(!selectedRoute)return;
    if(['loading','unloading'].includes(routeTab) && !['DRAFT','READY'].includes(selectedRoute.state))setRouteTab('stops');
    if(routeTab==='checks' && selectedRoute.state==='DRAFT'&&!canPlan)setRouteTab(canLoad?'loading':'stops');
  },[selectedRoute?.state,routeTab,canLoad,canPlan]);
  useEffect(()=>{
    if(missingChecklist){setEditRouteId('');setRouteTab('checks');}
  },[missingChecklist,selectedRoute?.id]);
  const refreshRoutes=async()=>{setRefreshing(true);setCreateError('');try{await onRefresh();}catch(error){setCreateError(errorMessage(error));}finally{setRefreshing(false);}};
  const submitAssign = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRoute) return;
    const ok = await action("/api/routes/" + encodeURIComponent(selectedRoute.id) + "/assignments", { parcelIds: assignmentIds, pickup: pickupMode, expectedVersion: selectedRoute.version, commandId: commandId() }, pickupMode ? "Retiro agregado a la ruta." : "Bultos asignados a la ruta.");
    if (ok) { setAssignmentIds([]); setPickupMode(false); }
  };
  const simpleRouteAction = async (suffix: string, message: string) => {
    if (!selectedRoute) return;
    const saved=await action("/api/routes/" + encodeURIComponent(selectedRoute.id) + "/" + suffix, { expectedVersion: selectedRoute.version, commandId: commandId(),...(suffix==='dispatch'?{dispatchNow:true}:{}) }, message);
    if(saved&&suffix==='dispatch')setRouteTab('stops');
    if(saved&&suffix==='ready')setRouteTab(canOperateRoad?'checks':'stops');
  };
  const submitScan = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRoute) return;
    const ok = await action("/api/routes/" + encodeURIComponent(selectedRoute.id) + "/load-scans", { code: scanCode.trim(), expectedVersion: selectedRoute.version, commandId: commandId() }, "Escaneo de carga registrado.");
    if (ok) setScanCode("");
  };
  const submitAttempt = async (event: FormEvent) => {
    event.preventDefault();
    const stop = stops.find((item) => item.id === stopId);
    if (!selectedRoute || !stop) return;
    const ok = await action("/api/stops/" + encodeURIComponent(stop.id) + "/attempts", {
      deliveredParcelIds: deliveredIds, failedParcelIds: failedIds, receiverName: receiverName.trim(),
      evidenceIds:evidenceIds.filter(e=>deliveredIds.includes(e.parcelId)||failedIds.includes(e.parcelId)).map(e=>e.id), reasonCode:failedIds.length?reasonCode.trim():'', nextAction:failedIds.length?nextAction.trim():'',
      expectedVersion: selectedRoute.version, commandId: commandId(),
    }, "Resultado de la entrega registrado.");
    if (ok) { setStopId(''); setDeliveredIds([]); setFailedIds([]); setReceiverName(""); setReasonCode(""); setNextAction(""); setEvidenceIds([]); }
  };
  const submitDriverInspection = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRoute) return;
    const submitter=(event.nativeEvent as SubmitEvent).submitter;
    const departAfterSave=submitter instanceof HTMLButtonElement&&submitter.value==='dispatch-now';
    const items = driverInspectionItems.filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim(), note: item.note.trim() }));
    const ok = await action("/api/vehicles/" + encodeURIComponent(selectedRoute.vehicleId) + "/inspections", {
      odometer: Number(driverInspectionOdometer), fuelPercent: Number(driverFuelPercent), items, commandId: commandId(),
    }, "Checklist de salida guardado.");
    if (ok) {
      setDriverInspectionOdometer(""); setDriverFuelPercent(""); setDriverInspectionItems([{ label: "", severity: "OK", note: "" }]);
      if(departAfterSave)await simpleRouteAction('dispatch','Salida de ruta registrada.');
    }
  };
  const toggleParcel = (id: string, kind: "delivered" | "failed") => {
    const current = kind === "delivered" ? deliveredIds : failedIds;
    const update = kind === "delivered" ? setDeliveredIds : setFailedIds;
    const other = kind === "delivered" ? failedIds : deliveredIds;
    update(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    if (!current.includes(id)) (kind === "delivered" ? setFailedIds : setDeliveredIds)(other.filter((item) => item !== id));
  };
  const onUpload = async (event: ChangeEvent<HTMLInputElement>, parcelId:string) => {
    const input=event.currentTarget, file=input.files?.[0];
    if (!file) return;
    const id = await uploadEvidence(parcelId, file);
    if (id) { setEvidenceIds((current) => [...current, {id,parcelId}]); input.value = ""; }
  };

  return (
    <>
      <SectionTitle eyebrow="PLANIFICACIÓN Y CALLE" title={showCreate ? 'Nueva ruta' : selectedRoute?.name ?? (driverId ? 'Mis rutas' : 'Rutas')} description={selectedRoute && !showCreate ? `Chofer: ${data.drivers.find(item=>item.id===selectedRoute.driverId)?.name ?? selectedRoute.driverId} · Vehículo: ${data.vehicles.find(item=>item.id===selectedRoute.vehicleId)?.plate ?? selectedRoute.vehicleId}` : showCreate ? undefined : driverId ? 'Tus recorridos asignados.' : 'Organizá los pedidos reservados y revisá la carga de cada camión.'} action={<div className="heading-actions">{(selectedRoute || showCreate) && <button type="button" className="button button-secondary" disabled={busy} onClick={backToRoutes}>← Volver a rutas</button>}<button className="button button-secondary" disabled={busy||refreshing} onClick={()=>void refreshRoutes()}>{refreshing?'Actualizando…':'Actualizar'}</button>{canPlan&&!selectedRoute&&!showCreate&&<button className="button button-secondary" disabled={busy} onClick={()=>{resetRouteTask();setShowCreate(true);setCreateError('');}}><Plus aria-hidden="true" />Nueva ruta</button>}</div>} />
      {createError&&<p className="notice error" role="alert">{createError}</p>}
      {canPlan&&!selectedRoute&&!showCreate&&<ReservedDispatch revision={data} onConfigureDepot={onConfigureDepot} onRefresh={onRefresh} onOpen={id=>{resetRouteTask();setSelectedRouteId(id);setRouteTab(data.routes.find(r=>r.id===id)?.state==="IN_PROGRESS"?"stops":"loading");}}/>}
      {canPlan && showCreate && <Panel title="Nueva ruta"><RouteSetup drivers={data.drivers} vehicles={data.vehicles} action={action} busy={busy} operationError={operationError} onCancel={()=>setShowCreate(false)} onSaved={result=>{if(typeof result.id==='string'){setJustCreated({...result,id:result.id,state:'DRAFT',version:Number(result.version??1)} as Route);setSelectedRouteId(result.id);setRouteTab('loading');setShowCreate(false);}}}/></Panel>}
      {!showCreate && <div className={"routes-layout " + (!selectedRoute ? "routes-layout--list" : "routes-layout--detail")}>
        {!selectedRoute && <details className="routes-history" open={!canPlan}><summary>{canPlan?"Buscar rutas e historial":"Tus rutas"}</summary><Panel title="Rutas">
          <div className="workspace-filters"><label className="field"><span>Buscar ruta</span><input type="search" value={routeSearch} placeholder="Nombre, chofer o matrícula" onChange={event=>{setRouteSearch(event.target.value);setRoutePage(0);}} /></label><label className="field"><span>Estado de ruta</span><select value={routeFilter} onChange={event=>{setRouteFilter(event.target.value);setRoutePage(0);}}><option value="ALL">Todas</option><option value="DRAFT">Sin confirmar</option><option value="READY">Rutas confirmadas</option><option value="IN_PROGRESS">En curso</option><option value="OPERATIONALLY_CLOSED">Cerradas</option></select></label></div>
          {filteredRoutes.length === 0 ? <EmptyState>{role==='DRIVER'?`Todavía no tenés recorridos asignados. El equipo de ${data.organization.name} prepara la ruta y te la asigna.`:<><p>No hay rutas para este filtro.</p>{canPlan&&<p>Los lotes pendientes de aprobación se muestran arriba, en Lotes de organización. Al aprobarlos se crean las rutas.</p>}{(routeFilter!=='ALL'||routeSearch)&&<button type="button" className="button button-secondary" onClick={()=>{setRouteFilter('ALL');setRouteSearch('');setRoutePage(0);}}>Ver todas las rutas</button>}</>}</EmptyState> : <div className="route-list">{displayedRoutes.map((route) => {
            const driver = data.drivers.find((item) => item.id === route.driverId);
            const vehicle = data.vehicles.find((item) => item.id === route.vehicleId);
            return <button className="route-card" key={route.id} onClick={() => { resetRouteTask(); setSelectedRouteId(route.id); setRouteTab(['DRAFT','READY'].includes(route.state)&&canLoad?'loading':'stops'); }}>
              <div className="row"><strong>{route.name}</strong><StateBadge value={route.state} label={route.state==='DRAFT'?'Sin confirmar':undefined} /></div>
              <small>{driver?.name ?? route.driverId} · {vehicle?.plate ?? route.vehicleId}</small>
              <small>{formatDate(route.startAt, data.organization.timezone)}</small>
            </button>;
          })}</div>}
          {filteredRoutes.length>8 && <div className="list-pagination"><button className="button button-secondary" disabled={routePage===0} onClick={()=>setRoutePage(p=>p-1)}>Anterior</button><span>{routePage+1} / {Math.ceil(filteredRoutes.length/8)}</span><button className="button button-secondary" disabled={(routePage+1)*8>=filteredRoutes.length} onClick={()=>setRoutePage(p=>p+1)}>Siguiente</button></div>}
        </Panel></details>}
        {selectedRoute ? <Panel title="Pedidos y operación">
          <RouteItinerary key={selectedRoute.id+':map:'+selectedRoute.version} sources={[{label:`${selectedRoute.name} · ${data.vehicles.find(v=>v.id===selectedRoute.vehicleId)?.plate??''}`,source:{routeId:selectedRoute.id}}]}/>
          {missingChecklist&&<div className="notice notice-neutral"><p>Para despachar, registrá los controles observados del vehículo.</p><button type="button" className="button button-secondary" disabled={busy} onClick={()=>{setEditRouteId('');setRouteTab('checks');onClearError();}}>Ir al control de salida</button></div>}
          {canPlan && editRouteId!==selectedRoute.id && ['DRAFT','READY'].includes(selectedRoute.state) && <button type="button" className="button button-secondary" disabled={busy} onClick={()=>setEditRouteId(selectedRoute.id)}>Editar ruta</button>}
          {canPlan && editRouteId===selectedRoute.id && <Panel title="Editar ruta"><RouteSetup key={selectedRoute.id+':'+selectedRoute.version} route={selectedRoute} drivers={data.drivers} vehicles={data.vehicles} action={action} busy={busy} operationError={operationError} onCancel={()=>setEditRouteId('')} onSaved={()=>setEditRouteId('')}/></Panel>}
          {editRouteId!==selectedRoute.id && <><div className="route-toolbar"><StateBadge value={selectedRoute.state==='READY'&&pendingLoadCount>0?'DRAFT':selectedRoute.state} label={pendingLoadCount>0&&['DRAFT','READY'].includes(selectedRoute.state)?'Carga pendiente':selectedRoute.state==='DRAFT'?'Sin confirmar':undefined} /><span className="muted">Inicio: {formatDate(selectedRoute.startAt,data.organization.timezone)} · Fin: {formatDate(selectedRoute.endAt,data.organization.timezone)}</span></div>
          {selectedRoute.state === 'READY' && (new Date(selectedRoute.startAt).getTime() > Date.now()||new Date(selectedRoute.endAt).getTime() < Date.now()) && <p className="muted">Al despachar ahora, el horario se actualizará automáticamente. Necesitás un checklist registrado en las últimas 24 horas.</p>}
          <div className="button-row">
            {capacityIncomplete && <p className="muted">Hay bultos sin peso o volumen. Podés continuar; la capacidad total no está verificada.</p>}
            {canOperateRoad && selectedRoute.state === "IN_PROGRESS" && <button className="button button-secondary" disabled={busy} onClick={() => simpleRouteAction("close", "Cierre de ruta solicitado.")}>Cerrar ruta</button>}
          </div>
          {['DRAFT','READY'].includes(selectedRoute.state)&&<section className="route-next-step" aria-label="Próximo paso de la ruta">
            <p className="muted">Reservar pedido → Cargar vehículo → Confirmar ruta → Control de salida → Despachar ahora</p>
            <p role="status">{!routeParcels.length?'Agregá los artículos reservados que vas a llevar en esta ruta.':pendingLoadCount>0?`Falta cargar ${pendingLoadCount} bulto(s). La ruta se confirma después de cargar el vehículo.`:selectedRoute.state==='DRAFT'?canPlan?'Carga completa. Revisá las paradas y confirmá la ruta.':'Carga lista. Coordinación logística debe confirmar la ruta.':'Ruta confirmada. Completá el control de salida y despachá.'}</p>
            {canPlan&&selectedRoute.state==='DRAFT'&&<button type="button" className="button button-primary" disabled={busy||pendingLoadCount>0||!routeParcels.length} onClick={()=>void simpleRouteAction('ready','Ruta confirmada. Continuá con el control de salida.')}>Confirmar ruta</button>}
            {canOperateRoad&&selectedRoute.state==='READY'&&<button type="button" className="button button-primary" disabled={busy||pendingLoadCount>0||!routeParcels.length} onClick={()=>void simpleRouteAction('dispatch','Salida de ruta registrada.')}>Despachar ahora</button>}
            {!canPlan&&selectedRoute.state==='DRAFT'&&routeParcels.length>0&&pendingLoadCount===0&&<p className="muted">La carga está lista. Coordinación logística debe confirmar la ruta.</p>}
          </section>}
          {canPlan&&['DRAFT','READY'].includes(selectedRoute.state)&&<RouteOrderManagement routeId={selectedRoute.id} revision={data} onChanged={onRefresh} onOrganize={backToRoutes}/>}
          <nav className="workspace-tabs route-task-tabs" aria-label="Tareas de la ruta">
            {canLoad&&['DRAFT','READY'].includes(selectedRoute.state)&&<button type="button" aria-pressed={routeTab==='loading'} onClick={()=>setRouteTab('loading')}>Cargar artículos ({pendingLoadCount})</button>}
            {canLoad&&['DRAFT','READY'].includes(selectedRoute.state)&&<button type="button" aria-pressed={routeTab==='unloading'} onClick={()=>setRouteTab('unloading')}>Bajar artículos ({loadedParcels.length})</button>}
            <button type="button" aria-pressed={routeTab==='stops'} onClick={()=>setRouteTab('stops')}>Paradas ({stops.length})</button>
            {canOperateRoad && (['READY','IN_PROGRESS'].includes(selectedRoute.state)||selectedRoute.state==='DRAFT'&&canPlan) && <button type="button" aria-pressed={routeTab==='checks'} onClick={()=>setRouteTab('checks')}>Control de salida</button>}
            {(openIncidents.length>0 || routeReturnItems.length>0) && <button type="button" aria-pressed={routeTab==='issues'} onClick={()=>setRouteTab('issues')}>Incidencias y retornos ({openIncidents.length+routeReturnItems.length})</button>}
          </nav>
          {canPlan && ['DRAFT','READY'].includes(selectedRoute.state) && routeTab === 'loading' && <TaskDisclosure label="Agregar envíos directos o retiros (avanzado)"><div className="route-operations">
            <form className="stack form-divider" onSubmit={submitAssign}>
              {selectedRoute.state==='READY'&&<p>Al agregar artículos, la ruta quedará pendiente de confirmación hasta completar la nueva carga.</p>}
              <h3>{pickupMode ? "Agregar retiro al remitente" : "Asignar bultos recibidos"}</h3>
              <label className="checkbox-field"><input type="checkbox" disabled={busy} checked={pickupMode} onChange={(event) => { setPickupMode(event.target.checked); setAssignmentIds([]); }} /> Incluir retiro directo desde el remitente</label>
              {assignableParcels.length === 0 ? <p className="muted">{pickupMode ? "No hay bultos esperados pendientes de retiro." : "No hay bultos recibidos y en depósito sin asignación activa."}</p> : <div className="parcel-picker compact">{assignableParcels.map((parcel) => {
                const shipment = data.shipments.find(item => item.id === parcel.shipmentId);
                const client = data.clients.find(item => item.id === shipment?.clientId);
                return <label className="parcel-row" key={parcel.id}><input type="checkbox" disabled={busy} checked={assignmentIds.includes(parcel.id)} onChange={() => setAssignmentIds((current) => current.includes(parcel.id) ? current.filter((id) => id !== parcel.id) : [...current, parcel.id])} /><span><strong>{parcel.product?.name || "Artículo no especificado"}</strong><small>Destinatario: {shipment?.recipientName || "No disponible"}{client?.name ? " · Cliente: " + client.name : ""}</small><small>{shipment?.reference || "Envío"} · bulto {data.parcels.filter(item=>item.shipmentId===parcel.shipmentId).findIndex(item=>item.id===parcel.id)+1} · Código: {parcel.code}</small></span></label>;
              })}</div>}
              <button className="button button-secondary" disabled={busy || assignmentIds.length === 0}>Asignar selección</button>
            </form>
          </div></TaskDisclosure>}
          {canLoad && ['DRAFT','READY'].includes(selectedRoute.state) && routeTab === "loading" && <div className="route-operations"><RouteLoadPanel key={selectedRoute.id} route={selectedRoute} parcels={depotLoadParcels} shipments={data.shipments} busy={busy} action={action}/>{pendingLoadCount>0&&<details><summary>Usar lector o ingresar código</summary><form className="stack form-divider" onSubmit={submitScan}>
            <Field label="Código del bulto"><input required value={scanCode} onChange={(event) => setScanCode(event.target.value)} placeholder="Escaneá o escribí el código" /></Field>
            <button className="button button-secondary" disabled={busy || !scanCode.trim()}>Registrar escaneo</button>
          </form></details>}{canPlan&&removableParcels.some(p=>!p.product)&&<TaskDisclosure label="Quitar artículos sin cargar de esta ruta"><RouteParcelActions key={selectedRoute.id+':unassign'} route={selectedRoute} parcels={removableParcels.filter(p=>!p.product)} shipments={data.shipments} mode="unassign" busy={busy} action={action}/></TaskDisclosure>}</div>}
          {canLoad&&['DRAFT','READY'].includes(selectedRoute.state)&&routeTab==='unloading'&&<RouteParcelActions key={selectedRoute.id+':unload'} route={selectedRoute} parcels={loadedParcels} shipments={data.shipments} mode="unload" busy={busy} action={action}/>}
          {canOperateRoad && routeTab === "checks" && <Panel title="Checklist de salida" description={"Inspección del vehículo " + (data.vehicles.find((vehicle) => vehicle.id === selectedRoute.vehicleId)?.plate ?? selectedRoute.vehicleId) + ". Guardá controles observados. Para despachar ahora, el checklist debe ser de las últimas 24 horas."}>
            {!['READY','IN_PROGRESS'].includes(selectedRoute.state)&&!(selectedRoute.state==='DRAFT'&&canPlan) ? <p className="muted">La inspección estará disponible cuando la ruta esté lista para salir.</p> : <form className="stack" onSubmit={submitDriverInspection}>
              <fieldset disabled={busy}>
                <div className="form-grid">
                  <Field label="Odómetro observado"><input required type="number" min="0" step="1" value={driverInspectionOdometer} onChange={(event) => setDriverInspectionOdometer(event.target.value)} /></Field>
                  <Field label="Combustible (%)"><input required type="number" min="0" max="100" step="1" value={driverFuelPercent} onChange={(event) => setDriverFuelPercent(event.target.value)} /></Field>
                </div>
                <div className="inspection-list"><div className="row"><h3>Controles</h3><button type="button" className="text-button" disabled={busy} onClick={() => setDriverInspectionItems((items) => [...items, { label: "", severity: "OK", note: "" }])}><Plus aria-hidden="true" />Agregar control</button></div>
                  {driverInspectionItems.map((item, index) => <div className="inspection-item" key={index}><input aria-label="Nombre del control" placeholder="Control observado" value={item.label} onChange={(event) => setDriverInspectionItems((items) => items.map((row, idx) => idx === index ? { ...row, label: event.target.value } : row))} /><select aria-label="Severidad" value={item.severity} onChange={(event) => setDriverInspectionItems((items) => items.map((row, idx) => idx === index ? { ...row, severity: event.target.value as InspectionItem["severity"] } : row))}><option value="OK">OK</option><option value="MINOR">Menor</option><option value="CRITICAL">Crítico</option></select><input aria-label="Nota" placeholder="Nota (opcional)" value={item.note} onChange={(event) => setDriverInspectionItems((items) => items.map((row, idx) => idx === index ? { ...row, note: event.target.value } : row))} /></div>)}
                </div>
              </fieldset>
              <div className="button-row"><button className="button button-secondary" disabled={busy || !driverInspectionOdometer || !driverFuelPercent || driverInspectionItems.every((item) => !item.label.trim())}>Guardar checklist</button>
              {selectedRoute.state==='READY'&&<button className="button button-primary" type="submit" name="departureAction" value="dispatch-now" disabled={busy||pendingLoadCount>0||!routeParcels.length||!driverInspectionOdometer||!driverFuelPercent||driverInspectionItems.every(item=>!item.label.trim())}>Guardar checklist y despachar ahora</button>}</div>
            </form>}
          </Panel>}
          {canPlan && selectedRoute.state === "DRAFT" && routeTab === "stops" && stops.length > 1 && <TaskDisclosure label="Cambiar orden de paradas"><StopOrderEditor key={selectedRoute.id} stops={stops} route={selectedRoute} action={action} busy={busy} shipmentLabel={id=>data.shipments.find(shipment=>shipment.id===id)?.reference??"Envío"} /></TaskDisclosure>}
          {routeTab === "stops" && <div className="route-stop-list">
            <h3>Paradas</h3>
            {stops.length === 0 ? <EmptyState>Aún no hay paradas asignadas.</EmptyState> : stops.map((stop) => {
              const shipment = data.shipments.find((item) => item.id === stop.shipmentId);
              const earlierPending=stops.some(item=>item.sequence<stop.sequence&&!['COMPLETED','FAILED'].includes(item.state));
              const stopParcels = routeParcels.filter(parcel => parcel.shipmentId === stop.shipmentId);
              const products = new Map<string, { name: string; count: number }>();
              for (const parcel of stopParcels) {
                const key = parcel.product?.sku ?? '';
                const item = products.get(key) ?? { name: parcel.product?.name || 'Artículo no especificado', count: 0 };
                item.count++; products.set(key, item);
              }
              return <div className="stop-card" key={stop.id}>
                <div className="row"><strong>{String(stop.sequence).padStart(2, "0")} · {shipment?.reference ?? stop.shipmentId}</strong><StateBadge value={stop.state} /></div>
                <p>{stop.kind==='PICKUP' ? 'Retiro en origen' : shipment?.recipientName ?? 'Destinatario no informado'} · {stop.kind==='PICKUP' ? shipment?.originText ?? 'Origen no informado' : shipment?.destinationText ?? 'Destino no informado'}</p>
                {products.size > 0 && <p>{[...products.values()].map(item => `${item.name} × ${item.count}`).join(' · ')}</p>}
                {['DRAFT','READY'].includes(selectedRoute.state)&&<p className="muted">{stopParcels.filter(isLoadedHere).length} de {stopParcels.length} bultos en el vehículo · {selectedRoute.state==='DRAFT'?'Ruta sin confirmar':'Ruta confirmada'}</p>}
                <details className="parcel-code-details"><summary>{stopParcels.length} {stopParcels.length === 1 ? 'bulto' : 'bultos'} · ver códigos</summary><div className="parcel-tags">{stopParcels.map((parcel) => <span key={parcel.id}>{parcel.code} · {displayState(parcel.state)}</span>)}</div></details>
                {!isClosed(stop.state) && canOperateRoad && selectedRoute.state === "IN_PROGRESS" && stop.kind?.toUpperCase() === "PICKUP" && <PickupAction stop={stop} route={selectedRoute} parcels={routeParcels.filter((parcel) => parcel.shipmentId === stop.shipmentId)} action={action} busy={busy} />}
                {!isClosed(stop.state) && canOperateRoad && selectedRoute.state === "IN_PROGRESS" && stop.kind?.toUpperCase() !== "PICKUP" && <button type="button" className="text-button" disabled={busy||earlierPending} onClick={() => { setStopId(stop.id); setDeliveredIds([]); setFailedIds([]); setReceiverName(""); setEvidenceIds([]); setReasonCode(""); setNextAction(""); }}>{earlierPending?'Primero completá la parada anterior':'Registrar resultado de entrega'}</button>}
                {canOperateRoad && selectedRoute.state === 'IN_PROGRESS' && stop.kind === 'DELIVERY' && ['FAILED','PARTIAL'].includes(stop.state) && routeParcels.some(parcel=>parcel.shipmentId===stop.shipmentId&&parcel.state==='RETURN_PENDING'&&!data.returns.some(item=>item.parcelId===parcel.id&&item.state!=='SENT_TO_SENDER')) && <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void action('/api/stops/'+encodeURIComponent(stop.id)+'/retry',{commandId:commandId(),expectedVersion:selectedRoute.version},'Nuevo intento habilitado. Registrá el resultado de la nueva visita.')}>Habilitar nuevo intento</button>}
              </div>;
            })}
          </div>}
          {routeTab === "stops" && stopId && canOperateRoad && selectedRoute.state === "IN_PROGRESS" && <form className="stack form-divider" onSubmit={submitAttempt}>
            <h3>Resultado de la entrega</h3>
            {data.organization.testMode&&<p className="notice">Modo de prueba: la foto es opcional para repartos Nexora. Usá solo pedidos de prueba.</p>}
            <p className="muted">Cada artículo está en tránsito. Elegí el resultado real; los que dejes pendientes seguirán en el vehículo.</p>
            <fieldset disabled={busy}>
              <div className="parcel-picker compact">{routeParcels.filter((parcel) => {
                const stop = stops.find((item) => item.id === stopId);
                return stop?.shipmentId === parcel.shipmentId && parcel.state === "IN_TRANSIT";
              }).map((parcel) => <div className="parcel-row attempt-row" key={parcel.id}>
                <span><strong>{parcel.product?.name || 'Artículo'}{parcel.product?.sku?' · SKU: '+parcel.product.sku:''}</strong><small>{parcel.code} · En tránsito</small></span>
                <label><input type="radio" name={'resultado-'+parcel.id} checked={!deliveredIds.includes(parcel.id)&&!failedIds.includes(parcel.id)} onChange={()=>{setDeliveredIds(items=>items.filter(id=>id!==parcel.id));setFailedIds(items=>items.filter(id=>id!==parcel.id));}} /> Pendiente</label>
                <label><input type="radio" name={'resultado-'+parcel.id} checked={deliveredIds.includes(parcel.id)} onChange={() => toggleParcel(parcel.id, "delivered")} /> Entregado</label>
                <label><input type="radio" name={'resultado-'+parcel.id} checked={failedIds.includes(parcel.id)} onChange={() => toggleParcel(parcel.id, "failed")} /> No entregado</label>
                {deliveredIds.includes(parcel.id)&&<div className="parcel-photo"><label>Foto de este artículo<input type="file" accept="image/*" onChange={event=>void onUpload(event,parcel.id)} /></label>{evidenceIds.filter(e=>e.parcelId===parcel.id).map((e,index)=><a key={e.id} href={'/api/evidence/'+encodeURIComponent(e.id)} target="_blank" rel="noreferrer">Ver foto {index+1}</a>)}</div>}
              </div>)}</div>
              <div className="form-grid">
                {deliveredIds.length>0&&<Field label="Nombre de quien recibe"><input value={receiverName} onChange={(event) => setReceiverName(event.target.value)} /></Field>}
                {failedIds.length>0&&<><Field label="Motivo de no entrega"><select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="">Seleccionar motivo</option><option value="ABSENT">Ausente</option><option value="REFUSED">Rechazado</option><option value="ADDRESS_ISSUE">Problema de dirección</option><option value="DAMAGED">Dañado</option><option value="OTHER">Otro</option></select></Field>
                <Field label="Próxima acción"><input value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></Field></>}
              </div>
            </fieldset>
            <button className="button button-primary" disabled={busy || (deliveredIds.length === 0 && failedIds.length === 0) || (deliveredIds.length > 0 && !receiverName.trim()) || (failedIds.length > 0 && (!reasonCode || !nextAction.trim()))}>Guardar resultado</button>
          </form>}
          {routeTab === "issues" && openIncidents.length > 0 && <div className="form-divider"><h3>Incidencias abiertas</h3>{openIncidents.map((incident) => <div className="incident-row" key={incident.id}><span><strong>{incident.reasonCode}</strong><small>{incident.nextAction} · {data.parcels.find(parcel=>parcel.id===incident.parcelId)?.code??"Bulto"}</small></span>{canPlan && <button className="button button-secondary" disabled={busy} onClick={() => void action("/api/incidents/" + encodeURIComponent(incident.id) + "/authorize-return", { commandId: commandId() }, "Devolución autorizada.")}>Autorizar devolución</button>}</div>)}</div>}
          {routeTab === "issues" && canReceiveReturns && routeReturnItems.length > 0 && <ReturnOperations canCorrect={isOpsRole(role)} returns={routeReturnItems} parcels={data.parcels} action={action} busy={busy} uploadEvidence={uploadEvidence} />}
          {routeTab === "stops" && stops.length > 0 && pendingStops.length === 0 && openIncidents.length === 0 && <div className="notice notice-neutral">No hay paradas o incidencias abiertas. El servidor validará si la ruta puede cerrarse.</div>}
          </>}
        </Panel> : null}
      </div>}
    </>
  );
}

function PickupAction({ stop, route, parcels, action, busy }: {
  stop: Stop;
  route: Route;
  parcels: Parcel[];
  action: Action;
  busy: boolean;
}) {
  const [codes, setCodes] = useState<string[]>([]);
  const expectedParcels = parcels.filter((parcel) => parcel.state === "EXPECTED" && parcel.custodyType === "SENDER");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action("/api/stops/" + encodeURIComponent(stop.id) + "/pickups", {
      codes: expectedParcels.filter((parcel) => codes.includes(parcel.id)).map((parcel) => parcel.code),
      expectedVersion: route.version,
      commandId: commandId(),
    }, "Retiro registrado.");
    if (ok) setCodes([]);
  };
  return <form className="pickup-form" onSubmit={submit}>
    {expectedParcels.length === 0 ? <small className="muted">No hay bultos esperados pendientes en este retiro.</small> : <div className="parcel-picker compact">
      {expectedParcels.map((parcel) => <label className="parcel-row" key={parcel.id}><input type="checkbox" disabled={busy} checked={codes.includes(parcel.id)} onChange={() => setCodes((current) => current.includes(parcel.id) ? current.filter((id) => id !== parcel.id) : [...current, parcel.id])} /><span><strong>{parcel.code}</strong><small>Esperado · remitente</small></span></label>)}
    </div>}
    <button className="button button-secondary" disabled={busy || codes.length === 0}>Confirmar retiro seleccionado</button>
  </form>;
}

function StopOrderEditor({ stops, route, action, busy, shipmentLabel }: {
  stops: Stop[];
  route: Route;
  action: Action;
  busy: boolean;
  shipmentLabel: (id:string)=>string;
}) {
  const [order, setOrder] = useState(stops.map((stop) => stop.id));
  const stopSignature = stops.map(stop=>stop.id).join('|');
  useEffect(()=>{setOrder(stops.map(stop=>stop.id));},[stopSignature]);
  const orderedStops = order.map((id) => stops.find((stop) => stop.id === id)).filter((stop): stop is Stop => Boolean(stop));
  const move = (index: number, offset: number) => {
    const next = [...order];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action("/api/routes/" + encodeURIComponent(route.id) + "/stops/order", { stopIds: order, expectedVersion: route.version, commandId: commandId() }, "Orden de paradas guardado.");
  };
  return <form className="stop-order form-divider" onSubmit={submit}>
    <div className="row"><div><h3>Orden de paradas</h3><small className="muted">Orden manual; no se calculan distancias ni ETA.</small></div><button className="button button-secondary" disabled={busy}>Guardar orden</button></div>
    {orderedStops.map((stop, index) => <div className="order-row" key={stop.id}><span>{index + 1}. {displayState(stop.kind ?? "DELIVERY")} · {shipmentLabel(stop.shipmentId)}</span><span className="order-buttons"><button type="button" aria-label="Mover arriba" disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label="Mover abajo" disabled={busy || index === order.length - 1} onClick={() => move(index, 1)}>↓</button></span></div>)}
  </form>;
}

function FleetView({ data, action, busy, uploadEvidence, role,onPrepareRoute }: {
  data: Bootstrap; action: Action; busy: boolean; uploadEvidence: EvidenceUpload; role: Role;onPrepareRoute:()=>void;
}) {
  const canManage = isOpsRole(role);
  const [fleetTab,setFleetTab] = useState('vehicles');
  const [documentTarget,setDocumentTarget] = useState('vehicles');
  const [inspectionTarget,setInspectionTarget] = useState('inspections');
  const [driverName, setDriverName] = useState("");
  const [driverUsername, setDriverUsername] = useState("");
  const [driverPassword, setDriverPassword] = useState("");
  const [driverAccounts,setDriverAccounts]=useState<Array<{id:string;driverId:string|null;username:string;enabled:boolean|number}>>([]);
  const [accountsRevision,setAccountsRevision]=useState(0);
  const [accessDriverId,setAccessDriverId]=useState('');
  const [accessUsername,setAccessUsername]=useState('');
  const [accessPassword,setAccessPassword]=useState('');
  const [accountError,setAccountError]=useState('');
  const [accountsLoading,setAccountsLoading]=useState(true);
  useEffect(()=>{if(role!=='ADMIN'||fleetTab!=='drivers')return;const controller=new AbortController();setAccountsLoading(true);api<{team:Array<{id:string;driverId:string|null;username:string;enabled:boolean|number}>}>('/api/company',{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setDriverAccounts(result.team);setAccountError('');}}).catch(()=>{if(!controller.signal.aborted)setAccountError('No se pudo consultar el acceso de los choferes. Actualizá la página.');}).finally(()=>{if(!controller.signal.aborted)setAccountsLoading(false);});return()=>controller.abort();},[role,fleetTab,accountsRevision]);
  const [plate, setPlate] = useState("");
  const [capacityWeight, setCapacityWeight] = useState("");
  const [capacityVolume, setCapacityVolume] = useState("");
  const [odometer, setOdometer] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [docName, setDocName] = useState("");
  const [docExpiresAt, setDocExpiresAt] = useState("");
  const [blocksDispatch, setBlocksDispatch] = useState(false);
  const [inspectionOdometer, setInspectionOdometer] = useState("");
  const [fuelPercent, setFuelPercent] = useState("");
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>([{ label: "", severity: "OK", note: "" }]);
  const [defectEvidenceFile, setDefectEvidenceFile] = useState<File | null>(null);
  const [defectEvidenceId, setDefectEvidenceId] = useState("");
  const [defectNote, setDefectNote] = useState("");
  const [selectedDefectId, setSelectedDefectId] = useState("");
  const vehicles = data.vehicles;
  const selectedVehicle = vehicles.find((item) => item.id === selectedVehicleId) ?? vehicles[0];
  const openDefects = data.defects.filter((item) => !isClosed(item.state));

  const submitDriver = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action("/api/drivers", { name: driverName.trim(), username: driverUsername.trim(), password: driverPassword }, "Chofer registrado.");
    if (ok) { setDriverName(""); setDriverUsername(""); setDriverPassword(""); setAccountsRevision(v=>v+1); }
  };
  const createDriverAccess=async(event:FormEvent)=>{event.preventDefault();if(await action('/api/drivers/'+encodeURIComponent(accessDriverId)+'/access',{username:accessUsername.trim(),password:accessPassword},'Acceso del chofer creado.')){setAccessDriverId('');setAccessUsername('');setAccessPassword('');setAccountsRevision(v=>v+1);}};
  const submitVehicle = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action("/api/vehicles", {
      plate: plate.trim(), capacityWeightGrams: Math.round(Number(capacityWeight)*1000),
      capacityVolumeCm3: Math.round(Number(capacityVolume)*1_000_000), odometer: Number(odometer),
    }, "Vehículo registrado.");
    if (ok) { setPlate(""); setCapacityWeight(""); setCapacityVolume(""); setOdometer(""); }
  };
  const submitDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedVehicle) return;
    const ok = await action("/api/vehicles/" + encodeURIComponent(selectedVehicle.id) + "/documents", { name: docName.trim(), expiresAt: new Date(docExpiresAt).toISOString(), blocksDispatch, commandId: commandId() }, "Documento agregado.");
    if (ok) { setDocName(""); setDocExpiresAt(""); setBlocksDispatch(false); }
  };
  const submitInspection = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedVehicle) return;
    const items = inspectionItems.filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim(), note: item.note.trim() }));
    const ok = await action("/api/vehicles/" + encodeURIComponent(selectedVehicle.id) + "/inspections", {
      odometer: Number(inspectionOdometer), fuelPercent: Number(fuelPercent), items, commandId: commandId(),
    }, "Inspección guardada.");
    if (ok) { setInspectionOdometer(""); setFuelPercent(""); setInspectionItems([{ label: "", severity: "OK", note: "" }]); }
  };
  const resolveDefect = async () => {
    if (!selectedDefectId || !defectEvidenceId) return;
    const ok = await action("/api/defects/" + encodeURIComponent(selectedDefectId) + "/resolve", { evidenceId: defectEvidenceId, note: defectNote.trim(), commandId: commandId() }, "Defecto resuelto con evidencia.");
    if (ok) { setSelectedDefectId(""); setDefectEvidenceId(""); setDefectEvidenceFile(null); setDefectNote(""); }
  };
  const uploadDefectEvidence = async () => {
    if (!defectEvidenceFile) return;
    const id = await uploadEvidence(null, defectEvidenceFile);
    if (id) setDefectEvidenceId(id);
  };

  return (
    <>
      <SectionTitle eyebrow="RECURSOS Y CONTROLES" title="Flota" description="Vehículos y choferes, con sus controles." action={canManage?<button type="button" className="button button-primary" onClick={onPrepareRoute}>Preparar chofer, vehículo y celular</button>:undefined} />
      <nav className="workspace-tabs" aria-label="Secciones de flota">{[['vehicles','Vehículos'],['drivers','Choferes'],['documents','Documentos'],['inspections','Inspecciones'],['maintenance','Mantenimiento']].map(([key,label])=><button type="button" key={key} aria-pressed={fleetTab===key} onClick={()=>setFleetTab(key)}>{label}</button>)}</nav>
      {canManage && fleetTab === "drivers" && <TaskDisclosure label="Agregar chofer">
        <Panel title="Nuevo chofer"><form className="stack" onSubmit={submitDriver}><fieldset disabled={busy}><Field label="Nombre"><input required value={driverName} onChange={(event) => setDriverName(event.target.value)} /></Field><div className="form-grid"><Field label="Usuario"><input required value={driverUsername} onChange={(event) => setDriverUsername(event.target.value)} autoComplete="off" /></Field><Field label="Contraseña inicial" hint="Mínimo 6 caracteres."><input required minLength={6} type="password" value={driverPassword} onChange={(event) => setDriverPassword(event.target.value)} autoComplete="new-password" /></Field></div></fieldset><button className="button button-primary" disabled={busy || driverPassword.length < 6}>Registrar chofer</button></form></Panel>
      </TaskDisclosure>}
      {canManage && fleetTab === "vehicles" && <TaskDisclosure label="Agregar vehículo"><Panel title="Nuevo vehículo"><form className="stack" onSubmit={submitVehicle}><fieldset disabled={busy}><div className="form-grid">
          <Field label="Matrícula"><input required value={plate} onChange={(event) => setPlate(event.target.value)} /></Field>
          <Field label="Capacidad de peso (kg)"><input required type="number" min="0.001" step="0.001" value={capacityWeight} onChange={(event) => setCapacityWeight(event.target.value)} /></Field>
          <Field label="Capacidad de volumen (m³)"><input required type="number" min="0.000001" step="0.000001" value={capacityVolume} onChange={(event) => setCapacityVolume(event.target.value)} /></Field>
          <Field label="Odómetro"><input required type="number" min="0" step="1" value={odometer} onChange={(event) => setOdometer(event.target.value)} /></Field>
        </div></fieldset><button className="button button-primary" disabled={busy || !plate.trim() || !capacityWeight || !capacityVolume || !odometer}>Registrar vehículo</button></form></Panel>
      </TaskDisclosure>}
      {fleetTab === "vehicles" && <Panel title="Vehículos">
        {vehicles.length === 0 ? <EmptyState>No hay vehículos registrados.</EmptyState> : <div className="table-wrap"><table className="table"><thead><tr><th>Matrícula</th><th>Peso máximo</th><th>Volumen máximo</th><th>Odómetro</th><th>Estado</th></tr></thead><tbody>{vehicles.map((vehicle) => <tr key={vehicle.id}><td><strong>{vehicle.plate}</strong></td><td>{formatMeasure(vehicle.capacityWeightGrams == null ? null : vehicle.capacityWeightGrams/1000, "kg")}</td><td>{formatMeasure(vehicle.capacityVolumeCm3 == null ? null : vehicle.capacityVolumeCm3/1_000_000, "m³")}</td><td>{vehicle.odometer == null ? "Sin declarar" : new Intl.NumberFormat("es").format(vehicle.odometer)}</td><td><StateBadge value={availabilityLabel(vehicle.available)} /></td></tr>)}</tbody></table></div>}
      </Panel>}
      {fleetTab === 'documents' && <nav className="workspace-tabs secondary-tabs" aria-label="Tipo de documentos"><button aria-pressed={documentTarget==='vehicles'} onClick={()=>setDocumentTarget('vehicles')}>Vehículos</button><button aria-pressed={documentTarget==='drivers'} onClick={()=>setDocumentTarget('drivers')}>Choferes</button></nav>}
      {fleetTab === 'inspections' && <nav className="workspace-tabs secondary-tabs" aria-label="Controles de vehículos"><button aria-pressed={inspectionTarget==='inspections'} onClick={()=>setInspectionTarget('inspections')}>Registrar inspección</button><button aria-pressed={inspectionTarget==='defects'} onClick={()=>setInspectionTarget('defects')}>Defectos abiertos ({openDefects.length})</button></nav>}
      {fleetTab === "documents" && documentTarget === 'vehicles' && <Panel title="Documentos de vehículos">
          {vehicles.length === 0 ? <EmptyState>Registrá un vehículo primero.</EmptyState> : canManage ? <TaskDisclosure label="Agregar documento de vehículo"><form className="stack" onSubmit={submitDocument}><fieldset disabled={busy}>
            <Field label="Vehículo"><select value={selectedVehicle?.id ?? ""} onChange={(event) => setSelectedVehicleId(event.target.value)}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}</option>)}</select></Field>
            <Field label="Documento"><input required value={docName} onChange={(event) => setDocName(event.target.value)} /></Field>
            <Field label="Vencimiento" hint={timeZoneHint(data.organization.timezone)}><input required type="datetime-local" value={docExpiresAt} onChange={(event) => setDocExpiresAt(event.target.value)} /></Field>
            <label className="checkbox-field"><input type="checkbox" checked={blocksDispatch} onChange={(event) => setBlocksDispatch(event.target.checked)} /> Este documento bloquea el despacho si está vencido</label>
          </fieldset><button className="button button-secondary" disabled={busy || !docName.trim() || !docExpiresAt}>Agregar documento</button></form></TaskDisclosure> : <p className="muted">Solo administración y operaciones pueden registrar documentos.</p>}
          <div className="document-list">{data.documents.map((document) => <div className="document-row" key={document.id}><span><strong>{document.name}</strong><small>{vehicles.find((vehicle) => vehicle.id === document.vehicleId)?.plate ?? document.vehicleId} · vence {formatDate(document.expiresAt, data.organization.timezone)}</small></span>{document.blocksDispatch && <span className="badge badge-warning">Bloquea despacho</span>}</div>)}</div>
        </Panel>}
        {fleetTab === "inspections" && inspectionTarget === "inspections" && canManage && <Panel title="Inspección del vehículo">
          {vehicles.length === 0 ? <EmptyState>Registrá un vehículo primero.</EmptyState> : <form className="stack" onSubmit={submitInspection}><fieldset disabled={busy}>
            <Field label="Vehículo"><select value={selectedVehicle?.id ?? ""} onChange={(event) => setSelectedVehicleId(event.target.value)}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}</option>)}</select></Field>
            <div className="form-grid"><Field label="Odómetro observado"><input required type="number" min="0" step="1" value={inspectionOdometer} onChange={(event) => setInspectionOdometer(event.target.value)} /></Field><Field label="Combustible (%)"><input required type="number" min="0" max="100" step="1" value={fuelPercent} onChange={(event) => setFuelPercent(event.target.value)} /></Field></div>
            <div className="inspection-list"><div className="row"><h3>Controles</h3><button type="button" className="text-button" onClick={() => setInspectionItems((items) => [...items, { label: "", severity: "OK", note: "" }])}><Plus aria-hidden="true" />Agregar control</button></div>
              {inspectionItems.map((item, index) => <div className="inspection-item" key={index}><input aria-label="Nombre del control" placeholder="Control observado" value={item.label} onChange={(event) => setInspectionItems((items) => items.map((row, idx) => idx === index ? { ...row, label: event.target.value } : row))} /><select aria-label="Severidad" value={item.severity} onChange={(event) => setInspectionItems((items) => items.map((row, idx) => idx === index ? { ...row, severity: event.target.value as InspectionItem["severity"] } : row))}><option value="OK">OK</option><option value="MINOR">Menor</option><option value="CRITICAL">Crítico</option></select><input aria-label="Nota" placeholder="Nota (opcional)" value={item.note} onChange={(event) => setInspectionItems((items) => items.map((row, idx) => idx === index ? { ...row, note: event.target.value } : row))} /></div>)}
            </div>
          </fieldset><button className="button button-primary" disabled={busy || !inspectionOdometer || !fuelPercent || inspectionItems.every((item) => !item.label.trim())}>Guardar inspección</button></form>}
        </Panel>}
      {fleetTab === "inspections" && inspectionTarget === "defects" && <Panel title="Defectos" description="La resolución requiere una evidencia de la corrección.">
        {openDefects.length === 0 ? <EmptyState>No hay defectos abiertos registrados.</EmptyState> : <div className="stack">{openDefects.map((defect) => <div className="defect-row" key={defect.id}><span><strong>{vehicles.find((vehicle) => vehicle.id === defect.vehicleId)?.plate ?? defect.vehicleId} · {displayState(defect.severity)}</strong><small>{defect.note}</small></span><StateBadge value={defect.state} /></div>)}</div>}
        {canManage && openDefects.length > 0 && <div className="form-divider stack">
          <h3>Resolver defecto</h3>
          <Field label="Defecto"><select disabled={busy} value={selectedDefectId} onChange={(event) => { setSelectedDefectId(event.target.value); setDefectEvidenceId(""); setDefectEvidenceFile(null); }}><option value="">Seleccionar defecto abierto</option>{openDefects.map((defect) => <option value={defect.id} key={defect.id}>{vehicles.find((vehicle) => vehicle.id === defect.vehicleId)?.plate ?? defect.vehicleId} · {defect.severity}</option>)}</select></Field>
          <Field label="Foto de la corrección"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { setDefectEvidenceId(""); setDefectEvidenceFile(event.target.files?.[0] ?? null); }} /></Field>
          <button className="button button-secondary" type="button" disabled={busy || !selectedDefectId || !defectEvidenceFile || Boolean(defectEvidenceId)} onClick={uploadDefectEvidence}>{defectEvidenceId ? "Evidencia cargada" : "Cargar evidencia"}</button>
          <Field label="Nota de resolución"><input disabled={busy} value={defectNote} onChange={(event) => setDefectNote(event.target.value)} /></Field>
          <button className="button button-primary" disabled={busy || !selectedDefectId || !defectEvidenceId} onClick={() => void resolveDefect()}>Guardar resolución</button>
        </div>}
      </Panel>}
      {fleetTab === "drivers" && <Panel title="Choferes">{accountError&&<p role="alert" className="notice error">{accountError}</p>}<div className="table-wrap"><table className="table"><thead><tr><th>Nombre</th><th>Disponibilidad</th>{role==='ADMIN'&&<th>Acceso al OS</th>}</tr></thead><tbody>{data.drivers.map((driver) => {const account=driverAccounts.find(item=>item.driverId===driver.id);return <tr key={driver.id}><td>{driver.name}</td><td><StateBadge value={availabilityLabel(driver.available)} /></td>{role==='ADMIN'&&<td>{accountsLoading?'Consultando acceso…':accountError?'No disponible':account?<span className="inventory-actions"><span>{account.username} · {account.enabled?'Activo':'Suspendido'}</span>{account.enabled&&<AccountRecovery id={account.id}/>}<button type="button" className="button button-secondary" disabled={busy} onClick={async()=>{if(await action('/api/users/'+encodeURIComponent(account.id)+'/access',{enabled:!account.enabled},account.enabled?'Acceso suspendido.':'Acceso activado.'))setAccountsRevision(v=>v+1);}}>{account.enabled?'Suspender':'Activar'}</button></span>:<button type="button" className="button button-secondary" disabled={busy} onClick={()=>{setAccessDriverId(driver.id);setAccessUsername('');setAccessPassword('');}}>Crear acceso</button>}</td>}</tr>})}</tbody></table></div>{accessDriverId&&<form className="stack form-divider" onSubmit={createDriverAccess}><h3>Crear acceso para {data.drivers.find(d=>d.id===accessDriverId)?.name}</h3><p>El chofer conserva sus rutas y su historial.</p><div className="form-grid"><Field label="Usuario"><input required minLength={3} maxLength={100} value={accessUsername} onChange={e=>setAccessUsername(e.target.value)} autoComplete="off" /></Field><Field label="Contraseña inicial" hint="Mínimo 6 caracteres."><input required minLength={6} maxLength={200} type="password" value={accessPassword} onChange={e=>setAccessPassword(e.target.value)} autoComplete="new-password" /></Field></div><div className="inventory-actions"><button className="button button-primary" disabled={busy}>Crear acceso</button><button type="button" className="button button-secondary" disabled={busy} onClick={()=>{setAccessDriverId('');setAccessPassword('');}}>Cancelar</button></div></form>}</Panel>}
      {fleetTab === "documents" && documentTarget === "drivers" && <DriverDocumentsPanel drivers={data.drivers} documents={data.driverDocuments} timezone={data.organization.timezone} canManage={canManage} busy={busy} action={action} />}
      {fleetTab === "maintenance" && <MaintenancePanel vehicles={vehicles} maintenance={data.maintenance} timezone={data.organization.timezone} canManage={canManage} busy={busy} action={action} uploadEvidence={uploadEvidence} />}
    </>
  );
}

function TrackingView({ data, action, busy, onRefresh,onPrepareRoute }: { data: Bootstrap; action: Action; busy: boolean; onRefresh: () => Promise<void>; onPrepareRoute:()=>void }) {
  const [trackingTab,setTrackingTab] = useState('positions');
  const canManage = isOpsRole(data.user.role);
  return <>
    <SectionTitle eyebrow="SEGUIMIENTO" title="Tracking" description="Ubicación de tus repartos." action={canManage?<button type="button" className="button button-primary" onClick={onPrepareRoute}>Preparar chofer, vehículo y celular</button>:undefined} />
    <nav className="workspace-tabs" aria-label="Vistas de seguimiento"><button aria-pressed={trackingTab==='positions'} onClick={()=>setTrackingTab('positions')}>Mapa</button>{data.user.role==='ADMIN'&&<button aria-pressed={trackingTab==='clients'} onClick={()=>setTrackingTab('clients')}>Sistema por cliente</button>}{canManage&&<button aria-pressed={trackingTab==='operations'||trackingTab==='quad-settings'} onClick={()=>setTrackingTab('operations')}>Universo · QuadMinds</button>}</nav>
    {trackingTab === 'positions' && <QuadMindsPanel vehicles={data.vehicles} routes={data.routes} timezone={data.organization.timezone} canManage={false} action={action} busy={busy} />}
    {trackingTab === 'clients' && data.user.role==='ADMIN' && <ClientDeliveryPanel clients={data.clients} action={action} busy={busy}/> }
    {trackingTab === 'operations' && canManage && <QuadOperationsPanel shipments={data.shipments.map(({ id, reference }) => ({ id, reference }))} parcels={data.parcels.map(({ id, shipmentId, code }) => ({ id, shipmentId, code }))} routes={data.routes.map(({ id, name, state }) => ({ id, name, state }))} onRefresh={onRefresh} onConfigure={()=>setTrackingTab('quad-settings')} />}
    {trackingTab === 'quad-settings' && canManage && <div className="tracking-workspace"><div><button className="tracking-back" onClick={()=>setTrackingTab('operations')}>← Volver a QuadMinds</button></div><QuadMindsPanel configurationOnly vehicles={data.vehicles} routes={data.routes} timezone={data.organization.timezone} canManage={true} action={action} busy={busy}/></div>}

  </>;
}

function isClosed(value?: string | null): boolean {
  return /CLOSED|CLOSE|RESOLVED|DELIVERED|COMPLETE|COMPLETED|CANCELLED|CANCELED|ENTREGADO|CERRADO|RESUELTO|RECEIVED_BY_SENDER/i.test(value ?? "");
}

function isAvailable(value?: boolean | string): boolean {
  return value === true || String(value).toUpperCase() === "TRUE" || String(value).toUpperCase() === "AVAILABLE";
}

function availabilityLabel(value?: boolean | string): string {
  return value === true || String(value).toUpperCase() === "TRUE" || String(value).toUpperCase() === "AVAILABLE"
    ? "Disponible"
    : value === false || String(value).toUpperCase() === "FALSE"
      ? "No disponible"
      : "Sin disponibilidad informada";
}

function isOpsRole(role: Role): boolean {
  return role === "ADMIN" || role === "OPERATIONS";
}

function canDepotRole(role: Role): boolean {
  return isOpsRole(role) || role === "DEPOT";
}

function canRoadRole(role: Role): boolean {
  return isOpsRole(role) || role === "DRIVER";
}

function isFinalParcel(value?: string | null): boolean {
  return /DELIVERED|COMPLETE|MISSING|LOST|SENDER|ENTREGADO|FALTANTE|PERDIDO/i.test(value ?? "");
}

function isReceivedAndAtDepot(parcel: Parcel): boolean {
  return parcel.state === "RECEIVED" && parcel.custodyType === "DEPOT";
}

function canReceiveReturn(state: string): boolean {
  return state === "AUTHORIZED";
}

function canSendReturnToSender(state: string): boolean {
  return state === "AT_DEPOT";
}

function pageLabel(page: Page): string {
  const labels: Record<string, string> = { home: "Inicio", shipments: "Envíos", routes: "Rutas", fleet: "Flota", clients: "Clientes", company: "Empresa y equipo", tracking: "Tracking" };
  return labels[page] ?? ({ inventory: "Inventario", orders: "Pedidos", customerAccess: "Accesos cliente", billing: "Facturación" } as Partial<Record<Page, string>>)[page] ?? page;
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return "Ocurrió un error al comunicarse con el servidor.";
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("No se pudo leer el archivo."));
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    reportClientError('UI_ERROR','ErrorBoundary',undefined,sourcePosition(_error.stack));
  }

  render() {
    if (this.state.error) {
      return <main className="auth-shell"><section className="auth-card" role="alert"><p className="eyebrow">OS DE LOGÍSTICA</p><h1>No se pudo mostrar esta pantalla</h1><p className="muted">Recargá el espacio para volver a consultar los datos.</p><button className="button button-primary" onClick={() => window.location.reload()}>Recargar</button></section></main>;
    }
    return this.props.children;
  }
}

function App() {
  if(new URLSearchParams(window.location.hash.slice(1)).has('restablecer'))return <ErrorBoundary><PasswordReset/></ErrorBoundary>;
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}

export default App;
