import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDeployment } from '../services/deployments';

export default function NewDeployment() {
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const deployment = await createDeployment(repoUrl.trim());
      navigate(`/deployments/${deployment._id}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Deployment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>New Deployment</h1>
      <div className="card" style={{ maxWidth: 560 }}>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          Enter a public GitHub repository URL. Supported: Node (package.json), Python (requirements.txt), Java Maven (pom.xml).
        </p>
        {error && <div className="errors">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>GitHub repository URL</label>
            <input
              type="url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Deploying…' : 'Deploy'}
          </button>
        </form>
      </div>
    </div>
  );
}
