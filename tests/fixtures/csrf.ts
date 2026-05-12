import { APIRequestContext } from '@playwright/test';

export async function loginApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const resp = await request.post('/index.php', {
    form: { username: email, password, login: 'Login' },
  });
  if (!resp.ok()) {
    throw new Error(`Login POST failed: ${resp.status()} ${resp.statusText()}`);
  }
}

export async function fetchCsrfToken(
  request: APIRequestContext,
  fromPath: string,
): Promise<string> {
  const resp = await request.get(fromPath);
  const html = await resp.text();
  const m = html.match(/name="csrf_token"\s+value="([a-f0-9]+)"/);
  if (!m) {
    throw new Error(
      `Could not find csrf_token hidden input on ${fromPath} (status ${resp.status()})`,
    );
  }
  return m[1];
}
