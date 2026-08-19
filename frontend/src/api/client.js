import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

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
      return "Unable to connect to authentication server. Please verify the backend is running at " + API_BASE_URL;
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
  return err.response.data?.message || defaultMsg;
};

// --- Auth APIs ---
export const signup = (data) => api.post("/auth/signup", data);
export const verifyOtp = (data) => api.post("/auth/verify-otp", data);
export const resendOtp = (data) => api.post("/auth/resend-otp", data);
export const login = (data) => api.post("/auth/login", data);
export const googleLogin = (id_token) => api.post("/auth/google-login", { id_token });
export const fetchUserProfile = () => api.get("/auth/me");
export const updateSocialLinks = (data) => api.post("/auth/social-links", data);

// --- Core FinGraph APIs ---
export const fetchStats = () => api.get("/api/stats");
export const fetchAccounts = (limit = 100) => api.get("/api/accounts", { params: { limit } });
export const fetchTransactions = (limit = 100) => api.get("/api/transactions", { params: { limit } });
export const fetchFraudAlerts = (limit = 100) => api.get("/api/fraud-alerts", { params: { limit } });
export const fetchFraudAlertDetail = (alertId) => api.get(`/api/fraud-alerts/${alertId}`);
export const graphOverview = (limit = 300) => api.get("/api/graph", { params: { limit } });
export const runDetection = () => api.post("/api/fraud/detect");

export const uploadCsv = (file) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/api/data/upload-csv", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const generateData = (params) => api.post("/api/data/generate", null, { params });

export default api;
