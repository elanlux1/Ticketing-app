import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
} from 'lucide-react';
import { INITIAL_SCHEMA_FIELDS, SchemaFieldConfig } from '../data/learningData';

interface ValidationErrorEntry {
  loc: string[];
  type: string;
  msg: string;
  input: unknown;
}

function buildPythonModel(fields: SchemaFieldConfig[]): string {
  const usesLiteral = fields.some((f) => f.type === 'Literal');
  const usesOptional = fields.some((f) => !f.required);
  const imports: string[] = ['from pydantic import BaseModel, Field'];
  const typingParts: string[] = [];
  if (usesLiteral) typingParts.push('Literal');
  if (usesOptional) typingParts.push('Optional');
  if (typingParts.length > 0) {
    imports.push(`from typing import ${typingParts.join(', ')}`);
  }

  const lines = fields.map((f) => {
    let pyType = f.type as string;
    if (f.type === 'Literal') {
      const opts = (f.literalOptions ?? ['option_a', 'option_b'])
        .map((o) => `"${o}"`)
        .join(', ');
      pyType = `Literal[${opts}]`;
    }
    if (!f.required) {
      pyType = `Optional[${pyType}]`;
    }

    const fieldArgs: string[] = [];
    if (!f.required) {
      fieldArgs.push('default=None');
    }
    if ((f.type === 'int' || f.type === 'float') && f.minVal !== undefined) {
      fieldArgs.push(`ge=${f.minVal}`);
    }
    if ((f.type === 'int' || f.type === 'float') && f.maxVal !== undefined) {
      fieldArgs.push(`le=${f.maxVal}`);
    }
    if (f.description.trim()) {
      fieldArgs.push(`description="${f.description.replace(/"/g, '\\"')}"`);
    }

    if (fieldArgs.length > 0) {
      return `    ${f.name}: ${pyType} = Field(${fieldArgs.join(', ')})`;
    }
    return `    ${f.name}: ${pyType}`;
  });

  return `${imports.join('\n')}\n\nclass TicketAnalysis(BaseModel):\n${
    lines.length > 0 ? lines.join('\n') : '    pass'
  }`;
}

function buildJsonSchema(fields: SchemaFieldConfig[]) {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const f of fields) {
    if (f.required) required.push(f.name);
    const prop: Record<string, unknown> = {};

    if (f.type === 'str') prop.type = 'string';
    if (f.type === 'int') prop.type = 'integer';
    if (f.type === 'float') prop.type = 'number';
    if (f.type === 'bool') prop.type = 'boolean';
    if (f.type === 'list[str]') {
      prop.type = 'array';
      prop.items = { type: 'string' };
    }
    if (f.type === 'Literal') {
      prop.type = 'string';
      prop.enum = f.literalOptions ?? ['option_a', 'option_b'];
    }
    if ((f.type === 'int' || f.type === 'float') && f.minVal !== undefined) {
      prop.minimum = f.minVal;
    }
    if ((f.type === 'int' || f.type === 'float') && f.maxVal !== undefined) {
      prop.maximum = f.maxVal;
    }
    if (f.description.trim()) {
      prop.description = f.description;
    }
    properties[f.name] = prop;
  }

  return {
    title: 'TicketAnalysis',
    type: 'object',
    properties,
    required,
  };
}

function validatePayloadAgainstFields(
  rawJson: string,
  fields: SchemaFieldConfig[]
): { parsed: Record<string, unknown> | null; errors: ValidationErrorEntry[]; parseError?: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(rawJson);
  } catch (err) {
    return {
      parsed: null,
      errors: [],
      parseError: err instanceof Error ? err.message : 'Invalid JSON syntax',
    };
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return {
      parsed: null,
      errors: [
        {
          loc: ['body'],
          type: 'model_type',
          msg: 'Input should be a valid dictionary or object to extract fields from',
          input: obj,
        },
      ],
    };
  }

  const record = obj as Record<string, unknown>;
  const errors: ValidationErrorEntry[] = [];

  for (const f of fields) {
    const hasKey = Object.prototype.hasOwnProperty.call(record, f.name);
    const val = record[f.name];

    if (!hasKey || val === undefined) {
      if (f.required) {
        errors.push({
          loc: [f.name],
          type: 'missing',
          msg: 'Field required',
          input: record,
        });
      }
      continue;
    }

    if (val === null) {
      if (f.required) {
        errors.push({
          loc: [f.name],
          type: 'value_error',
          msg: 'Input should not be null for required field',
          input: null,
        });
      }
      continue;
    }

    if (f.type === 'str' && typeof val !== 'string') {
      errors.push({
        loc: [f.name],
        type: 'string_type',
        msg: 'Input should be a valid string',
        input: val,
      });
    } else if (f.type === 'bool' && typeof val !== 'boolean') {
      errors.push({
        loc: [f.name],
        type: 'bool_type',
        msg: 'Input should be a valid boolean (true or false)',
        input: val,
      });
    } else if (f.type === 'int') {
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        errors.push({
          loc: [f.name],
          type: 'int_type',
          msg: 'Input should be a valid integer',
          input: val,
        });
      } else {
        if (f.minVal !== undefined && val < f.minVal) {
          errors.push({
            loc: [f.name],
            type: 'greater_than_equal',
            msg: `Input should be greater than or equal to ${f.minVal}`,
            input: val,
          });
        }
        if (f.maxVal !== undefined && val > f.maxVal) {
          errors.push({
            loc: [f.name],
            type: 'less_than_equal',
            msg: `Input should be less than or equal to ${f.maxVal}`,
            input: val,
          });
        }
      }
    } else if (f.type === 'float') {
      if (typeof val !== 'number' || Number.isNaN(val)) {
        errors.push({
          loc: [f.name],
          type: 'float_type',
          msg: 'Input should be a valid number',
          input: val,
        });
      } else {
        if (f.minVal !== undefined && val < f.minVal) {
          errors.push({
            loc: [f.name],
            type: 'greater_than_equal',
            msg: `Input should be greater than or equal to ${f.minVal}`,
            input: val,
          });
        }
        if (f.maxVal !== undefined && val > f.maxVal) {
          errors.push({
            loc: [f.name],
            type: 'less_than_equal',
            msg: `Input should be less than or equal to ${f.maxVal}`,
            input: val,
          });
        }
      }
    } else if (f.type === 'list[str]') {
      if (!Array.isArray(val) || !val.every((item) => typeof item === 'string')) {
        errors.push({
          loc: [f.name],
          type: 'list_type',
          msg: 'Input should be a valid list of strings',
          input: val,
        });
      }
    } else if (f.type === 'Literal') {
      const allowed = f.literalOptions ?? [];
      if (typeof val !== 'string' || !allowed.includes(val)) {
        errors.push({
          loc: [f.name],
          type: 'literal_error',
          msg: `Input should be one of: ${allowed.map((a) => `'${a}'`).join(', ')}`,
          input: val,
        });
      }
    }
  }

  return { parsed: record, errors };
}

export const SchemaLab: React.FC = () => {
  const [fields, setFields] = useState<SchemaFieldConfig[]>(INITIAL_SCHEMA_FIELDS);
  const [rightView, setRightView] = useState<'schema' | 'validator'>('schema');
  const [testJson, setTestJson] = useState<string>(
    JSON.stringify(
      {
        sentiment: 'negative',
        confidence: 0.91,
        action_items: ['Issue duplicate charge refund', 'Escalate PDF export bug'],
        escalate: false,
      },
      null,
      2
    )
  );

  const pythonCode = useMemo(() => buildPythonModel(fields), [fields]);
  const jsonSchema = useMemo(() => buildJsonSchema(fields), [fields]);
  const validationResult = useMemo(
    () => validatePayloadAgainstFields(testJson, fields),
    [testJson, fields]
  );

  const updateField = (id: string, patch: Partial<SchemaFieldConfig>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const addCustomField = () => {
    const idx = fields.length + 1;
    setFields((prev) => [
      ...prev,
      {
        id: `f_${Date.now()}`,
        name: `custom_note_${idx}`,
        type: 'str',
        required: false,
        description: 'Optional reviewer note extracted from the message.',
      },
    ]);
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const applyPresetPayload = (preset: 'valid' | 'out-of-range' | 'wrong-type' | 'missing') => {
    setRightView('validator');
    if (preset === 'valid') {
      setTestJson(
        JSON.stringify(
          {
            sentiment: 'negative',
            confidence: 0.91,
            action_items: ['Issue duplicate charge refund', 'Escalate PDF export bug'],
            escalate: false,
          },
          null,
          2
        )
      );
    } else if (preset === 'out-of-range') {
      setTestJson(
        JSON.stringify(
          {
            sentiment: 'frustrated',
            confidence: 95,
            action_items: ['Check billing'],
            escalate: false,
          },
          null,
          2
        )
      );
    } else if (preset === 'wrong-type') {
      setTestJson(
        JSON.stringify(
          {
            sentiment: 'neutral',
            confidence: 'high',
            action_items: 'Send email',
            escalate: 'yes',
          },
          null,
          2
        )
      );
    } else {
      setTestJson(
        JSON.stringify(
          {
            escalate: true,
          },
          null,
          2
        )
      );
    }
  };

  return (
    <section id="schema-lab" className="scroll-mt-20 pt-12 border-t border-slate-200">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-sky-700 mb-1.5">
            02. Live Schema Translator
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            How Pydantic Tells the LLM What to Return
          </h2>
          <p className="mt-2 text-base text-slate-600 leading-relaxed">
            Edit the Python model fields below. Notice how Pydantic compiles types, bounds, and{' '}
            <code className="text-sm font-mono text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
              Field(description=...)
            </code>{' '}
            directly into a JSON Schema prompt contract.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={addCustomField}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add Field
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Interactive Field Editor + Generated Python BaseModel */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-6">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="text-sm font-semibold text-slate-900">
                1. Configure Pydantic Fields
              </h3>
              <span className="text-xs text-slate-500 tabular-nums">
                {fields.length} {fields.length === 1 ? 'field' : 'fields'}
              </span>
            </div>

            <div className="space-y-3">
              {fields.map((field) => (
                <div
                  key={field.id}
                  className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5"
                >
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <label className="sr-only" htmlFor={`name-${field.id}`}>
                        Field name
                      </label>
                      <input
                        id={`name-${field.id}`}
                        type="text"
                        value={field.name}
                        onChange={(e) =>
                          updateField(field.id, {
                            name: e.target.value.replace(/[^a-zA-Z0-9_]/g, ''),
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                        placeholder="field_name"
                      />
                    </div>

                    <div className="col-span-4">
                      <label className="sr-only" htmlFor={`type-${field.id}`}>
                        Field type
                      </label>
                      <select
                        id={`type-${field.id}`}
                        value={field.type}
                        onChange={(e) =>
                          updateField(field.id, {
                            type: e.target.value as SchemaFieldConfig['type'],
                            literalOptions:
                              e.target.value === 'Literal'
                                ? field.literalOptions ?? ['positive', 'neutral', 'negative']
                                : field.literalOptions,
                          })
                        }
                        className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      >
                        <option value="str">str</option>
                        <option value="int">int</option>
                        <option value="float">float</option>
                        <option value="bool">bool</option>
                        <option value="list[str]">list[str]</option>
                        <option value="Literal">Literal[...]</option>
                      </select>
                    </div>

                    <div className="col-span-2 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => updateField(field.id, { required: !field.required })}
                        className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap cursor-pointer ${
                          field.required
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
                        }`}
                      >
                        {field.required ? 'Req' : 'Opt'}
                      </button>
                    </div>

                    <div className="col-span-1 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => removeField(field.id)}
                        disabled={fields.length <= 1}
                        aria-label={`Remove ${field.name}`}
                        className="p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="sr-only" htmlFor={`desc-${field.id}`}>
                      Field description for LLM
                    </label>
                    <input
                      id={`desc-${field.id}`}
                      type="text"
                      value={field.description}
                      onChange={(e) => updateField(field.id, { description: e.target.value })}
                      placeholder="Description sent to the LLM inside JSON Schema..."
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700">
                Resulting Python Pydantic Class
              </span>
              <span className="text-xs font-mono text-slate-500">models.py</span>
            </div>
            <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto">
              {pythonCode}
            </pre>
          </div>
        </div>

        {/* Right: JSON Schema Output OR Live Validation Tester */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 mb-4">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setRightView('schema')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    rightView === 'schema'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Generated JSON Schema
                </button>
                <button
                  type="button"
                  onClick={() => setRightView('validator')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    rightView === 'validator'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Test Validation Live
                </button>
              </div>

              <span className="text-xs font-mono text-slate-500">
                {rightView === 'schema'
                  ? 'TicketAnalysis.model_json_schema()'
                  : 'TicketAnalysis.model_validate_json()'}
              </span>
            </div>

            {rightView === 'schema' ? (
              <div>
                <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                  Your LLM API never executes Python. Instead, Pydantic emits this standard JSON Schema, which gets passed via{' '}
                  <code className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">
                    response_schema
                  </code>{' '}
                  or tool definitions so the LLM knows exact keys, enums, and descriptions.
                </p>
                <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto max-h-[420px]">
                  {JSON.stringify(jsonSchema, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500 mr-1">
                    Try LLM output:
                  </span>
                  <button
                    type="button"
                    onClick={() => applyPresetPayload('valid')}
                    className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Valid Output
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetPayload('out-of-range')}
                    className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Bad Enum / Range
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetPayload('wrong-type')}
                    className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Wrong Types
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetPayload('missing')}
                    className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Missing Fields
                  </button>
                </div>

                <div>
                  <label
                    htmlFor="live-json-input"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Simulated Raw JSON from LLM (editable)
                  </label>
                  <textarea
                    id="live-json-input"
                    value={testJson}
                    onChange={(e) => setTestJson(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    className="w-full p-3.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>

                {/* Live Validation Verdict */}
                {validationResult.parseError ? (
                  <div className="p-4 rounded-lg border border-rose-200 bg-rose-50">
                    <div className="flex items-center gap-2 text-xs font-semibold text-rose-800 mb-1">
                      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>INVALID JSON SYNTAX</span>
                    </div>
                    <p className="text-xs font-mono text-rose-700">
                      {validationResult.parseError}
                    </p>
                  </div>
                ) : validationResult.errors.length === 0 ? (
                  <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 mb-1">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>VALIDATION PASSED · READY FOR HTTP 200</span>
                    </div>
                    <p className="text-xs text-emerald-800">
                      All {fields.length} model rules passed. Your API can safely return this typed object.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-rose-800">
                      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>
                        VALIDATION ERROR ({validationResult.errors.length}{' '}
                        {validationResult.errors.length === 1 ? 'issue' : 'issues'})
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {validationResult.errors.map((err, idx) => (
                        <li
                          key={`${err.loc.join('.')}-${idx}`}
                          className="text-xs font-mono text-rose-800 bg-white/80 px-2.5 py-1.5 rounded border border-rose-200"
                        >
                          <span className="font-semibold">{err.loc.join('.')}</span>: {err.msg}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
