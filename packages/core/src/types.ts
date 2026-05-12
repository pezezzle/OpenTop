import type {
  ComplexityLevel,
  ExecutionMode,
  ExecutionStatus,
  RiskLevel,
  TicketSource,
  TicketStatus
} from "@opentop/shared";

export interface Ticket {
  id: string;
  source: TicketSource;
  externalId?: string;
  title: string;
  description: string;
  labels: string[];
  status: TicketStatus;
  classification?: Classification;
}

export interface Classification {
  risk: RiskLevel;
  complexity: ComplexityLevel;
  affectedAreas: string[];
  suggestedProfile: string;
  suggestedModelTier: string;
  suggestedMode: ExecutionMode;
  approvalRequired: boolean;
  reason: string;
}

export interface AgentProfile {
  id: string;
  description?: string;
  mode: ExecutionMode;
  modelTier: string;
  requiresApproval: boolean;
  allowedCommands: string[];
}

export interface Execution {
  id: string;
  ticketId: string;
  profileId: string;
  providerId: string;
  modelId: string;
  status: ExecutionStatus;
  branchName: string;
  logs: string[];
  changedFiles: string[];
  pullRequestUrl?: string;
}

export interface ExecutionPlan {
  ticket: Ticket;
  classification: Classification;
  profile: AgentProfile;
  providerId: string;
  modelId: string;
  branchName: string;
}
