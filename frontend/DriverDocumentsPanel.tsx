import TaskDisclosure from './TaskDisclosure';
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";

export type DriverDocumentsPanelProps = {
  drivers: Array<{ id: string; name: string }>;
  documents: Array<{
    id: string;
    driverId: string;
    name: string;
    expiresAt: string;
    blocksDispatch: boolean;
  }>;
  timezone: string;
  canManage: boolean;
  busy: boolean;
  action: (path: string, payload: Record<string, unknown>, message: string) => Promise<boolean>;
};

function formatInZone(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Fecha inválida";

  try {
    return new Intl.DateTimeFormat("es", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("es", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(date);
  }
}

function expiryStatus(expiresAt: string, now: number): { label: string; tone: string } {
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry)) return { label: "Fecha inválida", tone: "badge-neutral" };
  if (expiry <= now) return { label: "Vencido", tone: "badge-danger" };
  return { label: "Vigente", tone: "badge-success" };
}

function futureIso(value: string): string | null {
  if (!value) return null;
  // datetime-local is interpreted in the device's local timezone by Date.
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now() ? date.toISOString() : null;
}

export default function DriverDocumentsPanel({
  drivers,
  documents,
  timezone,
  canManage,
  busy,
  action,
}: DriverDocumentsPanelProps) {
  const [driverId, setDriverId] = useState("");
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [blocksDispatch, setBlocksDispatch] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewalExpiresAt, setRenewalExpiresAt] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [renewalError, setRenewalError] = useState("");
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);
  const orderedDocuments = useMemo(
    () => [...documents].sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()),
    [documents],
  );
  const selectedDriverId = drivers.some((driver) => driver.id === driverId) ? driverId : (drivers[0]?.id ?? "");
  const disabled = busy || pending;

  const submitDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const date = new Date(expiresAt);
    const expiration = Number.isFinite(date.getTime()) ? date.toISOString() : null;
    if (!selectedDriverId || !name.trim() || !expiration) {
      setDocumentError(!expiration ? "Ingresá una fecha de vencimiento válida según la hora de este dispositivo." : "Seleccioná un chofer e ingresá el nombre del requisito.");
      return;
    }

    setDocumentError("");
    setPending(true);
    try {
      const saved = await action(
        `/api/drivers/${encodeURIComponent(selectedDriverId)}/documents`,
        { name: name.trim(), expiresAt: expiration, blocksDispatch },
        "Documento del chofer agregado.",
      );
      if (saved) {
        setName("");
        setExpiresAt("");
        setBlocksDispatch(false);
      }
    } finally {
      setPending(false);
    }
  };

  const submitRenewal = async (event: FormEvent<HTMLFormElement>, documentId: string) => {
    event.preventDefault();
    const expiration = futureIso(renewalExpiresAt);
    if (!expiration) {
      setRenewalError("Ingresá una nueva fecha futura según la hora de este dispositivo.");
      return;
    }

    setRenewalError("");
    setPending(true);
    try {
      const renewed = await action(
        `/api/driver-documents/${encodeURIComponent(documentId)}/renew`,
        { expiresAt: expiration },
        "Vencimiento del documento actualizado.",
      );
      if (renewed) {
        setRenewingId(null);
        setRenewalExpiresAt("");
      }
    } finally {
      setPending(false);
    }
  };

  const toggleRenewal = (documentId: string) => {
    setRenewalError("");
    setRenewalExpiresAt("");
    setRenewingId((current) => current === documentId ? null : documentId);
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Documentos de choferes</h2>
          <p>Vigencia y renovación de documentos.</p>
        </div>
      </div>

      {canManage && (
        <TaskDisclosure label="Agregar documento de chofer"><form className="stack" onSubmit={submitDocument}>
          <fieldset disabled={disabled}>
            <legend>Nuevo documento</legend>
            <div className="form-grid">
              <label className="field">
                <span>Chofer</span>
                <select required value={selectedDriverId} onChange={(event) => setDriverId(event.target.value)}>
                  {drivers.length === 0 && <option value="">No hay choferes registrados</option>}
                  {drivers.map((driver) => <option value={driver.id} key={driver.id}>{driver.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Documento</span>
                <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre del documento" />
              </label>
              <label className="field">
                <span>Vencimiento</span>
                <input required type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
                <small className="field-hint">La fecha y hora ingresadas usan la zona horaria de este dispositivo.</small>
              </label>
            </div>
            <label className="checkbox-field">
              <input type="checkbox" checked={blocksDispatch} onChange={(event) => setBlocksDispatch(event.target.checked)} />
              Este requisito bloquea el despacho cuando está vencido
            </label>
          </fieldset>
          {documentError && <div className="notice error" role="alert">{documentError}</div>}
          <button className="button button-primary" type="submit" disabled={disabled || drivers.length === 0 || !name.trim() || !expiresAt}>
            Agregar documento
          </button>
        </form></TaskDisclosure>
      )}

      {!canManage && <p className="muted">Solo administración y operaciones pueden agregar o renovar documentos.</p>}

      <div className="form-divider">
        <h3>Requisitos registrados</h3>
        {documents.length === 0 ? (
          <div className="empty-state">No hay documentos registrados para choferes.</div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Documentos de choferes">
              <thead>
                <tr>
                  <th>Chofer</th>
                  <th>Requisito</th>
                  <th>Vencimiento</th>
                  <th>Estado</th>
                  <th>Despacho</th>
                  {canManage && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {orderedDocuments.map((document) => {
                  const driver = drivers.find((candidate) => candidate.id === document.driverId);
                  const status = expiryStatus(document.expiresAt, now);
                  return (
                    <Fragment key={document.id}>
                      <tr>
                        <td>{driver?.name ?? "Chofer no disponible"}</td>
                        <td><strong>{document.name}</strong></td>
                        <td>{formatInZone(document.expiresAt, timezone)}</td>
                        <td><span className={`badge ${status.tone}`}>{status.label}</span></td>
                        <td>
                          {document.blocksDispatch
                            ? <span className={`badge ${status.label === "Vencido" ? "badge-danger" : "badge-warning"}`}>{status.label === "Vencido" ? "Bloquea despacho" : "Bloquea al vencer"}</span>
                            : <span className="badge badge-neutral">No bloquea</span>}
                        </td>
                        {canManage && <td><button className="button button-secondary" type="button" disabled={disabled} onClick={() => toggleRenewal(document.id)}>{renewingId === document.id ? "Cerrar" : "Renovar"}</button></td>}
                      </tr>
                      {canManage && renewingId === document.id && (
                        <tr>
                          <td colSpan={6}>
                            <form className="form-grid" onSubmit={(event) => void submitRenewal(event, document.id)}>
                              <label className="field">
                                <span>Nueva fecha de vencimiento</span>
                                <input required type="datetime-local" value={renewalExpiresAt} onChange={(event) => setRenewalExpiresAt(event.target.value)} />
                                <small className="field-hint">Se registra como renovación en el historial. La hora ingresada usa la zona horaria de este dispositivo.</small>
                              </label>
                              <button className="button button-primary" type="submit" disabled={disabled || !renewalExpiresAt}>Guardar renovación</button>
                            </form>
                            {renewalError && <div className="notice error" role="alert">{renewalError}</div>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

