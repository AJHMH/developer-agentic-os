import type { OperationalEvent, OperationalIncident } from "@/types/operational";
import type { IncomingSignal } from "@/types/incoming-signal";
import type { WorkspaceData } from "../types";

export function OperationalIncidentInspector({
  selectedOperationalIncident,
  workspace,
  signals,
  onClose,
}: {
  selectedOperationalIncident: OperationalIncident & { events: OperationalEvent[] };
  workspace: WorkspaceData | null;
  signals: IncomingSignal[];
  onClose: () => void;
}) {
  return (
    <aside className="inspector-panel" aria-label="Operational Incident Inspector">
      <div className="inspector-header">
        <div>
          <span className="tiny">operational incident / {selectedOperationalIncident.status}</span>
          <h3>{selectedOperationalIncident.title}</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close operational incident inspector"
          onClick={onClose}
        >
          x
        </button>
      </div>
      <p className="inspector-line">
        Incident ID: <code>{selectedOperationalIncident.id}</code>
      </p>
      <p className="inspector-line">
        Repository:{" "}
        <code>
          {workspace?.repositories.find(
            (repository) => repository.id === selectedOperationalIncident.repositoryId
          )?.name ?? selectedOperationalIncident.repositoryId}
        </code>
      </p>
      <p className="inspector-line">
        Created: <code>{new Date(selectedOperationalIncident.createdAt).toLocaleString()}</code>
      </p>
      <p className="inspector-line">
        Updated: <code>{new Date(selectedOperationalIncident.updatedAt).toLocaleString()}</code>
      </p>
      <p className="inspector-line">
        Providers: <code>{selectedOperationalIncident.providers.join(", ")}</code>
      </p>
      {selectedOperationalIncident.failure ? (
        <div className="work-history">
          <span className="tiny">Failure details</span>
          <p className="inspector-line">
            <code>{selectedOperationalIncident.failure.message}</code>
          </p>
          <pre className="inspector-content">
            {JSON.stringify(selectedOperationalIncident.failure.details ?? {}, null, 2)}
          </pre>
        </div>
      ) : null}
      <div className="work-history">
        <span className="tiny">
          Linked signals ({selectedOperationalIncident.signalIds.length})
        </span>
        {signals
          .filter((signal) => selectedOperationalIncident.signalIds.includes(signal.id))
          .map((signal) => (
            <p className="inspector-line" key={signal.id}>
              <strong>{signal.title}</strong> <code>{signal.id}</code>
            </p>
          ))}
      </div>
      <div className="work-history">
        <span className="tiny">Evidence</span>
        {selectedOperationalIncident.events.map((event) => (
          <p className="inspector-line" key={event.id}>
            <strong>{event.title}</strong>{" "}
            <code>
              {event.provider} / {event.sourceId ?? "no source id"} /{" "}
              {new Date(event.observedAt).toLocaleString()}
            </code>
          </p>
        ))}
      </div>
    </aside>
  );
}
