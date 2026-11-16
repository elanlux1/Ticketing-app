export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory = 'billing' | 'bug' | 'feature' | 'account';
export type CommentRole = 'customer' | 'agent';

export interface TicketComment {
  id: string;
  author: string;
  body: string;
  role?: CommentRole;
  created_at: string;
}

export interface TicketTriageData {
  category: TicketCategory;
  priority: TicketPriority;
  recommended_status: TicketStatus;
  confidence: number;
  reasoning: string;
  suggested_reply: string;
  triaged_at: string;
  model: string;
}

export interface TicketRecord {
  id: string;
  title: string;
  description: string;
  requester_email: string;
  priority: TicketPriority;
  category: TicketCategory;
  status: TicketStatus;
  assignee: string | null;
  comments: TicketComment[];
  ai_triage?: TicketTriageData | null;
  reply_deadline_at?: string | null;
  auto_closed?: boolean;
  closed_at?: string | null;
  closed_reason?: string | null;
  parent_ticket_id?: string | null;
  superseded_by_ticket_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParameterTraceItem {
  param: string;
  location: 'body' | 'query' | 'path' | 'llm_output';
  raw_value: unknown;
  validated_value: unknown;
  pydantic_type: string;
  constraint: string;
  source: 'client' | 'default' | 'coerced' | 'rejected';
  status: 'pass' | 'defaulted' | 'fail';
  error_msg?: string;
}

export interface ApiTraceEntry {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  statusCode: number;
  pydanticModel: string;
  pydanticEngine: string;
  parameterTrace: ParameterTraceItem[];
  jsonSchema?: Record<string, unknown>;
  requestBody?: unknown;
  responseBody: unknown;
  timestamp: string;
}
