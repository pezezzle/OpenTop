"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveExecutionReview,
  approvePlanArtifact,
  approvePromptReview,
  completeProviderOauth,
  createTicket,
  createDraftPullRequest,
  disconnectProviderOauth,
  generateWorkerPlan,
  regeneratePlanArtifact,
  regeneratePromptReview,
  rejectExecutionReview,
  rejectPlanArtifact,
  rejectPromptReview,
  reopenTicket,
  resolveTicket,
  runWorkItem,
  runWorkerPlan,
  runTicket,
  startProviderOauth,
  updateBranchPolicy,
  updateContextSettings,
  updateProvider
} from "../lib/opentop-api";

function parseLabels(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "The requested action could not be completed.";
}

export async function createTicketAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const labels = parseLabels(formData.get("labels"));

  if (!title) {
    throw new Error("Missing title.");
  }

  const result = await createTicket({
    title,
    description,
    labels
  });

  revalidatePath("/");
  redirect(`/tickets/${result.ticket.id}?created=1`);
}

export async function runTicketAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");

  if (!ticketId) {
    throw new Error("Missing ticketId.");
  }

  const result = await runTicket(ticketId);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);

  if (result.status === "blocked") {
    const params = new URLSearchParams({
      run: "blocked",
      blocker: result.blocker,
      reason: result.reason
    });

    if (result.promptReview) {
      params.set("promptReviewId", result.promptReview.id);
      params.set("promptReviewStatus", result.promptReview.status);
    }

    if (result.planArtifact) {
      params.set("planArtifactId", result.planArtifact.id);
      params.set("planArtifactStatus", result.planArtifact.status);
    }

    redirect(`/tickets/${ticketId}?${params.toString()}`);
  }

  revalidatePath(`/executions/${result.execution.id}`);
  redirect(`/executions/${result.execution.id}?run=${result.status}`);
}

export async function approveExecutionReviewAction(formData: FormData) {
  const executionId = String(formData.get("executionId") ?? "").trim();
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();
  const overrideFailedChecks = String(formData.get("overrideFailedChecks") ?? "").trim() === "1";

  if (!executionId || !ticketId) {
    throw new Error("Missing execution review approval fields.");
  }

  await approveExecutionReview(executionId, reviewerComment || undefined, overrideFailedChecks);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath(`/executions/${executionId}`);
  redirect(`/executions/${executionId}?review=approved`);
}

export async function rejectExecutionReviewAction(formData: FormData) {
  const executionId = String(formData.get("executionId") ?? "").trim();
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();

  if (!executionId || !ticketId) {
    throw new Error("Missing execution review rejection fields.");
  }

  await rejectExecutionReview(executionId, reviewerComment || undefined);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath(`/executions/${executionId}`);
  redirect(`/executions/${executionId}?review=rejected`);
}

export async function createPullRequestAction(formData: FormData) {
  const executionId = String(formData.get("executionId") ?? "").trim();
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const overrideFailedChecks = String(formData.get("overrideFailedChecks") ?? "").trim() === "1";

  if (!executionId || !ticketId) {
    throw new Error("Missing pull request creation fields.");
  }

  try {
    await createDraftPullRequest(executionId, overrideFailedChecks);
    revalidatePath("/");
    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath(`/executions/${executionId}`);
    redirect(`/executions/${executionId}?pullRequest=created`);
  } catch (error) {
    const params = new URLSearchParams({
      pullRequest: "blocked",
      reason: getActionErrorMessage(error)
    });

    redirect(`/executions/${executionId}?${params.toString()}`);
  }
}

export async function resolveTicketAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const resolutionType = String(formData.get("resolutionType") ?? "").trim();
  const resolutionNote = String(formData.get("resolutionNote") ?? "").trim();

  if (!ticketId || !resolutionType) {
    throw new Error("Missing ticket resolution fields.");
  }

  await resolveTicket(ticketId, {
    resolutionType: resolutionType as "done" | "manual_pr" | "no_pr",
    resolutionNote: resolutionNote || undefined
  });
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?ticket=resolved`);
}

export async function reopenTicketAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();

  if (!ticketId) {
    throw new Error("Missing ticketId.");
  }

  await reopenTicket(ticketId);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?ticket=reopened`);
}

export async function updateBranchPolicyAction(formData: FormData) {
  const scope = formData.get("scope");
  const value = formData.get("value");

  if ((scope !== "project" && scope !== "user") || typeof value !== "string") {
    throw new Error("Invalid branch policy update.");
  }

  await updateBranchPolicy(scope, value);
  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings");
}

export async function updateProviderAction(formData: FormData) {
  const providerId = String(formData.get("providerId") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const connectionMethod = String(formData.get("connectionMethod") ?? "").trim();
  const command = String(formData.get("command") ?? "").trim();
  const apiKeyEnv = String(formData.get("apiKeyEnv") ?? "").trim();
  const oauthProvider = String(formData.get("oauthProvider") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  const cheapModel = String(formData.get("cheapModel") ?? "").trim();
  const strongModel = String(formData.get("strongModel") ?? "").trim();
  const localModel = String(formData.get("localModel") ?? "").trim();

  if (!providerId || !type || !connectionMethod) {
    throw new Error("Missing provider setup fields.");
  }

  await updateProvider({
    providerId,
    type,
    connectionMethod: connectionMethod as "local_cli" | "api_key" | "oauth" | "custom_command" | "local_model",
    command: command || undefined,
    apiKeyEnv: apiKeyEnv || undefined,
    oauthProvider: oauthProvider || undefined,
    baseUrl: baseUrl || undefined,
    modelMappings: {
      ...(cheapModel ? { cheap: cheapModel } : {}),
      ...(strongModel ? { strong: strongModel } : {}),
      ...(localModel ? { local: localModel } : {})
    }
  });

  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings");
}

export async function startProviderOauthAction(formData: FormData) {
  const providerId = String(formData.get("providerId") ?? "").trim();

  if (!providerId) {
    throw new Error("Missing providerId.");
  }

  const result = await startProviderOauth(providerId);
  redirect(result.authorizationUrl);
}

export async function disconnectProviderOauthAction(formData: FormData) {
  const providerId = String(formData.get("providerId") ?? "").trim();

  if (!providerId) {
    throw new Error("Missing providerId.");
  }

  await disconnectProviderOauth(providerId);
  revalidatePath("/");
  revalidatePath("/settings");
  redirect(`/settings?oauth=disconnected&provider=${encodeURIComponent(providerId)}`);
}

export async function completeProviderOauthAction(input: {
  providerId: string;
  sessionId: string;
  code?: string;
  error?: string;
  errorDescription?: string;
}) {
  if (!input.providerId || !input.sessionId) {
    throw new Error("Missing OAuth callback fields.");
  }

  return completeProviderOauth(input.providerId, {
    sessionId: input.sessionId,
    code: input.code,
    error: input.error,
    errorDescription: input.errorDescription
  });
}

function parseProfileList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function updateContextSettingsAction(formData: FormData) {
  const scope = formData.get("scope");
  const profileMode = formData.get("profileMode");
  const learnedProfiles = parseProfileList(formData.get("learnedProfiles"));
  const userProfiles = parseProfileList(formData.get("userProfiles"));
  const maxPromptProfileWords = Number(formData.get("maxPromptProfileWords") ?? 900);
  const maxProfileSections = Number(formData.get("maxProfileSections") ?? 6);

  if (
    (scope !== "project" && scope !== "user") ||
    (profileMode !== "project-first" &&
      profileMode !== "profile-first" &&
      profileMode !== "project-only" &&
      profileMode !== "profile-only" &&
      profileMode !== "manual")
  ) {
    throw new Error("Invalid context settings update.");
  }

  await updateContextSettings({
    scope,
    learnedProfiles,
    userProfiles,
    profileMode,
    maxPromptProfileWords,
    maxProfileSections
  });

  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings");
}

export async function approvePromptReviewAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const promptReviewId = String(formData.get("promptReviewId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();

  if (!ticketId || !promptReviewId) {
    throw new Error("Missing prompt review approval fields.");
  }

  await approvePromptReview(ticketId, promptReviewId, reviewerComment || undefined);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?prompt=approved`);
}

export async function rejectPromptReviewAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const promptReviewId = String(formData.get("promptReviewId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();

  if (!ticketId || !promptReviewId) {
    throw new Error("Missing prompt review rejection fields.");
  }

  await rejectPromptReview(ticketId, promptReviewId, reviewerComment || undefined);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?prompt=rejected`);
}

export async function regeneratePromptReviewAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();

  if (!ticketId) {
    throw new Error("Missing prompt review regeneration fields.");
  }

  await regeneratePromptReview(ticketId, reviewerComment || undefined);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?prompt=regenerated`);
}

export async function approvePlanArtifactAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const planArtifactId = String(formData.get("planArtifactId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();

  if (!ticketId || !planArtifactId) {
    throw new Error("Missing plan approval fields.");
  }

  await approvePlanArtifact(ticketId, planArtifactId, reviewerComment || undefined);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?plan=approved`);
}

export async function rejectPlanArtifactAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const planArtifactId = String(formData.get("planArtifactId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();

  if (!ticketId || !planArtifactId) {
    throw new Error("Missing plan rejection fields.");
  }

  await rejectPlanArtifact(ticketId, planArtifactId, reviewerComment || undefined);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?plan=rejected`);
}

export async function regeneratePlanArtifactAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();

  if (!ticketId) {
    throw new Error("Missing plan regeneration fields.");
  }

  const result = await regeneratePlanArtifact(ticketId, reviewerComment || undefined);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);

  if (result.status === "blocked") {
    const params = new URLSearchParams({
      plan: "blocked",
      blocker: result.blocker,
      reason: result.reason
    });
    redirect(`/tickets/${ticketId}?${params.toString()}`);
  }

  revalidatePath(`/executions/${result.execution.id}`);
  redirect(`/executions/${result.execution.id}?run=${result.status}`);
}

export async function generateWorkerPlanAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const reviewerComment = String(formData.get("reviewerComment") ?? "").trim();

  if (!ticketId) {
    throw new Error("Missing worker plan generation fields.");
  }

  await generateWorkerPlan(ticketId, reviewerComment || undefined);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?workerPlan=generated`);
}

export async function runWorkerPlanAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();

  if (!ticketId) {
    throw new Error("Missing worker plan run fields.");
  }

  const result = await runWorkerPlan(ticketId);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}?workerRun=${result.status}`);
}

export async function runWorkItemAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "").trim();
  const workItemId = String(formData.get("workItemId") ?? "").trim();

  if (!ticketId || !workItemId) {
    throw new Error("Missing work-item run fields.");
  }

  const result = await runWorkItem(workItemId);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);

  if (result.execution) {
    revalidatePath(`/executions/${result.execution.id}`);
    redirect(`/executions/${result.execution.id}?run=${result.status}&ticketId=${ticketId}`);
  }

  redirect(`/tickets/${ticketId}?workerRun=${result.status}`);
}
