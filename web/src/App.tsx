import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './router';
import SessionGate from './components/frame/SessionGate';

export default function App() {
  return (
    <BrowserRouter>
      <SessionGate>
        <AppRoutes />
      </SessionGate>
    </BrowserRouter>
  );
}
