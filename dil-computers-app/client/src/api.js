// Small fetch wrapper that attaches the bearer token and treats a 401 as
// "you're logged out" so callers can react uniformly.

export class AuthError extends Error {}

export async function apiFetch(path, token, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  })

  if (res.status === 401) {
    throw new AuthError('Session expired')
  }

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status})`)
  }

  return data
}
