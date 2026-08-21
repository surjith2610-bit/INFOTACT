import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:5001";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// Attach JWT token automatically if stored in localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("fingraph_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Helper to extract human-readable error messages from Axios / FastAPI responses
export const getErrorMessage = (err, defaultMsg = "An unexpected error occurred. Please try again.") => {
  if (!err) return defaultMsg;
  if (!err.response) {
    if (err.code === "ERR_NETWORK" || err.message === "Network Error") {
      return "Unable to connect to FinGraph backend API. Please verify backend is running at " + API_BASE_URL;
    }
    return err.message || defaultMsg;
  }

  const detail = err.response.data?.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg || item.message || JSON.stringify(item)).join(". ");
  }
  if (detail && typeof detail === "object") {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return err.response.data?.message || err.response.statusText || defaultMsg;
};

// --- Core FinGraph APIs ---
export const fetchStats = () => api.get("/api/stats");
export const fetchAccounts = (limit = 100) => api.get("/api/accounts", { params: { limit } });
export const fetchTransactions = (limit = 100) => api.get("/api/transactions", { params: { limit } });
export const fetchFraudAlerts = (limit = 100) => api.get("/api/fraud-alerts", { params: { limit } });
export const fetchFraudAlertDetail = (alertId) => api.get(`/api/fraud-alerts/${alertId}`);
export const submitAlertFeedback = (alertId, status, notes = "") =>
  api.post(`/api/fraud-alerts/${alertId}/feedback`, { status, notes });

export const graphOverview = (limit = 300) => api.get("/api/graph", { params: { limit } });
export const runDetection = () => api.post("/api/fraud/detect");

export const uploadCsv = (file) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/api/data/upload-csv", form);
};

export const generateData = (params) => api.post("/api/data/generate", null, { params });

// --- Auth APIs ---
export const loginUser = (email, password) => api.post("/api/auth/login", { email, password });
export const registerUser = (email, password, name, role = "ANALYST") =>
  api.post("/api/auth/register", { email, password, name, role });
export const fetchCurrentUser = () => api.get("/api/auth/me");

export default api;
