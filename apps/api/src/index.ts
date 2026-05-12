import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { z } from "zod";
import { classifyTicket, createExecutionPlan, loadOpenTopConfig, type Ticket } from "@opentop/core";

const classifyBodySchema = z.object({
  id: z.string().default("manual-1"),
  title: z.string(),
  description: z.string().default(""),
  labels: z.array(z.string()).default([])
});

export function buildServer() {
  const server = Fastify({ logger: true });

  server.get("/health", async () => ({
    ok: true,
    service: "opentop-api"
  }));

  server.post("/classify", async (request) => {
    const body = classifyBodySchema.parse(request.body);
    const config = await loadOpenTopConfig();
    const ticket: Ticket = {
      id: body.id,
      source: "manual",
      title: body.title,
      description: body.description,
      labels: body.labels,
      status: "inbox"
    };
    const classification = classifyTicket(ticket, config);

    return {
      ticket,
      classification,
      executionPlan: createExecutionPlan({ ...ticket, classification }, config)
    };
  });

  return server;
}

const currentFile = fileURLToPath(import.meta.url);

if (process.argv[1] === currentFile) {
  const server = buildServer();
  const port = Number(process.env.PORT ?? 4317);

  await server.listen({ port, host: "0.0.0.0" });
}
