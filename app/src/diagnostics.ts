type DiagnosticEvent = {
  at: string;
  type: string;
  detail: Record<string, string | number | boolean | null>;
};

const MAX_EVENTS = 120;
const events: DiagnosticEvent[] = [];

export function recordDiagnostic(type: string, detail: DiagnosticEvent["detail"] = {}) {
  events.push({ at: new Date().toISOString(), type, detail: { ...detail } });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function exposeDiagnostics() {
  Object.defineProperty(window, "apertaleDiagnostics", {
    configurable: true,
    value: () => events.map((event) => ({ ...event, detail: { ...event.detail } })),
  });
}

declare global {
  interface Window {
    apertaleDiagnostics?: () => DiagnosticEvent[];
  }
}
