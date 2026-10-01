// Standalone Translate Page Script (docs/js/translate.js)
import './app.js';
import { Scene3D } from './three-scene.js';
import { RealtimeTranslator } from './traductor.js';

document.addEventListener('DOMContentLoaded', () => {
  const modelViewer = document.getElementById('bot-model-viewer');
  if (modelViewer) {
    modelViewer.addEventListener('error', () => {
      modelViewer.style.display = 'none';
      new Scene3D('canvas-container');
    });
  } else if (document.getElementById('canvas-container')) {
    new Scene3D('canvas-container');
  }

  const translator = new RealtimeTranslator();
  translator.init();
});
