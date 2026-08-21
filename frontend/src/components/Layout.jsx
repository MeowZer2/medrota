import { useState } from 'react';
import Sidebar from './Sidebar';
import ThemeToggle from './ThemeToggle';

export default function Layout({ children }) {
  const [activeBlock, setActiveBlock] = useState(3);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  let userName = '';
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userName = payload.email || '';
    }
  } catch {
    // ignore malformed token
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar
          activeBlock={activeBlock}
          onBlockSelect={setActiveBlock}
          userName={userName}
        />
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0"
            style={{ background: 'var(--overlay)' }}
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-50 h-full">
            <Sidebar
              activeBlock={activeBlock}
              onBlockSelect={(id) => { setActiveBlock(id); setSidebarOpen(false); }}
              userName={userName}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 md:ml-[220px] min-w-0">
        {/* Mobile top bar */}
        <header
          className="flex md:hidden items-center justify-between px-4 py-3 sticky top-0 z-30"
          style={{ background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--sidebar-border)' }}
        >
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-1)', lineHeight: 1.2 }}>MedRota</p>
            <p style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 1 }}>Vascular Surgery</p>
          </div>
          <div className="flex items-center gap-1">
            {/* The sidebar's three-way control does not fit here, so the phone
                header gets a straight light/dark flip. */}
            <ThemeToggle variant="icon" />
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg transition-colors duration-100"
              style={{ color: 'var(--ink-4)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              aria-label="Open menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </header>

        <main className="animated-bg flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
