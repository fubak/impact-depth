import { App } from './app';

const app = new App();

// HMR-friendly dispose in Vite
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.dispose();
  });
}
