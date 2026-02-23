import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <>
      <nav className="nav">
        <div>
          <Link to="/" style={{ fontWeight: 700, marginRight: '1rem' }}>DeployMate</Link>
          <Link to="/">Dashboard</Link>
          <Link to="/deploy">New Deployment</Link>
        </div>
        <div>
          <span className="user">{user?.email}</span>
          <button type="button" onClick={handleLogout} style={{ marginLeft: '1rem' }}>Logout</button>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
    </>
  );
}
