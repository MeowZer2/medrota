import { useState } from 'react';
import Sidebar from './Sidebar';

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
            style={{ background: 'rgba(15,23,42,0.34)' }}
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
          className="flex md:hidden items-center justify-between px-4 py-3 bg-white sticky top-0 z-30"
          style={{ borderBottom: '1px solid #E8EFF6' }}
        >
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#1A3A5C', lineHeight: 1.2 }}>MedRota</p>
            <p style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>Vascular Surgery</p>
          </div>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg transition-colors duration-100"
            style={{ color: '#64748B' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F0F5FF'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </header>

        <main className="animated-bg flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
