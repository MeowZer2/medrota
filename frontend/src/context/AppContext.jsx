import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import api from '../api/axios';
import { hasPermission, normalizeRole, roleLabel } from '../constants/roles';

const AppContext = createContext(null);
const UserContext = createContext(null);
const BlockContext = createContext(null);

function decodeSessionToken(token) {
  const payload = JSON.parse(atob(token.split('.')[1]));
  if (!payload.userId || (payload.exp && payload.exp * 1000 <= Date.now())) {
    throw new Error('Expired or invalid session');
  }
  return payload;
}

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
        juniorInHouseCall: data.juniorInHouseCall ?? true,
        seniorInHouseCall: data.seniorInHouseCall ?? false,
        role: normalizeRole(data.role),
        roleLabel: roleLabel(data.role),
        permissions: data.permissions ?? [],
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
      const payload = decodeSessionToken(token);
      setCurrentUser({ userId: payload.userId, email: payload.email, name: payload.name });
      fetchProgram();
    } catch {
      localStorage.removeItem('token');
      setLoading(false);
    }
  }, [fetchProgram]);

  useEffect(() => {
    const clearExpiredSession = () => {
      setCurrentUser(null);
      setCurrentProgram(null);
      setCurrentBlock(null);
      setAcademicYears([]);
      setCurrentAcademicYear(null);
      setHasProgram(true);
      setLoading(false);
    };
    window.addEventListener('medrota:auth-expired', clearExpiredSession);
    return () => window.removeEventListener('medrota:auth-expired', clearExpiredSession);
  }, []);

  // Re-fetch program when token changes (login/logout).
  // Returns a promise so callers can await full context reload.
  const refreshContext = useCallback(() => {
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
      const payload = decodeSessionToken(token);
      setCurrentUser({ userId: payload.userId, email: payload.email, name: payload.name });
    } catch {
      localStorage.removeItem('token');
      setCurrentUser(null);
      setLoading(false);
      return Promise.resolve(false);
    }
    setLoading(true);
    return fetchProgram();
  }, [fetchProgram]);

  const userValue = useMemo(() => ({
    currentUser,
    currentProgram,
    currentRole: currentProgram?.role ?? null,
    currentRoleLabel: currentProgram?.roleLabel ?? null,
    can: (permission) => hasPermission(currentProgram?.role, permission, currentProgram?.permissions),
    hasProgram,
    loading,
    refreshContext,
  }), [currentUser, currentProgram, hasProgram, loading, refreshContext]);

  const blockValue = useMemo(() => ({
    currentBlock,
    setCurrentBlock,
    academicYears,
    currentAcademicYear,
    setCurrentAcademicYear,
  }), [currentBlock, academicYears, currentAcademicYear]);

  const appValue = useMemo(() => ({
    ...userValue,
    ...blockValue,
  }), [userValue, blockValue]);

  return (
    <UserContext.Provider value={userValue}>
      <BlockContext.Provider value={blockValue}>
        <AppContext.Provider value={appValue}>
          {children}
        </AppContext.Provider>
      </BlockContext.Provider>
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used inside AppProvider');
  return ctx;
}

export function useBlock() {
  const ctx = useContext(BlockContext);
  if (!ctx) throw new Error('useBlock must be used inside AppProvider');
  return ctx;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
