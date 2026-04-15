import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { MockProvider } from "./MockProvider";
import { MockShell } from "./components/MockShell";
import { MockHome } from "./pages/MockHome";
import { MockPlaceholder } from "./pages/MockPlaceholder";

export function MockApp() {
  return (
    <BrowserRouter>
      <MockProvider>
        <MockShell>
          <Routes>
            <Route path="/mock" element={<MockHome />} />
            <Route path="/mock/projects/:id" element={<MockPlaceholder checkpoint={1} label="ProjectWorkbench (Hero)" />} />
            <Route path="/mock/knowledge" element={<MockPlaceholder checkpoint={9} label="Knowledge" />} />
            <Route path="/mock/style-panels" element={<MockPlaceholder checkpoint={9} label="Style Panels" />} />
            <Route path="/mock/config" element={<MockPlaceholder checkpoint={9} label="Config Workbench" />} />
            <Route path="/mock/settings" element={<MockPlaceholder checkpoint={9} label="Settings" />} />
            <Route path="*" element={<Navigate to="/mock" replace />} />
          </Routes>
        </MockShell>
      </MockProvider>
    </BrowserRouter>
  );
}
