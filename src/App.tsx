/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  Award,
  FileCheck2,
  Home,
  Layers,
  Send,
  ShieldCheck,
  UserCircle2,
  Wallet,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  db,
  FIREBASE_DATABASE_ID,
  FIREBASE_PROJECT_ID,
  OperationType,
  handleFirestoreError,
} from './lib/firebase';
import { formatBdt, toMillis } from './lib/api';
import {
  AccountApprovalGate,
  AuthPortal,
  BrandLogoMark,
  BrandWordmark,
  CompleteRegistrationScreen,
  EmailVerificationScreen,
} from './components/AuthViews';
import {
  CompletedTasksView,
  MemberDashboardView,
  MemberProfileView,
  MemberTasksView,
  MemberWalletView,
  MemberWithdrawView,
  ProofSubmissionsView,
} from './components/MemberViews';
import { AdminPanel } from './components/AdminPanel';
import { AvatarDisplay } from './components/MediaView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallPrompt';
import {
  MemberPageTab,
  PasswordChangeRequest,
  TaskItem,
  TaskSubmission,
  WalletTransaction,
  WithdrawalRequest,
} from './types';

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || '';
      const isQuota = msg.includes('Quota exceeded');
      const upgradeUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIREBASE_DATABASE_ID}/data?openUpgradeDialog=true`;

      return (
        <div className="min-h-dvh flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-3xl bg-[#0D1730] border border-rose-400/30 p-6 sm:p-8 space-y-4">
            <h1 className="text-xl font-bold text-white">
              {isQuota ? 'Daily Database Quota Reached' : 'Application Error'}
            </h1>
            <p className="text-sm text-sky-200/80 leading-relaxed">
              {isQuota
                ? 'Your Firestore free-tier daily quota has been reached and will reset tomorrow. You can inspect quota details or upgrade in Firebase Console.'
                : 'An unexpected error occurred while communicating with the service.'}
            </p>
            {isQuota && (
              <a
                href={upgradeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs font-semibold text-teal-300 underline"
              >
                Open Firebase Database Console
              </a>
            )}
            <div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] px-4 rounded-xl bg-teal-500 text-slate-950 text-xs font-semibold"
              >
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthenticatedWorkspace() {
  const { profile, wallet, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<MemberPageTab>(() =>
    profile?.role === 'admin' ? 'admin' : 'home'
  );

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [passwordRequests, setPasswordRequests] = useState<PasswordChangeRequest[]>([]);

  useEffect(() => {
    if (!profile) return;
    if (profile.status !== 'approved' && profile.role !== 'admin') return;

    const uid = profile.uid;

    const unsubs = [
      onSnapshot(
        query(collection(db, 'tasks'), where('isActive', '==', true)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as TaskItem);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setTasks(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
      ),
      onSnapshot(
        query(collection(db, 'submissions'), where('userId', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as TaskSubmission);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setSubmissions(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'submissions')
      ),
      onSnapshot(
        query(collection(db, 'transactions'), where('userId', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as WalletTransaction);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setTransactions(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
      ),
      onSnapshot(
        query(collection(db, 'withdrawals'), where('userId', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as WithdrawalRequest);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setWithdrawals(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'withdrawals')
      ),
      onSnapshot(
        query(collection(db, 'passwordChangeRequests'), where('userId', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as PasswordChangeRequest);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setPasswordRequests(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'passwordChangeRequests')
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, [profile]);

  if (!profile) return null;

  const isAdmin = profile.role === 'admin';

  const sidebarLinks: { id: MemberPageTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'Dashboard', icon: Home },
    { id: 'tasks', label: 'Available Tasks', icon: Layers },
    { id: 'completed', label: 'Completed Tasks', icon: Award },
    { id: 'proof', label: 'Proof Submissions', icon: FileCheck2 },
    { id: 'wallet', label: 'Wallet & Earnings', icon: Wallet },
    { id: 'withdraw', label: 'Withdraw Funds', icon: Send },
    { id: 'profile', label: 'Profile & Settings', icon: UserCircle2 },
  ];

  const mobileBottomTabs: { id: MemberPageTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'tasks', label: 'Tasks', icon: Layers },
    { id: 'proof', label: 'Proof', icon: FileCheck2 },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
    { id: 'withdraw', label: 'Withdraw', icon: Send },
  ];

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-[#081024]/95 border-r border-white/10 p-5 justify-between sticky top-0 h-dvh">
        <div className="space-y-6">
          <BrandWordmark size="sm" />

          <nav className="space-y-1">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-colors whitespace-nowrap ${
                  activeTab === 'admin'
                    ? 'bg-teal-500 text-slate-950'
                    : 'text-teal-300 hover:bg-white/6'
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Admin Panel</span>
              </button>
            )}

            {sidebarLinks.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-teal-500 text-slate-950 font-semibold'
                      : 'text-sky-200/75 hover:text-white hover:bg-white/6'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <PWAInstallButton />
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className="w-full p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center gap-3 text-left transition-colors"
        >
          <AvatarDisplay
            photoAssetId={profile.photoAssetId}
            fullName={profile.fullName}
            sizeClass="w-10 h-10 text-xs"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate">{profile.fullName}</p>
            <p className="text-[11px] font-mono tabular-nums text-teal-300 truncate">
              {formatBdt(wallet?.availableBalance ?? 0)} · {profile.memberId}
            </p>
          </div>
        </button>
      </aside>

      {/* Mobile Compact Top App Bar (48px height -> respects 15% mobile sticky cap with 56px bottom nav) */}
      <header className="lg:hidden sticky top-0 z-30 h-12 px-4 bg-[#070E20]/90 backdrop-blur-md border-b border-white/10 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className="text-sm font-bold tracking-tight text-white whitespace-nowrap shrink-0 flex items-center gap-2"
        >
          <BrandLogoMark className="w-7 h-7 rounded-full text-[10px]" />
          <span>MTS Freelancing Zone</span>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <PWAInstallButton compact />
          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'admin' ? 'home' : 'admin')}
              className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap ${
                activeTab === 'admin'
                  ? 'bg-teal-500 text-slate-950'
                  : 'text-teal-300 hover:bg-white/8'
              }`}
            >
              {activeTab === 'admin' ? 'Member View' : 'Admin'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2"
            aria-label="Open profile and settings"
          >
            <AvatarDisplay
              photoAssetId={profile.photoAssetId}
              fullName={profile.fullName}
              sizeClass="w-8 h-8 text-xs"
            />
          </button>
        </div>
      </header>

      {/* Main Responsive Content Container */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-8 pb-24 lg:pb-10">
        {activeTab === 'admin' && isAdmin ? (
          <AdminPanel currentAdmin={profile} />
        ) : activeTab === 'tasks' ? (
          <MemberTasksView tasks={tasks} submissions={submissions} onNavigate={setActiveTab} />
        ) : activeTab === 'completed' ? (
          <CompletedTasksView submissions={submissions} onNavigate={setActiveTab} />
        ) : activeTab === 'proof' ? (
          <ProofSubmissionsView submissions={submissions} onNavigate={setActiveTab} />
        ) : activeTab === 'wallet' ? (
          <MemberWalletView
            wallet={wallet}
            transactions={transactions}
            onNavigate={setActiveTab}
          />
        ) : activeTab === 'withdraw' ? (
          <MemberWithdrawView
            profile={profile}
            wallet={wallet}
            withdrawals={withdrawals}
          />
        ) : activeTab === 'profile' ? (
          <MemberProfileView
            profile={profile}
            wallet={wallet}
            submissions={submissions}
            passwordRequests={passwordRequests}
            onLogout={logout}
          />
        ) : (
          <MemberDashboardView
            profile={profile}
            wallet={wallet}
            tasks={tasks}
            submissions={submissions}
            transactions={transactions}
            withdrawals={withdrawals}
            passwordRequests={passwordRequests}
            onNavigate={setActiveTab}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar (Home, Tasks, Proof, Wallet, Withdraw) */}
      <nav
        aria-label="Primary mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[#070E20]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-5 items-center px-1"
      >
        {mobileBottomTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            activeTab === tab.id || (tab.id === 'tasks' && activeTab === 'completed');
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center transition-colors ${
                isActive ? 'text-teal-300' : 'text-sky-200/65 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium tracking-tight mt-0.5 whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function AppGateRouter() {
  const { firebaseUser, profile, authReady, profileLoading, quotaError } = useAuth();

  if (quotaError) {
    throw new Error(quotaError);
  }

  if (!authReady || profileLoading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 p-4">
        <BrandWordmark />
        <p className="text-xs text-sky-200/70">Connecting to secure workspace...</p>
      </div>
    );
  }

  if (!firebaseUser) {
    return <AuthPortal />;
  }

  if (!firebaseUser.emailVerified) {
    return <EmailVerificationScreen />;
  }

  if (!profile) {
    return <CompleteRegistrationScreen />;
  }

  if (profile.status !== 'approved' && profile.role !== 'admin') {
    return <AccountApprovalGate />;
  }

  return <AuthenticatedWorkspace />;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <OfflineIndicator />
        <AppGateRouter />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
