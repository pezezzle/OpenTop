"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runTicket, updateBranchPolicy } from "../lib/opentop-api";

export async function runTicketAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");

  if (!ticketId) {
    throw new Error("Missing ticketId.");
  }

  await runTicket(ticketId);
  revalidatePath("/");
  revalidatePath(`/tickets/${ticketId}`);
  redirect(`/tickets/${ticketId}`);
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
