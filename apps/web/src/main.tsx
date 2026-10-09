import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('Не найден контейнер #root в index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
