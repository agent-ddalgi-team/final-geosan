import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './router';
import SessionGate from './components/frame/SessionGate';
import TempLoginGate from './components/frame/TempLoginGate';

export default function App() {
  return (
    <BrowserRouter>
      <TempLoginGate>
        <SessionGate>
          <AppRoutes />
        </SessionGate>
      </TempLoginGate>
    </BrowserRouter>
  );
}
