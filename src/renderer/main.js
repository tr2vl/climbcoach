import { start } from './app.js';

// In the Windows app, window.climb comes from the preload bridge. In a plain browser (the demo), a
// stand-in with sample data takes its place.
const climb = window.climb ?? (await import('./demo-bridge.js')).createDemoBridge();
start(climb);
