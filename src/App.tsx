import { useState } from 'react';
import { ActiveView, TopNav } from './components/TopNav';
import { TicketingWorkspace } from './components/TicketingWorkspace';
import { PythonBackendView } from './components/PythonBackendView';
import { PipelineSimulator } from './components/PipelineSimulator';
import { SchemaLab } from './components/SchemaLab';
import { CodeBridge } from './components/CodeBridge';
import { ConceptCheck } from './components/ConceptCheck';

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>('tickets');
  const [openCreateSignal, setOpenCreateSignal] = useState(0);
  const [playSignal] = useState(0);

  const handleNewTicket = () => {
    setActiveView('tickets');
    setOpenCreateSignal((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <TopNav
        activeView={activeView}
        onSelectView={setActiveView}
        onNewTicket={handleNewTicket}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {activeView === 'tickets' && (
          <TicketingWorkspace
            openCreateSignal={openCreateSignal}
            onViewPythonCode={() => setActiveView('python')}
          />
        )}

        {activeView === 'python' && <PythonBackendView />}

        {activeView === 'pipeline' && (
          <div className="space-y-14">
            <PipelineSimulator playSignal={playSignal} />
            <CodeBridge />
          </div>
        )}

        {activeView === 'schema-lab' && (
          <div className="space-y-14">
            <SchemaLab />
            <ConceptCheck />
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>SchemaFlow · Ticketing App &amp; Python FastAPI / Pydantic Guide</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveView('tickets')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Tickets
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveView('python')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Python Code
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveView('pipeline')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Pipeline
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveView('schema-lab')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Schema Lab
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
