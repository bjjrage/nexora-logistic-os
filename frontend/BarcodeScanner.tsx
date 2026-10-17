import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Camera, CameraOff, ScanLine } from "lucide-react";

type ScanProps = {
  onScan: (code: string) => void;
  disabled?: boolean;
  label?: string;
  focusSignal?: number;
};

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

function getDetector(): DetectorConstructor | null {
  return (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector ?? null;
}

function isSecureCameraContext(): boolean {
  return window.isSecureContext || ["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname);
}

function cameraUnavailableReason(): string {
  if (!isSecureCameraContext()) return "Cámara disponible solo con HTTPS o localhost.";
  if (!getDetector()) return "Este navegador no ofrece lectura de códigos con BarcodeDetector.";
  if (!navigator.mediaDevices?.getUserMedia) return "Este navegador no permite acceso a la cámara.";
  return "";
}

export default function BarcodeScanner({ onScan, disabled = false, label = "Código de barras", focusSignal }: ScanProps) {
  const helpId = useId();
  const [value, setValue] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraAwaitingRemoval, setCameraAwaitingRemoval] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const onScanRef = useRef(onScan);
  const disabledRef = useRef(disabled);
  const mountedRef = useRef(true);
  const detectingRef = useRef(false);
  const cameraLockedRef = useRef(false);
  const emptyFramesRef = useRef(0);
  const startingRef = useRef(false);
  const cameraUnavailable = cameraUnavailableReason();
  onScanRef.current = onScan;
  disabledRef.current = disabled;

  useEffect(() => {
    if (focusSignal !== undefined && !disabled) inputRef.current?.focus();
  }, [focusSignal, disabled]);

  const stopCamera = () => {
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    cameraLockedRef.current = false;
    emptyFramesRef.current = 0;
    setCameraAwaitingRemoval(false);
    setCameraActive(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!disabled) return;
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    cameraLockedRef.current = false;
    emptyFramesRef.current = 0;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraAwaitingRemoval(false);
    setCameraActive(false);
  }, [disabled]);

  const startCamera = async () => {
    if (startingRef.current || disabledRef.current) return;
    setCameraMessage("");
    if (!isSecureCameraContext()) {
      setCameraMessage("La cámara requiere HTTPS o localhost. Podés usar un lector USB o ingresar el código manualmente.");
      return;
    }
    const DetectorApi = getDetector();
    if (!DetectorApi) {
      setCameraMessage("Este navegador no ofrece BarcodeDetector. Podés usar un lector USB o ingresar el código manualmente.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("Este navegador no permite acceso a la cámara. Usá un lector USB o ingresá el código manualmente.");
      return;
    }
    startingRef.current = true;
    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (!mountedRef.current || disabledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      cameraLockedRef.current = false;
      emptyFramesRef.current = 0;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (!mountedRef.current || disabledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
        return;
      }
      setCameraActive(true);
      const detector = new DetectorApi();
      timerRef.current = window.setInterval(() => {
        const video = videoRef.current;
        if (detectingRef.current || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        detectingRef.current = true;
        void detector.detect(video).then((results) => {
          const code = results.find((result) => result.rawValue?.trim())?.rawValue?.trim();
          if (!mountedRef.current || disabledRef.current) return;
          if (!code) {
            if (cameraLockedRef.current) {
              emptyFramesRef.current += 1;
              if (emptyFramesRef.current >= 3) {
                cameraLockedRef.current = false;
                emptyFramesRef.current = 0;
                setCameraAwaitingRemoval(false);
              }
            }
            return;
          }
          emptyFramesRef.current = 0;
          if (cameraLockedRef.current) return;
          cameraLockedRef.current = true;
          setCameraAwaitingRemoval(true);
          onScanRef.current(code);
        }).catch(() => {
          if (mountedRef.current) setCameraMessage("No se pudo leer el código con la cámara. Probá con lector USB o entrada manual.");
        }).finally(() => { detectingRef.current = false; });
      }, 240);
    } catch (error) {
      if (!mountedRef.current) return;
      const name = error instanceof DOMException ? error.name : "";
      const reason = name === "NotAllowedError" ? "No se autorizó el acceso a la cámara." : name === "NotFoundError" ? "No se encontró una cámara disponible." : "No se pudo iniciar la cámara.";
      setCameraMessage(reason + " Podés usar un lector USB o ingresar el código manualmente.");
      stopCamera();
    } finally {
      startingRef.current = false;
      if (mountedRef.current) setCameraStarting(false);
    }
  };

  const commitScan = () => {
    const code = value.trim();
    if (!code || disabled) return;
    onScan(code);
    setValue("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    commitScan();
  };

  return (
    <div className="barcode-scanner">
      <div className="barcode-entry">
        <label className="field">
          <span>{label}</span>
          <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={handleKeyDown} autoComplete="off" inputMode="text" placeholder="Escaneá con USB o escribí el código" disabled={disabled} />
          <small className="scanner-ready">Lector USB/Bluetooth · terminá cada lectura con Enter.</small>
        </label>
        <button className="button button-secondary" type="button" onClick={commitScan} disabled={disabled || !value.trim()}><ScanLine aria-hidden="true" />Agregar</button>
      </div>
      <div className="camera-controls">
        {cameraActive ? <button className="button button-secondary" type="button" onClick={stopCamera}><CameraOff aria-hidden="true" />Detener cámara</button> : <button className="button button-secondary" type="button" onClick={() => void startCamera()} disabled={disabled || cameraStarting || Boolean(cameraUnavailable)} title={cameraUnavailable || "La cámara solo se activa cuando pulsás este botón."} aria-describedby={helpId}><Camera aria-hidden="true" />{cameraStarting ? "Iniciando cámara…" : "Usar cámara"}</button>}
        <video ref={videoRef} className={cameraActive ? "barcode-video is-active" : "barcode-video"} muted playsInline aria-label="Vista de la cámara para leer códigos" />
      </div>
      <details className="barcode-help" id={helpId}><summary>Ayuda de lectura</summary><p>Conectá el lector en modo teclado (HID), enfocá el campo y configurá Enter al final de cada lectura.</p>{cameraUnavailable && <p>La cámara está deshabilitada: {cameraUnavailable}</p>}</details>
      {cameraActive && cameraAwaitingRemoval && <p className="barcode-message" role="status">Código leído. Retirá la etiqueta del encuadre; la cámara se rearmará cuando no detecte códigos durante tres lecturas.</p>}
      {cameraMessage && <p className="barcode-message" role="status">{cameraMessage}</p>}
    </div>
  );
}
