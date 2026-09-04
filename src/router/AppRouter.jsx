/**
 * AppRouter.jsx
 *
 * Bootstraps the React Router v7 data router from the central route config.
 * This is the ONLY place createBrowserRouter is called.
 *
 * Usage: <AppRouter /> replaces the entire routing setup in App.jsx.
 */

import { createBrowserRouter, RouterProvider } from "react-router";
import { routeDefinitions } from "./routeConfig";

// Build the router once at module level (not inside a component) so it is
// never recreated on re-renders.
const router = createBrowserRouter(routeDefinitions);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
