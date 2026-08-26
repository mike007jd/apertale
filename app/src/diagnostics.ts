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
  document.getElementById("apertale-diagnostics")?.remove();
  diagnosticsNode = document.createElement("script");
  diagnosticsNode.id = "apertale-diagnostics";
  diagnosticsNode.type = "application/json";
  diagnosticsNode.textContent = "[]";
  document.head.appendChild(diagnosticsNode);
  Object.defineProperty(window, "apertaleDiagnostics", {
    configurable: true,
    value: getDiagnostics,
  });
}

declare global {
  interface Window {
    apertaleDiagnostics?: () => DiagnosticEvent[];
  }
}
