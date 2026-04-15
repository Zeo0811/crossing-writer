import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { MockProvider } from "./MockProvider";
import { MockShell } from "./components/MockShell";
import { MockProjectList } from "./pages/MockProjectList";
import { MockProjectWorkbench } from "./pages/MockProjectWorkbench";
import { MockKnowledge } from "./pages/MockKnowledge";
import { MockStylePanels } from "./pages/MockStylePanels";
import { MockConfig } from "./pages/MockConfig";
import { MockSettings } from "./pages/MockSettings";

export function MockApp() {
  return (
    <BrowserRouter>
      <MockProvider>
        <MockShell>
          <Routes>
            <Route path="/mock" element={<MockProjectList />} />
            <Route path="/mock/projects/:id" element={<MockProjectWorkbench />} />
            <Route path="/mock/knowledge" element={<MockKnowledge />} />
            <Route path="/mock/style-panels" element={<MockStylePanels />} />
            <Route path="/mock/config" element={<MockConfig />} />
            <Route path="/mock/settings" element={<MockSettings />} />
            <Route path="*" element={<Navigate to="/mock" replace />} />
          </Routes>
        </MockShell>
      </MockProvider>
    </BrowserRouter>
  );
}
