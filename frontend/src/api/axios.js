import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  console.log('[axios]', config.method?.toUpperCase(), config.baseURL + config.url, {
    hasAuth: !!config.headers.Authorization,
    body: config.data,
  });
  return config;
});

export default api;
