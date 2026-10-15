import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

/** Mount point declared in index.html. */
const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
