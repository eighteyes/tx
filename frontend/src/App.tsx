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
import { CoreChat } from './components/CoreChat';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary, RouteErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Router>
          <Layout>
            <Routes>
              {/* Dashboard - Home */}
              <Route path="/" element={
                <RouteErrorBoundary name="Dashboard">
                  <Dashboard />
                </RouteErrorBoundary>
              } />

              {/* Mesh routes */}
              <Route path="/meshes" element={
                <RouteErrorBoundary name="Mesh List">
                  <MeshList />
                </RouteErrorBoundary>
              } />
              <Route path="/meshes/:meshName" element={
                <RouteErrorBoundary name="Mesh Editor">
                  <MeshEditor />
                </RouteErrorBoundary>
              } />
              <Route path="/meshes/:meshName/activity" element={
                <RouteErrorBoundary name="Mesh Activity">
                  <MeshActivity />
                </RouteErrorBoundary>
              } />
              <Route path="/meshes/:meshName/run" element={
                <RouteErrorBoundary name="Session Runner">
                  <SessionRunner />
                </RouteErrorBoundary>
              } />
              <Route path="/meshes/:meshName/run/:sessionId" element={
                <RouteErrorBoundary name="Session Runner">
                  <SessionRunner />
                </RouteErrorBoundary>
              } />

              {/* Workspace file browser */}
              <Route path="/workspace" element={
                <RouteErrorBoundary name="Workspace">
                  <Workspace />
                </RouteErrorBoundary>
              } />

              {/* Sessions list */}
              <Route path="/sessions" element={
                <RouteErrorBoundary name="Sessions">
                  <SessionsPage />
                </RouteErrorBoundary>
              } />

              {/* Logs viewer */}
              <Route path="/logs" element={
                <RouteErrorBoundary name="Logs Viewer">
                  <LogsViewer />
                </RouteErrorBoundary>
              } />

              {/* Core Agent Web Interface */}
              <Route path="/core" element={
                <RouteErrorBoundary name="Core Chat">
                  <CoreChat />
                </RouteErrorBoundary>
              } />
            </Routes>
          </Layout>
        </Router>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
