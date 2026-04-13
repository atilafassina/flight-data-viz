import { WorkspaceClient } from '@databricks/sdk-experimental';

let cachedAuth: { host: string; headers: Record<string, string>; expiresAt: number } | null = null;

/** Get auth headers from the SDK's configured credentials (cached for 5 minutes) */
async function getAuthHeaders(): Promise<{ host: string; headers: Record<string, string> }> {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return { host: cachedAuth.host, headers: cachedAuth.headers };
  }

  const client = new WorkspaceClient({});
  await client.config.ensureResolved();

  const host = client.config.host ?? '';
  const headers = new Headers();
  await client.config.authenticate(headers);

  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });

  cachedAuth = { host, headers: result, expiresAt: Date.now() + 5 * 60 * 1000 };
  return { host, headers: result };
}

/**
 * Upload binary data to a UC Volume file using the REST API directly.
 * The SDK's ReadableStream-based upload is unreliable for binary data.
 */
export async function uploadToVolume(filePath: string, data: Uint8Array): Promise<void> {
  const { host, headers } = await getAuthHeaders();

  const encodedPath = filePath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');

  const url = `${host}/api/2.0/fs/files${encodedPath}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
    },
    body: data,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Volume upload failed (${response.status}): ${body}`);
  }
}

/**
 * Download binary data from a UC Volume file using the REST API directly.
 */
export async function downloadFromVolume(filePath: string): Promise<Uint8Array> {
  const { host, headers } = await getAuthHeaders();

  const encodedPath = filePath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');

  const url = `${host}/api/2.0/fs/files${encodedPath}`;

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Volume download failed (${response.status}): ${body}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}
