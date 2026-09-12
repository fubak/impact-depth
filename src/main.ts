import { App } from './app';

const app = new App();
(window as unknown as { __silentDepths?: App }).__silentDepths = app;

// HMR-friendly dispose in Vite
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.dispose();
  });
}
