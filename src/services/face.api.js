import { aiDetectionClient } from "./clients/aiDetection";

export const registerFace = async ({ session_id, imageFile }) => {
  const form = new FormData();
  form.append("session_id", session_id);
  form.append("image", imageFile);
  const response = await aiDetectionClient.post(
    "/continuous-verify/verification/register-face",
    form,
  );
  return response.data;
};

export const continuousVerify = async ({ session_id, imageFile }) => {
  const form = new FormData();
  form.append("session_id", session_id);
  form.append("image", imageFile);
  const response = await aiDetectionClient.post(
    "/continuous-verify/verification/continuous-verify",
    form,
  );
  return response.data;
};
