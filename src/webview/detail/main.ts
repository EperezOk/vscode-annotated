import { mount } from 'svelte';
import DetailApp from './DetailApp.svelte';
import { handleHostMessage } from './state';
import { postToHost } from './vscodeApi';

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message && typeof message === 'object' && (message.type === 'setGroup' || message.type === 'openAnnotation')) {
    handleHostMessage(message);
  }
});

const app = mount(DetailApp, { target: document.body });

// Ask the host for the current group.
postToHost({ type: 'ready' });

export default app;
