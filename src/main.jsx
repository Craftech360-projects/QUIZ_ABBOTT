import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { HIDE_CURSOR } from './config.js';
import './styles.css';

document.documentElement.classList.toggle('kiosk', HIDE_CURSOR);

document.addEventListener('touchstart', (event) => {
  if (event.touches.length > 1) event.preventDefault();
}, { passive: false });

document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('dragstart', (event) => event.preventDefault());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
