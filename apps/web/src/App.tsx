import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Workflows } from './pages/Workflows';
import { WorkflowDesigner } from './pages/WorkflowDesigner';
import { Agents } from './pages/Agents';
import { Events } from './pages/Events';
import { Settings } from './pages/Settings';
import RunViewer from './components/RunViewer';
import { ToastProvider } from './hooks/useToast';

function App() {
  return (
    <ToastProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/workflows/:id/designer" element={<WorkflowDesigner />} />
          <Route path="/workflows/new" element={<WorkflowDesigner />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/events" element={<Events />} />
          <Route path="/runs" element={<RunViewer />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}

export default App;