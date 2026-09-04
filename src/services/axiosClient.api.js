import axios from "axios";
import { STORAGE_KEY as LANGUAGE_STORAGE_KEY } from "@/i18n";
import { DEFAULT_LANGUAGE } from "@/i18n/languages";

export const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_BASE_URL}/`,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem("ac");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    config.headers["Accept-Language"] =
      sessionStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE;

    return config;
  },
  (error) => Promise.reject(error),
);

let isRefreshing = false;

let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve(token);
    }
  });

  failedQueue = [];
};

const clearSession = () => {
  sessionStorage.removeItem("ac");
  sessionStorage.removeItem("rc");

  window.location.href = "/unauthorized-access";
};

api.interceptors.response.use(
  (response) => response,

  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Prevent refresh loop
    if (originalRequest.url?.includes("/user/v1/login_refresh/")) {
      clearSession();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token) => {
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          },
          reject,
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const response = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/user/v1/login_refresh/`,
        {
          refresh_token: sessionStorage.getItem("rc"),
        },
      );

      const newAccessToken = response.data.access_token;
      const newRefreshToken = response.data.refresh_token;

      sessionStorage.setItem("ac", newAccessToken);
      sessionStorage.setItem("rc", newRefreshToken);

      api.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`;

      processQueue(null, newAccessToken);

      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;

      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);

      clearSession();

      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);
