import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { exposeDiagnostics } from "./diagnostics";
import "./styles.css";

exposeDiagnostics();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
