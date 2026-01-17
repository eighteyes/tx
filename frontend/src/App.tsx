import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { MeshList } from './components/MeshList';
import { MeshEditor } from './components/MeshEditor';
import { MeshActivity } from './components/MeshActivity';
import { SessionRunner } from './components/SessionRunner';
import { Workspace } from './components/Workspace';
import { SessionsPage } from './components/SessionsPage';
import { LogsViewer } from './components/LogsViewer';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Router>
          <Layout>
            <Routes>
              {/* Dashboard - Home */}
              <Route path="/" element={<Dashboard />} />

              {/* Mesh routes */}
              <Route path="/meshes" element={<MeshList />} />
              <Route path="/meshes/:meshName" element={<MeshEditor />} />
              <Route path="/meshes/:meshName/activity" element={<MeshActivity />} />
              <Route path="/meshes/:meshName/run" element={<SessionRunner />} />
              <Route path="/meshes/:meshName/run/:sessionId" element={<SessionRunner />} />

              {/* Workspace file browser */}
              <Route path="/workspace" element={<Workspace />} />

              {/* Sessions list */}
              <Route path="/sessions" element={<SessionsPage />} />

              {/* Logs viewer */}
              <Route path="/logs" element={<LogsViewer />} />
            </Routes>
          </Layout>
        </Router>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
