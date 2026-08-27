type DiagnosticEvent = {
  at: string;
  type: string;
  detail: Record<string, string | number | boolean | null>;
};

const MAX_EVENTS = 120;
const events: DiagnosticEvent[] = [];
let diagnosticsNode: HTMLScriptElement | null = null;

function readSharedEvents() {
  if (
    typeof document === "undefined"
    || typeof document.getElementById !== "function"
    || typeof HTMLScriptElement === "undefined"
  ) return events;
  const node = diagnosticsNode ?? document.getElementById("apertale-diagnostics");
  if (!(node instanceof HTMLScriptElement)) return events;
  try {
    const parsed = JSON.parse(node.textContent ?? "[]") as DiagnosticEvent[];
    return Array.isArray(parsed) ? parsed : events;
  } catch {
    return events;
  }
}

function syncDiagnosticsNode() {
  if (
    typeof document === "undefined"
    || typeof document.getElementById !== "function"
    || typeof HTMLScriptElement === "undefined"
  ) return;
  const node = diagnosticsNode ?? document.getElementById("apertale-diagnostics");
  if (node instanceof HTMLScriptElement) node.textContent = JSON.stringify(events);
}

export function recordDiagnostic(type: string, detail: DiagnosticEvent["detail"] = {}) {
  const sharedEvents = readSharedEvents();
  if (sharedEvents !== events) events.splice(0, events.length, ...sharedEvents);
  events.push({ at: new Date().toISOString(), type, detail: { ...detail } });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  syncDiagnosticsNode();
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
    value: () => readSharedEvents().map((event) => ({ ...event, detail: { ...event.detail } })),
  });
}

declare global {
  interface Window {
    apertaleDiagnostics?: () => DiagnosticEvent[];
  }
}
