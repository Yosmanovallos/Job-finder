import React, { createContext, useContext, useState, useEffect } from 'react';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  subscriptionTier: 'free' | 'pro';
  subscriptionEnd?: string;
}

export interface AuthContextType {
  user: UserProfile | null;
  tier: 'free' | 'pro';
  isAuthenticated: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string) => Promise<void>;
  logout: () => void;
  upgradeToPro: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('jobradar_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem('jobradar_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('jobradar_user');
    }
  }, [user]);

  const loginWithGoogle = async () => {
    const mockUser: UserProfile = {
      id: `usr_${Date.now()}`,
      email: 'usuario.pro@jobradar.app',
      name: 'Usuario Job Radar',
      subscriptionTier: 'free'
    };
    setUser(mockUser);
  };

  const loginWithEmail = async (email: string) => {
    const mockUser: UserProfile = {
      id: `usr_${Date.now()}`,
      email,
      name: email.split('@')[0],
      subscriptionTier: 'free'
    };
    setUser(mockUser);
  };

  const logout = () => {
    setUser(null);
  };

  const upgradeToPro = () => {
    if (user) {
      setUser({
        ...user,
        subscriptionTier: 'pro',
        subscriptionEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
    } else {
      const mockProUser: UserProfile = {
        id: `usr_pro_${Date.now()}`,
        email: 'suscriptor.pro@jobradar.app',
        name: 'Suscriptor Pro',
        subscriptionTier: 'pro',
        subscriptionEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
      setUser(mockProUser);
    }
  };

  const tier = user?.subscriptionTier || 'free';
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{
      user,
      tier,
      isAuthenticated,
      loginWithGoogle,
      loginWithEmail,
      logout,
      upgradeToPro
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser usado dentro de un AuthProvider');
  }
  return context;
}
