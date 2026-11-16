import 'dotenv/config';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { spawn } from 'child_process';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
type TicketCategory = 'billing' | 'bug' | 'feature' | 'account';
type CommentRole = 'customer' | 'agent';

const AUTO_CLOSE_DELAY_MS = 5 * 60 * 1000; // 5 minutes

interface TicketComment {
  id: string;
  author: string;
  body: string;
  role: CommentRole;
  created_at: string;
}

interface TicketTriageData {
  category: TicketCategory;
  priority: TicketPriority;
  recommended_status: TicketStatus;
  confidence: number;
  reasoning: string;
  suggested_reply: string;
  triaged_at: string;
  model: string;
}

interface TicketRecord {
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

interface ParameterTraceItem {
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

interface ValidationDetail {
  loc: string[];
  msg: string;
  type: string;
}

interface PydanticBridgeResult {
  valid: boolean;
  pydantic_engine: string;
  validated?: Record<string, unknown>;
  json_schema?: Record<string, unknown>;
  errors?: ValidationDetail[];
  parameter_trace: ParameterTraceItem[];
}

const VALID_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];

let nextTicketNumber = 108;

const seedNow = new Date().toISOString();
const ticketsStore = new Map<string, TicketRecord>([
  [
    'TKT-107',
    {
      id: 'TKT-107',
      title: 'refund',
      description: 'how many days can i expect my refund from my damaged item i sent back',
      requester_email: 'max@gmail.com',
      priority: 'medium',
      category: 'billing',
      status: 'in_progress',
      assignee: null,
      comments: [
        {
          id: 'CMT-1',
          author: 'Gemini Triage Draft',
          role: 'agent',
          body: 'Thank you for reaching out! Refunds are typically processed within 5 to 10 business days after we receive the returned item. Could you please reply with your order number so we can check the status for you?',
          created_at: '2026-11-16T17:28:30.846Z',
        },
        {
          id: 'CMT-2',
          author: 'max@gmail.com',
          role: 'customer',
          body: 'thanks thats all i wanted',
          created_at: '2026-11-16T17:28:47.055Z',
        },
      ],
      ai_triage: {
        category: 'billing',
        priority: 'medium',
        recommended_status: 'in_progress',
        confidence: 0.95,
        reasoning:
          'The requester is asking about the expected timeline for a refund on a returned damaged item, which is a billing inquiry.',
        suggested_reply:
          'Thank you for reaching out! Refunds are typically processed within 5 to 10 business days after we receive the returned item. Could you please reply with your order number so we can check the status for you?',
        triaged_at: '2026-11-16T17:27:52.033Z',
        model: 'gemini-4-hydrogen',
      },
      created_at: '2026-11-16T17:26:44.377Z',
      updated_at: '2026-11-16T17:29:35.930Z',
    },
  ],
  [
    'TKT-105',
    {
      id: 'TKT-105',
      title: 'refund',
      description: 'i want a refund',
      requester_email: 'max@gmail.com',
      priority: 'medium',
      category: 'billing',
      status: 'open',
      assignee: null,
      comments: [],
      ai_triage: null,
      created_at: '2026-11-16T16:43:57.893Z',
      updated_at: '2026-11-16T16:43:57.893Z',
    },
  ],
  [
    'TKT-101',
    {
      id: 'TKT-101',
      title: 'Duplicate charge on April invoice #8841',
      description:
        'Customer reports two $49.00 charges on their corporate card within 4 minutes after upgrading seats.',
      requester_email: 'maya.chen@northstar.io',
      priority: 'urgent',
      category: 'billing',
      status: 'open',
      assignee: 'Alex Rivera',
      comments: [
        {
          id: 'CMT-1',
          author: 'Alex Rivera',
          role: 'agent',
          body: 'Verified duplicate Stripe charge ID ch_3P9x. Preparing refund.',
          created_at: seedNow,
        },
      ],
      ai_triage: null,
      created_at: seedNow,
      updated_at: seedNow,
    },
  ],
  [
    'TKT-102',
    {
      id: 'TKT-102',
      title: 'PDF export fails for reports over 25 pages',
      description:
        'Clicking Export PDF returns a 504 timeout when the monthly audit report exceeds 25 pages.',
      requester_email: 'devon.patel@harborlabs.com',
      priority: 'high',
      category: 'bug',
      status: 'in_progress',
      assignee: 'Samira Khan',
      comments: [],
      ai_triage: null,
      created_at: seedNow,
      updated_at: seedNow,
    },
  ],
  [
    'TKT-103',
    {
      id: 'TKT-103',
      title: 'Add SSO role mapping for Okta groups',
      description:
        'Requesting automatic mapping from Okta security groups to workspace viewer and editor roles.',
      requester_email: 'it-ops@veridian.co',
      priority: 'medium',
      category: 'feature',
      status: 'resolved',
      assignee: 'Alex Rivera',
      comments: [
        {
          id: 'CMT-1',
          author: 'Alex Rivera',
          role: 'agent',
          body: 'Shipped group-to-role mapping under Workspace Settings -> Security.',
          created_at: seedNow,
        },
      ],
      ai_triage: null,
      created_at: seedNow,
      updated_at: seedNow,
    },
  ],
  [
    'TKT-104',
    {
      id: 'TKT-104',
      title: 'Unable to invite external contractor to billing portal',
      description:
        'Invite email bounces with domain restriction warning even after adding domain to allowlist.',
      requester_email: 'finance@kestrelworks.com',
      priority: 'low',
      category: 'account',
      status: 'open',
      assignee: null,
      comments: [],
      ai_triage: null,
      created_at: seedNow,
      updated_at: seedNow,
    },
  ],
]);

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function runPythonPydantic(
  modelName: 'TicketCreate' | 'TicketUpdate' | 'TicketCommentCreate' | 'TriageResult',
  payload: Record<string, unknown>
): Promise<PydanticBridgeResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, 'python_backend', 'validator_bridge.py');
    const proc = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`validator_bridge exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as PydanticBridgeResult);
      } catch (err) {
        reject(err);
      }
    });

    proc.stdin.write(JSON.stringify({ model: modelName, payload }));
    proc.stdin.end();
  });
}

function sweepExpiredTickets(): number {
  const nowMs = Date.now();
  let closedCount = 0;

  for (const [id, ticket] of ticketsStore.entries()) {
    if (
      ticket.status !== 'resolved' &&
      ticket.status !== 'closed' &&
      ticket.reply_deadline_at
    ) {
      const deadlineMs = Date.parse(ticket.reply_deadline_at);
      if (!Number.isNaN(deadlineMs) && nowMs >= deadlineMs) {
        const nowIso = new Date(nowMs).toISOString();
        const timeoutNote: TicketComment = {
          id: `CMT-${ticket.comments.length + 1}`,
          author: 'Auto-Close Timer',
          role: 'agent',
          body: 'Ticket auto-closed because no customer reply was received within the 5-minute window. Please create a new ticket to continue.',
          created_at: nowIso,
        };
        ticketsStore.set(id, {
          ...ticket,
          status: 'closed',
          auto_closed: true,
          closed_at: nowIso,
          closed_reason: 'No customer reply within 5 minutes',
          reply_deadline_at: null,
          comments: [...ticket.comments, timeoutNote],
          updated_at: nowIso,
        });
        closedCount++;
      }
    }
  }

  return closedCount;
}

async function executeGeminiTriage(
  existing: TicketRecord,
  mode: 'initial_open' | 'thread_update' = 'thread_update'
) {
  const modelName = 'gemini-4-hydrogen';
  const ai = getGeminiClient();

  const threadLines = existing.comments.map(
    (c) => `- [${(c.role ?? 'agent').toUpperCase()} - ${c.author}]: ${c.body}`
  );

  const promptText = [
    `Ticket ID: ${existing.id}`,
    `Current Status: ${existing.status}`,
    `Requester: ${existing.requester_email}`,
    `Title: ${existing.title}`,
    `Initial Description: ${existing.description}`,
    existing.parent_ticket_id
      ? `Follow-up context: Opened after auto-closed ticket ${existing.parent_ticket_id}.`
      : null,
    threadLines.length > 0
      ? `Conversation Thread (chronological):\n${threadLines.join('\n')}`
      : 'Conversation Thread: No replies yet.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemInstruction =
    mode === 'initial_open'
      ? 'You are a support ticket triage classifier and immediate first responder. A customer just opened this ticket. Write a warm, helpful initial response acknowledging their issue, giving concrete next steps or asking a specific clarifying question, and letting them know they have 5 minutes to reply before the ticket auto-closes. Always set recommended_status to "in_progress".'
      : 'You are a support ticket triage classifier and responder. Read the initial ticket and the entire conversation thread carefully. Reply directly to the latest customer message if one exists. Set recommended_status to "resolved" when the customer indicates their question is answered or resolved (e.g. "thanks thats all i wanted"), otherwise set recommended_status to "in_progress" and remind them if further info is needed within 5 minutes.';

  let geminiResponse;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      geminiResponse = await ai.models.generateContent({
        model: modelName,
        contents: promptText,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: {
                type: Type.STRING,
                enum: ['billing', 'bug', 'feature', 'account'],
                description: 'Best matching ticket category: billing, bug, feature, or account',
              },
              priority: {
                type: Type.STRING,
                enum: ['low', 'medium', 'high', 'urgent'],
                description: 'Recommended urgency level: low, medium, high, or urgent',
              },
              recommended_status: {
                type: Type.STRING,
                enum: ['open', 'in_progress', 'resolved'],
                description:
                  'Recommended ticket status: resolved if customer confirmed satisfied/done, otherwise in_progress',
              },
              confidence: {
                type: Type.NUMBER,
                description: 'Confidence score between 0.0 and 1.0',
              },
              reasoning: {
                type: Type.STRING,
                description: 'Short one-sentence explanation for the classification and status',
              },
              suggested_reply: {
                type: Type.STRING,
                description: 'Concise, polite response addressing the latest message in the thread',
              },
            },
            required: [
              'category',
              'priority',
              'recommended_status',
              'confidence',
              'reasoning',
              'suggested_reply',
            ],
          },
        },
      });
      break;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE');
      if (!isTransient || attempt === 2) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }

  if (!geminiResponse) {
    throw lastErr instanceof Error ? lastErr : new Error('Gemini request failed');
  }

  const rawText = (geminiResponse.text ?? '{}').trim();
  const rawParsed = JSON.parse(rawText) as Record<string, unknown>;
  const pydanticResult = await runPythonPydantic('TriageResult', rawParsed);

  return { modelName, rawParsed, pydanticResult };
}

async function applyInitialAutoGreeting(baseTicket: TicketRecord): Promise<{
  ticket: TicketRecord;
  triage: TicketTriageData | null;
  autoReplied: boolean;
  triageTraceItems: ParameterTraceItem[];
  modelLabel: string;
}> {
  let triage: TicketTriageData | null = null;
  let triageTraceItems: ParameterTraceItem[] = [];
  let modelLabel = 'TicketCreate -> TicketOut';

  if (process.env.GEMINI_API_KEY) {
    try {
      const { modelName, pydanticResult } = await executeGeminiTriage(baseTicket, 'initial_open');
      if (pydanticResult.valid && pydanticResult.validated) {
        const tv = pydanticResult.validated;
        const replyTime = new Date().toISOString();
        const deadlineIso = new Date(Date.now() + AUTO_CLOSE_DELAY_MS).toISOString();

        triage = {
          category: tv.category as TicketCategory,
          priority: tv.priority as TicketPriority,
          recommended_status: 'in_progress',
          confidence: Number(tv.confidence),
          reasoning: String(tv.reasoning),
          suggested_reply: String(tv.suggested_reply),
          triaged_at: replyTime,
          model: modelName,
        };

        const aiReplyComment: TicketComment = {
          id: `CMT-${baseTicket.comments.length + 1}`,
          author: 'Gemini Support',
          role: 'agent',
          body: triage.suggested_reply,
          created_at: replyTime,
        };

        const updated: TicketRecord = {
          ...baseTicket,
          category: triage.category,
          priority: triage.priority,
          status: 'in_progress',
          comments: [...baseTicket.comments, aiReplyComment],
          ai_triage: triage,
          reply_deadline_at: deadlineIso,
          updated_at: replyTime,
        };
        triageTraceItems = pydanticResult.parameter_trace;
        modelLabel = `TicketCreate + Gemini (${modelName}) -> TriageResult`;
        return {
          ticket: updated,
          triage,
          autoReplied: true,
          triageTraceItems,
          modelLabel,
        };
      }
    } catch {
      // Fall back to deterministic initial greeting if Gemini is temporarily unavailable
    }
  }

  const replyTime = new Date().toISOString();
  const deadlineIso = new Date(Date.now() + AUTO_CLOSE_DELAY_MS).toISOString();
  const fallbackBody =
    'Thank you for opening this ticket. Our support desk has received your request and is reviewing it now. Please reply within 5 minutes with any extra details before this ticket auto-closes.';
  const updated: TicketRecord = {
    ...baseTicket,
    status: 'in_progress',
    comments: [
      ...baseTicket.comments,
      {
        id: `CMT-${baseTicket.comments.length + 1}`,
        author: 'Support Auto-Responder',
        role: 'agent',
        body: fallbackBody,
        created_at: replyTime,
      },
    ],
    reply_deadline_at: deadlineIso,
    updated_at: replyTime,
  };
  return {
    ticket: updated,
    triage: null,
    autoReplied: true,
    triageTraceItems: [],
    modelLabel,
  };
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());

  app.get('/api/tickets', (req: Request, res: Response) => {
    sweepExpiredTickets();
    const rawStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
    const rawPriority = typeof req.query.priority === 'string' ? req.query.priority : undefined;
    const rawQ = typeof req.query.q === 'string' ? req.query.q : undefined;

    const queryTrace: ParameterTraceItem[] = [];
    const errors: ValidationDetail[] = [];

    if (rawStatus !== undefined) {
      const valid = VALID_STATUSES.includes(rawStatus as TicketStatus);
      queryTrace.push({
        param: 'status',
        location: 'query',
        raw_value: rawStatus,
        validated_value: valid ? rawStatus : null,
        pydantic_type: "Optional[Literal['open','in_progress','resolved','closed']]",
        constraint: 'Query(default=None)',
        source: valid ? 'client' : 'rejected',
        status: valid ? 'pass' : 'fail',
        error_msg: valid ? undefined : "Input should be 'open', 'in_progress', 'resolved' or 'closed'",
      });
      if (!valid) {
        errors.push({
          loc: ['query', 'status'],
          msg: "Input should be 'open', 'in_progress', 'resolved' or 'closed'",
          type: 'literal_error',
        });
      }
    } else {
      queryTrace.push({
        param: 'status',
        location: 'query',
        raw_value: undefined,
        validated_value: null,
        pydantic_type: 'Optional[TicketStatus]',
        constraint: 'Query(default=None)',
        source: 'default',
        status: 'defaulted',
      });
    }

    if (rawPriority !== undefined) {
      const valid = VALID_PRIORITIES.includes(rawPriority as TicketPriority);
      queryTrace.push({
        param: 'priority',
        location: 'query',
        raw_value: rawPriority,
        validated_value: valid ? rawPriority : null,
        pydantic_type: "Optional[Literal['low','medium','high','urgent']]",
        constraint: 'Query(default=None)',
        source: valid ? 'client' : 'rejected',
        status: valid ? 'pass' : 'fail',
        error_msg: valid ? undefined : "Input should be 'low', 'medium', 'high' or 'urgent'",
      });
      if (!valid) {
        errors.push({
          loc: ['query', 'priority'],
          msg: "Input should be 'low', 'medium', 'high' or 'urgent'",
          type: 'literal_error',
        });
      }
    } else {
      queryTrace.push({
        param: 'priority',
        location: 'query',
        raw_value: undefined,
        validated_value: null,
        pydantic_type: 'Optional[TicketPriority]',
        constraint: 'Query(default=None)',
        source: 'default',
        status: 'defaulted',
      });
    }

    if (rawQ !== undefined && rawQ.trim() !== '') {
      queryTrace.push({
        param: 'q',
        location: 'query',
        raw_value: rawQ,
        validated_value: rawQ.trim().toLowerCase(),
        pydantic_type: 'Optional[str]',
        constraint: 'Query(default=None)',
        source: 'coerced',
        status: 'pass',
      });
    }

    if (errors.length > 0) {
      res.status(422).json({
        detail: errors,
        trace: {
          method: 'GET',
          path: req.originalUrl,
          statusCode: 422,
          pydanticModel: 'Query Parameters -> list[TicketOut]',
          pydanticEngine: 'Python Pydantic v1.10.4',
          parameterTrace: queryTrace,
          responseBody: { detail: errors },
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    let items = Array.from(ticketsStore.values());
    if (rawStatus) items = items.filter((t) => t.status === rawStatus);
    if (rawPriority) items = items.filter((t) => t.priority === rawPriority);
    if (rawQ && rawQ.trim()) {
      const needle = rawQ.trim().toLowerCase();
      items = items.filter(
        (t) =>
          t.id.toLowerCase().includes(needle) ||
          t.title.toLowerCase().includes(needle) ||
          t.requester_email.toLowerCase().includes(needle)
      );
    }

    items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    res.json({
      tickets: items,
      trace: {
        method: 'GET',
        path: req.originalUrl,
        statusCode: 200,
        pydanticModel: 'Query(status, priority, q) -> list[TicketOut]',
        pydanticEngine: 'Python Pydantic v1.10.4',
        parameterTrace: queryTrace,
        responseBody: { count: items.length, ids: items.map((t) => t.id) },
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.post('/api/tickets', async (req: Request, res: Response) => {
    sweepExpiredTickets();
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = await runPythonPydantic('TicketCreate', body);

      if (!result.valid || !result.validated) {
        const errorResponse = { detail: result.errors ?? [] };
        res.status(422).json({
          ...errorResponse,
          trace: {
            method: 'POST',
            path: '/api/tickets',
            statusCode: 422,
            pydanticModel: 'TicketCreate -> TicketOut',
            pydanticEngine: result.pydantic_engine,
            parameterTrace: result.parameter_trace,
            jsonSchema: result.json_schema,
            requestBody: body,
            responseBody: errorResponse,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const now = new Date().toISOString();
      const id = `TKT-${nextTicketNumber++}`;
      const v = result.validated;
      const parentTicketId =
        typeof v.parent_ticket_id === 'string' && v.parent_ticket_id.trim()
          ? v.parent_ticket_id.trim()
          : null;

      let ticket: TicketRecord = {
        id,
        title: String(v.title).trim(),
        description: String(v.description).trim(),
        requester_email: String(v.requester_email).trim().toLowerCase(),
        priority: v.priority as TicketPriority,
        category: v.category as TicketCategory,
        status: 'open',
        assignee: null,
        comments: [],
        ai_triage: null,
        reply_deadline_at: null,
        auto_closed: false,
        closed_at: null,
        closed_reason: null,
        parent_ticket_id: parentTicketId,
        superseded_by_ticket_id: null,
        created_at: now,
        updated_at: now,
      };

      // Link closed parent ticket to this newly created follow-up ticket
      if (parentTicketId) {
        const parent = ticketsStore.get(parentTicketId);
        if (parent) {
          ticketsStore.set(parentTicketId, {
            ...parent,
            superseded_by_ticket_id: id,
            updated_at: now,
          });
        }
      }

      // Immediately auto-reply as soon as the ticket is open & start the 5-minute reply timer
      const greeted = await applyInitialAutoGreeting(ticket);
      ticket = greeted.ticket;
      const mergedTrace = [...result.parameter_trace, ...greeted.triageTraceItems];

      ticketsStore.set(id, ticket);
      res.status(201).json({
        ticket,
        triage: greeted.triage,
        auto_replied: greeted.autoReplied,
        trace: {
          method: 'POST',
          path: '/api/tickets',
          statusCode: 201,
          pydanticModel: greeted.modelLabel,
          pydanticEngine: result.pydantic_engine,
          parameterTrace: mergedTrace,
          jsonSchema: result.json_schema,
          requestBody: body,
          responseBody: ticket,
          timestamp: ticket.updated_at,
        },
      });
    } catch (err) {
      res.status(500).json({
        detail: err instanceof Error ? err.message : 'Python validator error',
      });
    }
  });

  app.post('/api/tickets/greet-open', async (_req: Request, res: Response) => {
    sweepExpiredTickets();
    const openTickets = Array.from(ticketsStore.values()).filter((t) => t.status === 'open');
    const greetedTickets: TicketRecord[] = [];
    const collectedTrace: ParameterTraceItem[] = [];

    for (const openTicket of openTickets) {
      const greeted = await applyInitialAutoGreeting(openTicket);
      ticketsStore.set(openTicket.id, greeted.ticket);
      greetedTickets.push(greeted.ticket);
      collectedTrace.push({
        param: openTicket.id,
        location: 'path',
        raw_value: 'open',
        validated_value: greeted.ticket.status,
        pydantic_type: 'TicketStatus',
        constraint: 'Auto-greet open ticket -> in_progress + 5m deadline',
        source: 'coerced',
        status: 'pass',
      });
    }

    const allItems = Array.from(ticketsStore.values()).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    );

    res.json({
      greeted_count: greetedTickets.length,
      greeted_tickets: greetedTickets,
      tickets: allItems,
      trace: {
        method: 'POST',
        path: '/api/tickets/greet-open',
        statusCode: 200,
        pydanticModel: 'BatchOpenGreet + Gemini -> TriageResult',
        pydanticEngine: 'Python Pydantic v1.10.4',
        parameterTrace: collectedTrace,
        responseBody: {
          greeted_count: greetedTickets.length,
          ids: greetedTickets.map((t) => t.id),
        },
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.post('/api/tickets/:id/triage', async (req: Request, res: Response) => {
    sweepExpiredTickets();
    const ticketId = String(req.params.id);
    const existing = ticketsStore.get(ticketId);
    if (!existing) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
      return;
    }

    if (existing.status === 'closed') {
      res.status(409).json({
        detail: `Ticket ${ticketId} was auto-closed after the 5-minute reply window expired. Please create a new ticket.`,
        code: 'TICKET_AUTO_CLOSED',
        requires_new_ticket: true,
        ticket: existing,
      });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(400).json({
        detail:
          'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.',
      });
      return;
    }

    try {
      const { modelName, pydanticResult } = await executeGeminiTriage(existing, 'thread_update');

      if (!pydanticResult.valid || !pydanticResult.validated) {
        const errorResponse = { detail: pydanticResult.errors ?? [] };
        res.status(422).json({
          ...errorResponse,
          trace: {
            method: 'POST',
            path: `/api/tickets/${ticketId}/triage`,
            statusCode: 422,
            pydanticModel: `Gemini (${modelName}) -> TriageResult`,
            pydanticEngine: pydanticResult.pydantic_engine,
            parameterTrace: pydanticResult.parameter_trace,
            jsonSchema: pydanticResult.json_schema,
            requestBody: {
              ticket_id: ticketId,
              title: existing.title,
              comment_count: existing.comments.length,
            },
            responseBody: errorResponse,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const v = pydanticResult.validated;
      const now = new Date().toISOString();
      const recommendedStatus = v.recommended_status as TicketStatus;
      const nextStatus: TicketStatus =
        recommendedStatus === 'open' || recommendedStatus === 'closed'
          ? 'in_progress'
          : recommendedStatus;

      const triage: TicketTriageData = {
        category: v.category as TicketCategory,
        priority: v.priority as TicketPriority,
        recommended_status: nextStatus,
        confidence: Number(v.confidence),
        reasoning: String(v.reasoning),
        suggested_reply: String(v.suggested_reply),
        triaged_at: now,
        model: modelName,
      };

      const nextDeadline =
        nextStatus === 'resolved'
          ? null
          : new Date(Date.now() + AUTO_CLOSE_DELAY_MS).toISOString();

      const hasAiGreeting = existing.comments.some((c) => c.author === 'Gemini Support');
      const shouldAppendReply =
        existing.status === 'open' || !hasAiGreeting;
      const nextComments = shouldAppendReply
        ? [
            ...existing.comments,
            {
              id: `CMT-${existing.comments.length + 1}`,
              author: 'Gemini Support',
              role: 'agent' as CommentRole,
              body: triage.suggested_reply,
              created_at: now,
            },
          ]
        : existing.comments;

      const updated: TicketRecord = {
        ...existing,
        category: triage.category,
        priority: triage.priority,
        status: nextStatus,
        comments: nextComments,
        ai_triage: triage,
        reply_deadline_at: nextDeadline,
        updated_at: now,
      };
      ticketsStore.set(ticketId, updated);

      res.json({
        ticket: updated,
        triage,
        trace: {
          method: 'POST',
          path: `/api/tickets/${ticketId}/triage`,
          statusCode: 200,
          pydanticModel: `Gemini (${modelName}) -> TriageResult`,
          pydanticEngine: pydanticResult.pydantic_engine,
          parameterTrace: pydanticResult.parameter_trace,
          jsonSchema: pydanticResult.json_schema,
          requestBody: {
            ticket_id: ticketId,
            title: existing.title,
            comment_count: existing.comments.length,
          },
          responseBody: triage,
          timestamp: now,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini triage failed';
      const isAuthError =
        msg.includes('API_KEY_INVALID') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('403') ||
        msg.includes('401');

      res.status(isAuthError ? 403 : 502).json({
        detail: isAuthError
          ? 'Gemini API rejected the key. Please check your GEMINI_API_KEY in Settings > Secrets.'
          : msg,
      });
    }
  });

  app.patch('/api/tickets/:id', async (req: Request, res: Response) => {
    sweepExpiredTickets();
    const ticketId = String(req.params.id);
    const existing = ticketsStore.get(ticketId);
    if (!existing) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (existing.status === 'closed' && body.status && body.status !== 'closed') {
      res.status(409).json({
        detail: `Ticket ${ticketId} was auto-closed after the 5-minute timeout and cannot be reopened. Please create a new ticket.`,
        code: 'TICKET_AUTO_CLOSED',
        requires_new_ticket: true,
        ticket: existing,
      });
      return;
    }

    try {
      const result = await runPythonPydantic('TicketUpdate', body);
      const pathItem: ParameterTraceItem = {
        param: 'ticket_id',
        location: 'path',
        raw_value: ticketId,
        validated_value: ticketId,
        pydantic_type: 'str',
        constraint: 'Path parameter matched',
        source: 'client',
        status: 'pass',
      };

      if (!result.valid || !result.validated) {
        const errorResponse = { detail: result.errors ?? [] };
        res.status(422).json({
          ...errorResponse,
          trace: {
            method: 'PATCH',
            path: `/api/tickets/${ticketId}`,
            statusCode: 422,
            pydanticModel: 'TicketUpdate -> TicketOut',
            pydanticEngine: result.pydantic_engine,
            parameterTrace: [pathItem, ...result.parameter_trace],
            requestBody: body,
            responseBody: errorResponse,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const v = result.validated;
      const now = new Date().toISOString();
      const nextStatus = (v.status as TicketStatus | null) ?? existing.status;
      const nextDeadline =
        nextStatus === 'resolved' || nextStatus === 'closed'
          ? null
          : existing.reply_deadline_at ?? null;

      const updated: TicketRecord = {
        ...existing,
        status: nextStatus,
        priority: (v.priority as TicketPriority | null) ?? existing.priority,
        category: (v.category as TicketCategory | null) ?? existing.category,
        assignee:
          body.assignee === undefined
            ? existing.assignee
            : v.assignee === null
            ? null
            : String(v.assignee).trim(),
        reply_deadline_at: nextDeadline,
        closed_at: nextStatus === 'closed' ? existing.closed_at ?? now : existing.closed_at ?? null,
        updated_at: now,
      };

      ticketsStore.set(ticketId, updated);
      res.json({
        ticket: updated,
        trace: {
          method: 'PATCH',
          path: `/api/tickets/${ticketId}`,
          statusCode: 200,
          pydanticModel: 'TicketUpdate -> TicketOut',
          pydanticEngine: result.pydantic_engine,
          parameterTrace: [pathItem, ...result.parameter_trace],
          requestBody: body,
          responseBody: updated,
          timestamp: now,
        },
      });
    } catch (err) {
      res.status(500).json({
        detail: err instanceof Error ? err.message : 'Python validator error',
      });
    }
  });

  app.post('/api/tickets/:id/comments', async (req: Request, res: Response) => {
    sweepExpiredTickets();
    const ticketId = String(req.params.id);
    const existing = ticketsStore.get(ticketId);
    if (!existing) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
      return;
    }

    if (existing.status === 'closed') {
      res.status(409).json({
        detail: `Ticket ${ticketId} was auto-closed due to the 5-minute reply timeout. Please create a new ticket.`,
        code: 'TICKET_AUTO_CLOSED',
        requires_new_ticket: true,
        ticket: existing,
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const autoReplyOnCustomer = body.auto_reply !== false;
    const commentPayload: Record<string, unknown> = {
      author: body.author,
      body: body.body,
      ...(body.role !== undefined ? { role: body.role } : {}),
    };

    try {
      const result = await runPythonPydantic('TicketCommentCreate', commentPayload);
      const pathItem: ParameterTraceItem = {
        param: 'ticket_id',
        location: 'path',
        raw_value: ticketId,
        validated_value: ticketId,
        pydantic_type: 'str',
        constraint: 'Path parameter matched',
        source: 'client',
        status: 'pass',
      };

      if (!result.valid || !result.validated) {
        const errorResponse = { detail: result.errors ?? [] };
        res.status(422).json({
          ...errorResponse,
          trace: {
            method: 'POST',
            path: `/api/tickets/${ticketId}/comments`,
            statusCode: 422,
            pydanticModel: 'TicketCommentCreate -> TicketOut',
            pydanticEngine: result.pydantic_engine,
            parameterTrace: [pathItem, ...result.parameter_trace],
            requestBody: commentPayload,
            responseBody: errorResponse,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const v = result.validated;
      const now = new Date().toISOString();
      const role = (v.role as CommentRole) ?? 'agent';
      const comment: TicketComment = {
        id: `CMT-${existing.comments.length + 1}`,
        author: String(v.author).trim(),
        body: String(v.body).trim(),
        role,
        created_at: now,
      };

      // Automatically move open tickets to in_progress on reply, or reopen resolved tickets when customer replies
      let nextStatus: TicketStatus = existing.status;
      if (existing.status === 'open') {
        nextStatus = 'in_progress';
      } else if (role === 'customer' && existing.status === 'resolved') {
        nextStatus = 'in_progress';
      }

      let updated: TicketRecord = {
        ...existing,
        status: nextStatus,
        comments: [...existing.comments, comment],
        reply_deadline_at:
          role === 'agent' && nextStatus !== 'resolved'
            ? new Date(Date.now() + AUTO_CLOSE_DELAY_MS).toISOString()
            : null,
        updated_at: now,
      };

      // If customer replied and Gemini key is available, automatically generate and post a contextual response
      if (role === 'customer' && autoReplyOnCustomer && process.env.GEMINI_API_KEY) {
        try {
          const { modelName, pydanticResult } = await executeGeminiTriage(updated, 'thread_update');
          if (pydanticResult.valid && pydanticResult.validated) {
            const tv = pydanticResult.validated;
            const replyTime = new Date().toISOString();
            const recommendedStatus = tv.recommended_status as TicketStatus;
            const resolvedStatus: TicketStatus =
              recommendedStatus === 'open' || recommendedStatus === 'closed'
                ? 'in_progress'
                : recommendedStatus;

            const triage: TicketTriageData = {
              category: tv.category as TicketCategory,
              priority: tv.priority as TicketPriority,
              recommended_status: resolvedStatus,
              confidence: Number(tv.confidence),
              reasoning: String(tv.reasoning),
              suggested_reply: String(tv.suggested_reply),
              triaged_at: replyTime,
              model: modelName,
            };

            const aiReplyComment: TicketComment = {
              id: `CMT-${updated.comments.length + 1}`,
              author: 'Gemini Support',
              role: 'agent',
              body: triage.suggested_reply,
              created_at: replyTime,
            };

            const nextDeadline =
              resolvedStatus === 'resolved'
                ? null
                : new Date(Date.now() + AUTO_CLOSE_DELAY_MS).toISOString();

            updated = {
              ...updated,
              category: triage.category,
              priority: triage.priority,
              status: resolvedStatus,
              comments: [...updated.comments, aiReplyComment],
              ai_triage: triage,
              reply_deadline_at: nextDeadline,
              updated_at: replyTime,
            };

            ticketsStore.set(ticketId, updated);
            res.status(201).json({
              ticket: updated,
              triage,
              auto_replied: true,
              trace: {
                method: 'POST',
                path: `/api/tickets/${ticketId}/comments`,
                statusCode: 201,
                pydanticModel: `TicketCommentCreate + Gemini (${modelName}) -> TriageResult`,
                pydanticEngine: pydanticResult.pydantic_engine,
                parameterTrace: [
                  ...result.parameter_trace,
                  ...pydanticResult.parameter_trace,
                ],
                jsonSchema: pydanticResult.json_schema,
                requestBody: commentPayload,
                responseBody: triage,
                timestamp: replyTime,
              },
            });
            return;
          }
        } catch {
          // If Gemini auto-reply fails transiently, still persist the customer's comment cleanly
        }
      }

      ticketsStore.set(ticketId, updated);
      res.status(201).json({
        ticket: updated,
        auto_replied: false,
        trace: {
          method: 'POST',
          path: `/api/tickets/${ticketId}/comments`,
          statusCode: 201,
          pydanticModel: 'TicketCommentCreate -> TicketOut',
          pydanticEngine: result.pydantic_engine,
          parameterTrace: [pathItem, ...result.parameter_trace],
          requestBody: commentPayload,
          responseBody: updated,
          timestamp: now,
        },
      });
    } catch (err) {
      res.status(500).json({
        detail: err instanceof Error ? err.message : 'Python validator error',
      });
    }
  });

  app.post('/api/tickets/:id/expire', (req: Request, res: Response) => {
    const ticketId = String(req.params.id);
    const existing = ticketsStore.get(ticketId);
    if (!existing) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
      return;
    }
    if (existing.status === 'resolved' || existing.status === 'closed') {
      res.json({ ticket: existing });
      return;
    }

    const rawDelay = Number((req.body as Record<string, unknown> | undefined)?.delay_seconds ?? 0);
    if (Number.isFinite(rawDelay) && rawDelay > 0) {
      const clampedDelay = Math.min(Math.max(Math.round(rawDelay), 1), 300);
      const nowIso = new Date().toISOString();
      const deadlineIso = new Date(Date.now() + clampedDelay * 1000).toISOString();
      const armedTicket: TicketRecord = {
        ...existing,
        reply_deadline_at: deadlineIso,
        updated_at: nowIso,
      };
      ticketsStore.set(ticketId, armedTicket);
      res.json({
        ticket: armedTicket,
        trace: {
          method: 'POST',
          path: `/api/tickets/${ticketId}/expire`,
          statusCode: 200,
          pydanticModel: 'AutoCloseTimerPolicy -> TicketOut',
          pydanticEngine: 'Auto-Close Delay Countdown',
          parameterTrace: [
            {
              param: 'delay_seconds',
              location: 'body',
              raw_value: rawDelay,
              validated_value: clampedDelay,
              pydantic_type: 'int',
              constraint: 'Field(ge=1, le=300)',
              source: 'client',
              status: 'pass',
            },
          ],
          responseBody: armedTicket,
          timestamp: nowIso,
        },
      });
      return;
    }

    ticketsStore.set(ticketId, {
      ...existing,
      reply_deadline_at: new Date(Date.now() - 1000).toISOString(),
    });
    sweepExpiredTickets();
    const closedTicket = ticketsStore.get(ticketId)!;
    res.json({
      ticket: closedTicket,
      trace: {
        method: 'POST',
        path: `/api/tickets/${ticketId}/expire`,
        statusCode: 200,
        pydanticModel: 'AutoCloseTimerPolicy -> TicketOut',
        pydanticEngine: '5-Min Reply Deadline Sweep',
        parameterTrace: [
          {
            param: 'reply_deadline_at',
            location: 'body',
            raw_value: 'expired (> 5m)',
            validated_value: null,
            pydantic_type: 'Optional[datetime]',
            constraint: 'Auto-close after 5 min without customer reply',
            source: 'coerced',
            status: 'pass',
          },
        ],
        responseBody: closedTicket,
        timestamp: closedTicket.updated_at,
      },
    });
  });

  app.delete('/api/tickets/:id', (req: Request, res: Response) => {
    const ticketId = String(req.params.id);
    if (!ticketsStore.has(ticketId)) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
      return;
    }
    ticketsStore.delete(ticketId);
    res.status(204).send();
  });

  setInterval(() => {
    sweepExpiredTickets();
  }, 1000);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
