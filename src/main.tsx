import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './card-visuals.css'
import './playful-theme.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

// Orientation locking is supported only in some installed/fullscreen mobile
// contexts. The viewport still remains usable in a normal browser tab.
const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: 'portrait') => Promise<void> }
if (orientation.lock) {
  orientation.lock('portrait').catch(() => undefined)
}
