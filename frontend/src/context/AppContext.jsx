import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/axios';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentProgram, setCurrentProgram] = useState(null);
  const [currentBlock, setCurrentBlock] = useState(null);
  const [academicYears, setAcademicYears] = useState([]);
  const [currentAcademicYear, setCurrentAcademicYear] = useState(null);
  const [hasProgram, setHasProgram] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchProgram = useCallback(async () => {
    try {
      const { data } = await api.get('/programs/mine');

      setCurrentProgram({
        programId: data.programId,
        programName: data.programName,
        specialty: data.specialty,
        role: data.role,
        blocks: data.blocks,
      });

      const years = data.academicYears ?? [];
      setAcademicYears(years);

      // Pick the academic year that contains currentBlock (or today's block)
      setCurrentAcademicYear(prev => {
        if (prev) {
          // Keep previously selected year if it still exists
          const still = years.find(ay => ay.id === prev.id);
          if (still) return still;
        }
        // Default: year containing today's block
        const todayBlock = data.currentBlock;
        if (todayBlock) {
          const match = years.find(ay => ay.blocks.some(b => b.id === todayBlock.id));
          if (match) return match;
        }
        return years[0] ?? null;
      });

      setCurrentBlock(prev => {
        if (!prev) return data.currentBlock;
        // Refresh the current block with fresh data from API (e.g. isPublished, publicToken)
        const allBlocks = years.flatMap(ay => ay.blocks ?? []);
        const fresh = allBlocks.find(b => b.id === prev.id);
        return fresh ?? data.currentBlock;
      });
      setHasProgram(true);
      return true;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        setCurrentProgram(null);
        setCurrentBlock(null);
        setAcademicYears([]);
        setCurrentAcademicYear(null);
        setHasProgram(false);
        return false;
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Decode JWT from localStorage to get currentUser
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setCurrentUser({ userId: payload.userId, email: payload.email, name: payload.name });
      fetchProgram();
    } catch {
      setLoading(false);
    }
  }, [fetchProgram]);

  // Re-fetch program when token changes (login/logout).
  // Returns a promise so callers can await full context reload.
  function refreshContext() {
    const token = localStorage.getItem('token');
    if (!token) {
      setCurrentUser(null);
      setCurrentProgram(null);
      setCurrentBlock(null);
      setAcademicYears([]);
      setCurrentAcademicYear(null);
      setHasProgram(true);
      setLoading(false);
      return Promise.resolve();
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setCurrentUser({ userId: payload.userId, email: payload.email, name: payload.name });
    } catch { /* ignore */ }
    setLoading(true);
    return fetchProgram();
  }

  return (
    <AppContext.Provider value={{
      currentUser,
      currentProgram,
      currentBlock,
      setCurrentBlock,
      academicYears,
      currentAcademicYear,
      setCurrentAcademicYear,
      hasProgram,
      loading,
      refreshContext,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
