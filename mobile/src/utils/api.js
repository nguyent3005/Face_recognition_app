import axios from 'axios';
import { getAccessToken, clearAuth } from './auth';
import { getApiBaseUrl } from '../config/apiConfig';
import { parseApiError } from './validation';

let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

const api = axios.create({
  headers: { 
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
  },
  timeout: 30000,
});

api.interceptors.request.use(
  async (config) => {
    config.baseURL = await getApiBaseUrl();
    const token = await getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    if (error.response?.status === 401) {
      await clearAuth();
      unauthorizedHandler?.();
    }

    const payload = error.response?.data;
    const message = parseApiError(payload || error);
    const err = new Error(message);
    err.status = error.response?.status;
    err.data = payload;
    return Promise.reject(err);
  }
);

// Auth
export const login = (data) => api.post('/auth/login', data);
export const getMe = () => api.get('/auth/me');

// Students
export const createStudent = (data) => api.post('/students', data);
export const createStudentWithFace = (formData) => api.post('/students/with-face', formData, {
  headers: {
    'Content-Type': 'multipart/form-data',
  },
});
export const registerStudentFace = (studentId, formData) => api.post(`/students/${studentId}/register-face`, formData, {
  headers: {
    'Content-Type': 'multipart/form-data',
  },
});
export const registerFaceVideo = (studentId, formData) => api.post(`/students/${studentId}/register-face-video`, formData, {
  headers: {
    'Content-Type': 'multipart/form-data',
  },
});
export const deleteStudent = (studentId) => api.delete(`/students/${studentId}`);

// Classes & Sessions
export const getClasses = () => api.get('/classes/');
export const getClassSessions = (classId) => api.get(`/classes/${classId}/sessions`);
export const getSessions = (params) => api.get('/sessions/', { params });
export const getSessionDetail = (sessionId) => api.get(`/sessions/${sessionId}`);
export const getSessionStudents = (sessionId) => api.get(`/sessions/${sessionId}/students`);

// Attendance
export const markAttendance = (payload) => api.post('/attendance/mark', payload);
export const markAttendanceVideo = (formData) => api.post('/attendance/mark-video', formData, {
  headers: {
    'Content-Type': 'multipart/form-data',
  },
});
export const scanAttendanceFrame = (payload) => api.post('/attendance/scan-frame', payload);
export const getAttendanceHistory = (params) => api.get('/attendance/history', { params });
export const getTodayAttendance = (sessionId) => api.get('/attendance/today', { params: { session_id: sessionId } });

// Dashboard
export const getStats = () => api.get('/reports/stats');
export const getTrend = (days) => api.get('/reports/trend', { params: { days } });
export const getStatusDistribution = (date) => api.get('/reports/distribution', { params: { date } });

Object.assign(api, {
  login, getMe, createStudent, createStudentWithFace, registerStudentFace, registerFaceVideo, deleteStudent,
  getClasses, getClassSessions, getSessions, getSessionDetail, getSessionStudents,
  markAttendance, markAttendanceVideo, scanAttendanceFrame, getAttendanceHistory, getTodayAttendance,
  getStats, getTrend, getStatusDistribution
});

export default api;
