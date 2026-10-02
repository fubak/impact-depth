import { App } from './app';
import { isWebGL2Available, showWebGlFailure } from './ui/boot';
import { installErrorHandlers, type ErrorRecord } from './ui/error-toast';

function start(): void {
  if (!isWebGL2Available()) {
    showWebGlFailure();
    return;
  }
  let app: App | undefined;
  const pending: ErrorRecord[] = [];
  const releaseErrors = installErrorHandlers(window, (record) => {
    if (app) app.noteCapturedError(record);
    else pending.push(record);
  });
  try {
    app = new App();
  } catch (error) {
    console.error('[silent-depths] WebGL startup failed', error);
    showWebGlFailure();
    return;
  }
  for (const record of pending) app.noteCapturedError(record);
  (window as unknown as { __silentDepths?: App }).__silentDepths = app;
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      releaseErrors();
      app?.dispose();
    });
  }
}

start();
