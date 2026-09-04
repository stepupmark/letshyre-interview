/**
 * App.tsx
 *
 * Root component. Delegates 100% of routing to AppRouter.
 * No route definitions, no <BrowserRouter>, no <Routes> here.
 */

import AppRouter from "@/router/AppRouter";
import { Toaster } from "sonner";

export default function App() {
  return (
    <>
      <AppRouter />
      <Toaster richColors position="top-center" />
    </>
  );
}
