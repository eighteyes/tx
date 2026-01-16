import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { MeshList } from './components/MeshList';
import { MeshEditor } from './components/MeshEditor';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/meshes" replace />} />
          <Route path="/meshes" element={<MeshList />} />
          <Route path="/meshes/:meshName" element={<MeshEditor />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
