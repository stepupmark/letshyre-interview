/**
 * routeConfig.jsx
 *
 * THE single source of truth for all application routes.
 * Consumed exclusively by AppRouter — no route definitions live elsewhere.
 */

import { EntryPoint } from "@/pages/EntryPoint";
import { privateLoader } from "./privateLoader";
import NotFoundPage from "@/pages/PageNotFound";
import { RouteErrorBoundary } from "@/pages/RouteError";
import { InterviewFlowGuard } from "./InterviewFlowGuard";

export const routeDefinitions = [
  {
    path: "/",
    Component: EntryPoint,
    ErrorBoundary: RouteErrorBoundary,
  },

  {
    loader: privateLoader,
    element: <InterviewFlowGuard />,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      {
        path: "/interview",
        lazy: async () => {
          const { Interview } = await import("@/pages/Interview");
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
    ErrorBoundary: RouteErrorBoundary,
  },

  {
    path: "*",
    Component: NotFoundPage,
    ErrorBoundary: RouteErrorBoundary,
  },
];
