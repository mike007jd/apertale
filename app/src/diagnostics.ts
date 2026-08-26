export type DiagnosticEvent = {
  at: string;
  type: string;
  detail: Record<string, string | number | boolean | null>;
};

const MAX_EVENTS = 120;
const events: DiagnosticEvent[] = [];
let diagnosticsNode: HTMLScriptElement | null = null;

function syncDiagnosticsNode() {
  if (diagnosticsNode) diagnosticsNode.textContent = JSON.stringify(events);
}

export function recordDiagnostic(type: string, detail: DiagnosticEvent["detail"] = {}) {
  events.push({ at: new Date().toISOString(), type, detail: { ...detail } });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  syncDiagnosticsNode();
}

export function getDiagnostics() {
  return events.map((event) => ({ ...event, detail: { ...event.detail } }));
}

export function exposeDiagnostics() {
  document.getElementById("livingbook-diagnostics")?.remove();
  diagnosticsNode = document.createElement("script");
  diagnosticsNode.id = "livingbook-diagnostics";
  diagnosticsNode.type = "application/json";
  diagnosticsNode.textContent = "[]";
  document.head.appendChild(diagnosticsNode);
  Object.defineProperty(window, "livingBookDiagnostics", {
    configurable: true,
    value: getDiagnostics,
  });
}

declare global {
  interface Window {
    livingBookDiagnostics?: () => DiagnosticEvent[];
  }
}
