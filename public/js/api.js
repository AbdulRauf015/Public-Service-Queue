// public/js/api.js
// Client API layer for Baari

const API = {
  async getDemoBranch() {
    const res = await fetch('/api/branches/demo');
    if (!res.ok) throw new Error('Failed to fetch demo branch');
    return await res.json();
  },

  async getBranchPublic(branchId) {
    const res = await fetch(`/api/branches/${branchId}/public`);
    if (!res.ok) throw new Error('Failed to load branch information');
    return await res.json();
  },

  async createToken(payload) {
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ? data.error.message : 'Could not create token');
    }
    return data.token;
  },

  async getToken(publicId) {
    const res = await fetch(`/api/tokens/${publicId}`);
    if (!res.ok) throw new Error('Token not found');
    return await res.json();
  },

  async confirmArrival(publicId) {
    const res = await fetch(`/api/tokens/${publicId}/here`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ? data.error.message : 'Failed to confirm arrival');
    }
    return data;
  },

  async cancelToken(publicId) {
    const res = await fetch(`/api/tokens/${publicId}/cancel`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ? data.error.message : 'Failed to cancel token');
    }
    return data;
  },

  async updateToken(publicId, payload) {
    const res = await fetch(`/api/tokens/${publicId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ? data.error.message : 'Failed to update token');
    }
    return data.token;
  },

  async getAnalyticsSummary({ branchId, range = 'today', includeSimulated = true } = {}) {
    const params = new URLSearchParams({
      ...(branchId ? { branchId } : {}),
      range,
      includeSimulated: includeSimulated ? 'true' : 'false'
    });
    const res = await fetch(`/api/analytics/summary?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to load analytics summary');
    return await res.json();
  },

  async getAnalyticsHourly({ branchId, range = 'today', includeSimulated = true } = {}) {
    const params = new URLSearchParams({
      ...(branchId ? { branchId } : {}),
      range,
      includeSimulated: includeSimulated ? 'true' : 'false'
    });
    const res = await fetch(`/api/analytics/hourly?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to load hourly analytics');
    return await res.json();
  },

  async getAnalyticsCounters({ branchId, range = 'today', includeSimulated = true } = {}) {
    const params = new URLSearchParams({
      ...(branchId ? { branchId } : {}),
      range,
      includeSimulated: includeSimulated ? 'true' : 'false'
    });
    const res = await fetch(`/api/analytics/counters?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to load counter performance');
    return await res.json();
  },

  async getBestTime(branchId, serviceId = null) {
    const url = serviceId
      ? `/api/branches/${branchId}/best-time?serviceId=${serviceId}`
      : `/api/branches/${branchId}/best-time`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load best visiting time');
    return await res.json();
  }
};

window.API = API;
