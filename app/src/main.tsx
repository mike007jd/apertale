import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { exposeDiagnostics } from "./diagnostics";
import "./styles.css";

exposeDiagnostics();

const isSharedBook = /^\/share\/[^/]+\/?$/u.test(window.location.pathname);
const RootApp = isSharedBook
  ? lazy(() => import("./SharedBookApp").then((module) => ({ default: module.SharedBookApp })))
  : lazy(() => import("./App").then((module) => ({ default: module.App })));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<main className="app-shell" role="status" aria-label="Opening Apertale" />}>
      <RootApp />
    </Suspense>
  </React.StrictMode>,
);
