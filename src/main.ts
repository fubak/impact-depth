import { App } from './app';
import { isWebGL2Available, showWebGlFailure } from './ui/boot';

function start(): void {
  if (!isWebGL2Available()) {
    showWebGlFailure();
    return;
  }
  let app: App;
  try {
    app = new App();
  } catch (error) {
    console.error('[silent-depths] WebGL startup failed', error);
    showWebGlFailure();
    return;
  }
  (window as unknown as { __silentDepths?: App }).__silentDepths = app;
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      app.dispose();
    });
  }
}

start();
