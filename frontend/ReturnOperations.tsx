import { useState, type FormEvent } from "react";

type ReturnRecord = {
  id: string;
  parcelId: string;
  routeId: string;
  state: string;
  depotEvidenceId?: string | null;
  senderEvidenceId?: string | null;
};

type ReturnParcel = { id: string; code: string };
type EvidenceStage = "DEPOT" | "SENDER" | "CORRECTION";

type ReturnOperationsProps = {
  returns: ReturnRecord[];
  parcels: ReturnParcel[];
  action: (path: string, payload: Record<string, unknown>, message: string) => Promise<boolean>;
  busy: boolean;
  uploadEvidence: (parcelId: string | null, file: File) => Promise<string | null>;
  canCorrect: boolean;
};

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxEvidenceBytes = 5 * 1024 * 1024;

function stageKey(returnId: string, stage: EvidenceStage): string {
  return `${returnId}:${stage}`;
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    AUTHORIZED: "Autorizada",
    AT_DEPOT: "En depósito",
    SENT_TO_SENDER: "Entregada al remitente",
  };
  return labels[state] ?? state.replaceAll("_", " ");
}

function stateBadgeClass(state: string): string {
  if (state === "SENT_TO_SENDER") return "badge-success";
  if (state === "AT_DEPOT") return "badge-neutral";
  if (state === "AUTHORIZED") return "badge-warning";
  return "badge-neutral";
}

function EvidenceLink({ evidenceId, label }: { evidenceId?: string | null; label: string }) {
  if (!evidenceId) return null;
  return (
    <a href={"/api/evidence/" + encodeURIComponent(evidenceId)} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export default function ReturnOperations({
  returns,
  parcels,
  action,
  busy,
  uploadEvidence,
  canCorrect,
}: ReturnOperationsProps) {
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [receiverNames, setReceiverNames] = useState<Record<string, string>>({});
  const [correctionNotes, setCorrectionNotes] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [stagedEvidenceIds, setStagedEvidenceIds] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setError = (key: string, message: string) => {
    setErrors((current) => ({ ...current, [key]: message }));
  };

  const selectFile = (key: string, file?: File) => {
    setFiles((current) => ({ ...current, [key]: file }));
    setStagedEvidenceIds((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setError(key, "");
  };

  const uploadForStage = async (item: ReturnRecord, stage: EvidenceStage) => {
    const key = stageKey(item.id, stage);
    const file = files[key];
    if (!file) return;
    setError(key, "");
    if (!allowedImageTypes.has(file.type)) {
      setError(key, "Elegí una foto JPG, PNG o WebP.");
      return;
    }
    if (file.size > maxEvidenceBytes) {
      setError(key, "La foto debe pesar hasta 5 MB.");
      return;
    }

    setUploadingKey(key);
    try {
      const evidenceId = await uploadEvidence(item.parcelId, file);
      if (evidenceId) {
        setStagedEvidenceIds((current) => ({ ...current, [key]: evidenceId }));
      } else {
        setError(key, "No se pudo guardar la foto. Podés volver a intentarlo.");
      }
    } finally {
      setUploadingKey(null);
    }
  };

  const receiveAtDepot = async (event: FormEvent<HTMLFormElement>, item: ReturnRecord) => {
    event.preventDefault();
    const key = stageKey(item.id, "DEPOT");
    setError(key, "");
    const evidenceId = stagedEvidenceIds[key];
    if (!evidenceId) {
      setError(key, "Guardá la foto de recepción antes de registrar el ingreso.");
      return;
    }

    const ok = await action(
      "/api/returns/" + encodeURIComponent(item.id) + "/receive",
      { location: (locations[item.id] ?? "").trim(), evidenceId },
      "Recepción de devolución registrada.",
    );
    if (ok) {
      setLocations((current) => ({ ...current, [item.id]: "" }));
      setFiles((current) => ({ ...current, [key]: undefined }));
      setStagedEvidenceIds((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const sendToSender = async (event: FormEvent<HTMLFormElement>, item: ReturnRecord) => {
    event.preventDefault();
    const key = stageKey(item.id, "SENDER");
    setError(key, "");
    const evidenceId = stagedEvidenceIds[key];
    if (!evidenceId) {
      setError(key, "Guardá una foto distinta antes de confirmar la entrega al remitente.");
      return;
    }

    const ok = await action(
      "/api/returns/" + encodeURIComponent(item.id) + "/send-to-sender",
      { receiverName: (receiverNames[item.id] ?? "").trim(), evidenceId },
      "Entrega al remitente registrada.",
    );
    if (ok) {
      setReceiverNames((current) => ({ ...current, [item.id]: "" }));
      setFiles((current) => ({ ...current, [key]: undefined }));
      setStagedEvidenceIds((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const correctDepotEvidence = async (event: FormEvent<HTMLFormElement>, item: ReturnRecord) => {
    event.preventDefault();
    const key = stageKey(item.id, "CORRECTION");
    setError(key, "");
    const evidenceId = stagedEvidenceIds[key];
    if (!evidenceId) {
      setError(key, "Guardá la foto de subsanación antes de registrar la corrección.");
      return;
    }

    const ok = await action(
      "/api/returns/" + encodeURIComponent(item.id) + "/depot-evidence",
      { evidenceId, note: (correctionNotes[item.id] ?? "").trim() },
      "Subsanación de evidencia de depósito registrada.",
    );
    if (ok) {
      setCorrectionNotes((current) => ({ ...current, [item.id]: "" }));
      setFiles((current) => ({ ...current, [key]: undefined }));
      setStagedEvidenceIds((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const fileField = (item: ReturnRecord, stage: EvidenceStage, label: string, hint: string) => {
    const key = stageKey(item.id, stage);
    return (
      <label className="field">
        <span>{label}</span>
        <input
          key={key}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || uploadingKey !== null}
          onChange={(event) => selectFile(key, event.target.files?.[0] ?? undefined)}
        />
        <small className="field-hint">{hint} Formatos JPG, PNG o WebP; hasta 5 MB.</small>
        {stagedEvidenceIds[key] && (
          <small className="field-hint" role="status">
            <EvidenceLink evidenceId={stagedEvidenceIds[key]} label="Foto guardada y lista para vincular" />
          </small>
        )}
      </label>
    );
  };

  const uploadButton = (item: ReturnRecord, stage: EvidenceStage, label: string) => {
    const key = stageKey(item.id, stage);
    return (
      <button
        className="button button-secondary"
        type="button"
        disabled={busy || uploadingKey !== null || !files[key] || Boolean(stagedEvidenceIds[key])}
        onClick={() => void uploadForStage(item, stage)}
      >
        {uploadingKey === key ? "Guardando foto…" : stagedEvidenceIds[key] ? "Foto guardada" : label}
      </button>
    );
  };

  return (
    <div className="stack">
      {returns.length === 0 ? (
        <div className="card empty-state"><h3>Sin devoluciones</h3><p>Las devoluciones autorizadas aparecerán aquí.</p></div>
      ) : returns.map((item) => {
        const parcel = parcels.find((entry) => entry.id === item.parcelId);
        const depotKey = stageKey(item.id, "DEPOT");
        const senderKey = stageKey(item.id, "SENDER");
        const correctionKey = stageKey(item.id, "CORRECTION");
        const needsDepotCorrection = item.state === "AT_DEPOT" && !item.depotEvidenceId;

        return (
          <section className="card" key={item.id} aria-label={`Devolución ${parcel?.code ?? "sin código disponible"}`}>
            <div className="card-header">
              <div>
                <h2>{parcel?.code ?? "Bulto sin código disponible"}</h2>
                <p>Devolución · ruta vinculada</p>
              </div>
              <span className={`badge ${stateBadgeClass(item.state)}`}>{stateLabel(item.state)}</span>
            </div>

            <div className="stack stack-sm">
              {item.depotEvidenceId && <div><EvidenceLink evidenceId={item.depotEvidenceId} label="Ver foto de recepción en depósito" /></div>}
              {item.senderEvidenceId && <div><EvidenceLink evidenceId={item.senderEvidenceId} label="Ver foto de entrega al remitente" /></div>}
              {item.state === "SENT_TO_SENDER" && !item.depotEvidenceId && !item.senderEvidenceId && (
                <p className="muted">No hay enlaces de evidencia disponibles para esta devolución.</p>
              )}
            </div>

            {item.state === "AUTHORIZED" && (
              <form className="form-divider stack" onSubmit={(event) => void receiveAtDepot(event, item)}>
                <h3>Registrar recepción en depósito</h3>
                <fieldset disabled={busy || uploadingKey !== null}>
                  <div className="form-grid">
                    <label className="field">
                      <span>Ubicación de recepción</span>
                      <input required maxLength={500} value={locations[item.id] ?? ""} onChange={(event) => setLocations((current) => ({ ...current, [item.id]: event.target.value }))} />
                    </label>
                    {fileField(item, "DEPOT", "Foto de recepción", "La foto debe corresponder a este bulto.")}
                  </div>
                </fieldset>
                {errors[depotKey] && <div className="notice error" role="alert">{errors[depotKey]}</div>}
                <div className="row">
                  {uploadButton(item, "DEPOT", "Guardar foto")}
                  <button className="button button-primary" type="submit" disabled={busy || uploadingKey !== null || !locations[item.id]?.trim() || !stagedEvidenceIds[depotKey]}>
                    Confirmar recepción
                  </button>
                </div>
              </form>
            )}

            {needsDepotCorrection && canCorrect && (
              <form className="form-divider stack" onSubmit={(event) => void correctDepotEvidence(event, item)}>
                <h3>Subsanar evidencia de recepción</h3>
                <div className="notice">Esta devolución ya figura recibida. La foto y la nota se registrarán como subsanación, sin atribuir una fecha original.</div>
                <fieldset disabled={busy || uploadingKey !== null}>
                  <div className="form-grid">
                    {fileField(item, "CORRECTION", "Foto de subsanación", "Elegí una imagen que documente la recepción.")}
                    <label className="field">
                      <span>Nota de subsanación</span>
                      <textarea required maxLength={500} value={correctionNotes[item.id] ?? ""} onChange={(event) => setCorrectionNotes((current) => ({ ...current, [item.id]: event.target.value }))} />
                    </label>
                  </div>
                </fieldset>
                {errors[correctionKey] && <div className="notice error" role="alert">{errors[correctionKey]}</div>}
                <div className="row">
                  {uploadButton(item, "CORRECTION", "Guardar foto de subsanación")}
                  <button className="button button-primary" type="submit" disabled={busy || uploadingKey !== null || !correctionNotes[item.id]?.trim() || !stagedEvidenceIds[correctionKey]}>
                    Registrar subsanación
                  </button>
                </div>
              </form>
            )}

            {needsDepotCorrection && !canCorrect && (
              <div className="form-divider notice">Falta la evidencia de recepción en depósito. Solo Operaciones puede subsanar este registro.</div>
            )}

            {item.state === "AT_DEPOT" && item.depotEvidenceId && (
              <form className="form-divider stack" onSubmit={(event) => void sendToSender(event, item)}>
                <h3>Registrar entrega al remitente</h3>
                <fieldset disabled={busy || uploadingKey !== null}>
                  <div className="form-grid">
                    <label className="field">
                      <span>Nombre de quien recibe</span>
                      <input required maxLength={500} value={receiverNames[item.id] ?? ""} onChange={(event) => setReceiverNames((current) => ({ ...current, [item.id]: event.target.value }))} />
                    </label>
                    {fileField(item, "SENDER", "Foto de entrega", "Debe ser una foto independiente de la recepción en depósito.")}
                  </div>
                </fieldset>
                {errors[senderKey] && <div className="notice error" role="alert">{errors[senderKey]}</div>}
                <div className="row">
                  {uploadButton(item, "SENDER", "Guardar foto de entrega")}
                  <button className="button button-primary" type="submit" disabled={busy || uploadingKey !== null || !receiverNames[item.id]?.trim() || !stagedEvidenceIds[senderKey]}>
                    Confirmar entrega al remitente
                  </button>
                </div>
              </form>
            )}

            {item.state === "SENT_TO_SENDER" && (
              <div className="form-divider stack stack-sm">
                <h3>Registro final</h3>
                <p className="muted">Esta devolución está cerrada y sus evidencias quedan disponibles en los enlaces privados.</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
