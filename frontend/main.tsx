import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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
