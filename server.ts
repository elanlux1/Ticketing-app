import 'dotenv/config';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { spawn } from 'child_process';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TicketStatus = 'open' | 'in_progress' | 'resolved';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
type TicketCategory = 'billing' | 'bug' | 'feature' | 'account';
type CommentRole = 'customer' | 'agent';

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

const VALID_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved'];
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

async function executeGeminiTriage(existing: TicketRecord) {
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
    threadLines.length > 0
      ? `Conversation Thread (chronological):\n${threadLines.join('\n')}`
      : 'Conversation Thread: No replies yet.',
  ].join('\n\n');

  let geminiResponse;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      geminiResponse = await ai.models.generateContent({
        model: modelName,
        contents: promptText,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are a support ticket triage classifier and responder. Read the initial ticket and the entire conversation thread carefully. Reply directly to the latest customer message if one exists. Set recommended_status to "resolved" when the customer indicates their question is answered or resolved (e.g. "thanks thats all i wanted"), otherwise set recommended_status to "in_progress".',
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

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());

  app.get('/api/tickets', (req: Request, res: Response) => {
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
        pydantic_type: "Optional[Literal['open','in_progress','resolved']]",
        constraint: 'Query(default=None)',
        source: valid ? 'client' : 'rejected',
        status: valid ? 'pass' : 'fail',
        error_msg: valid ? undefined : "Input should be 'open', 'in_progress' or 'resolved'",
      });
      if (!valid) {
        errors.push({
          loc: ['query', 'status'],
          msg: "Input should be 'open', 'in_progress' or 'resolved'",
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
      const ticket: TicketRecord = {
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
        created_at: now,
        updated_at: now,
      };

      ticketsStore.set(id, ticket);
      res.status(201).json({
        ticket,
        trace: {
          method: 'POST',
          path: '/api/tickets',
          statusCode: 201,
          pydanticModel: 'TicketCreate -> TicketOut',
          pydanticEngine: result.pydantic_engine,
          parameterTrace: result.parameter_trace,
          jsonSchema: result.json_schema,
          requestBody: body,
          responseBody: ticket,
          timestamp: now,
        },
      });
    } catch (err) {
      res.status(500).json({
        detail: err instanceof Error ? err.message : 'Python validator error',
      });
    }
  });

  app.post('/api/tickets/:id/triage', async (req: Request, res: Response) => {
    const ticketId = String(req.params.id);
    const existing = ticketsStore.get(ticketId);
    if (!existing) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
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
      const { modelName, pydanticResult } = await executeGeminiTriage(existing);

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
        recommendedStatus === 'open' && existing.status === 'open'
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

      const updated: TicketRecord = {
        ...existing,
        category: triage.category,
        priority: triage.priority,
        status: nextStatus,
        ai_triage: triage,
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
    const ticketId = String(req.params.id);
    const existing = ticketsStore.get(ticketId);
    if (!existing) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
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
      const updated: TicketRecord = {
        ...existing,
        status: (v.status as TicketStatus | null) ?? existing.status,
        priority: (v.priority as TicketPriority | null) ?? existing.priority,
        category: (v.category as TicketCategory | null) ?? existing.category,
        assignee:
          body.assignee === undefined
            ? existing.assignee
            : v.assignee === null
            ? null
            : String(v.assignee).trim(),
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
    const ticketId = String(req.params.id);
    const existing = ticketsStore.get(ticketId);
    if (!existing) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
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
        updated_at: now,
      };

      // If customer replied and Gemini key is available, automatically generate and post a contextual response
      if (role === 'customer' && autoReplyOnCustomer && process.env.GEMINI_API_KEY) {
        try {
          const { modelName, pydanticResult } = await executeGeminiTriage(updated);
          if (pydanticResult.valid && pydanticResult.validated) {
            const tv = pydanticResult.validated;
            const replyTime = new Date().toISOString();
            const recommendedStatus = tv.recommended_status as TicketStatus;
            const resolvedStatus: TicketStatus =
              recommendedStatus === 'open' ? 'in_progress' : recommendedStatus;

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

            updated = {
              ...updated,
              category: triage.category,
              priority: triage.priority,
              status: resolvedStatus,
              comments: [...updated.comments, aiReplyComment],
              ai_triage: triage,
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

  app.delete('/api/tickets/:id', (req: Request, res: Response) => {
    const ticketId = String(req.params.id);
    if (!ticketsStore.has(ticketId)) {
      res.status(404).json({ detail: `Ticket ${ticketId} not found` });
      return;
    }
    ticketsStore.delete(ticketId);
    res.status(204).send();
  });

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
