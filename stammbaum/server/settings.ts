/**
 * How main.ts reads what the environment says — kept apart from it, since
 * main.ts starts listening as soon as it is loaded, and the tests want these
 * on their own.
 */

/**
 * `1`, `true`, `yes`, `on` — however a .env file says yes; empty, `0`,
 * `false`, `no`, `off` say no. Anything else is `undefined`: the server
 * cannot tell, and says so.
 */
export function switchedOn(value: string | undefined): boolean | undefined {
  const text = (value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['', '0', 'false', 'no', 'off'].includes(text)) return false;
  return undefined;
}

/**
 * Why the server must not start, if it must not: in production — the docker
 * image — it answers only the proxy, so without the secret that tells the
 * proxy apart, it would trust whatever reaches the port to say who is logged
 * in. Outside production (`npm start` on a laptop) no secret is needed.
 */
export function missingSecret(env: NodeJS.ProcessEnv): string | undefined {
  // The stand-in from deploy/nginx-stammbaum.conf is as good as none: it is public.
  const secret = env.STAMMBAUM_PROXY_SECRET;
  if (env.NODE_ENV !== 'production' || (secret && secret !== 'replace-with-the-secret')) return undefined;
  return [
    'STAMMBAUM_PROXY_SECRET is not set (or still the stand-in from deploy/), and without it anything that reaches the port could claim to be anyone.',
    'Make one with `openssl rand -hex 32`, put it into .env next to docker-compose.yml as',
    '  STAMMBAUM_PROXY_SECRET=<the value>',
    'and into the nginx site as',
    '  proxy_set_header X-Stammbaum-Proxy "<the value>";',
    '(see deploy/nginx-stammbaum.conf), then `docker compose up -d` and `systemctl reload nginx`.',
  ].join('\n');
}
