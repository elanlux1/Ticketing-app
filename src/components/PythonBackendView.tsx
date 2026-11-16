import React, { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';

type PythonFileId = 'models.py' | 'main.py' | 'validator_bridge.py' | 'requirements.txt' | 'README.md';

const PYTHON_FILES: Record<PythonFileId, { label: string; description: string; content: string }> = {
  'validator_bridge.py': {
    label: 'python_backend/validator_bridge.py',
    description:
      'Live Python Pydantic validation bridge invoked by the API server on every request to trace parameters, defaults, and errors.',
    content: `import json
import sys
from typing import Literal, Optional
import pydantic
from pydantic import BaseModel, Field, ValidationError

TicketStatus = Literal["open", "in_progress", "resolved"]
TicketPriority = Literal["low", "medium", "high", "urgent"]
TicketCategory = Literal["billing", "bug", "feature", "account"]

class TicketCreate(BaseModel):
    title: str = Field(min_length=4, max_length=120)
    description: str = Field(min_length=10, max_length=2000)
    requester_email: str = Field(regex=r"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
    priority: TicketPriority = "medium"
    category: TicketCategory = "bug"

# Executed on every POST /api/tickets call via server.ts -> python3 validator_bridge.py
# Returns: { valid, pydantic_engine, validated, parameter_trace } or HTTP 422 errors`,
  },
  'models.py': {
    label: 'python_backend/models.py',
    description:
      'Defines strict Pydantic v2 BaseModels for ticket creation, updates, comments, and API responses.',
    content: `from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

TicketStatus = Literal["open", "in_progress", "resolved"]
TicketPriority = Literal["low", "medium", "high", "urgent"]
TicketCategory = Literal["billing", "bug", "feature", "account"]


class TicketCreate(BaseModel):
    title: str = Field(
        min_length=4,
        max_length=120,
        description="Short summary of the issue",
    )
    description: str = Field(
        min_length=10,
        max_length=2000,
        description="Detailed explanation of what happened",
    )
    requester_email: str = Field(
        pattern=r"^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
        description="Valid email address for the requester",
    )
    priority: TicketPriority = "medium"
    category: TicketCategory = "bug"


class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None
    assignee: Optional[str] = Field(default=None, min_length=2, max_length=60)


class TicketCommentCreate(BaseModel):
    author: str = Field(min_length=2, max_length=60)
    body: str = Field(min_length=2, max_length=1000)


class TicketComment(BaseModel):
    id: str
    author: str
    body: str
    created_at: datetime


class TicketOut(BaseModel):
    id: str
    title: str
    description: str
    requester_email: str
    priority: TicketPriority
    category: TicketCategory
    status: TicketStatus
    assignee: Optional[str] = None
    comments: list[TicketComment] = []
    created_at: datetime
    updated_at: datetime`,
  },
  'main.py': {
    label: 'python_backend/main.py',
    description:
      'FastAPI REST endpoints wired directly to TicketCreate, TicketUpdate, and TicketOut models.',
    content: `from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from models import (
    TicketComment,
    TicketCommentCreate,
    TicketCreate,
    TicketOut,
    TicketPriority,
    TicketStatus,
    TicketUpdate,
)

app = FastAPI(title="Simple Ticketing API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TICKETS: dict[str, TicketOut] = {}
_next_number = 104


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


@app.get("/tickets", response_model=list[TicketOut])
def list_tickets(
    status: Optional[TicketStatus] = Query(default=None),
    priority: Optional[TicketPriority] = Query(default=None),
    q: Optional[str] = Query(default=None),
) -> list[TicketOut]:
    results = list(TICKETS.values())
    if status is not None:
        results = [t for t in results if t.status == status]
    if priority is not None:
        results = [t for t in results if t.priority == priority]
    if q:
        needle = q.strip().lower()
        results = [
            t for t in results
            if needle in t.id.lower() or needle in t.title.lower() or needle in t.requester_email.lower()
        ]
    return sorted(results, key=lambda t: t.updated_at, reverse=True)


@app.post("/tickets", response_model=TicketOut, status_code=201)
def create_ticket(payload: TicketCreate) -> TicketOut:
    global _next_number
    ticket_id = f"TKT-{_next_number}"
    _next_number += 1
    timestamp = now_utc()
    ticket = TicketOut(
        id=ticket_id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        requester_email=payload.requester_email.strip().lower(),
        priority=payload.priority,
        category=payload.category,
        status="open",
        comments=[],
        created_at=timestamp,
        updated_at=timestamp,
    )
    TICKETS[ticket.id] = ticket
    return ticket


@app.patch("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: str, payload: TicketUpdate) -> TicketOut:
    ticket = TICKETS.get(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")
    updates = payload.model_dump(exclude_unset=True)
    updated_ticket = ticket.model_copy(update={**updates, "updated_at": now_utc()})
    TICKETS[ticket_id] = updated_ticket
    return updated_ticket


@app.post("/tickets/{ticket_id}/comments", response_model=TicketOut, status_code=201)
def add_comment(ticket_id: str, payload: TicketCommentCreate) -> TicketOut:
    ticket = TICKETS.get(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")
    comment = TicketComment(
        id=f"CMT-{len(ticket.comments) + 1}",
        author=payload.author.strip(),
        body=payload.body.strip(),
        created_at=now_utc(),
    )
    updated = ticket.model_copy(
        update={"comments": [*ticket.comments, comment], "updated_at": now_utc()}
    )
    TICKETS[ticket_id] = updated
    return updated


@app.delete("/tickets/{ticket_id}", status_code=204)
def delete_ticket(ticket_id: str) -> None:
    if ticket_id not in TICKETS:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")
    del TICKETS[ticket_id]`,
  },
  'requirements.txt': {
    label: 'python_backend/requirements.txt',
    description: 'Minimal Python dependencies required to run the FastAPI ticketing server.',
    content: `fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.9.0`,
  },
  'README.md': {
    label: 'python_backend/README.md',
    description: 'Commands to install dependencies, launch Uvicorn, and inspect OpenAPI docs.',
    content: `# Simple Ticketing Backend (Python + FastAPI + Pydantic)

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Interactive API docs auto-generated from Pydantic models:
# http://127.0.0.1:8000/docs`,
  },
};

export const PythonBackendView: React.FC = () => {
  const [activeFile, setActiveFile] = useState<PythonFileId>('models.py');
  const [copied, setCopied] = useState<boolean>(false);

  const current = PYTHON_FILES[activeFile];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(current.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in restricted frame
    }
  };

  return (
    <section className="space-y-6">
      <div className="max-w-2xl">
        <p className="text-sm font-medium text-sky-700 mb-1">
          Python Backend Source · FastAPI + Pydantic
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
          Complete Python Ticketing API
        </h1>
        <p className="mt-2 text-base text-slate-600 leading-relaxed">
          These Python files live in your workspace under{' '}
          <code className="font-mono text-sm bg-slate-100 px-1.5 py-0.5 rounded">
            python_backend/
          </code>
          . Every endpoint in the live workspace mirrors these exact Pydantic models and HTTP status codes.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(Object.keys(PYTHON_FILES) as PythonFileId[]).map((fileId) => (
              <button
                key={fileId}
                type="button"
                onClick={() => setActiveFile(fileId)}
                className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  activeFile === fileId
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {fileId}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                Copy File
              </>
            )}
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
            <span className="font-mono font-semibold text-slate-800">{current.label}</span>
            <span>{current.description}</span>
          </div>

          <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto">
            {current.content}
          </pre>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-700">
              <Terminal className="w-4 h-4 text-slate-600 shrink-0" aria-hidden="true" />
              <span>
                Run locally with{' '}
                <code className="font-mono font-semibold text-slate-900">
                  uvicorn main:app --reload --port 8000
                </code>
              </span>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Swagger Docs: /docs
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
