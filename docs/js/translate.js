// Standalone Translate Page Script (docs/js/translate.js)
import { Scene3D } from './three-scene.js';
import { RealtimeTranslator } from './traductor.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Setup 3D Viewer Fallback
  const modelViewer = document.getElementById('bot-model-viewer');
  if (modelViewer) {
    modelViewer.addEventListener('error', () => {
      console.warn('model-viewer failed to load GLTF on translate.html, launching 3D fallback scene.');
      modelViewer.style.display = 'none';
      new Scene3D('canvas-container');
    });
  } else {
    new Scene3D('canvas-container');
  }

  // 2. Initialize Real-Time Translator
  const translator = new RealtimeTranslator();
  translator.init();
});
