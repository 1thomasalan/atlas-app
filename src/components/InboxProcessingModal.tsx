import { useMemo, useState } from "react";
import { ObjectTypeDef } from "../lib/objectTypes";
import {
  AgentSecretStatus,
  copyProcessingPrompt,
  prepareInboxProcessing,
  ProcessingResult,
  Processor,
} from "../lib/agentProcessing";
import { Settings } from "../lib/settings";

export default function InboxProcessingModal(props: {
  vaultPath: string;
  settings: Settings;
  types: ObjectTypeDef[];
  tokenStatus: AgentSecretStatus;
  preferredProcessor?: Processor;
  onClose: () => void;
  onComplete: () => void;
  toast: (message: string, ms?: number) => void;
}) {
  const [busy, setBusy] = useState<Processor | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [message, setMessage] = useState("Choose a processor for the next unclaimed Capture items.");
  const enabledLabels = useMemo(() => props.types.map((type) => type.plural), [props.types]);
  const mode = props.settings.processingMode;
  const showCodex = mode !== "agent-zero" || props.preferredProcessor === "codex";
  const showAgentZero = mode !== "codex" || props.preferredProcessor === "agent-zero";
  const codexReady = props.settings.codexEnabled;
  const agentZeroReady = props.settings.agentZeroEnabled && props.tokenStatus.configured;

  const run = async (processor: Processor) => {
    setBusy(processor);
    setResult(null);
    setMessage(processor === "codex" ? "Preparing a one-hour Codex lease…" : "Waiting for a scoped Agent Zero proposal…");
    try {
      const next = await prepareInboxProcessing(
        props.vaultPath,
        processor,
        props.settings,
        enabledLabels,
      );
      setResult(next);
      if (next.mode === "copy" && next.prompt) {
        try {
          await copyProcessingPrompt(next.prompt);
          setMessage(`Codex handoff copied for ${next.captureCount} Capture item${next.captureCount === 1 ? "" : "s"}${next.omittedCount ? `; ${next.omittedCount} remain unclaimed` : ""}.`);
        } catch {
          setMessage("Codex handoff prepared. Select and copy the prompt below.");
        }
      } else {
        setMessage(next.message);
        props.onComplete();
        props.toast(next.message);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not prepare that processing job.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="modal processing-modal">
        <span className="eyebrow" style={{ color: "var(--signal)" }}>Capture routing</span>
        <h2>Process Atlas files</h2>
        <p className="hint">{message}</p>

        <div className="processor-grid">
          {showCodex && (
            <button
              className={`processor-option ${props.preferredProcessor === "codex" ? "preferred" : ""}`}
              disabled={!codexReady || busy !== null}
              onClick={() => run("codex")}
            >
              <strong>Codex</strong>
              <span>Uses your local ChatGPT subscription. Atlas copies a scoped handoff prompt and leases only the listed Capture paths.</span>
              <i>{codexReady ? "Ready" : "Disabled in Settings"}</i>
            </button>
          )}
          {showAgentZero && (
            <button
              className={`processor-option ${props.preferredProcessor === "agent-zero" ? "preferred" : ""}`}
              disabled={!agentZeroReady || busy !== null}
              onClick={() => run("agent-zero")}
            >
              <strong>Agent Zero</strong>
              <span>Sends only the leased Capture content through A2A. The response is saved as a Review proposal.</span>
              <i>{agentZeroReady ? "Ready" : "Finish Agent Zero setup"}</i>
            </button>
          )}
        </div>

        {result?.prompt && (
          <div className="processing-handoff">
            <div className="processing-handoff-head">
              <span className="eyebrow">Codex handoff · job {result.jobId}</span>
              <button className="btn" onClick={() => copyProcessingPrompt(result.prompt!).then(
                () => props.toast("Codex handoff copied"),
                () => props.toast("Clipboard unavailable — select the prompt manually"),
              )}>Copy</button>
            </div>
            <textarea className="input processing-prompt" readOnly value={result.prompt} />
          </div>
        )}

        <div className="processing-boundary">
          <span>One-hour leases prevent duplicate claims.</span>
          <span>External actions and processing-rule changes require approval.</span>
        </div>
        <button className="btn" onClick={props.onClose}>Close</button>
      </div>
    </div>
  );
}
