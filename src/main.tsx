import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/utilities.css';
import { App } from './App';
import { PlayerDisplayApp } from './components/PlayerDisplayApp';

const isPlayerDisplay =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('player') === '1';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPlayerDisplay ? <PlayerDisplayApp /> : <App />}
  </React.StrictMode>
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' });
  });
}
