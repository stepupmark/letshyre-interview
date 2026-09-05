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
