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

export default api;
