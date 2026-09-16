import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { AppProvider, useUser } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Residents from './pages/Residents';
import BlockPage from './pages/BlockPage';
import BlockResidents from './pages/BlockResidents';
import AttendingSchedule from './pages/AttendingSchedule';
import Calendar from './pages/Calendar';
import Setup from './pages/Setup';
import PublicSchedule from './pages/PublicSchedule';
import BlockSettings from './pages/BlockSettings';
import ProgramSettings from './pages/ProgramSettings';
import JoinProgram from './pages/JoinProgram';
import BlockWorkspace from './components/BlockWorkspace';

function ProtectedRoute({ children, allowWithoutProgram = false }) {
  const { currentUser, hasProgram, loading } = useUser();
  const location = useLocation();

  if (loading) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg-canvas)' }} aria-label="Loading application" />;
  }
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!hasProgram && !allowWithoutProgram) {
    return <Navigate to="/setup" replace />;
  }
  return children;
}

function AnimatedRoutes() {
  const location = useLocation();
  const { currentUser, loading } = useUser();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname.startsWith('/blocks/') ? 'block-workspace' : location.pathname}>
        {/* ── Public (no auth required) ──────────────────────────── */}
        <Route path="/login"              element={<Login />} />
        <Route path="/register"           element={<Register />} />
        <Route path="/setup"              element={<ProtectedRoute allowWithoutProgram><Setup /></ProtectedRoute>} />
        <Route path="/schedule/:token"    element={<PublicSchedule />} />
        <Route path="/join/:token"        element={<JoinProgram />} />

        {/* ── Protected ──────────────────────────────────────────── */}
        <Route path="/dashboard"          element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/residents"          element={<ProtectedRoute><Residents /></ProtectedRoute>} />
        <Route path="/attending"          element={<ProtectedRoute><AttendingSchedule /></ProtectedRoute>} />
        <Route path="/calendar"           element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
        <Route path="/settings"           element={<ProtectedRoute><ProgramSettings /></ProtectedRoute>} />
        <Route path="/blocks/:blockNumber" element={<ProtectedRoute><BlockWorkspace /></ProtectedRoute>}>
          <Route index element={<BlockPage />} />
          <Route path="residents" element={<BlockResidents />} />
          <Route path="attending" element={<AttendingSchedule />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="settings" element={<BlockSettings />} />
        </Route>

        <Route path="*" element={<Navigate to={loading || currentUser ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <ThemeProvider>
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
                boxShadow: 'var(--shadow-lg)',
                padding: '12px 16px',
                color: 'var(--ink-1)',
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-1)',
              },
              success: {
                iconTheme: { primary: 'var(--success)', secondary: 'var(--on-success)' },
              },
              error: {
                iconTheme: { primary: 'var(--danger)', secondary: 'var(--on-danger)' },
              },
            }}
          />
          <AnimatedRoutes />
        </BrowserRouter>
      </AppProvider>
    </ThemeProvider>
  );
}
