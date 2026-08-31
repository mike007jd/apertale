import React from "react";
import { createRoot } from "react-dom/client";
import { exposeDiagnostics, recordDiagnostic } from "./diagnostics";
// Scales first, so styles.css can only consume them and never redefine them.
import "./design/tokens.generated.css";
import "./styles.css";

exposeDiagnostics();

const isSharedBook = /^\/share\/[^/]+\/?$/u.test(window.location.pathname);
const root = document.getElementById("root");
if (!root) throw new Error("Apertale root element is missing.");

// Keep the server-delivered shell in place while the selected application
// chunk arrives. Rendering an empty React fallback here used to replace the
// useful first paint with a blank page for exactly the slow part of startup.
const rootApp = isSharedBook
  ? import("./SharedBookApp").then((module) => module.SharedBookApp)
  : import("./App").then((module) => module.App);

void rootApp.then((RootApp) => {
  createRoot(root).render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>,
  );
}).catch((error: unknown) => {
  const status = root.querySelector<HTMLElement>(".apertale-boot__status");
  if (status) status.textContent = "Apertale could not open. Reload to try again.";
  recordDiagnostic("app:load-failed", { message: error instanceof Error ? error.message : String(error) });
  console.error(error);
});
