import { mount } from 'svelte';
import App from './App.svelte';
import { handleHostMessage } from './state';
import { postToHost } from './vscodeApi';

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message && typeof message === 'object' && message.type === 'setState') {
    handleHostMessage(message);
  }
});

const app = mount(App, { target: document.body });

// Ask the host for the initial state.
postToHost({ type: 'ready' });

export default app;
