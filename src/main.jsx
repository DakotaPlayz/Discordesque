import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './polish.css';
import './refine.css';
import './studio.css';
import './context-menus.css';
import './voice-calls.css';
import './server-delete.css';
import './safe-zones.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
