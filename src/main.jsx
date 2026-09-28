import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./index.css";
import "./i18n";
import App from "./App.jsx";

// Single QueryClient instance — created outside the component tree so it is
// never re-instantiated on re-renders.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes
      retry: 1,
    },
    mutations: {
      // Don't auto-retry mutations (e.g. login) to avoid duplicate POSTs.
      retry: 0,
    },
  },
});

function mount(DevPage) {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <Suspense fallback={null}>
        <QueryClientProvider client={queryClient}>
          {DevPage ? <DevPage /> : <App />}
        </QueryClientProvider>
      </Suspense>
    </StrictMode>,
  );
}

// Dev tools (fake desktop, mock backend, log timeline) never reach a production build.
if (import.meta.env.DEV) {
  import("./dev/setup.js")
    .then(({ setupDevTools }) => setupDevTools())
    .then(mount, (error) => {
      console.error("[dev tools] setup failed:", error);
      mount();
    });
} else {
  mount();
}
