import axios from 'axios';
import { getApiBase } from './base';

const api = axios.create({
  baseURL: getApiBase(),
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    const status = error?.response?.status;
    const url = error?.config?.url ?? '';
    const isCredentialAttempt = url.includes('/auth/login') || url.includes('/auth/register');
    if (status === 401 && !isCredentialAttempt) {
      localStorage.removeItem('token');
      window.dispatchEvent(new CustomEvent('medrota:auth-expired'));
    }
    return Promise.reject(error);
  },
);

export default api;
