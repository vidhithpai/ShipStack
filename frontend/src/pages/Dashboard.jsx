import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { listDeployments } from '../services/deployments';

export default function Dashboard() {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await listDeployments();
        if (!cancelled) setDeployments(data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || 'Failed to load deployments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="container"><p>Loading deployments…</p></div>;
  if (error) return <div className="container"><div className="errors">{error}</div></div>;

  return (
    <div className="container">
      <h1>Deployments</h1>
      {deployments.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--muted)' }}>No deployments yet.</p>
          <Link to="/deploy">Create your first deployment</Link>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {deployments.map((d) => (
            <li key={d._id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <Link to={`/deployments/${d._id}`} style={{ fontWeight: 600 }}>
                  {d.repoUrl}
                </Link>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                  {d.stackType} · Port {d.assignedPort ?? '—'} · {new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
              <span className={`badge ${d.status}`}>{d.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
