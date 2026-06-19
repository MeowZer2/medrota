import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { AppProvider, useUser } from './context/AppContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Residents from './pages/Residents';
import BlockPage from './pages/BlockPage';
import AttendingSchedule from './pages/AttendingSchedule';
import Calendar from './pages/Calendar';
import Setup from './pages/Setup';
import PublicSchedule from './pages/PublicSchedule';
import BlockSettings from './pages/BlockSettings';
import ProgramSettings from './pages/ProgramSettings';
import JoinProgram from './pages/JoinProgram';

function AnimatedRoutes() {
  const location = useLocation();
  const { currentUser, hasProgram, loading } = useUser();

  // Public paths that skip auth redirect
  const isPublicPath =
    ['/login', '/register', '/setup'].includes(location.pathname) ||
    location.pathname.startsWith('/schedule/') ||
    location.pathname.startsWith('/join/');

  if (!loading && currentUser && !hasProgram && !isPublicPath) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        {/* ── Public (no auth required) ──────────────────────────── */}
        <Route path="/login"              element={<Login />} />
        <Route path="/register"           element={<Register />} />
        <Route path="/setup"              element={<Setup />} />
        <Route path="/schedule/:token"    element={<PublicSchedule />} />
        <Route path="/join/:token"        element={<JoinProgram />} />

        {/* ── Protected ──────────────────────────────────────────── */}
        <Route path="/dashboard"          element={<Dashboard />} />
        <Route path="/residents"          element={<Residents />} />
        <Route path="/attending"          element={<AttendingSchedule />} />
        <Route path="/calendar"           element={<Calendar />} />
        <Route path="/settings"           element={<ProgramSettings />} />
        <Route path="/blocks/:blockNumber"                  element={<BlockPage />} />
        <Route path="/blocks/:blockNumber/calendar"         element={<Calendar />} />
        <Route path="/blocks/:blockNumber/settings"         element={<BlockSettings />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 3000,
            style: {
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              borderRadius: 12,
              boxShadow: '0 8px 30px rgba(26,58,92,0.15)',
              padding: '12px 16px',
              color: '#1A3A5C',
              background: '#fff',
              border: '1px solid #E8EFF6',
            },
            success: {
              iconTheme: { primary: '#16A34A', secondary: '#fff' },
            },
            error: {
              iconTheme: { primary: '#DC2626', secondary: '#fff' },
            },
          }}
        />
        <AnimatedRoutes />
      </BrowserRouter>
    </AppProvider>
  );
}
