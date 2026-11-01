import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {reportClientError,sourcePosition} from './diagnostics';
window.addEventListener('error',event=>reportClientError('UI_ERROR','window',undefined,sourcePosition(event.error instanceof Error?event.error.stack:undefined)));
window.addEventListener('unhandledrejection',event=>reportClientError('UNHANDLED_REJECTION','window',undefined,sourcePosition(event.reason instanceof Error?event.reason.stack:undefined)));
import "./fonts.css";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("No se encontró el elemento raíz de la aplicación.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
