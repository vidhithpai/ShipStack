import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getDeployment,
  getLogs,
  restartDeployment,
  stopDeployment,
  deleteDeployment,
  startDeployment,
  getDeploymentStats,
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
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState('');

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

  useEffect(() => {
    if (!deployment?.containerId || deployment.status !== 'running') {
      return undefined;
    }
    let cancelled = false;
    let timerId;

    async function poll() {
      try {
        const data = await getDeploymentStats(id);
        if (!cancelled) {
          setStats(data);
          setStatsError('');
        }
      } catch (err) {
        if (!cancelled) {
          setStatsError(err.response?.data?.message || 'Failed to load stats');
        }
      } finally {
        if (!cancelled) {
          timerId = setTimeout(poll, 30000);
        }
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [id, deployment?.containerId, deployment?.status]);

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

  const handleStart = async () => {
    setActionLoading('start');
    try {
      const updated = await startDeployment(id);
      setDeployment(updated);
      await refreshLogs();
      setStats(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Start failed');
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
  const canStart = deployment.containerId && deployment.status === 'stopped';

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
            {canStart && (
              <button onClick={handleStart} disabled={!!actionLoading}>
                {actionLoading === 'start' ? 'Starting…' : 'Start'}
              </button>
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

      <div className="card">
        <strong>Resource stats</strong>
        {statsError && <div className="errors" style={{ marginTop: '0.5rem' }}>{statsError}</div>}
        {stats ? (
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '0.25rem 1rem',
              marginTop: '0.5rem',
            }}
          >
            <dt>CPU</dt>
            <dd>{stats.cpuPercent}</dd>
            <dt>Memory</dt>
            <dd>{stats.memoryUsage}</dd>
            <dt>Limit</dt>
            <dd>{stats.memoryLimit}</dd>
            <dt>Status</dt>
            <dd>{stats.containerStatus}</dd>
          </dl>
        ) : (
          <p style={{ color: 'var(--muted)', marginTop: '0.5rem' }}>
            Stats will appear here while the deployment is running.
          </p>
        )}
      </div>
    </div>
  );
}
