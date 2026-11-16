import React from 'react';

export type ActiveView = 'tickets' | 'python' | 'pipeline' | 'schema-lab';

interface TopNavProps {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  onNewTicket: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeView,
  onSelectView,
  onNewTicket,
}) => {
  const navItems: Array<{ id: ActiveView; label: string }> = [
    { id: 'tickets', label: 'Tickets' },
    { id: 'python', label: 'Python Code' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'schema-lab', label: 'Schema Lab' },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onSelectView('tickets')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded"
        >
          SchemaFlow
        </button>

        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`py-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer underline-offset-4 hover:underline ${
                  isActive
                    ? 'text-slate-900 font-semibold underline'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onNewTicket}
            className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 cursor-pointer"
          >
            New Ticket
          </button>
        </div>
      </div>

      {/* Compact mobile nav bar */}
      <div className="md:hidden border-t border-slate-200 px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium text-slate-600">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`py-1 whitespace-nowrap shrink-0 cursor-pointer ${
                isActive ? 'text-slate-900 font-semibold' : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </header>
  );
};
