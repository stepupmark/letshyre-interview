/**
 * routeConfig.jsx
 *
 * THE single source of truth for all application routes.
 * Consumed exclusively by AppRouter — no route definitions live elsewhere.
 */

import { EntryPoint } from "@/pages/EntryPoint";
import { privateLoader } from "./PrivateRoute";
import NotFoundPage from "@/pages/PageNotFound";
import { ErrorBoundary } from "@/pages/Error";
import { InterviewFlowGuard } from "./InterviewFlowGuard";

export const routeDefinitions = [
  {
    path: "/",
    Component: EntryPoint,
    ErrorBoundary: ErrorBoundary,
  },

  {
    loader: privateLoader,
    element: <InterviewFlowGuard />,
    ErrorBoundary: ErrorBoundary,
    children: [
      {
        path: "/interview",
        lazy: async () => {
          const { Interview } = await import("@/pages/interview");
          return { Component: Interview };
        },
      },
    ],
  },

  {
    path: "/unauthorized-access",
    lazy: async () => {
      const { UnauthorizedAccess } = await import("@/pages/UnauthorizedAccess");
      return { Component: UnauthorizedAccess };
    },
    ErrorBoundary: ErrorBoundary,
  },

  {
    path: "*",
    Component: NotFoundPage,
    ErrorBoundary: ErrorBoundary,
  },
];
