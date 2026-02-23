import api from './api';

// Pure API helpers for auth (no React / JSX here)
export async function loginApi(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function registerApi(email, password, name) {
  const { data } = await api.post('/auth/register', { email, password, name });
  return data;
}
