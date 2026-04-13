import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectList } from "./pages/ProjectList";
import { ProjectWorkbench } from "./pages/ProjectWorkbench";
import { ToastProvider } from "./components/ui/ToastProvider";

const qc = new QueryClient();

export function App() {
  return (
    <ToastProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ProjectList />} />
            <Route path="/projects/:id" element={<ProjectWorkbench />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ToastProvider>
  );
}
