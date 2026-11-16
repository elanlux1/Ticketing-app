export type ScenarioId = 'ticket' | 'invoice' | 'recipe';
export type SimulationMode = 'happy' | 'bad-input' | 'no-pydantic' | 'retry-heal';

export interface ValidationCheckItem {
  field: string;
  rule: string;
  status: 'pass' | 'fail' | 'skipped' | 'repaired';
  detail: string;
}

export interface StageSnapshot {
  stageIndex: number; // 0..4
  id: 'client' | 'input-gate' | 'llm' | 'output-gate' | 'response';
  title: string;
  roleLabel: string;
  statusText: string;
  statusKind: 'nominal' | 'error' | 'warning' | 'active';
  summary: string;
  artifactLabel: string;
  artifactContent: string;
  checks: ValidationCheckItem[];
  conceptNote: string;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  endpoint: string;
  inputModelName: string;
  outputModelName: string;
  sampleUserText: string;
  pydanticInputCode: string;
  pydanticOutputCode: string;
  jsonSchema: string;
  modes: Record<SimulationMode, StageSnapshot[]>;
}

export const MODE_OPTIONS: Array<{
  id: SimulationMode;
  label: string;
  shortNote: string;
}> = [
  {
    id: 'happy',
    label: 'Normal Flow',
    shortNote: 'Client input passes Gate 1, LLM follows JSON Schema, Gate 2 verifies types.',
  },
  {
    id: 'bad-input',
    label: 'Bad Input (422)',
    shortNote: 'Pydantic rejects malformed API input before spending any LLM tokens.',
  },
  {
    id: 'no-pydantic',
    label: 'Without Pydantic',
    shortNote: 'Unconstrained LLM returns prose and renamed keys, crashing downstream code.',
  },
  {
    id: 'retry-heal',
    label: 'Constraint Self-Heal',
    shortNote: 'Pydantic catches an out-of-range value and feeds the error back to the LLM.',
  },
];

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  ticket: {
    id: 'ticket',
    name: 'Support Ticket Triage',
    endpoint: 'POST /api/v1/triage',
    inputModelName: 'TicketRequest',
    outputModelName: 'TriageResult',
    sampleUserText:
      'My invoice #8841 charged me twice ($49.00 each) on Tuesday and I cannot export PDFs anymore.',
    pydanticInputCode: `class TicketRequest(BaseModel):
    customer_id: str = Field(min_length=3)
    message: str = Field(min_length=10, max_length=2000)
    channel: Literal["web", "email", "chat"] = "web"`,
    pydanticOutputCode: `class TriageResult(BaseModel):
    category: Literal["billing", "bug", "account"]
    urgency: Literal["low", "medium", "high"]
    refund_requested: bool
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str = Field(max_length=120)`,
    jsonSchema: `{
  "title": "TriageResult",
  "type": "object",
  "required": ["category", "urgency", "refund_requested", "confidence", "summary"],
  "properties": {
    "category": { "enum": ["billing", "bug", "account"], "type": "string" },
    "urgency": { "enum": ["low", "medium", "high"], "type": "string" },
    "refund_requested": { "type": "boolean" },
    "confidence": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
    "summary": { "type": "string", "maxLength": 120 }
  }
}`,
    modes: {
      happy: [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'A frontend app sends raw JSON over HTTP to your FastAPI endpoint.',
          artifactLabel: 'Incoming HTTP Body (JSON)',
          artifactContent: `{
  "customer_id": "cus_9042",
  "message": "My invoice #8841 charged me twice ($49.00 each) on Tuesday and I cannot export PDFs anymore.",
  "channel": "web"
}`,
          checks: [
            { field: 'HTTP Method', rule: 'POST /api/v1/triage', status: 'pass', detail: 'Route matched' },
            { field: 'Content-Type', rule: 'application/json', status: 'pass', detail: 'Valid JSON syntax' },
          ],
          conceptNote:
            'APIs receive untrusted JSON strings from browsers or mobile apps. Nothing guarantees the fields are safe or correctly typed yet.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'VALIDATED',
          statusKind: 'nominal',
          summary: 'FastAPI automatically parses the request through TicketRequest(BaseModel).',
          artifactLabel: 'Validated Python Object',
          artifactContent: `TicketRequest(
  customer_id="cus_9042",
  message="My invoice #8841 charged me twice...",
  channel="web"
)`,
          checks: [
            { field: 'customer_id', rule: 'str, min_length=3', status: 'pass', detail: 'Length 8 >= 3' },
            { field: 'message', rule: 'str, 10..2000 chars', status: 'pass', detail: 'Length 91 OK' },
            { field: 'channel', rule: 'Literal["web","email","chat"]', status: 'pass', detail: '"web" allowed' },
          ],
          conceptNote:
            'Pydantic validates inbound data before your business logic runs. If anything is missing, your app stops early without wasting LLM cost.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM + JSON Schema',
          roleLabel: 'Reasoning Engine',
          statusText: 'STRUCTURED OUTPUT',
          statusKind: 'active',
          summary: 'Pydantic exports TriageResult.model_json_schema() into the LLM API call so the model knows the exact shape to produce.',
          artifactLabel: 'Raw LLM Response Text',
          artifactContent: `{
  "category": "billing",
  "urgency": "high",
  "refund_requested": true,
  "confidence": 0.94,
  "summary": "Duplicate $49.00 charge on invoice #8841 plus PDF export failure."
}`,
          checks: [
            { field: 'Schema Attached', rule: 'response_schema=TriageResult', status: 'pass', detail: '5 properties enforced' },
            { field: 'Model Output', rule: 'Valid JSON string', status: 'pass', detail: 'No markdown prose wrapper' },
          ],
          conceptNote:
            'LLMs are trained on free text, not Python classes. Pydantic translates your Python types into standard JSON Schema that the LLM API understands.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Outbound Validation',
          statusText: 'VERIFIED',
          statusKind: 'nominal',
          summary: 'TriageResult.model_validate_json() verifies every field, enum, and numeric bound from the LLM.',
          artifactLabel: 'Typed Python Return Value',
          artifactContent: `TriageResult(
  category="billing",
  urgency="high",
  refund_requested=True,
  confidence=0.94,
  summary="Duplicate $49.00 charge on invoice #8841 plus PDF export failure."
)`,
          checks: [
            { field: 'category', rule: 'Literal["billing","bug","account"]', status: 'pass', detail: '"billing" in enum' },
            { field: 'confidence', rule: 'float, 0.0 <= x <= 1.0', status: 'pass', detail: '0.94 within bounds' },
            { field: 'summary', rule: 'str, max_length=120', status: 'pass', detail: '65 chars <= 120' },
          ],
          conceptNote:
            'Never trust raw LLM text directly in production code. Pydantic acts as a strict bouncer checking types and numeric ranges.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Contract Fulfilled',
          statusText: '200 OK',
          statusKind: 'nominal',
          summary: 'The API serializes the verified Pydantic object into clean JSON for the caller.',
          artifactLabel: 'HTTP 200 Response Body',
          artifactContent: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "category": "billing",
  "urgency": "high",
  "refund_requested": true,
  "confidence": 0.94,
  "summary": "Duplicate $49.00 charge on invoice #8841 plus PDF export failure."
}`,
          checks: [
            { field: 'Response Contract', rule: 'Matches OpenAPI Spec', status: 'pass', detail: 'Typed JSON guaranteed' },
          ],
          conceptNote:
            'Because Pydantic sits on both sides of the LLM, your API caller receives deterministic, strongly-typed JSON every single time.',
        },
      ],
      'bad-input': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'MALFORMED PAYLOAD',
          statusKind: 'warning',
          summary: 'A buggy client sends a short 2-character message and an unknown channel.',
          artifactLabel: 'Incoming HTTP Body (JSON)',
          artifactContent: `{
  "customer_id": "90",
  "message": "hi",
  "channel": "carrier_pigeon"
}`,
          checks: [
            { field: 'HTTP Method', rule: 'POST /api/v1/triage', status: 'pass', detail: 'Route matched' },
          ],
          conceptNote:
            'Real-world API clients frequently send empty strings, wrong types, or unexpected enum values.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'BLOCKED 422',
          statusKind: 'error',
          summary: 'Pydantic catches 3 validation errors immediately and short-circuits the pipeline.',
          artifactLabel: 'Pydantic ValidationError',
          artifactContent: `3 validation errors for TicketRequest
customer_id: String should have at least 3 characters (got "90")
message: String should have at least 10 characters (got "hi")
channel: Input should be 'web', 'email' or 'chat' (got 'carrier_pigeon')`,
          checks: [
            { field: 'customer_id', rule: 'min_length=3', status: 'fail', detail: 'Length 2 < 3' },
            { field: 'message', rule: 'min_length=10', status: 'fail', detail: 'Length 2 < 10' },
            { field: 'channel', rule: 'Literal["web","email","chat"]', status: 'fail', detail: '"carrier_pigeon" invalid' },
          ],
          conceptNote:
            'Catching bad payloads at Gate 1 saves money and latency: the LLM is never called for junk input.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM + JSON Schema',
          roleLabel: 'Skipped',
          statusText: 'NOT CALLED ($0.00)',
          statusKind: 'warning',
          summary: 'Because Pydantic raised a ValidationError at Gate 1, execution never reaches the LLM.',
          artifactLabel: 'LLM Invocation Skipped',
          artifactContent: `// Skipped: Request halted at Pydantic Input Gate.
// 0 input tokens sent · 0 output tokens billed.`,
          checks: [
            { field: 'Token Spend', rule: 'Zero waste on invalid requests', status: 'skipped', detail: '0 tokens used' },
          ],
          conceptNote:
            'Without Pydantic input validation, your app might send garbage text to an LLM and pay for meaningless completions.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Skipped',
          statusText: 'BYPASSED',
          statusKind: 'warning',
          summary: 'No LLM output was produced, so the output validator remains idle.',
          artifactLabel: 'No Output Validation Needed',
          artifactContent: `// Pipeline terminated at HTTP 422 error handler.`,
          checks: [],
          conceptNote:
            'Early validation keeps downstream services clean and prevents cascading errors.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Error Contract',
          statusText: '422 UNPROCESSABLE',
          statusKind: 'error',
          summary: 'FastAPI converts Pydantic’s error list into a standard, structured HTTP 422 response.',
          artifactLabel: 'HTTP 422 Error Payload',
          artifactContent: `HTTP/1.1 422 Unprocessable Entity

{
  "detail": [
    { "loc": ["body", "customer_id"], "msg": "String should have at least 3 characters" },
    { "loc": ["body", "message"], "msg": "String should have at least 10 characters" },
    { "loc": ["body", "channel"], "msg": "Input should be 'web', 'email' or 'chat'" }
  ]
}`,
          checks: [
            { field: 'Error Format', rule: 'Machine-readable JSON array', status: 'pass', detail: 'Exact field paths returned' },
          ],
          conceptNote:
            'A 422 error tells the frontend engineer the exact field path and rule that failed, without exposing stack traces.',
        },
      ],
      'no-pydantic': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'Client sends the exact same support message, but Pydantic is disabled.',
          artifactLabel: 'Incoming HTTP Body (JSON)',
          artifactContent: `{
  "customer_id": "cus_9042",
  "message": "My invoice #8841 charged me twice ($49.00 each) on Tuesday and I cannot export PDFs anymore."
}`,
          checks: [{ field: 'HTTP Method', rule: 'POST /api/v1/triage', status: 'pass', detail: 'Route matched' }],
          conceptNote: 'Without a schema, your endpoint accepts an untyped Python dict.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'No Input Gate',
          roleLabel: 'Unchecked Dict',
          statusText: 'UNCHECKED',
          statusKind: 'warning',
          summary: 'Raw request dictionary passes straight through without type or length verification.',
          artifactLabel: 'Untyped Python Dict',
          artifactContent: `payload = await request.json()
# Warning: payload["channel"] does not exist!`,
          checks: [
            { field: 'Schema Check', rule: 'None configured', status: 'skipped', detail: 'Missing keys undetected' },
          ],
          conceptNote: 'Skipping input models leaves KeyError and injection risks wide open.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'Unconstrained LLM',
          roleLabel: 'Free-Form Text',
          statusText: 'PROSE DRIFT',
          statusKind: 'error',
          summary: 'Asked politely in a prompt for JSON, the LLM wraps markdown fences around renamed keys and uses a string for confidence.',
          artifactLabel: 'Raw Unconstrained LLM Output',
          artifactContent: `Sure! Here is the triage analysis:

\`\`\`json
{
  "ticket_type": "Billing Issue",
  "priority": "High Priority",
  "wants_refund": "Yes",
  "confidence_score": "95%",
  "short_summary": "Customer was billed twice on invoice #8841."
}
\`\`\``,
          checks: [
            { field: 'JSON Parse', rule: 'json.loads(raw_text)', status: 'fail', detail: 'Fails due to prose + ```json fences' },
            { field: 'Key Names', rule: 'Expected "category"', status: 'fail', detail: 'Model invented "ticket_type"' },
            { field: 'Value Types', rule: 'Expected float', status: 'fail', detail: 'Model wrote "95%" string' },
          ],
          conceptNote:
            'Even when you write "Return ONLY JSON" in a prompt, LLMs drift—adding conversational intros, markdown fences, or renaming keys.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'No Output Gate',
          roleLabel: 'Runtime Crash',
          statusText: 'JSONDECODEERROR',
          statusKind: 'error',
          summary: 'Calling json.loads() on conversational text crashes the server before a response is built.',
          artifactLabel: 'Unhandled Server Exception',
          artifactContent: `json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
  File "app/main.py", line 42, in triage_ticket
    data = json.loads(llm_response.text)`,
          checks: [
            { field: 'Type Safety', rule: 'None', status: 'fail', detail: 'Exception raised' },
          ],
          conceptNote:
            'Writing brittle regexes to strip markdown fences breaks the moment an LLM phrases something differently.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Server Failure',
          statusText: '500 INTERNAL ERROR',
          statusKind: 'error',
          summary: 'Your API returns a 500 error to the frontend, breaking the user’s workflow.',
          artifactLabel: 'HTTP 500 Crash',
          artifactContent: `HTTP/1.1 500 Internal Server Error

{ "detail": "Internal Server Error" }`,
          checks: [
            { field: 'Caller Experience', rule: 'Reliable JSON contract', status: 'fail', detail: 'UI crashes or hangs' },
          ],
          conceptNote:
            'Pydantic eliminates this entire class of failures by connecting structured JSON Schema generation with strict validation.',
        },
      ],
      'retry-heal': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'Valid support ticket enters the API endpoint.',
          artifactLabel: 'Incoming HTTP Body (JSON)',
          artifactContent: `{
  "customer_id": "cus_9042",
  "message": "My invoice #8841 charged me twice ($49.00 each) on Tuesday and I cannot export PDFs anymore.",
  "channel": "web"
}`,
          checks: [{ field: 'HTTP Method', rule: 'POST /api/v1/triage', status: 'pass', detail: 'Route matched' }],
          conceptNote: 'The request itself is valid; now watch what happens when the LLM slips on a numeric constraint.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'VALIDATED',
          statusKind: 'nominal',
          summary: 'TicketRequest validates all incoming fields cleanly.',
          artifactLabel: 'Validated TicketRequest',
          artifactContent: `TicketRequest(customer_id="cus_9042", message="...", channel="web")`,
          checks: [{ field: 'TicketRequest', rule: 'All 3 fields valid', status: 'pass', detail: 'Passed to LLM' }],
          conceptNote: 'Gate 1 ensures the prompt gets clean, bounded input.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM Attempt 1 -> 2',
          roleLabel: 'Self-Correction Loop',
          statusText: 'REPAIRED ON RETRY',
          statusKind: 'warning',
          summary: 'On Attempt 1, the LLM outputs confidence: 94 instead of 0.94. Pydantic sends the ValidationError back, and Attempt 2 fixes it.',
          artifactLabel: 'Attempt 1 vs Attempt 2',
          artifactContent: `// Attempt 1 (Rejected by Pydantic):
{ "category": "billing", "urgency": "high", "refund_requested": true, "confidence": 94, "summary": "..." }

// Repair Prompt injected with Pydantic Error:
// "ValidationError: confidence must be <= 1.0 (got 94). Fix and return valid JSON."

// Attempt 2 (Corrected by LLM):
{ "category": "billing", "urgency": "high", "refund_requested": true, "confidence": 0.94, "summary": "Duplicate $49.00 charge on invoice #8841." }`,
          checks: [
            { field: 'Attempt 1', rule: 'confidence <= 1.0', status: 'fail', detail: 'LLM returned 94' },
            { field: 'Attempt 2', rule: 'confidence <= 1.0', status: 'repaired', detail: 'LLM fixed to 0.94' },
          ],
          conceptNote:
            'Because Pydantic error messages are crisp and descriptive, libraries like Instructor or LangChain feed them straight back to the LLM to self-heal.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Outbound Validation',
          statusText: 'VERIFIED',
          statusKind: 'nominal',
          summary: 'Attempt 2 passes every TriageResult constraint with zero remaining violations.',
          artifactLabel: 'Validated TriageResult',
          artifactContent: `TriageResult(
  category="billing",
  urgency="high",
  refund_requested=True,
  confidence=0.94,
  summary="Duplicate $49.00 charge on invoice #8841."
)`,
          checks: [
            { field: 'confidence', rule: '0.0 <= x <= 1.0', status: 'pass', detail: '0.94 verified' },
            { field: 'All Fields', rule: '5/5 constraints satisfied', status: 'pass', detail: 'Ready for HTTP 200' },
          ],
          conceptNote:
            'Semantic constraints like "0.0 <= confidence <= 1.0" go beyond basic JSON syntax—Pydantic enforces domain rules.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Contract Fulfilled',
          statusText: '200 OK (HEALED)',
          statusKind: 'nominal',
          summary: 'The API caller never sees the hiccup and receives clean, normalized JSON.',
          artifactLabel: 'HTTP 200 Response Body',
          artifactContent: `HTTP/1.1 200 OK

{
  "category": "billing",
  "urgency": "high",
  "refund_requested": true,
  "confidence": 0.94,
  "summary": "Duplicate $49.00 charge on invoice #8841."
}`,
          checks: [{ field: 'API Reliability', rule: 'Contract honored', status: 'pass', detail: 'Self-healing transparent to client' }],
          conceptNote:
            'This validation-and-retry loop is the backbone of production AI agents and extraction pipelines.',
        },
      ],
    },
  },

  invoice: {
    id: 'invoice',
    name: 'Invoice Line-Item Extractor',
    endpoint: 'POST /api/v1/extract-invoice',
    inputModelName: 'InvoiceOCRInput',
    outputModelName: 'ParsedInvoice',
    sampleUserText:
      'ACME CLOUD INC · INV-2026-41 · Qty 3x GPU Nodes @ $120.00 = $360.00 · Tax $28.80 · Total $388.80 USD',
    pydanticInputCode: `class InvoiceOCRInput(BaseModel):
    document_id: str
    raw_ocr_text: str = Field(min_length=20)
    currency_hint: Literal["USD", "EUR", "GBP"] = "USD"`,
    pydanticOutputCode: `class LineItem(BaseModel):
    description: str
    quantity: int = Field(gt=0)
    unit_price: float = Field(ge=0)

class ParsedInvoice(BaseModel):
    vendor: str
    invoice_number: str
    items: list[LineItem] = Field(min_length=1)
    total_amount: float = Field(gt=0)`,
    jsonSchema: `{
  "title": "ParsedInvoice",
  "type": "object",
  "required": ["vendor", "invoice_number", "items", "total_amount"],
  "properties": {
    "vendor": { "type": "string" },
    "invoice_number": { "type": "string" },
    "items": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["description", "quantity", "unit_price"],
        "properties": {
          "description": { "type": "string" },
          "quantity": { "type": "integer", "exclusiveMinimum": 0 },
          "unit_price": { "type": "number", "minimum": 0 }
        }
      }
    },
    "total_amount": { "type": "number", "exclusiveMinimum": 0 }
  }
}`,
    modes: {
      happy: [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'Accounting service posts raw OCR text from a scanned PDF receipt.',
          artifactLabel: 'Incoming HTTP Body (JSON)',
          artifactContent: `{
  "document_id": "doc_4109",
  "raw_ocr_text": "ACME CLOUD INC · INV-2026-41 · Qty 3x GPU Nodes @ $120.00 = $360.00 · Tax $28.80 · Total $388.80 USD",
  "currency_hint": "USD"
}`,
          checks: [{ field: 'Payload', rule: 'Valid JSON', status: 'pass', detail: '3 keys present' }],
          conceptNote: 'OCR text is messy and unstructured—ideal work for an LLM, risky without validation.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'VALIDATED',
          statusKind: 'nominal',
          summary: 'InvoiceOCRInput confirms raw_ocr_text has enough content to parse.',
          artifactLabel: 'Validated InvoiceOCRInput',
          artifactContent: `InvoiceOCRInput(
  document_id="doc_4109",
  raw_ocr_text="ACME CLOUD INC · INV-2026-41...",
  currency_hint="USD"
)`,
          checks: [
            { field: 'raw_ocr_text', rule: 'min_length=20', status: 'pass', detail: '101 chars OK' },
            { field: 'currency_hint', rule: 'USD | EUR | GBP', status: 'pass', detail: '"USD" valid' },
          ],
          conceptNote: 'Pydantic blocks blank OCR scans before they trigger pointless LLM extraction.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM + JSON Schema',
          roleLabel: 'Reasoning Engine',
          statusText: 'NESTED EXTRACTION',
          statusKind: 'active',
          summary: 'Nested Pydantic models (LineItem inside ParsedInvoice) compile into nested JSON Schema arrays for the LLM.',
          artifactLabel: 'Raw LLM JSON Output',
          artifactContent: `{
  "vendor": "ACME CLOUD INC",
  "invoice_number": "INV-2026-41",
  "items": [
    { "description": "GPU Nodes", "quantity": 3, "unit_price": 120.0 }
  ],
  "total_amount": 388.8
}`,
          checks: [
            { field: 'Nested Schema', rule: 'list[LineItem]', status: 'pass', detail: '1 line item extracted' },
          ],
          conceptNote: 'Pydantic supports nested models—allowing LLMs to extract complex arrays of typed objects cleanly.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Outbound Validation',
          statusText: 'VERIFIED',
          statusKind: 'nominal',
          summary: 'ParsedInvoice validates both outer fields and every LineItem inside the items array.',
          artifactLabel: 'Typed Python Objects',
          artifactContent: `ParsedInvoice(
  vendor="ACME CLOUD INC",
  invoice_number="INV-2026-41",
  items=[LineItem(description="GPU Nodes", quantity=3, unit_price=120.0)],
  total_amount=388.8
)`,
          checks: [
            { field: 'items[0].quantity', rule: 'int > 0', status: 'pass', detail: '3 is positive integer' },
            { field: 'total_amount', rule: 'float > 0', status: 'pass', detail: '388.8 valid' },
          ],
          conceptNote: 'Your accounting database can safely insert invoice.items[0].unit_price without fearing "$120.00" strings.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Contract Fulfilled',
          statusText: '200 OK',
          statusKind: 'nominal',
          summary: 'Structured invoice JSON is returned cleanly to the ERP system.',
          artifactLabel: 'HTTP 200 Response Body',
          artifactContent: `HTTP/1.1 200 OK

{
  "vendor": "ACME CLOUD INC",
  "invoice_number": "INV-2026-41",
  "items": [
    { "description": "GPU Nodes", "quantity": 3, "unit_price": 120.0 }
  ],
  "total_amount": 388.8
}`,
          checks: [{ field: 'Database Safety', rule: 'Numeric floats & ints', status: 'pass', detail: 'Ready for SQL insert' }],
          conceptNote: 'End-to-end type safety bridges messy OCR documents directly into SQL tables.',
        },
      ],
      'bad-input': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'EMPTY OCR',
          statusKind: 'warning',
          summary: 'Scanner uploaded a blank PDF page yielding almost empty text.',
          artifactLabel: 'Incoming HTTP Body (JSON)',
          artifactContent: `{
  "document_id": "doc_4110",
  "raw_ocr_text": "Page 1",
  "currency_hint": "JPY"
}`,
          checks: [{ field: 'Payload', rule: 'JSON parsed', status: 'pass', detail: 'Valid syntax, invalid values' }],
          conceptNote: 'Valid JSON syntax does not mean valid domain data.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'BLOCKED 422',
          statusKind: 'error',
          summary: 'InvoiceOCRInput rejects the 6-character OCR string and unsupported currency.',
          artifactLabel: 'Pydantic ValidationError',
          artifactContent: `2 validation errors for InvoiceOCRInput
raw_ocr_text: String should have at least 20 characters (got 6)
currency_hint: Input should be 'USD', 'EUR' or 'GBP' (got 'JPY')`,
          checks: [
            { field: 'raw_ocr_text', rule: 'min_length=20', status: 'fail', detail: 'Only 6 chars' },
            { field: 'currency_hint', rule: 'USD | EUR | GBP', status: 'fail', detail: '"JPY" unsupported' },
          ],
          conceptNote: 'Pydantic prevents hallucinated invoices from empty OCR scans.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM + JSON Schema',
          roleLabel: 'Skipped',
          statusText: 'NOT CALLED ($0.00)',
          statusKind: 'warning',
          summary: 'Execution halted before calling the LLM API.',
          artifactLabel: 'Skipped',
          artifactContent: `// Halted at Gate 1 — zero LLM tokens spent.`,
          checks: [{ field: 'LLM Call', rule: 'Avoided hallucination', status: 'skipped', detail: 'Saved latency & cost' }],
          conceptNote: 'Empty prompts often cause LLMs to invent sample invoices; Gate 1 stops that completely.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Skipped',
          statusText: 'BYPASSED',
          statusKind: 'warning',
          summary: 'Skipped because no LLM response exists.',
          artifactLabel: 'Bypassed',
          artifactContent: `// No output generated.`,
          checks: [],
          conceptNote: 'Error handling stays clean and predictable.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Error Contract',
          statusText: '422 UNPROCESSABLE',
          statusKind: 'error',
          summary: 'Caller receives exact validation errors for each offending field.',
          artifactLabel: 'HTTP 422 Response',
          artifactContent: `HTTP/1.1 422 Unprocessable Entity
{ "detail": [ ...2 field errors... ] }`,
          checks: [{ field: 'Status Code', rule: '422 Client Error', status: 'pass', detail: 'Clear feedback to uploader' }],
          conceptNote: 'The client knows immediately to re-scan the document.',
        },
      ],
      'no-pydantic': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'Invoice OCR text arrives at an unvalidated endpoint.',
          artifactLabel: 'Incoming JSON',
          artifactContent: `{ "raw_ocr_text": "ACME CLOUD INC · INV-2026-41 · Qty 3x GPU Nodes @ $120.00..." }`,
          checks: [{ field: 'JSON', rule: 'Parsed', status: 'pass', detail: 'Untyped dict' }],
          conceptNote: 'Without Pydantic, shapes are assumed rather than enforced.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'No Input Gate',
          roleLabel: 'Unchecked Dict',
          statusText: 'UNCHECKED',
          statusKind: 'warning',
          summary: 'No validation runs on input length or fields.',
          artifactLabel: 'Raw Dict',
          artifactContent: `text = body.get("raw_ocr_text")`,
          checks: [{ field: 'Checks', rule: 'None', status: 'skipped', detail: 'Unverified' }],
          conceptNote: 'Bugs propagate silently deeper into your pipeline.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'Unconstrained LLM',
          roleLabel: 'Free-Form Text',
          statusText: 'TYPE MISMATCH',
          statusKind: 'error',
          summary: 'LLM returns currency symbols inside numbers ("$120.00") and spells out quantity ("three").',
          artifactLabel: 'Unvalidated JSON',
          artifactContent: `{
  "vendor": "ACME CLOUD INC",
  "line_items": [
    { "item": "GPU Nodes", "qty": "three", "price": "$120.00" }
  ],
  "total": "$388.80 USD"
}`,
          checks: [
            { field: 'price', rule: 'Expected float', status: 'fail', detail: 'Got string "$120.00"' },
            { field: 'qty', rule: 'Expected int', status: 'fail', detail: 'Got string "three"' },
          ],
          conceptNote: 'Even valid JSON breaks your app if numeric fields come back as formatted currency strings.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'No Output Gate',
          roleLabel: 'Type Crash',
          statusText: 'TYPEERROR',
          statusKind: 'error',
          summary: 'Arithmetic in your billing service fails when multiplying "three" * "$120.00".',
          artifactLabel: 'Python TypeError',
          artifactContent: `ValueError: could not convert string to float: '$120.00'`,
          checks: [{ field: 'Math Op', rule: 'qty * price', status: 'fail', detail: 'Crash in database layer' }],
          conceptNote: 'Strings masquerading as numbers cause subtle crashes far away from the LLM call.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Server Failure',
          statusText: '500 INTERNAL ERROR',
          statusKind: 'error',
          summary: 'Database write aborts and returns HTTP 500.',
          artifactLabel: 'HTTP 500',
          artifactContent: `HTTP/1.1 500 Internal Server Error`,
          checks: [{ field: 'Outcome', rule: 'Broken ERP sync', status: 'fail', detail: 'Failed' }],
          conceptNote: 'Pydantic enforces pure int/float types before downstream code ever touches the data.',
        },
      ],
      'retry-heal': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'Valid invoice OCR payload enters the API.',
          artifactLabel: 'Incoming JSON',
          artifactContent: `{ "document_id": "doc_4109", "raw_ocr_text": "ACME CLOUD INC · INV-2026-41...", "currency_hint": "USD" }`,
          checks: [{ field: 'HTTP', rule: 'POST', status: 'pass', detail: 'Received' }],
          conceptNote: 'Clean request enters Gate 1.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'VALIDATED',
          statusKind: 'nominal',
          summary: 'Input passes InvoiceOCRInput checks.',
          artifactLabel: 'InvoiceOCRInput',
          artifactContent: `InvoiceOCRInput(document_id="doc_4109", ...)`,
          checks: [{ field: 'Input', rule: 'Valid', status: 'pass', detail: 'Ready for LLM' }],
          conceptNote: 'Gate 1 passes.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM Attempt 1 -> 2',
          roleLabel: 'Self-Correction Loop',
          statusText: 'REPAIRED ON RETRY',
          statusKind: 'warning',
          summary: 'Attempt 1 returns an empty items array []. Pydantic catches min_length=1 and prompts the LLM to extract the line item.',
          artifactLabel: 'Attempt 1 vs Attempt 2',
          artifactContent: `// Attempt 1 (Rejected):
{ "vendor": "ACME CLOUD INC", "invoice_number": "INV-2026-41", "items": [], "total_amount": 388.8 }

// Error fed back: "items: List should have at least 1 item after validation"

// Attempt 2 (Corrected):
{ "vendor": "ACME CLOUD INC", "invoice_number": "INV-2026-41", "items": [{ "description": "GPU Nodes", "quantity": 3, "unit_price": 120.0 }], "total_amount": 388.8 }`,
          checks: [
            { field: 'Attempt 1', rule: 'items min_length=1', status: 'fail', detail: 'Empty list []' },
            { field: 'Attempt 2', rule: 'items min_length=1', status: 'repaired', detail: '1 item populated' },
          ],
          conceptNote: 'Pydantic list constraints catch lazy omissions by the model and trigger targeted repair.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Outbound Validation',
          statusText: 'VERIFIED',
          statusKind: 'nominal',
          summary: 'ParsedInvoice confirms at least 1 valid LineItem with positive quantity.',
          artifactLabel: 'ParsedInvoice',
          artifactContent: `ParsedInvoice(vendor="ACME CLOUD INC", items=[LineItem(...)], total_amount=388.8)`,
          checks: [{ field: 'items', rule: 'min_length=1', status: 'pass', detail: 'Verified' }],
          conceptNote: 'Nested object arrays are fully verified.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Contract Fulfilled',
          statusText: '200 OK (HEALED)',
          statusKind: 'nominal',
          summary: 'Clean structured invoice delivered to the API client.',
          artifactLabel: 'HTTP 200 JSON',
          artifactContent: `HTTP/1.1 200 OK
{ "vendor": "ACME CLOUD INC", "items": [{ "description": "GPU Nodes", "quantity": 3, "unit_price": 120.0 }], "total_amount": 388.8 }`,
          checks: [{ field: 'Contract', rule: 'Fulfilled', status: 'pass', detail: '200 OK' }],
          conceptNote: 'Self-healing keeps automated document pipelines resilient.',
        },
      ],
    },
  },

  recipe: {
    id: 'recipe',
    name: 'Recipe Macro Parser',
    endpoint: 'POST /api/v1/parse-recipe',
    inputModelName: 'RecipePrompt',
    outputModelName: 'NutritionFacts',
    sampleUserText: '2 scrambled eggs with 1 slice whole wheat toast and half an avocado',
    pydanticInputCode: `class RecipePrompt(BaseModel):
    meal_description: str = Field(min_length=5)
    servings: int = Field(ge=1, le=20, default=1)`,
    pydanticOutputCode: `class NutritionFacts(BaseModel):
    calories: int = Field(ge=0, le=5000)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    dietary_tags: list[Literal["vegetarian", "gluten_free", "dairy_free"]]`,
    jsonSchema: `{
  "title": "NutritionFacts",
  "type": "object",
  "required": ["calories", "protein_g", "carbs_g", "fat_g", "dietary_tags"],
  "properties": {
    "calories": { "type": "integer", "minimum": 0, "maximum": 5000 },
    "protein_g": { "type": "number", "minimum": 0 },
    "carbs_g": { "type": "number", "minimum": 0 },
    "fat_g": { "type": "number", "minimum": 0 },
    "dietary_tags": { "type": "array", "items": { "enum": ["vegetarian", "gluten_free", "dairy_free"] } }
  }
}`,
    modes: {
      happy: [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'Fitness app sends a casual meal description from a user.',
          artifactLabel: 'Incoming HTTP Body',
          artifactContent: `{
  "meal_description": "2 scrambled eggs with 1 slice whole wheat toast and half an avocado",
  "servings": 1
}`,
          checks: [{ field: 'JSON', rule: 'Valid', status: 'pass', detail: '2 fields received' }],
          conceptNote: 'Users type natural food descriptions, while nutrition charts need strict numbers.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'VALIDATED',
          statusKind: 'nominal',
          summary: 'RecipePrompt checks that servings is between 1 and 20.',
          artifactLabel: 'RecipePrompt',
          artifactContent: `RecipePrompt(meal_description="2 scrambled eggs...", servings=1)`,
          checks: [
            { field: 'servings', rule: '1 <= int <= 20', status: 'pass', detail: '1 valid' },
          ],
          conceptNote: 'Input bounds prevent absurd values like servings=-5.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM + JSON Schema',
          roleLabel: 'Reasoning Engine',
          statusText: 'STRUCTURED OUTPUT',
          statusKind: 'active',
          summary: 'LLM estimates macros constrained to NutritionFacts JSON Schema.',
          artifactLabel: 'Raw LLM Output',
          artifactContent: `{
  "calories": 385,
  "protein_g": 17.5,
  "carbs_g": 21.0,
  "fat_g": 24.5,
  "dietary_tags": ["vegetarian", "dairy_free"]
}`,
          checks: [{ field: 'Schema', rule: '5 typed fields', status: 'pass', detail: 'Conforms to schema' }],
          conceptNote: 'Enums inside lists restrict dietary_tags to values your UI icons actually support.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Outbound Validation',
          statusText: 'VERIFIED',
          statusKind: 'nominal',
          summary: 'NutritionFacts verifies non-negative macros and valid enum tags.',
          artifactLabel: 'NutritionFacts',
          artifactContent: `NutritionFacts(calories=385, protein_g=17.5, carbs_g=21.0, fat_g=24.5, dietary_tags=["vegetarian", "dairy_free"])`,
          checks: [
            { field: 'calories', rule: 'int in 0..5000', status: 'pass', detail: '385 OK' },
            { field: 'dietary_tags', rule: 'Known enum values', status: 'pass', detail: 'All tags valid' },
          ],
          conceptNote: 'Strict enums prevent the LLM from inventing unsupported tags like "low-ish carb".',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Contract Fulfilled',
          statusText: '200 OK',
          statusKind: 'nominal',
          summary: 'App charts update immediately with clean numeric macro data.',
          artifactLabel: 'HTTP 200 Response',
          artifactContent: `HTTP/1.1 200 OK
{ "calories": 385, "protein_g": 17.5, "carbs_g": 21.0, "fat_g": 24.5, "dietary_tags": ["vegetarian", "dairy_free"] }`,
          checks: [{ field: 'Chart Ready', rule: 'Numbers guaranteed', status: 'pass', detail: '200 OK' }],
          conceptNote: 'API, LLM, and Pydantic form a seamless translation layer from human text to UI charts.',
        },
      ],
      'bad-input': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'INVALID SERVINGS',
          statusKind: 'warning',
          summary: 'Client accidentally sends servings: -3.',
          artifactLabel: 'Incoming JSON',
          artifactContent: `{ "meal_description": "Toast", "servings": -3 }`,
          checks: [{ field: 'JSON', rule: 'Parsed', status: 'pass', detail: 'Negative int present' }],
          conceptNote: 'Invalid bounds often come from UI bugs.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'BLOCKED 422',
          statusKind: 'error',
          summary: 'RecipePrompt rejects servings=-3 because ge=1.',
          artifactLabel: 'ValidationError',
          artifactContent: `1 validation error for RecipePrompt
servings: Input should be greater than or equal to 1 (got -3)`,
          checks: [{ field: 'servings', rule: 'ge=1', status: 'fail', detail: '-3 < 1' }],
          conceptNote: 'Stopped before hitting the LLM.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM + JSON Schema',
          roleLabel: 'Skipped',
          statusText: 'NOT CALLED ($0.00)',
          statusKind: 'warning',
          summary: 'LLM skipped.',
          artifactLabel: 'Skipped',
          artifactContent: `// 0 tokens spent.`,
          checks: [],
          conceptNote: 'Zero wasted inference.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Skipped',
          statusText: 'BYPASSED',
          statusKind: 'warning',
          summary: 'Bypassed.',
          artifactLabel: 'Bypassed',
          artifactContent: `// Halted at Gate 1.`,
          checks: [],
          conceptNote: 'No output to check.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Error Contract',
          statusText: '422 UNPROCESSABLE',
          statusKind: 'error',
          summary: 'Returns 422 error describing servings >= 1.',
          artifactLabel: 'HTTP 422',
          artifactContent: `HTTP/1.1 422 Unprocessable Entity`,
          checks: [{ field: 'HTTP', rule: '422', status: 'pass', detail: 'Client notified' }],
          conceptNote: 'Clear contract violation error.',
        },
      ],
      'no-pydantic': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'Meal description arrives without validation.',
          artifactLabel: 'Incoming JSON',
          artifactContent: `{ "meal_description": "2 scrambled eggs with 1 slice whole wheat toast" }`,
          checks: [],
          conceptNote: 'Passed directly to prompt.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'No Input Gate',
          roleLabel: 'Unchecked',
          statusText: 'UNCHECKED',
          statusKind: 'warning',
          summary: 'Missing servings default is unhandled.',
          artifactLabel: 'Raw Dict',
          artifactContent: `servings = body["servings"] # Potential KeyError`,
          checks: [],
          conceptNote: 'No defaults or bounds.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'Unconstrained LLM',
          roleLabel: 'Free-Form Text',
          statusText: 'UNIT DRIFT',
          statusKind: 'error',
          summary: 'LLM outputs "17g" strings and approximate ranges ("350-400 kcal").',
          artifactLabel: 'Raw Output',
          artifactContent: `{
  "calories": "350-400 kcal",
  "protein": "17g",
  "tags": ["healthy", "breakfast"]
}`,
          checks: [
            { field: 'calories', rule: 'Expected int', status: 'fail', detail: 'Got range string "350-400 kcal"' },
          ],
          conceptNote: 'UI progress bars cannot add "350-400 kcal" to a daily total.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'No Output Gate',
          roleLabel: 'Frontend NaN',
          statusText: 'SILENT CORRUPTION',
          statusKind: 'error',
          summary: 'Invalid types slip through to the UI, rendering NaN calories.',
          artifactLabel: 'Corrupted Data',
          artifactContent: `totalCalories = 1200 + "350-400 kcal" // "1200350-400 kcal"`,
          checks: [],
          conceptNote: 'Silent type bugs are worse than crashes.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Broken Contract',
          statusText: '200 WITH BAD DATA',
          statusKind: 'error',
          summary: 'Endpoint returns 200 OK with unusable strings.',
          artifactLabel: 'Broken JSON',
          artifactContent: `{ "calories": "350-400 kcal" }`,
          checks: [],
          conceptNote: 'Pydantic stops bad data before it corrupts your database.',
        },
      ],
      'retry-heal': [
        {
          stageIndex: 0,
          id: 'client',
          title: 'HTTP API Request',
          roleLabel: 'Transport Layer',
          statusText: 'RECEIVED',
          statusKind: 'nominal',
          summary: 'Meal request enters endpoint.',
          artifactLabel: 'Incoming JSON',
          artifactContent: `{ "meal_description": "2 scrambled eggs with 1 slice whole wheat toast and half an avocado", "servings": 1 }`,
          checks: [],
          conceptNote: 'Gate 1 ready.',
        },
        {
          stageIndex: 1,
          id: 'input-gate',
          title: 'Pydantic Input Gate',
          roleLabel: 'Inbound Validation',
          statusText: 'VALIDATED',
          statusKind: 'nominal',
          summary: 'RecipePrompt verified.',
          artifactLabel: 'RecipePrompt',
          artifactContent: `RecipePrompt(meal_description="...", servings=1)`,
          checks: [],
          conceptNote: 'Passed to LLM.',
        },
        {
          stageIndex: 2,
          id: 'llm',
          title: 'LLM Attempt 1 -> 2',
          roleLabel: 'Self-Correction Loop',
          statusText: 'REPAIRED ON RETRY',
          statusKind: 'warning',
          summary: 'Attempt 1 includes "high_protein" in dietary_tags (not in Literal). Retry replaces it with valid enum tags.',
          artifactLabel: 'Attempt 1 vs Attempt 2',
          artifactContent: `// Attempt 1 (Rejected):
{ "calories": 385, "protein_g": 17.5, "carbs_g": 21.0, "fat_g": 24.5, "dietary_tags": ["vegetarian", "high_protein"] }

// Error: "dietary_tags.1: Input should be 'vegetarian', 'gluten_free' or 'dairy_free'"

// Attempt 2 (Corrected):
{ "calories": 385, "protein_g": 17.5, "carbs_g": 21.0, "fat_g": 24.5, "dietary_tags": ["vegetarian", "dairy_free"] }`,
          checks: [
            { field: 'Attempt 1', rule: 'dietary_tags enum', status: 'fail', detail: '"high_protein" not allowed' },
            { field: 'Attempt 2', rule: 'dietary_tags enum', status: 'repaired', detail: 'Only valid enum tags' },
          ],
          conceptNote: 'Pydantic enforces allowed enum lists strictly.',
        },
        {
          stageIndex: 3,
          id: 'output-gate',
          title: 'Pydantic Output Gate',
          roleLabel: 'Outbound Validation',
          statusText: 'VERIFIED',
          statusKind: 'nominal',
          summary: 'All nutrition fields and tags pass.',
          artifactLabel: 'NutritionFacts',
          artifactContent: `NutritionFacts(calories=385, protein_g=17.5, carbs_g=21.0, fat_g=24.5, dietary_tags=["vegetarian", "dairy_free"])`,
          checks: [],
          conceptNote: 'Output guaranteed.',
        },
        {
          stageIndex: 4,
          id: 'response',
          title: 'API HTTP Response',
          roleLabel: 'Contract Fulfilled',
          statusText: '200 OK (HEALED)',
          statusKind: 'nominal',
          summary: 'Clean nutrition JSON sent to client.',
          artifactLabel: 'HTTP 200',
          artifactContent: `HTTP/1.1 200 OK`,
          checks: [],
          conceptNote: 'Client receives strict data.',
        },
      ],
    },
  },
};

export interface SchemaFieldConfig {
  id: string;
  name: string;
  type: 'str' | 'int' | 'float' | 'bool' | 'list[str]' | 'Literal';
  required: boolean;
  description: string;
  minVal?: number;
  maxVal?: number;
  literalOptions?: string[];
}

export const INITIAL_SCHEMA_FIELDS: SchemaFieldConfig[] = [
  {
    id: 'f1',
    name: 'sentiment',
    type: 'Literal',
    required: true,
    description: 'Overall emotional tone of the customer message.',
    literalOptions: ['positive', 'neutral', 'negative'],
  },
  {
    id: 'f2',
    name: 'confidence',
    type: 'float',
    required: true,
    description: 'Model certainty score from 0.0 (guess) to 1.0 (certain).',
    minVal: 0,
    maxVal: 1,
  },
  {
    id: 'f3',
    name: 'action_items',
    type: 'list[str]',
    required: true,
    description: 'Concrete next steps for the support agent.',
  },
  {
    id: 'f4',
    name: 'escalate',
    type: 'bool',
    required: false,
    description: 'True only if legal threat or outage is mentioned.',
  },
];

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    prompt:
      'A client sends {"message": "hi"} to your FastAPI endpoint, violating min_length=10 on your Pydantic input model. What happens?',
    options: [
      'The LLM runs anyway and returns a polite error message',
      'Pydantic stops the request at Gate 1 and returns HTTP 422 before calling the LLM',
      'FastAPI converts it into a 500 Internal Server Error',
      'Pydantic pads the string to 10 characters automatically',
    ],
    correctIndex: 1,
    explanation:
      'Inbound Pydantic validation runs at the API boundary before your endpoint body executes, saving LLM latency and token cost while returning a structured 422 error.',
  },
  {
    id: 'q2',
    prompt:
      'How does an LLM API know what JSON structure to return when you pass a Pydantic BaseModel?',
    options: [
      'The LLM executes your Python class directly inside its weights',
      'Pydantic translates your Python class into a standard JSON Schema via .model_json_schema()',
      'FastAPI compiles Python bytecode into SQL triggers',
      'The LLM guesses the field names from your URL path',
    ],
    correctIndex: 1,
    explanation:
      'LLMs do not run Python. Pydantic exports a language-agnostic JSON Schema (with property names, types, enums, and descriptions) that LLM APIs use to constrain output.',
  },
  {
    id: 'q3',
    prompt:
      'Why is Field(description="...") on a Pydantic output model especially valuable when working with LLMs?',
    options: [
      'It compresses the HTTP response payload size',
      'It is included inside the JSON Schema sent to the LLM, acting as field-level prompt guidance',
      'It encrypts sensitive user fields before logging',
      'It speeds up Python dictionary lookups at runtime',
    ],
    correctIndex: 1,
    explanation:
      'Every Field(description=...) becomes a "description" property in the JSON Schema. The LLM reads those descriptions to understand exactly what value belongs in each key.',
  },
  {
    id: 'q4',
    prompt:
      'If an LLM returns valid JSON syntax like {"confidence": 95}, why do you still run Pydantic output validation (model_validate_json) if your schema expects 0.0 to 1.0?',
    options: [
      'JSON syntax alone cannot enforce numeric bounds (ge=0, le=1) or business rules',
      'model_validate_json translates JSON into XML for HTTP responses',
      'Python dictionaries cannot store floating-point numbers',
      'Browsers cannot parse integers larger than 10',
    ],
    correctIndex: 0,
    explanation:
      'Valid JSON is not the same as valid domain data. Pydantic checks semantic constraints (ranges, enums, string lengths) and lets you catch or retry bad values before returning 200 OK.',
  },
];
