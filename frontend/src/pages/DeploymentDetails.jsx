import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getDeployment,
  getLogs,
  restartDeployment,
  stopDeployment,
  deleteDeployment,
} from '../services/deployments';

export default function DeploymentDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deployment, setDeployment] = useState(null);
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getDeployment(id);
        if (!cancelled) setDeployment(data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || 'Failed to load deployment');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!deployment?.containerId) return;
    let cancelled = false;
    setLogsLoading(true);
    getLogs(id, 200)
      .then((data) => { if (!cancelled) setLogs(data.logs || ''); })
      .catch(() => { if (!cancelled) setLogs('(Failed to load logs)'); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [id, deployment?.containerId]);

  const refreshLogs = async () => {
    setLogsLoading(true);
    try {
      const data = await getLogs(id, 200);
      setLogs(data.logs || '');
    } catch {
      setLogs('(Failed to load logs)');
    } finally {
      setLogsLoading(false);
    }
  };

  const handleRestart = async () => {
    setActionLoading('restart');
    try {
      const updated = await restartDeployment(id);
      setDeployment(updated);
      await refreshLogs();
    } catch (err) {
      setError(err.response?.data?.message || 'Restart failed');
    } finally {
      setActionLoading('');
    }
  };

  const handleStop = async () => {
    setActionLoading('stop');
    try {
      const updated = await stopDeployment(id);
      setDeployment(updated);
    } catch (err) {
      setError(err.response?.data?.message || 'Stop failed');
    } finally {
      setActionLoading('');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this deployment? Container, image, and files will be removed.')) return;
    setActionLoading('delete');
    try {
      await deleteDeployment(id);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Delete failed');
      setActionLoading('');
    }
  };

  if (loading) return <div className="container"><p>Loading…</p></div>;
  if (error && !deployment) return <div className="container"><div className="errors">{error}</div></div>;
  if (!deployment) return null;

  const canControl = deployment.containerId && deployment.status === 'running';

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h1 style={{ margin: 0 }}>Deployment</h1>
          <span className={`badge ${deployment.status}`}>{deployment.status}</span>
        </div>
        <p style={{ color: 'var(--muted)', marginBottom: 0 }}>{deployment.repoUrl}</p>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', marginTop: '1rem' }}>
          <dt>Stack</dt>
          <dd>{deployment.stackType}</dd>
          <dt>Port</dt>
          <dd>{deployment.assignedPort ?? '—'}</dd>
          <dt>Image</dt>
          <dd style={{ wordBreak: 'break-all' }}>{deployment.imageName}</dd>
          <dt>Created</dt>
          <dd>{new Date(deployment.createdAt).toLocaleString()}</dd>
        </dl>
        {deployment.assignedPort && deployment.status === 'running' && (
          <p>
            <a href={`http://localhost:${deployment.assignedPort}`} target="_blank" rel="noopener noreferrer">
              Open app → http://localhost:{deployment.assignedPort}
            </a>
          </p>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <strong>Actions</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={refreshLogs} disabled={logsLoading || !deployment.containerId}>
              Refresh logs
            </button>
            {canControl && (
              <>
                <button onClick={handleRestart} disabled={!!actionLoading}>
                  {actionLoading === 'restart' ? 'Restarting…' : 'Restart'}
                </button>
                <button onClick={handleStop} disabled={!!actionLoading}>
                  {actionLoading === 'stop' ? 'Stopping…' : 'Stop'}
                </button>
              </>
            )}
            <button className="danger" onClick={handleDelete} disabled={!!actionLoading}>
              {actionLoading === 'delete' ? 'Deleting…' : 'Delete deployment'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <strong>Logs</strong>
        {logsLoading ? (
          <p style={{ color: 'var(--muted)' }}>Loading logs…</p>
        ) : (
          <pre className="logs">{logs || '(No logs yet)'}</pre>
        )}
      </div>
    </div>
  );
}
