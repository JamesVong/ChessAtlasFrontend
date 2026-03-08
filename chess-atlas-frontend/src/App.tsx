import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import AnalyzerPage from './pages/AnalyzerPage';
import ExplorerPage from './pages/ExplorerPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Navbar />
        <Routes>
          <Route path="/" element={<AnalyzerPage />} />
          <Route path="/explorer" element={<ExplorerPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
