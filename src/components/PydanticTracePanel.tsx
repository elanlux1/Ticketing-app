import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, SlidersHorizontal } from 'lucide-react';
import { ApiTraceEntry } from '../types/tickets';

interface PydanticTracePanelProps {
  trace: ApiTraceEntry | null;
}

export const PydanticTracePanel: React.FC<PydanticTracePanelProps> = ({ trace }) => {
  const [viewTab, setViewTab] = useState<'params' | 'schema' | 'json'>('params');

  if (!trace) return null;

  const isError = trace.statusCode >= 400;
  const effectiveTab = viewTab === 'schema' && !trace.jsonSchema ? 'params' : viewTab;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div>
          <div className="text-xs font-semibold text-slate-900">
            Pydantic Parameter Interaction
          </div>
          <div className="text-xs font-mono text-slate-500 mt-0.5">
            {trace.pydanticModel} · {trace.pydanticEngine}
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 text-xs font-mono font-semibold px-2.5 py-1 rounded-md border ${
            isError
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}
        >
          {isError ? (
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {trace.method} {trace.path} · {trace.statusCode}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setViewTab('params')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              effectiveTab === 'params'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Parameter Map ({trace.parameterTrace.length})
          </button>
          {trace.jsonSchema && (
            <button
              type="button"
              onClick={() => setViewTab('schema')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                effectiveTab === 'schema'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              JSON Schema
            </button>
          )}
          <button
            type="button"
            onClick={() => setViewTab('json')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              effectiveTab === 'json'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Raw JSON
          </button>
        </div>
      </div>

      {effectiveTab === 'params' ? (
        trace.parameterTrace.length === 0 ? (
          <p className="text-xs text-slate-500">
            No parameters were recorded for this request.
          </p>
        ) : (
          <div className="space-y-2.5">
            {trace.parameterTrace.map((item, idx) => (
              <div
                key={`${item.location}-${item.param}-${idx}`}
                className={`p-3 rounded-lg border text-xs ${
                  item.status === 'fail'
                    ? 'bg-rose-50/70 border-rose-200'
                    : item.status === 'defaulted'
                    ? 'bg-slate-50 border-slate-200'
                    : 'bg-emerald-50/40 border-emerald-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-semibold text-slate-900">{item.param}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">{item.location}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">{item.pydantic_type}</span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap ${
                      item.status === 'fail'
                        ? 'text-rose-700'
                        : item.status === 'defaulted'
                        ? 'text-slate-600'
                        : 'text-emerald-700'
                    }`}
                  >
                    {item.status === 'fail' && (
                      <>
                        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                        REJECTED
                      </>
                    )}
                    {item.status === 'defaulted' && (
                      <>
                        <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
                        DEFAULTED
                      </>
                    )}
                    {item.status === 'pass' && (
                      <>
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        VALIDATED
                      </>
                    )}
                  </span>
                </div>

                <div className="text-slate-600 mb-1.5 font-mono">
                  Rule: <span className="text-slate-800">{item.constraint}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 font-mono bg-white/90 px-2.5 py-1.5 rounded border border-slate-200/80 text-slate-800">
                  <span className="text-slate-500">in:</span>
                  <span className="break-all">
                    {item.raw_value === undefined ? '<omitted>' : JSON.stringify(item.raw_value)}
                  </span>
                  <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                  <span className="text-slate-500">out:</span>
                  <span className="font-semibold break-all">
                    {item.status === 'fail'
                      ? 'ValidationError'
                      : JSON.stringify(item.validated_value)}
                  </span>
                </div>

                {item.error_msg && (
                  <p className="mt-1.5 text-rose-700 font-medium">{item.error_msg}</p>
                )}
              </div>
            ))}
          </div>
        )
      ) : effectiveTab === 'schema' && trace.jsonSchema ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            Schema generated by Pydantic and passed to Gemini via{' '}
            <code className="font-mono text-slate-800">responseSchema</code>:
          </p>
          <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto max-h-56">
            {JSON.stringify(trace.jsonSchema, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="space-y-3">
          {trace.requestBody !== undefined && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">
                HTTP Request Body
              </div>
              <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto max-h-36">
                {JSON.stringify(trace.requestBody, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <div className="text-xs font-medium text-slate-600 mb-1">
              HTTP Response Body
            </div>
            <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto max-h-44">
              {JSON.stringify(trace.responseBody, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
