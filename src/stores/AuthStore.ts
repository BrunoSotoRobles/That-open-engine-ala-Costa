import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  provider: 'google' | 'demo';
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  login: (provider: 'google' | 'demo') => Promise<boolean>;
  logout: () => void;
  checkAuth: () => void;
}

// Demo credentials for testing
const DEMO_CREDENTIALS = {
  email: 'demo@example.com',
  password: 'demo123'
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      user: null,
      isLoading: false,

      login: async (provider: 'google' | 'demo') => {
        set({ isLoading: true });
        
        try {
          if (provider === 'demo') {
            // Simulate demo login
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const demoUser: User = {
              id: 'demo-user-123',
              name: 'Demo User',
              email: 'demo@example.com',
              avatar: '👤',
              provider: 'demo'
            };
            
            set({
              isAuthenticated: true,
              user: demoUser,
              isLoading: false
            });
            
            return true;
          } else if (provider === 'google') {
            // Simulate Google OAuth (in real implementation, this would use Google OAuth)
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const googleUser: User = {
              id: 'google-user-456',
              name: 'Google User',
              email: 'user@gmail.com',
              avatar: '🔐',
              provider: 'google'
            };
            
            set({
              isAuthenticated: true,
              user: googleUser,
              isLoading: false
            });
            
            return true;
          }
          
          return false;
        } catch (error) {
          console.error('Login error:', error);
          set({ isLoading: false });
          return false;
        }
      },

      logout: () => {
        set({
          isAuthenticated: false,
          user: null,
          isLoading: false
        });
      },

      checkAuth: () => {
        // Check if user is still authenticated (could add token validation here)
        const { isAuthenticated } = get();
        if (isAuthenticated) {
          // In a real app, you might validate the token here
          console.log('User is authenticated');
        }
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user
      })
    }
  )
);
