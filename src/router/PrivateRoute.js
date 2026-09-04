import { redirect } from "react-router";

export function privateLoader() {
  const accessToken = sessionStorage.getItem("ac");
  const refreshToken = sessionStorage.getItem("rc");

  const hasTokens = accessToken && refreshToken;

  if (!hasTokens) {
    return redirect("/unauthorized-access");
  }

  return null;
}
