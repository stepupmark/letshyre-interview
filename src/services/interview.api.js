import { api } from "./axiosClient.api";

export async function fetchQuestion(payload) {
  const response = await api.post(`/user/v1/candidate/interview/ai/start/`, payload || {}, {
    headers: { "Content-Type": "application/json" },
  });
  return response.data;
}

export async function submitAnswer(formData) {
  const response = await api.post(`/user/v1/candidate/interview/ai/answer/`, formData);
  return response.data;
}

export async function autoSubmitInterview(payload) {
  const response = await api.post(`/user/v1/candidate/interview/ai/auto_submit/force/`, payload);
  return response.data;
}
export async function enrollVoice() {
  const response = await api.post(`/user/v1/candidate/interview/voice_enroll/`);
  return response.data;
}

export async function compareVoice(formData) {
  const response = await api.post(`/user/v1/candidate/interview/voice_compare/`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}
