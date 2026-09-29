import axios, { isAxiosError } from "axios";

const http = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Public endpoints (the customer booking page) never need a session, so a
    // 401 there is a real error, not an expired owner session.
    const isPublic = isAxiosError(error) && error.config?.url?.startsWith("/public");
    if (
      isAxiosError(error) &&
      error.response?.status === 401 &&
      !isPublic &&
      typeof window !== "undefined"
    ) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/signin?next=${encodeURIComponent(next)}`);
    }
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  },
);

/** The API's `{ message }` error body, or a plain fallback. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback;
  }
  return fallback;
}

export default http;
