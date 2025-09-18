import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Editor from './views/pages/Editor';
import Home from './views/Home';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </Router>
  );
}

export default App;
