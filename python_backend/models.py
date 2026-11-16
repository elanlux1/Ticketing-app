from datetime import datetime
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
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
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
    role: Literal["customer", "agent"] = "agent"


class TicketComment(BaseModel):
    id: str
    author: str
    body: str
    role: Literal["customer", "agent"] = "agent"
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
    updated_at: datetime


class TriageResult(BaseModel):
    category: TicketCategory = Field(
        description="Best matching ticket category: billing, bug, feature, or account"
    )
    priority: TicketPriority = Field(
        description="Recommended urgency level: low, medium, high, or urgent"
    )
    recommended_status: TicketStatus = Field(
        description="Recommended ticket status based on conversation thread"
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0",
    )
    reasoning: str = Field(
        min_length=5,
        max_length=240,
        description="Short one-sentence explanation for the classification",
    )
    suggested_reply: str = Field(
        min_length=10,
        max_length=450,
        description="Concise, polite response to send to the requester",
    )
