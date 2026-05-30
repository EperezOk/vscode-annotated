import { type DetailToHost } from '../../shared/protocol';

let api: VsCodeApi | undefined;

function getApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

/** Post a typed message to the extension host. */
export function postToHost(message: DetailToHost): void {
  getApi().postMessage(message);
}
