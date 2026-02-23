import { createContext, useContext, useState, useCallback } from 'react';

// Auth context keeps JWT token and user info in memory + localStorage
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => localStorage.getItem('deploymate_token'));
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem('deploymate_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });

  const setToken = useCallback((newToken, newUser) => {
    if (newToken) {
      localStorage.setItem('deploymate_token', newToken);
      setTokenState(newToken);
    } else {
      localStorage.removeItem('deploymate_token');
      setTokenState(null);
    }
    if (newUser !== undefined) {
      if (newUser) {
        localStorage.setItem('deploymate_user', JSON.stringify(newUser));
        setUser(newUser);
      } else {
        localStorage.removeItem('deploymate_user');
        setUser(null);
      }
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null, null);
  }, [setToken]);

  return (
    <AuthContext.Provider value={{ token, user, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

