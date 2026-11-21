import { describe, expect, it } from 'vitest';
import { missingSecret, switchedOn } from '../server/settings';

describe('the settings the server reads', () => {
  it('takes yes however a .env file writes it', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' On ']) expect(switchedOn(value)).toBe(true);
    for (const value of [undefined, '', '0', 'false', 'no', 'off', 'OFF']) expect(switchedOn(value)).toBe(false);
    expect(switchedOn('maybe')).toBeUndefined();
  });

  it('will not start in production without the proxy secret, and says how to set it', () => {
    const refusal = missingSecret({ NODE_ENV: 'production' });
    expect(refusal).toContain('STAMMBAUM_PROXY_SECRET=');
    expect(refusal).toContain('proxy_set_header X-Stammbaum-Proxy');
    expect(missingSecret({ NODE_ENV: 'production', STAMMBAUM_PROXY_SECRET: '' })).toBeDefined();
    // The stand-in from deploy/ is public, so no secret at all.
    expect(missingSecret({ NODE_ENV: 'production', STAMMBAUM_PROXY_SECRET: 'replace-with-the-secret' })).toBeDefined();
    expect(missingSecret({ NODE_ENV: 'production', STAMMBAUM_PROXY_SECRET: 'long-and-random' })).toBeUndefined();
    // `npm start` on a laptop, and the tests.
    expect(missingSecret({})).toBeUndefined();
    expect(missingSecret({ NODE_ENV: 'test' })).toBeUndefined();
  });
});
