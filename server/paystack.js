export function createPaystack(secret, fetchImpl = fetch) {
  async function request(path, body) {
    const response = await fetchImpl('https://api.paystack.co' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok || result.status !== true || !result.data) throw new Error('Payment provider unavailable');
    return result.data;
  }
  return {
    initialize: body => request('/transaction/initialize', body),
    verify: reference => request('/transaction/verify/' + encodeURIComponent(reference))
  };
}
