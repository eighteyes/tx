import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { MeshList } from './components/MeshList';
import { MeshEditor } from './components/MeshEditor';
import { SessionRunner } from './components/SessionRunner';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Router>
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to="/meshes" replace />} />
              <Route path="/meshes" element={<MeshList />} />
              <Route path="/meshes/:meshName" element={<MeshEditor />} />
              {/* Session routes */}
              <Route path="/meshes/:meshName/run" element={<SessionRunner />} />
              <Route path="/meshes/:meshName/run/:sessionId" element={<SessionRunner />} />
            </Routes>
          </Layout>
        </Router>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
