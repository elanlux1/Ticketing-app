from datetime import datetime, timezone
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

app = FastAPI(
    title="Simple Ticketing API",
    description="A lightweight FastAPI + Pydantic ticketing backend.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# In-memory store seeded with sample tickets (swap for SQLite/PostgreSQL in production)
TICKETS: dict[str, TicketOut] = {}
_next_number = 104


def _seed_tickets() -> None:
    initial = [
        TicketOut(
            id="TKT-101",
            title="Duplicate charge on April invoice #8841",
            description="Customer reports two $49.00 charges on their corporate card within 4 minutes.",
            requester_email="maya.chen@northstar.io",
            priority="urgent",
            category="billing",
            status="open",
            assignee="Alex Rivera",
            comments=[
                TicketComment(
                    id="CMT-1",
                    author="Alex Rivera",
                    body="Verified duplicate Stripe charge ID ch_3P9x. Preparing refund.",
                    created_at=now_utc(),
                )
            ],
            created_at=now_utc(),
            updated_at=now_utc(),
        ),
        TicketOut(
            id="TKT-102",
            title="PDF export fails for reports over 25 pages",
            description="Clicking Export PDF returns a 504 timeout when the monthly audit report exceeds 25 pages.",
            requester_email="devon.patel@harborlabs.com",
            priority="high",
            category="bug",
            status="in_progress",
            assignee="Samira Khan",
            comments=[],
            created_at=now_utc(),
            updated_at=now_utc(),
        ),
        TicketOut(
            id="TKT-103",
            title="Add SSO role mapping for Okta groups",
            description="Requesting automatic mapping from Okta security groups to workspace viewer and editor roles.",
            requester_email="it-ops@veridian.co",
            priority="medium",
            category="feature",
            status="resolved",
            assignee="Alex Rivera",
            comments=[],
            created_at=now_utc(),
            updated_at=now_utc(),
        ),
    ]
    for ticket in initial:
        TICKETS[ticket.id] = ticket


_seed_tickets()


@app.get("/tickets", response_model=list[TicketOut])
def list_tickets(
    status: Optional[TicketStatus] = Query(default=None),
    priority: Optional[TicketPriority] = Query(default=None),
    q: Optional[str] = Query(default=None, description="Search title, ID, or email"),
) -> list[TicketOut]:
    results = list(TICKETS.values())
    if status is not None:
        results = [t for t in results if t.status == status]
    if priority is not None:
        results = [t for t in results if t.priority == priority]
    if q:
        needle = q.strip().lower()
        results = [
            t
            for t in results
            if needle in t.id.lower()
            or needle in t.title.lower()
            or needle in t.requester_email.lower()
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
        assignee=None,
        comments=[],
        created_at=timestamp,
        updated_at=timestamp,
    )
    TICKETS[ticket.id] = ticket
    return ticket


@app.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: str) -> TicketOut:
    ticket = TICKETS.get(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")
    return ticket


@app.patch("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(ticket_id: str, payload: TicketUpdate) -> TicketOut:
    ticket = TICKETS.get(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")

    updates = payload.model_dump(exclude_unset=True)
    updated_ticket = ticket.model_copy(
        update={**updates, "updated_at": now_utc()}
    )
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
    updated_ticket = ticket.model_copy(
        update={
            "comments": [*ticket.comments, comment],
            "updated_at": now_utc(),
        }
    )
    TICKETS[ticket_id] = updated_ticket
    return updated_ticket


@app.delete("/tickets/{ticket_id}", status_code=204)
def delete_ticket(ticket_id: str) -> None:
    if ticket_id not in TICKETS:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")
    del TICKETS[ticket_id]
