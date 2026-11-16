import json
import sys
from typing import Literal, Optional
import pydantic
from pydantic import BaseModel, Field, ValidationError

TicketStatus = Literal["open", "in_progress", "resolved", "closed"]
TicketPriority = Literal["low", "medium", "high", "urgent"]
TicketCategory = Literal["billing", "bug", "feature", "account"]
CommentRole = Literal["customer", "agent"]

IS_V2 = hasattr(BaseModel, "model_validate")


class TicketCreate(BaseModel):
    title: str = Field(min_length=4, max_length=120)
    description: str = Field(min_length=10, max_length=2000)
    requester_email: str = (
        Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
        if IS_V2
        else Field(regex=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    )
    priority: TicketPriority = "medium"
    category: TicketCategory = "bug"
    parent_ticket_id: Optional[str] = Field(default=None, min_length=3, max_length=30)


class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None
    category: Optional[TicketCategory] = None
    assignee: Optional[str] = Field(default=None, min_length=2, max_length=60)


class TicketCommentCreate(BaseModel):
    author: str = Field(min_length=2, max_length=60)
    body: str = Field(min_length=2, max_length=1000)
    role: CommentRole = "agent"


class TriageResult(BaseModel):
    category: TicketCategory = Field(
        description="Best matching ticket category: billing, bug, feature, or account"
    )
    priority: TicketPriority = Field(
        description="Recommended urgency level: low, medium, high, or urgent"
    )
    recommended_status: TicketStatus = Field(
        description="Recommended ticket status based on conversation: in_progress if awaiting action, resolved if customer confirmed issue is answered/done"
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0",
    )
    reasoning: str = Field(
        min_length=5,
        max_length=240,
        description="Short one-sentence explanation for the classification and status",
    )
    suggested_reply: str = Field(
        min_length=10,
        max_length=450,
        description="Concise, polite response addressing the latest message in the thread",
    )


MODELS = {
    "TicketCreate": TicketCreate,
    "TicketUpdate": TicketUpdate,
    "TicketCommentCreate": TicketCommentCreate,
    "TriageResult": TriageResult,
}

RULES = {
    "TicketCreate": {
        "title": ("str", "Field(min_length=4, max_length=120)"),
        "description": ("str", "Field(min_length=10, max_length=2000)"),
        "requester_email": ("str", "pattern=r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'"),
        "priority": ("Literal['low','medium','high','urgent']", "default='medium'"),
        "category": ("Literal['billing','bug','feature','account']", "default='bug'"),
        "parent_ticket_id": ("Optional[str]", "default=None"),
    },
    "TicketUpdate": {
        "status": ("Optional[Literal['open','in_progress','resolved','closed']]", "default=None"),
        "priority": ("Optional[Literal['low','medium','high','urgent']]", "default=None"),
        "category": ("Optional[Literal['billing','bug','feature','account']]", "default=None"),
        "assignee": ("Optional[str]", "Field(default=None, min_length=2, max_length=60)"),
    },
    "TicketCommentCreate": {
        "author": ("str", "Field(min_length=2, max_length=60)"),
        "body": ("str", "Field(min_length=2, max_length=1000)"),
        "role": ("Literal['customer','agent']", "default='agent'"),
    },
    "TriageResult": {
        "category": ("Literal['billing','bug','feature','account']", "Required enum from Gemini"),
        "priority": ("Literal['low','medium','high','urgent']", "Required enum from Gemini"),
        "recommended_status": ("Literal['open','in_progress','resolved','closed']", "Status transition from thread"),
        "confidence": ("float", "Field(ge=0.0, le=1.0)"),
        "reasoning": ("str", "Field(min_length=5, max_length=240)"),
        "suggested_reply": ("str", "Field(min_length=10, max_length=450)"),
    },
}


def model_to_dict(instance: BaseModel) -> dict:
    if IS_V2:
        return instance.model_dump()
    return instance.dict()


def model_to_schema(model_cls: type[BaseModel]) -> dict:
    if IS_V2:
        return model_cls.model_json_schema()
    return model_cls.schema()


def validate_request(model_name: str, payload: dict) -> dict:
    model_cls = MODELS.get(model_name)
    if model_cls is None:
        return {
            "valid": False,
            "errors": [{"loc": ["model"], "msg": f"Unknown model {model_name}", "type": "value_error"}],
        }

    rules = RULES[model_name]
    version_label = f"Python Pydantic v{pydantic.__version__}"
    location = "llm_output" if model_name == "TriageResult" else "body"

    try:
        instance = model_cls.model_validate(payload) if IS_V2 else model_cls(**payload)
        dumped = model_to_dict(instance)

        parameter_trace = []
        for field_name, (py_type, constraint) in rules.items():
            in_payload = field_name in payload and payload[field_name] is not None
            raw_val = payload.get(field_name) if field_name in payload else None
            out_val = dumped.get(field_name)

            if model_name == "TicketUpdate" and not in_payload:
                continue
            if model_name == "TicketCreate" and field_name == "parent_ticket_id" and not in_payload:
                continue

            if not in_payload:
                parameter_trace.append({
                    "param": field_name,
                    "location": location,
                    "raw_value": None if field_name in payload else "<omitted>",
                    "validated_value": out_val,
                    "pydantic_type": py_type,
                    "constraint": constraint,
                    "source": "default",
                    "status": "defaulted",
                })
            else:
                parameter_trace.append({
                    "param": field_name,
                    "location": location,
                    "raw_value": raw_val,
                    "validated_value": out_val,
                    "pydantic_type": py_type,
                    "constraint": constraint,
                    "source": "coerced" if raw_val != out_val else "client",
                    "status": "pass",
                })

        return {
            "valid": True,
            "pydantic_engine": version_label,
            "validated": dumped,
            "json_schema": model_to_schema(model_cls),
            "parameter_trace": parameter_trace,
        }

    except ValidationError as exc:
        raw_errors = exc.errors()
        error_map = {}
        formatted_errors = []
        for err in raw_errors:
            loc_list = [location] + [str(part) for part in err.get("loc", [])]
            field_key = str(err.get("loc", ["unknown"])[0])
            msg = err.get("msg", "Validation failed")
            err_type = err.get("type", "validation_error")
            error_map[field_key] = msg
            formatted_errors.append({
                "loc": loc_list,
                "msg": msg,
                "type": err_type,
            })

        parameter_trace = []
        for field_name, (py_type, constraint) in rules.items():
            in_payload = field_name in payload
            raw_val = payload.get(field_name) if in_payload else "<omitted>"
            if model_name == "TicketUpdate" and not in_payload and field_name not in error_map:
                continue

            if field_name in error_map:
                parameter_trace.append({
                    "param": field_name,
                    "location": location,
                    "raw_value": raw_val,
                    "validated_value": None,
                    "pydantic_type": py_type,
                    "constraint": constraint,
                    "source": "rejected",
                    "status": "fail",
                    "error_msg": error_map[field_name],
                })
            else:
                parameter_trace.append({
                    "param": field_name,
                    "location": location,
                    "raw_value": raw_val,
                    "validated_value": raw_val,
                    "pydantic_type": py_type,
                    "constraint": constraint,
                    "source": "client" if in_payload else "default",
                    "status": "pass" if in_payload else "defaulted",
                })

        return {
            "valid": False,
            "pydantic_engine": version_label,
            "errors": formatted_errors,
            "json_schema": model_to_schema(model_cls),
            "parameter_trace": parameter_trace,
        }


if __name__ == "__main__":
    raw_stdin = sys.stdin.read()
    request_data = json.loads(raw_stdin)
    result = validate_request(request_data["model"], request_data["payload"])
    print(json.dumps(result))
