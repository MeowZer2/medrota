import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { AppProvider, useUser } from './context/AppContext';
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

function ProtectedRoute({ children, allowWithoutProgram = false }) {
  const { currentUser, hasProgram, loading } = useUser();
  const location = useLocation();

  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#F8FAFC' }} aria-label="Loading application" />;
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
      <Routes location={location} key={location.pathname}>
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
        <Route path="/blocks/:blockNumber"                  element={<ProtectedRoute><BlockPage /></ProtectedRoute>} />
        <Route path="/blocks/:blockNumber/residents"        element={<ProtectedRoute><BlockResidents /></ProtectedRoute>} />
        <Route path="/blocks/:blockNumber/calendar"         element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
        <Route path="/blocks/:blockNumber/settings"         element={<ProtectedRoute><BlockSettings /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to={loading || currentUser ? '/dashboard' : '/login'} replace />} />
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
