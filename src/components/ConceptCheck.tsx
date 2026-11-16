import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { QUIZ_QUESTIONS } from '../data/learningData';

export const ConceptCheck: React.FC = () => {
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const answeredCount = Object.keys(answers).length;
  const correctCount = QUIZ_QUESTIONS.filter(
    (q) => answers[q.id] === q.correctIndex
  ).length;

  return (
    <section id="concept-check" className="scroll-mt-20 pt-12 border-t border-slate-200">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-sky-700 mb-1.5">
            04. Concept Check
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            Verify Your Mental Model
          </h2>
          <p className="mt-2 text-base text-slate-600 leading-relaxed">
            Test your understanding of where the API, Pydantic, and the LLM each take responsibility.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <span className="text-sm font-medium text-slate-600 tabular-nums">
            {correctCount} of {QUIZ_QUESTIONS.length} verified
          </span>
          {answeredCount > 0 && (
            <button
              type="button"
              onClick={() => setAnswers({})}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset Quiz
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {QUIZ_QUESTIONS.map((q, qIndex) => {
          const picked = answers[q.id];
          const hasAnswered = picked !== undefined;
          const isCorrect = picked === q.correctIndex;

          return (
            <div
              key={q.id}
              className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2 tabular-nums">
                  Question 0{qIndex + 1}
                </div>
                <h3 className="text-base font-semibold text-slate-900 leading-snug mb-4">
                  {q.prompt}
                </h3>

                <div className="space-y-2">
                  {q.options.map((opt, optIdx) => {
                    const isThisPicked = picked === optIdx;
                    const isThisCorrect = optIdx === q.correctIndex;

                    let optionStyle =
                      'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-white text-slate-800';
                    if (hasAnswered) {
                      if (isThisCorrect) {
                        optionStyle =
                          'border-emerald-300 bg-emerald-50 text-emerald-950 font-medium';
                      } else if (isThisPicked && !isThisCorrect) {
                        optionStyle = 'border-rose-300 bg-rose-50 text-rose-950';
                      } else {
                        optionStyle = 'border-slate-200 bg-white text-slate-500';
                      }
                    }

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: optIdx }))}
                        className={`w-full text-left px-3.5 py-2.5 rounded-lg border text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${optionStyle}`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>

              {hasAnswered && (
                <div
                  className={`p-3.5 rounded-lg border text-xs leading-relaxed ${
                    isCorrect
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-rose-200 bg-rose-50 text-rose-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold mb-1">
                    {isCorrect ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>CORRECT</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>NOT QUITE</span>
                      </>
                    )}
                  </div>
                  <p>{q.explanation}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
