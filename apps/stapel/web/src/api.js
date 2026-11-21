import { api } from './kit/api.js';

export * from './kit/api.js';

export const setStatus = (ids, flags) => api('/status', { method: 'POST', body: { ids, ...flags } });
