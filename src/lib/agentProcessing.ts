import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./demoFs";
import { ProcessingMode, Settings } from "./settings";

export type Processor = Exclude<ProcessingMode, "hybrid">;

export interface AgentSecretStatus {
  configured: boolean;
}

export interface ProcessingResult {
  jobId: string;
  processor: Processor;
  mode: "copy" | "review";
  prompt?: string;
  relativePath?: string;
  captureCount: number;
  omittedCount: number;
  message: string;
}

export interface ProcessingConfig {
  codexEnabled: boolean;
  agentZeroEnabled: boolean;
  agentZeroBaseUrl: string;
  agentZeroProject: string;
  requireExternalApproval: boolean;
  requireRuleApproval: boolean;
}

export const processingConfig = (settings: Settings): ProcessingConfig => ({
  codexEnabled: settings.codexEnabled,
  agentZeroEnabled: settings.agentZeroEnabled,
  agentZeroBaseUrl: settings.agentZeroBaseUrl,
  agentZeroProject: settings.agentZeroProject,
  requireExternalApproval: settings.requireExternalApproval,
  requireRuleApproval: settings.requireRuleApproval,
});

let demoTokenConfigured = false;

export async function agentZeroTokenStatus(): Promise<AgentSecretStatus> {
  if (!inTauri) return { configured: demoTokenConfigured };
  return invoke<AgentSecretStatus>("agent_zero_token_status");
}

export async function saveAgentZeroToken(token: string): Promise<AgentSecretStatus> {
  if (!inTauri) {
    demoTokenConfigured = Boolean(token.trim());
    return { configured: demoTokenConfigured };
  }
  return invoke<AgentSecretStatus>("save_agent_zero_token", { token });
}

export async function prepareInboxProcessing(
  vault: string,
  processor: Processor,
  settings: Settings,
  enabledObjects: string[],
): Promise<ProcessingResult> {
  if (!inTauri) {
    if (processor === "agent-zero") throw new Error("Agent Zero dispatch is available in the desktop app.");
    return {
      jobId: `demo-${Date.now()}`,
      processor,
      mode: "copy",
      prompt: "Process the Atlas demo Capture inbox using the configured system rules.",
      captureCount: 1,
      omittedCount: 0,
      message: "Demo Codex handoff prepared.",
    };
  }
  return invoke<ProcessingResult>("prepare_processing_job", {
    vault,
    processor,
    config: processingConfig(settings),
    enabledObjects,
  });
}

export async function completeProcessingJob(jobId: string): Promise<void> {
  if (!inTauri) return;
  await invoke("complete_processing_job", { jobId });
}

export async function copyProcessingPrompt(prompt: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable. Select and copy the handoff prompt manually.");
  }
  await navigator.clipboard.writeText(prompt);
}
