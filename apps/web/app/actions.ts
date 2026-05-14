"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createTicket, runTicket, updateBranchPolicy } from "../lib/opentop-api";

function parseLabels(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
    redirect(`/tickets/${ticketId}?run=blocked`);
  }

  revalidatePath(`/executions/${result.execution.id}`);
  redirect(`/executions/${result.execution.id}?run=${result.status}`);
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
