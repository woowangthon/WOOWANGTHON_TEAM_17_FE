import React from 'react';
import ReactDOM from 'react-dom/client';
import RoomPage from './pages/RoomPage';
import './styles/globals.css';
import './styles/room.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RoomPage />
  </React.StrictMode>,
);
