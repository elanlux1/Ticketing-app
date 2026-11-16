import React, { useState } from 'react';
import { Code2, Cpu, Globe, ShieldCheck } from 'lucide-react';

type PillarId = 'all' | 'api' | 'pydantic' | 'llm';
type CodeMode = 'with-pydantic' | 'without-pydantic';

interface CodeLine {
  num: number;
  text: string;
  pillar: 'api' | 'pydantic' | 'llm' | 'neutral';
}

const WITH_PYDANTIC_LINES: CodeLine[] = [
  { num: 1, text: 'from fastapi import FastAPI', pillar: 'api' },
  { num: 2, text: 'from pydantic import BaseModel, Field', pillar: 'pydantic' },
  { num: 3, text: 'from google import genai', pillar: 'llm' },
  { num: 4, text: '', pillar: 'neutral' },
  { num: 5, text: 'app = FastAPI()', pillar: 'api' },
  { num: 6, text: 'client = genai.Client()', pillar: 'llm' },
  { num: 7, text: '', pillar: 'neutral' },
  { num: 8, text: 'class TicketRequest(BaseModel):', pillar: 'pydantic' },
  { num: 9, text: '    message: str = Field(min_length=10, max_length=2000)', pillar: 'pydantic' },
  { num: 10, text: '', pillar: 'neutral' },
  { num: 11, text: 'class TriageResult(BaseModel):', pillar: 'pydantic' },
  { num: 12, text: '    category: str = Field(description="billing, bug, or account")', pillar: 'pydantic' },
  { num: 13, text: '    confidence: float = Field(ge=0.0, le=1.0)', pillar: 'pydantic' },
  { num: 14, text: '', pillar: 'neutral' },
  { num: 15, text: '@app.post("/api/v1/triage", response_model=TriageResult)', pillar: 'api' },
  { num: 16, text: 'def triage_ticket(body: TicketRequest) -> TriageResult:', pillar: 'api' },
  { num: 17, text: '    response = client.models.generate_content(', pillar: 'llm' },
  { num: 18, text: '        model="gemini-2.5-flash",', pillar: 'llm' },
  { num: 19, text: '        contents=body.message,', pillar: 'llm' },
  { num: 20, text: '        config={"response_mime_type": "application/json", "response_schema": TriageResult},', pillar: 'llm' },
  { num: 21, text: '    )', pillar: 'llm' },
  { num: 22, text: '    return TriageResult.model_validate_json(response.text)', pillar: 'pydantic' },
];

const WITHOUT_PYDANTIC_LINES: CodeLine[] = [
  { num: 1, text: 'import json', pillar: 'neutral' },
  { num: 2, text: 'from fastapi import FastAPI, Request', pillar: 'api' },
  { num: 3, text: 'from google import genai', pillar: 'llm' },
  { num: 4, text: '', pillar: 'neutral' },
  { num: 5, text: 'app = FastAPI()', pillar: 'api' },
  { num: 6, text: 'client = genai.Client()', pillar: 'llm' },
  { num: 7, text: '', pillar: 'neutral' },
  { num: 8, text: '@app.post("/api/v1/triage")', pillar: 'api' },
  { num: 9, text: 'async def triage_ticket(request: Request):', pillar: 'api' },
  { num: 10, text: '    body = await request.json()  # Risk: missing keys or wrong types', pillar: 'api' },
  { num: 11, text: '    prompt = f"Return JSON with category and confidence: {body[\'message\']}"', pillar: 'llm' },
  { num: 12, text: '    response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)', pillar: 'llm' },
  { num: 13, text: '    # Risk: LLM may wrap in ```json fences or return confidence="95%"', pillar: 'llm' },
  { num: 14, text: '    return json.loads(response.text)  # Crash: JSONDecodeError -> HTTP 500', pillar: 'neutral' },
];

const PILLAR_EXPLANATIONS: Record<PillarId, { title: string; body: string }> = {
  all: {
    title: 'Three Layers, One Continuous Contract',
    body: 'FastAPI handles HTTP routing and serialization, Pydantic enforces input and output contracts, and the LLM SDK receives Pydantic’s JSON Schema to produce structured data instead of free-form prose.',
  },
  api: {
    title: 'API Layer (FastAPI / HTTP)',
    body: 'Defines the URL route (@app.post) and binds TicketRequest as the body type and TriageResult as response_model. FastAPI delegates parsing to Pydantic and returns 422 automatically if client data is invalid.',
  },
  pydantic: {
    title: 'Pydantic Layer (BaseModel & Field)',
    body: 'Acts at both boundaries: TicketRequest guards incoming requests, while TriageResult compiles to JSON Schema for the LLM and runs .model_validate_json() on the returned text.',
  },
  llm: {
    title: 'LLM Layer (Model SDK)',
    body: 'Receives clean validated text (body.message) and the response_schema generated from TriageResult. Because the model sees exact keys and descriptions, it generates predictable JSON.',
  },
};

export const CodeBridge: React.FC = () => {
  const [selectedPillar, setSelectedPillar] = useState<PillarId>('all');
  const [codeMode, setCodeMode] = useState<CodeMode>('with-pydantic');

  const lines = codeMode === 'with-pydantic' ? WITH_PYDANTIC_LINES : WITHOUT_PYDANTIC_LINES;
  const activeNote = PILLAR_EXPLANATIONS[selectedPillar];

  return (
    <section id="code-bridge" className="scroll-mt-20 pt-12 border-t border-slate-200">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-sky-700 mb-1.5">
            03. The Code Bridge
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            See All Three Connect in 22 Lines of Python
          </h2>
          <p className="mt-2 text-base text-slate-600 leading-relaxed">
            Highlight each layer to see which lines belong to the API, Pydantic, and the LLM—or toggle off Pydantic to see why naive JSON prompting breaks.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 shrink-0">
          <button
            type="button"
            onClick={() => setCodeMode('with-pydantic')}
            className={`px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              codeMode === 'with-pydantic'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            With Pydantic (Type-Safe)
          </button>
          <button
            type="button"
            onClick={() => setCodeMode('without-pydantic')}
            className={`px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              codeMode === 'without-pydantic'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Without Pydantic (Fragile)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Pillar Selector Buttons */}
        <div className="lg:col-span-4 space-y-3">
          <button
            type="button"
            onClick={() => setSelectedPillar('all')}
            className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
              selectedPillar === 'all'
                ? 'bg-white border-slate-900 shadow-sm'
                : 'bg-white/70 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
              <Code2 className="w-4 h-4 text-slate-700" aria-hidden="true" />
              All Layers Combined
            </div>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              View the full request-to-response path in context.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSelectedPillar('api')}
            className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
              selectedPillar === 'api'
                ? 'bg-sky-50/70 border-sky-700 shadow-sm'
                : 'bg-white/70 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
              <Globe className="w-4 h-4 text-sky-700" aria-hidden="true" />
              1. HTTP API Layer (FastAPI)
            </div>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Routes HTTP traffic and declares request/response contracts.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSelectedPillar('pydantic')}
            className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
              selectedPillar === 'pydantic'
                ? 'bg-emerald-50/70 border-emerald-700 shadow-sm'
                : 'bg-white/70 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              2. Pydantic Contract Layer
            </div>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Validates incoming requests and verifies raw LLM JSON output.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSelectedPillar('llm')}
            className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
              selectedPillar === 'llm'
                ? 'bg-amber-50/70 border-amber-700 shadow-sm'
                : 'bg-white/70 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
              <Cpu className="w-4 h-4 text-amber-700" aria-hidden="true" />
              3. LLM Inference Layer
            </div>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              Generates reasoning constrained by Pydantic’s JSON Schema.
            </p>
          </button>
        </div>

        {/* Right: Synchronized Code Panel */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <span className="text-xs font-mono font-medium text-slate-700">
                {codeMode === 'with-pydantic' ? 'app_safe.py' : 'app_fragile.py'}
              </span>
              <span className="text-xs text-slate-500">
                Click a layer on the left to isolate its lines
              </span>
            </div>

            <div className="rounded-lg bg-slate-900 p-4 overflow-x-auto">
              <div className="font-mono text-xs leading-6 min-w-max">
                {lines.map((line) => {
                  const isHighlighted =
                    selectedPillar === 'all' || line.pillar === selectedPillar;
                  const accentClass =
                    line.pillar === 'api' && selectedPillar === 'api'
                      ? 'bg-sky-500/20 text-sky-100'
                      : line.pillar === 'pydantic' && selectedPillar === 'pydantic'
                      ? 'bg-emerald-500/20 text-emerald-100'
                      : line.pillar === 'llm' && selectedPillar === 'llm'
                      ? 'bg-amber-500/20 text-amber-100'
                      : '';

                  return (
                    <div
                      key={line.num}
                      className={`flex items-start gap-4 px-2 rounded transition-opacity ${accentClass} ${
                        isHighlighted ? 'opacity-100 text-slate-100' : 'opacity-30 text-slate-400'
                      }`}
                    >
                      <span className="w-5 text-right select-none text-slate-500 tabular-nums shrink-0">
                        {line.num}
                      </span>
                      <span className="whitespace-pre">{line.text || ' '}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              {activeNote.title}
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">{activeNote.body}</p>
          </div>
        </div>
      </div>
    </section>
  );
};
