import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  auth,
  db,
  BOOTSTRAPPED_ADMIN_EMAIL,
  OperationType,
  handleFirestoreError,
} from '../lib/firebase';
import { apiRequest } from '../lib/api';
import { MemberWallet, UserProfile } from '../types';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  wallet: MemberWallet | null;
  authReady: boolean;
  profileLoading: boolean;
  quotaError: string | null;
  refreshUserState: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<MemberWallet | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setProfile(null);
        setWallet(null);
        setProfileLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser || !firebaseUser.emailVerified) {
      setProfile(null);
      setWallet(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    const userPath = `users/${firebaseUser.uid}`;
    const walletPath = `wallets/${firebaseUser.uid}`;

    let bootstrappedAttempted = false;

    const unsubUser = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      async (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile(data);
          setProfileLoading(false);

          // Ensure bootstrapped project owner is promoted if needed
          if (
            !bootstrappedAttempted &&
            firebaseUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL &&
            data.role !== 'admin'
          ) {
            bootstrappedAttempted = true;
            try {
              await apiRequest('/api/auth/register', {
                method: 'POST',
                body: {
                  fullName: data.fullName || firebaseUser.displayName || 'MTS Administrator',
                  phone: data.phone || '',
                  authProvider:
                    firebaseUser.providerData[0]?.providerId === 'google.com'
                      ? 'google.com'
                      : 'password',
                },
              });
            } catch (e) {
              console.error('Admin bootstrap sync failed:', e);
            }
          }
        } else {
          // Automatically provision initial Admin when verified owner signs in
          if (
            !bootstrappedAttempted &&
            firebaseUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL
          ) {
            bootstrappedAttempted = true;
            try {
              await apiRequest('/api/auth/register', {
                method: 'POST',
                body: {
                  fullName: firebaseUser.displayName || 'MTS Administrator',
                  phone: '',
                  authProvider:
                    firebaseUser.providerData[0]?.providerId === 'google.com'
                      ? 'google.com'
                      : 'password',
                },
              });
              return;
            } catch (e) {
              console.error('Initial admin auto-provision error:', e);
            }
          }
          setProfile(null);
          setProfileLoading(false);
        }
      },
      (err) => {
        setProfileLoading(false);
        if (err.message.includes('Quota exceeded')) {
          setQuotaError(err.message);
          return;
        }
        handleFirestoreError(err, OperationType.GET, userPath);
      }
    );

    const unsubWallet = onSnapshot(
      doc(db, 'wallets', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          setWallet(snap.data() as MemberWallet);
        } else {
          setWallet(null);
        }
      },
      (err) => {
        if (err.message.includes('Quota exceeded')) {
          setQuotaError(err.message);
          return;
        }
        handleFirestoreError(err, OperationType.GET, walletPath);
      }
    );

    return () => {
      unsubUser();
      unsubWallet();
    };
  }, [authReady, firebaseUser, firebaseUser?.emailVerified]);

  const refreshUserState = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    setFirebaseUser({ ...auth.currentUser } as User);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        wallet,
        authReady,
        profileLoading,
        quotaError,
        refreshUserState,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
