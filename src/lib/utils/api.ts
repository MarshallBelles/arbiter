import axios from 'axios';
import { createLogger } from '@/lib/core/utils/logger';

const logger = createLogger('WebAPI');

export const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add any auth headers here if needed
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Handle common errors here
    if (error.response?.status === 401) {
      // Handle unauthorized
      logger.error('Unauthorized access', { status: 401 });
    } else if (error.response?.status === 500) {
      // Handle server errors
      logger.error('Server error', { 
        status: 500, 
        data: error.response.data 
      });
    }
    return Promise.reject(error);
  }
);

export default api;