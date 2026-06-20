export function getApiBase() {
  const configured = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE;
  return configured ? configured.replace(/\/$/, '') : '/api';
}
