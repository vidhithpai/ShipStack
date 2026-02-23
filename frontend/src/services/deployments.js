import api from './api';

export async function listDeployments() {
  const { data } = await api.get('/deployments');
  return data;
}

export async function getDeployment(id) {
  const { data } = await api.get(`/deployments/${id}`);
  return data;
}

export async function createDeployment(repoUrl) {
  const { data } = await api.post('/deployments/deploy', { repoUrl });
  return data;
}

export async function getLogs(id, tail = 100) {
  const { data } = await api.get(`/deployments/${id}/logs`, { params: { tail } });
  return data;
}

export async function restartDeployment(id) {
  const { data } = await api.post(`/deployments/${id}/restart`);
  return data;
}

export async function stopDeployment(id) {
  const { data } = await api.post(`/deployments/${id}/stop`);
  return data;
}

export async function startDeployment(id) {
  const { data } = await api.post(`/deployments/${id}/start`);
  return data;
}

export async function deleteDeployment(id) {
  await api.delete(`/deployments/${id}`);
}

export async function getDeploymentStats(id) {
  const { data } = await api.get(`/deployments/${id}/stats`);
  return data;
}
