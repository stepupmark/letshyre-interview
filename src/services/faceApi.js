import axios from "axios";

const baseURL = `${import.meta.env.VITE_AI_DETECTION_URL}/continuous-verify`;

const apiClient = axios.create({
  baseURL,
  headers: {
    "Content-Type": "multipart/form-data",
  },
});

export const registerFace = async ({ session_id, imageFile }) => {
  const form = new FormData();
  form.append("session_id", session_id);
  form.append("image", imageFile);
  const response = await apiClient.post("verification/register-face", form);
  return response.data;
};

export const continuousVerify = async ({ session_id, imageFile }) => {
  const form = new FormData();
  form.append("session_id", session_id);
  form.append("image", imageFile);
  const response = await apiClient.post("verification/continuous-verify", form);
  return response.data;
};
