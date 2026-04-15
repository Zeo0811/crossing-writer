import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectList } from "./pages/ProjectList";
import { ProjectWorkbench } from "./pages/ProjectWorkbench";
import { ToastProvider } from "./components/ui/ToastProvider";
import { StylePanelsPage } from "./pages/StylePanelsPage.js";
import { KnowledgePage } from "./pages/KnowledgePage.js";
import { ConfigWorkbench } from "./pages/ConfigWorkbench";
import { MockApp } from "./mock/MockApp";

const qc = new QueryClient();

function isMockMode(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get("mock") === "1") {
    sessionStorage.setItem("crossing_mock", "1");
    return true;
  }
  if (url.searchParams.get("mock") === "0") {
    sessionStorage.removeItem("crossing_mock");
    return false;
  }
  return sessionStorage.getItem("crossing_mock") === "1" || url.pathname.startsWith("/mock");
}

export function App() {
  if (isMockMode()) return <MockApp />;
  return (
    <ToastProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ProjectList />} />
            <Route path="/projects/:id" element={<ProjectWorkbench />} />
            <Route path="/style-panels" element={<StylePanelsPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/config" element={<ConfigWorkbench />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ToastProvider>
  );
}
