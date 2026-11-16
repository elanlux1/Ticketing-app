import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Globe,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SkipBack,
  SkipForward,
  AlertTriangle,
  MinusCircle,
  RefreshCw,
} from 'lucide-react';
import {
  MODE_OPTIONS,
  SCENARIOS,
  ScenarioId,
  SimulationMode,
  StageSnapshot,
} from '../data/learningData';

interface PipelineSimulatorProps {
  playSignal: number;
}

type InspectorTab = 'artifact' | 'checks' | 'schema';

export const PipelineSimulator: React.FC<PipelineSimulatorProps> = ({ playSignal }) => {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('ticket');
  const [mode, setMode] = useState<SimulationMode>('happy');
  const [activeStage, setActiveStage] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('artifact');

  const scenario = SCENARIOS[scenarioId];
  const stages = scenario.modes[mode];
  const currentStage: StageSnapshot = stages[activeStage] ?? stages[0];

  useEffect(() => {
    if (playSignal > 0) {
      setActiveStage(0);
      setIsPlaying(true);
    }
  }, [playSignal]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setActiveStage((prev) => {
        if (prev >= stages.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isPlaying, stages.length]);

  const handleSelectScenario = (id: ScenarioId) => {
    setScenarioId(id);
    setActiveStage(0);
    setIsPlaying(false);
  };

  const handleSelectMode = (nextMode: SimulationMode) => {
    setMode(nextMode);
    setActiveStage(0);
    setIsPlaying(false);
  };

  const getStageIcon = (id: StageSnapshot['id']) => {
    switch (id) {
      case 'client':
        return <Globe className="w-4 h-4" aria-hidden="true" />;
      case 'input-gate':
        return <ShieldCheck className="w-4 h-4" aria-hidden="true" />;
      case 'llm':
        return <Cpu className="w-4 h-4" aria-hidden="true" />;
      case 'output-gate':
        return <ShieldAlert className="w-4 h-4" aria-hidden="true" />;
      case 'response':
        return <Globe className="w-4 h-4" aria-hidden="true" />;
    }
  };

  const getStatusStyle = (kind: StageSnapshot['statusKind']) => {
    switch (kind) {
      case 'nominal':
        return {
          text: 'text-emerald-700',
          bg: 'bg-emerald-50',
          border: 'border-emerald-200',
          ring: 'ring-emerald-600/20',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />,
        };
      case 'error':
        return {
          text: 'text-rose-700',
          bg: 'bg-rose-50',
          border: 'border-rose-200',
          ring: 'ring-rose-600/20',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-700 shrink-0" aria-hidden="true" />,
        };
      case 'warning':
        return {
          text: 'text-amber-800',
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          ring: 'ring-amber-600/20',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />,
        };
      case 'active':
        return {
          text: 'text-sky-700',
          bg: 'bg-sky-50',
          border: 'border-sky-200',
          ring: 'ring-sky-600/20',
          icon: <Cpu className="w-3.5 h-3.5 text-sky-700 shrink-0" aria-hidden="true" />,
        };
    }
  };

  return (
    <section id="pipeline" className="scroll-mt-20">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-sky-700 mb-1.5">
            01. Interactive Request Pipeline
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
            How APIs, LLMs, and Pydantic Work Together
          </h1>
          <p className="mt-2 text-base text-slate-600 leading-relaxed">
            An API enforces strict HTTP contracts, an LLM reasons over messy language, and Pydantic bridges them by validating inputs and turning Python classes into JSON Schemas.
          </p>
        </div>

        {/* Scenario Switcher */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200 shrink-0">
          {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => {
            const active = id === scenarioId;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleSelectScenario(id)}
                className={`px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                  active
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {SCENARIOS[id].name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode Selector Bar */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {MODE_OPTIONS.map((opt) => {
          const selected = opt.id === mode;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelectMode(opt.id)}
              className={`text-left p-4 rounded-xl border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                selected
                  ? 'bg-white border-slate-900 shadow-sm'
                  : 'bg-white/70 border-slate-200 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                  {opt.label}
                </span>
                {selected && (
                  <span className="text-xs font-medium text-sky-700 whitespace-nowrap">
                    Selected
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{opt.shortNote}</p>
            </button>
          );
        })}
      </div>

      {/* Two-Zone Sandbox Layout: Left Stage (65%) + Right Inspector Deck (35%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Zone: Interactive Signal Flow Stage */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-600 font-mono">
                <span className="font-semibold text-slate-900">{scenario.endpoint}</span>
                <span aria-hidden="true">·</span>
                <span>{scenario.inputModelName}</span>
                <span aria-hidden="true">-&gt;</span>
                <span>{scenario.outputModelName}</span>
              </div>
              <div className="text-xs font-medium text-slate-600 tabular-nums">
                Step {activeStage + 1} of {stages.length}
              </div>
            </div>

            {/* 5-Node Interactive Flow Diagram */}
            <div className="my-6 space-y-3">
              {stages.map((stage, idx) => {
                const isSelected = idx === activeStage;
                const isPassed = idx < activeStage;
                const statusStyle = getStatusStyle(stage.statusKind);

                return (
                  <React.Fragment key={stage.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        setActiveStage(idx);
                      }}
                      className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                        isSelected
                          ? 'border-slate-900 bg-slate-50/90 shadow-sm'
                          : isPassed
                          ? 'border-slate-200 bg-white hover:border-slate-300'
                          : 'border-slate-200/80 bg-white/60 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                              isSelected
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {getStageIcon(stage.id)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="tabular-nums font-medium">0{idx + 1}</span>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{stage.roleLabel}</span>
                            </div>
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {stage.title}
                            </div>
                          </div>
                        </div>

                        <div
                          className={`flex items-center gap-1.5 text-xs font-mono font-semibold shrink-0 px-2.5 py-1 rounded-md border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                        >
                          {statusStyle.icon}
                          <span className="whitespace-nowrap">{stage.statusText}</span>
                        </div>
                      </div>

                      {isSelected && (
                        <p className="mt-3 pt-3 border-t border-slate-200 text-sm text-slate-700 leading-relaxed">
                          {stage.summary}
                        </p>
                      )}
                    </button>

                    {idx < stages.length - 1 && (
                      <div className="flex items-center justify-center py-0.5" aria-hidden="true">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <div
                            className={`w-px h-3 ${
                              idx < activeStage ? 'bg-sky-600' : 'bg-slate-200'
                            }`}
                          />
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Playback Controls */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4" aria-hidden="true" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" aria-hidden="true" />
                    Play Full Flow
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setActiveStage((prev) => Math.max(0, prev - 1));
                }}
                disabled={activeStage === 0}
                aria-label="Step Back"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                <SkipBack className="w-4 h-4" aria-hidden="true" />
                Back
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setActiveStage((prev) => Math.min(stages.length - 1, prev + 1));
                }}
                disabled={activeStage === stages.length - 1}
                aria-label="Step Forward"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                Next
                <SkipForward className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setActiveStage(0);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>

        {/* Right Zone: Control & Live Concept Inspector Deck */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <p className="text-xs font-medium text-slate-500">
                  Stage 0{activeStage + 1} Inspector
                </p>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  {currentStage.title}
                </h2>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setInspectorTab('artifact')}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inspectorTab === 'artifact'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Data
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('checks')}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inspectorTab === 'checks'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Checks
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('schema')}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    inspectorTab === 'schema'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Models
                </button>
              </div>
            </div>

            {/* Inspector Body */}
            <div className="mt-5">
              {inspectorTab === 'artifact' && (
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                    <span className="font-medium text-slate-700">
                      {currentStage.artifactLabel}
                    </span>
                    <span className="font-mono">
                      {currentStage.id === 'input-gate' || currentStage.id === 'output-gate'
                        ? 'Python / Pydantic'
                        : 'JSON / HTTP'}
                    </span>
                  </div>
                  <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap break-words">
                    {currentStage.artifactContent}
                  </pre>
                </div>
              )}

              {inspectorTab === 'checks' && (
                <div className="space-y-2.5">
                  {currentStage.checks.length === 0 ? (
                    <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
                      No active validation rules ran at this bypassed step.
                    </div>
                  ) : (
                    currentStage.checks.map((check, i) => (
                      <div
                        key={`${check.field}-${i}`}
                        className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs font-mono font-semibold text-slate-900">
                            <span>{check.field}</span>
                            <span aria-hidden="true" className="text-slate-400">
                              ·
                            </span>
                            <span className="text-slate-600 font-normal">{check.rule}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">{check.detail}</p>
                        </div>

                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold shrink-0 whitespace-nowrap ${
                            check.status === 'pass'
                              ? 'text-emerald-700'
                              : check.status === 'fail'
                              ? 'text-rose-700'
                              : check.status === 'repaired'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {check.status === 'pass' && (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                              PASS
                            </>
                          )}
                          {check.status === 'fail' && (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                              FAIL
                            </>
                          )}
                          {check.status === 'repaired' && (
                            <>
                              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                              REPAIRED
                            </>
                          )}
                          {check.status === 'skipped' && (
                            <>
                              <MinusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                              SKIPPED
                            </>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {inspectorTab === 'schema' && (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-medium text-slate-700 mb-1.5">
                      Gate 1 Input Contract ({scenario.inputModelName})
                    </div>
                    <pre className="p-3.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto">
                      {scenario.pydanticInputCode}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-700 mb-1.5">
                      Gate 2 Output Contract ({scenario.outputModelName})
                    </div>
                    <pre className="p-3.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto">
                      {scenario.pydanticOutputCode}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Contextual Takeaway Note (Always visible, tied to active stage) */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-semibold text-slate-900">
                Why This Step Matters
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-sky-700 font-medium">
                Key Takeaway
                <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              {currentStage.conceptNote}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
