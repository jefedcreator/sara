import axios from 'axios';
import { signOut } from 'next-auth/react';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Don't auto-redirect to logout as it causes infinite loops for guests
      console.warn('Unauthorized access (401)');
      await signOut({ redirectTo: '/login' });
    }
    return Promise.reject(error);
  }
);

export default api;
