import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ProjectionPage } from './ProjectionPage.tsx'
import './index.css'

// Check if we're in projection mode (opened by Electron's createProjectionWindow)
const isProjection = new URLSearchParams(window.location.search).get('mode') === 'projection'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isProjection ? <ProjectionPage /> : <App />}
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer?.on('main-process-message', (_event, message) => {
  console.log(message)
})
