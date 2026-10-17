import TaskDisclosure from './TaskDisclosure';
import { useState, type FormEvent } from "react";

type MaintenanceVehicle = {
  id: string;
  plate: string;
  odometer: number | null;
};

type MaintenanceItem = {
  id: string;
  vehicleId: string;
  description: string;
  dueAt: string | null;
  dueOdometer: number | null;
  state: string;
  completionNote?: string | null;
  evidenceId?: string | null;
};

type MaintenancePanelProps = {
  vehicles: MaintenanceVehicle[];
  maintenance: MaintenanceItem[];
  timezone: string;
  canManage: boolean;
  busy: boolean;
  action: (path: string, payload: Record<string, unknown>, message: string) => Promise<boolean>;
  uploadEvidence: (parcelId: string | null, file: File) => Promise<string | null>;
};

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxEvidenceBytes = 5 * 1024 * 1024;

function formatDate(value: string | null, timezone: string): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha inválida";

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
    return `${date.toISOString()} · zona ${timezone} no reconocida`;
  }
}

function formatOdometer(value: number | null): string {
  return value == null ? "Sin informar" : new Intl.NumberFormat("es").format(value);
}

function isCompleted(state: string): boolean {
  return /COMPLETED|COMPLETE|RESOLVED|CLOSED/i.test(state);
}

function MaintenanceState({ item, vehicle }: { item: MaintenanceItem; vehicle?: MaintenanceVehicle }) {
  if (isCompleted(item.state)) return <span className="badge badge-success">Completado</span>;

  const dateOverdue = item.dueAt != null && new Date(item.dueAt).getTime() <= Date.now();
  const odometerOverdue = item.dueOdometer != null
    && vehicle?.odometer != null
    && vehicle.odometer >= item.dueOdometer;

  if (dateOverdue || odometerOverdue) {
    const causes = [dateOverdue && "fecha", odometerOverdue && "kilometraje"].filter(Boolean).join(" y ");
    return <span className="badge badge-danger">Vencido por {causes}</span>;
  }

  if (item.state !== "OPEN") {
    return <span className="badge badge-neutral">{item.state.replaceAll("_", " ")}</span>;
  }
  return <span className="badge badge-warning">Programado</span>;
}

export default function MaintenancePanel({
  vehicles,
  maintenance,
  timezone,
  canManage,
  busy,
  action,
  uploadEvidence,
}: MaintenancePanelProps) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [dueOdometer, setDueOdometer] = useState("");
  const [createError, setCreateError] = useState("");
  const [selectedMaintenanceId, setSelectedMaintenanceId] = useState("");
  const [completionNotes, setCompletionNotes] = useState<Record<string, string>>({});
  const [completionFiles, setCompletionFiles] = useState<Record<string, File | undefined>>({});
  const [evidenceIds, setEvidenceIds] = useState<Record<string, string>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState("");

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId) ?? vehicles[0];
  const openMaintenance = maintenance.filter((item) => item.state === "OPEN");
  const selectedOpenItem = openMaintenance.find((item) => item.id === selectedMaintenanceId) ?? openMaintenance[0];
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "zona del dispositivo";

  const createMaintenance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError("");
    if (!selectedVehicle) return;
    if (!dueAt && !dueOdometer) {
      setCreateError("Indicá una fecha o un kilometraje de vencimiento.");
      return;
    }

    let dueAtIso: string | null = null;
    if (dueAt) {
      const date = new Date(dueAt);
      if (Number.isNaN(date.getTime())) {
        setCreateError("Revisá la fecha y hora de vencimiento.");
        return;
      }
      dueAtIso = date.toISOString();
    }

    const ok = await action(
      "/api/vehicles/" + encodeURIComponent(selectedVehicle.id) + "/maintenance",
      {
        description: description.trim(),
        dueAt: dueAtIso,
        dueOdometer: dueOdometer === "" ? null : Number(dueOdometer),
      },
      "Mantenimiento programado.",
    );
    if (ok) {
      setDescription("");
      setDueAt("");
      setDueOdometer("");
    }
  };

  const uploadCompletionEvidence = async () => {
    if (!selectedOpenItem) return;
    const file = completionFiles[selectedOpenItem.id];
    if (!file) return;
    setCompletionError("");
    if (!allowedImageTypes.has(file.type)) {
      setCompletionError("Elegí una foto JPG, PNG o WebP.");
      return;
    }
    if (file.size > maxEvidenceBytes) {
      setCompletionError("La foto debe pesar hasta 5 MB.");
      return;
    }

    setUploadingId(selectedOpenItem.id);
    try {
      const id = await uploadEvidence(null, file);
      if (id) {
        setEvidenceIds((current) => ({ ...current, [selectedOpenItem.id]: id }));
      } else {
        setCompletionError("No se pudo guardar la foto. Podés volver a intentarlo.");
      }
    } finally {
      setUploadingId(null);
    }
  };

  const completeMaintenance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCompletionError("");
    if (!selectedOpenItem) return;
    const evidenceId = evidenceIds[selectedOpenItem.id];
    if (!evidenceId) {
      setCompletionError("Cargá la foto de la tarea antes de completar el mantenimiento.");
      return;
    }

    const ok = await action(
      "/api/maintenance/" + encodeURIComponent(selectedOpenItem.id) + "/complete",
      { evidenceId, note: (completionNotes[selectedOpenItem.id] ?? "").trim() },
      "Mantenimiento completado con evidencia.",
    );
    if (ok) {
      setCompletionNotes((current) => {
        const next = { ...current };
        delete next[selectedOpenItem.id];
        return next;
      });
      setCompletionFiles((current) => {
        const next = { ...current };
        delete next[selectedOpenItem.id];
        return next;
      });
      setEvidenceIds((current) => {
        const next = { ...current };
        delete next[selectedOpenItem.id];
        return next;
      });
      setSelectedMaintenanceId("");
    }
  };

  return (
    <div className="stack stack-lg">
      {canManage && (
        <TaskDisclosure label="Programar mantenimiento"><section className="card" aria-labelledby="maintenance-create-title">
          <div className="card-header">
            <div>
              <h2 id="maintenance-create-title">Programar mantenimiento</h2>
              <p>Registrá el trabajo y al menos un criterio de vencimiento.</p>
            </div>
          </div>
          {vehicles.length === 0 ? (
            <div className="empty-state"><p>Registrá un vehículo antes de programar mantenimiento.</p></div>
          ) : (
            <form className="stack" onSubmit={createMaintenance}>
              <fieldset disabled={busy}>
                <div className="form-grid">
                  <label className="field">
                    <span>Vehículo</span>
                    <select value={selectedVehicle?.id ?? ""} onChange={(event) => setVehicleId(event.target.value)}>
                      {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Descripción del trabajo</span>
                    <input required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Fecha y hora de vencimiento (opcional)</span>
                    <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
                    <small className="field-hint">Hora del equipo · {deviceTimezone}.</small>
                  </label>
                  <label className="field">
                    <span>Kilometraje de vencimiento (opcional)</span>
                    <input type="number" min="0" step="1" inputMode="numeric" value={dueOdometer} onChange={(event) => setDueOdometer(event.target.value)} />
                    <small className="field-hint">Odómetro actual registrado: {formatOdometer(selectedVehicle?.odometer ?? null)} km.</small>
                  </label>
                </div>
              </fieldset>
              {createError && <div className="notice error" role="alert">{createError}</div>}
              <div><button className="button button-primary" type="submit" disabled={busy || !selectedVehicle || !description.trim() || (!dueAt && !dueOdometer)}>Programar mantenimiento</button></div>
            </form>
          )}
        </section></TaskDisclosure>
      )}

      <section className="card" aria-labelledby="maintenance-list-title">
        <div className="card-header">
          <div>
            <h2 id="maintenance-list-title">Mantenimientos registrados</h2>
            <p>Trabajos pendientes y completados.</p>
          </div>
          <span className="badge badge-neutral">{maintenance.length} registros</span>
        </div>
        {maintenance.length === 0 ? (
          <div className="empty-state"><h3>Sin mantenimientos registrados</h3><p>Los servicios programados aparecerán aquí.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Vehículo</th><th>Trabajo</th><th>Vencimiento</th><th>Odómetro actual</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {maintenance.map((item) => {
                  const vehicle = vehicles.find((entry) => entry.id === item.vehicleId);
                  return (
                    <tr key={item.id}>
                      <td><strong>{vehicle?.plate ?? item.vehicleId}</strong></td>
                      <td>
                        <strong>{item.description}</strong>
                        {item.completionNote && <small className="field-hint">Nota de cierre: {item.completionNote}</small>}
                        {item.evidenceId && <small><a href={"/api/evidence/" + encodeURIComponent(item.evidenceId)} target="_blank" rel="noreferrer">Ver foto de cierre</a></small>}
                      </td>
                      <td>
                        {item.dueAt && <div>{formatDate(item.dueAt, timezone)}</div>}
                        {item.dueOdometer != null && <div>{formatOdometer(item.dueOdometer)} km</div>}
                        {!item.dueAt && item.dueOdometer == null && <span className="muted">Sin vencimiento</span>}
                      </td>
                      <td>{formatOdometer(vehicle?.odometer ?? null)} km</td>
                      <td><MaintenanceState item={item} vehicle={vehicle} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && (
        <section className="card" aria-labelledby="maintenance-complete-title">
          <div className="card-header">
            <div>
              <h2 id="maintenance-complete-title">Completar mantenimiento</h2>
              <p>Adjuntá una foto privada de la tarea y una nota de cierre.</p>
            </div>
          </div>
          {openMaintenance.length === 0 ? (
            <div className="empty-state"><p>No hay mantenimientos abiertos para completar.</p></div>
          ) : (
            <form className="stack" onSubmit={completeMaintenance}>
              <fieldset disabled={busy || uploadingId !== null}>
                <div className="form-grid">
                  <label className="field">
                    <span>Mantenimiento</span>
                    <select value={selectedOpenItem?.id ?? ""} onChange={(event) => { setSelectedMaintenanceId(event.target.value); setCompletionError(""); }}>
                      {openMaintenance.map((item) => {
                        const vehicle = vehicles.find((entry) => entry.id === item.vehicleId);
                        return <option key={item.id} value={item.id}>{vehicle?.plate ?? item.vehicleId} · {item.description}</option>;
                      })}
                    </select>
                  </label>
                  <label className="field">
                    <span>Foto de la tarea completada</span>
                    <input
                      key={selectedOpenItem?.id}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        if (!selectedOpenItem) return;
                        setCompletionFiles((current) => ({ ...current, [selectedOpenItem.id]: event.target.files?.[0] }));
                        setEvidenceIds((current) => {
                          const next = { ...current };
                          delete next[selectedOpenItem.id];
                          return next;
                        });
                        setCompletionError("");
                      }}
                    />
                    <small className="field-hint">JPG, PNG o WebP; hasta 5 MB. Se conserva en la evidencia privada de la operación.</small>
                    {selectedOpenItem && evidenceIds[selectedOpenItem.id] && <small className="field-hint" role="status">Foto guardada y lista para vincular.</small>}
                  </label>
                  <label className="field">
                    <span>Nota de cierre</span>
                    <textarea required maxLength={500} value={selectedOpenItem ? completionNotes[selectedOpenItem.id] ?? "" : ""} onChange={(event) => {
                      if (selectedOpenItem) setCompletionNotes((current) => ({ ...current, [selectedOpenItem.id]: event.target.value }));
                    }} />
                  </label>
                </div>
              </fieldset>
              {completionError && <div className="notice error" role="alert">{completionError}</div>}
              <div className="row">
                <button className="button button-secondary" type="button" disabled={busy || uploadingId !== null || !selectedOpenItem || !completionFiles[selectedOpenItem.id] || Boolean(evidenceIds[selectedOpenItem.id])} onClick={() => void uploadCompletionEvidence()}>
                  {uploadingId === selectedOpenItem?.id ? "Guardando foto…" : evidenceIds[selectedOpenItem?.id ?? ""] ? "Foto guardada" : "Guardar foto"}
                </button>
                <button className="button button-primary" type="submit" disabled={busy || uploadingId !== null || !selectedOpenItem || !evidenceIds[selectedOpenItem.id] || !(completionNotes[selectedOpenItem.id] ?? "").trim()}>
                  Completar mantenimiento
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
