import React, { useMemo, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
} from 'firebase/auth';
import {
  ArrowUpRight,
  Award,
  Bell,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  KeyRound,
  Layers,
  Lock,
  Receipt,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import {
  apiRequest,
  formatBdt,
  formatDateTime,
  formatShortDate,
  toMillis,
  uploadCompressedMedia,
} from '../lib/api';
import { AvatarDisplay, ProofScreenshotViewer, primeMediaCache } from './MediaView';
import {
  BD_MOBILE_PATTERN,
  CustomTaskSubmission,
  FIXED_WITHDRAWAL_FEE,
  MAX_NAME_LENGTH,
  MAX_PROOF_LINK_LENGTH,
  MAX_SUBMISSION_NOTE_LENGTH,
  MAX_TASK_INSTRUCTIONS_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  MIN_WITHDRAWAL_GROSS,
  MemberNotification,
  MemberPageTab,
  MemberWallet,
  PasswordChangeRequest,
  PayoutMethod,
  TaskItem,
  TaskSubmission,
  UserProfile,
  WalletTransaction,
  WithdrawalRequest,
} from '../types';

interface SharedMemberProps {
  profile: UserProfile;
  wallet: MemberWallet | null;
  tasks: TaskItem[];
  submissions: TaskSubmission[];
  customTasks: CustomTaskSubmission[];
  notifications: MemberNotification[];
  transactions: WalletTransaction[];
  withdrawals: WithdrawalRequest[];
  passwordRequests: PasswordChangeRequest[];
  onNavigate: (tab: MemberPageTab) => void;
}

// ============================================================================
// 1. Member Dashboard (Home)
// ============================================================================
export function MemberDashboardView({
  profile,
  wallet,
  tasks,
  submissions,
  customTasks,
  notifications,
  transactions,
  onNavigate,
}: SharedMemberProps) {
  const availableBalance = wallet?.availableBalance ?? 0;
  const totalEarnings = wallet?.totalEarnings ?? profile.totalEarnings ?? 0;
  const [markingNotifId, setMarkingNotifId] = useState<string | null>(null);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.isRead).slice(0, 4),
    [notifications]
  );

  const pendingCustomCount = useMemo(
    () => customTasks.filter((c) => c.status === 'pending').length,
    [customTasks]
  );
  const approvedCustomCount = useMemo(
    () => customTasks.filter((c) => c.status === 'approved').length,
    [customTasks]
  );

  const handleDismissNotification = async (notificationId: string) => {
    setMarkingNotifId(notificationId);
    try {
      await apiRequest(`/api/notifications/${notificationId}/read`, { method: 'POST' });
    } catch {
      // Ignore transient dismissal error; real-time listener keeps state accurate
    } finally {
      setMarkingNotifId(null);
    }
  };
  const activeTasksCount = useMemo(() => tasks.filter((t) => t.isActive).length, [tasks]);
  const pendingProofCount = useMemo(
    () => submissions.filter((s) => s.status === 'pending').length,
    [submissions]
  );
  const completedCount = useMemo(
    () => submissions.filter((s) => s.status === 'approved').length,
    [submissions]
  );

  const openTasksPreview = useMemo(() => {
    const blockedTaskIds = new Set(
      submissions
        .filter((s) => s.status === 'pending' || s.status === 'approved')
        .map((s) => s.taskId)
    );
    return tasks.filter((t) => t.isActive && !blockedTaskIds.has(t.taskId)).slice(0, 4);
  }, [tasks, submissions]);

  const recentTransactions = useMemo(() => transactions.slice(0, 5), [transactions]);

  return (
    <div className="space-y-6">
      {/* Member Identity Header */}
      <div className="rounded-3xl bg-gradient-to-r from-[#0E1B3D] via-[#0B1530] to-[#0E1D3A] border border-white/10 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate('profile')}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded-2xl shrink-0"
          >
            <AvatarDisplay
              photoAssetId={profile.photoAssetId}
              fullName={profile.fullName}
              sizeClass="w-14 h-14 text-base"
            />
          </button>
          <div className="min-w-0">
            <p className="text-xs text-sky-200/75">
              Member ID <span className="font-mono tabular-nums text-teal-300">{profile.memberId}</span>
              <span aria-hidden="true"> · </span>
              <span>{profile.role === 'admin' ? 'Administrator' : 'Approved Member'}</span>
            </p>
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate mt-0.5">
              {profile.fullName}
            </h1>
            <p className="text-xs text-sky-200/65 mt-0.5 truncate">
              {completedCount} completed tasks · Joined {formatShortDate(profile.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {!profile.photoAssetId && (
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="min-h-[44px] px-3.5 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 border border-teal-400/30 text-xs sm:text-sm font-semibold text-teal-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4" />
              <span>Upload Photo</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('custom_task')}
            className="min-h-[44px] px-4 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 border border-teal-400/35 text-xs sm:text-sm font-semibold text-teal-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-4 h-4" />
            <span>Custom Task Submission</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('completed')}
            className="min-h-[44px] px-4 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-xs sm:text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0"
          >
            Completed ({completedCount})
          </button>
          <button
            type="button"
            onClick={() => onNavigate('withdraw')}
            className="min-h-[44px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            Withdraw Funds
          </button>
        </div>
      </div>

      {/* Unread Task & Custom Task Decision Notifications */}
      {unreadNotifications.length > 0 && (
        <div className="space-y-2.5">
          {unreadNotifications.map((n) => {
            const isApproved = n.type === 'custom_task_approved' || n.type === 'task_approved';
            return (
              <div
                key={n.notificationId}
                className={`p-4 rounded-2xl border flex items-start justify-between gap-3 ${
                  isApproved
                    ? 'bg-emerald-500/12 border-emerald-400/35 text-emerald-100'
                    : 'bg-rose-500/12 border-rose-400/35 text-rose-100'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <Bell className="w-4 h-4 shrink-0 mt-0.5 text-teal-300" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs sm:text-sm font-bold text-white">{n.title}</p>
                    <p className="text-xs leading-relaxed">{n.message}</p>
                    <p className="text-[11px] font-mono tabular-nums opacity-70">
                      {formatDateTime(n.createdAt)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={markingNotifId === n.notificationId}
                  onClick={() => void handleDismissNotification(n.notificationId)}
                  className="min-h-[34px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white shrink-0"
                >
                  Dismiss
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Color-Coded Fintech KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Wallet Balance: Emerald Green & Teal */}
        <button
          type="button"
          onClick={() => onNavigate('wallet')}
          className="text-left rounded-2xl bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-[#0C1731] border border-emerald-400/30 shadow-[0_0_24px_-8px_rgba(16,185,129,0.35)] p-5 transition-transform active:scale-[0.99]"
        >
          <div className="flex items-center justify-between text-emerald-300">
            <span className="text-xs font-medium text-sky-100/85">Wallet Balance</span>
            <Wallet className="w-4 h-4 shrink-0" />
          </div>
          <p className="mt-3 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-teal-300">
            {formatBdt(availableBalance)}
          </p>
          <p className="mt-1.5 text-xs text-sky-200/70">
            {wallet?.reservedWithdrawals
              ? `${formatBdt(wallet.reservedWithdrawals)} reserved in pending payout`
              : 'Available for bKash / Nagad payout'}
          </p>
        </button>

        {/* Total Earnings: Royal Blue */}
        <button
          type="button"
          onClick={() => onNavigate('completed')}
          className="text-left rounded-2xl bg-gradient-to-br from-blue-600/25 via-blue-500/10 to-[#0C1731] border border-blue-400/30 shadow-[0_0_24px_-8px_rgba(59,130,246,0.35)] p-5 transition-transform active:scale-[0.99]"
        >
          <div className="flex items-center justify-between text-blue-300">
            <span className="text-xs font-medium text-sky-100/85">Total Earnings</span>
            <Award className="w-4 h-4 shrink-0" />
          </div>
          <p className="mt-3 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">
            {formatBdt(totalEarnings)}
          </p>
          <p className="mt-1.5 text-xs text-sky-200/70">
            {completedCount} Admin-approved tasks
          </p>
        </button>

        {/* Available Tasks: Amber & Orange */}
        <button
          type="button"
          onClick={() => onNavigate('tasks')}
          className="text-left rounded-2xl bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-[#0C1731] border border-amber-400/30 shadow-[0_0_24px_-8px_rgba(245,158,11,0.3)] p-5 transition-transform active:scale-[0.99]"
        >
          <div className="flex items-center justify-between text-amber-300">
            <span className="text-xs font-medium text-sky-100/85">Available Tasks</span>
            <Layers className="w-4 h-4 shrink-0" />
          </div>
          <p className="mt-3 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-300">
            {activeTasksCount}
          </p>
          <p className="mt-1.5 text-xs text-sky-200/70">
            {openTasksPreview.length} ready for your submission
          </p>
        </button>

        {/* Pending Proof: Purple & Indigo */}
        <button
          type="button"
          onClick={() => onNavigate('proof')}
          className="text-left rounded-2xl bg-gradient-to-br from-purple-500/20 via-indigo-500/12 to-[#0C1731] border border-purple-400/30 shadow-[0_0_24px_-8px_rgba(168,85,247,0.35)] p-5 transition-transform active:scale-[0.99]"
        >
          <div className="flex items-center justify-between text-purple-300">
            <span className="text-xs font-medium text-sky-100/85">Pending Proof</span>
            <FileCheck2 className="w-4 h-4 shrink-0" />
          </div>
          <p className="mt-3 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-purple-200">
            {pendingProofCount}
          </p>
          <p className="mt-1.5 text-xs text-sky-200/70">Awaiting Admin verification</p>
        </button>
      </div>

      {/* Custom Task Submission Quick Access Card (Mobile & Desktop) */}
      <div className="rounded-2xl bg-gradient-to-r from-[#0E1E3E] via-[#0C1934] to-[#0D1730] border border-teal-400/30 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/35 flex items-center justify-center text-teal-300 shrink-0">
            <FilePlus2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-white">Custom Task Submission</h2>
            <p className="text-xs text-sky-200/75 mt-0.5 leading-relaxed">
              Completed work outside the official task list? Submit task details and request an
              individual BDT payment ({pendingCustomCount} pending · {approvedCustomCount} approved).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('custom_task')}
          className="min-h-[44px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <FilePlus2 className="w-4 h-4" />
          <span>Submit Custom Task</span>
        </button>
      </div>

      {/* Two-Column Content Split on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Ready Tasks List */}
        <section className="lg:col-span-7 rounded-2xl bg-[#0D1730]/90 border border-white/10 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">Open Tasks</h2>
              <p className="text-xs text-sky-200/65">Complete work and upload screenshot proof</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="min-h-[44px] px-3 text-xs font-semibold text-teal-300 hover:text-teal-200 flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span>View All</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {openTasksPreview.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-medium text-white">All current tasks submitted</p>
              <p className="text-xs text-sky-200/65">
                Check back soon for new tasks or review your submission status in Proof.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/8">
              {openTasksPreview.map((task) => (
                <button
                  key={task.taskId}
                  type="button"
                  onClick={() => onNavigate('tasks')}
                  className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-white/[0.03] transition-colors min-h-[64px]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{task.title}</p>
                    <p className="text-xs text-sky-200/65 mt-0.5 truncate">
                      <span className="font-mono tabular-nums">{task.taskCode}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{task.instructions}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold font-mono tabular-nums text-teal-300">
                      +{formatBdt(task.rewardAmount)}
                    </p>
                    <p className="text-[11px] text-sky-200/60 mt-0.5">Start task</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Recent Wallet Activity */}
        <section className="lg:col-span-5 rounded-2xl bg-[#0D1730]/90 border border-white/10 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">Recent Ledger Activity</h2>
              <p className="text-xs text-sky-200/65">Atomic wallet credits & payouts</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('wallet')}
              className="min-h-[44px] px-3 text-xs font-semibold text-teal-300 hover:text-teal-200 flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span>Full History</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-medium text-white">No wallet transactions yet</p>
              <p className="text-xs text-sky-200/65">
                Approved task rewards and withdrawals will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/8">
              {recentTransactions.map((tx) => (
                <div key={tx.transactionId} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-white truncate">
                      {tx.description}
                    </p>
                    <p className="text-[11px] text-sky-200/60 font-mono tabular-nums mt-0.5">
                      {formatDateTime(tx.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-bold font-mono tabular-nums shrink-0 ${
                      tx.direction === 'credit'
                        ? 'text-emerald-400'
                        : tx.direction === 'debit'
                        ? 'text-amber-300'
                        : 'text-sky-300'
                    }`}
                  >
                    {tx.direction === 'credit'
                      ? `+${formatBdt(tx.amount)}`
                      : tx.direction === 'debit'
                      ? `-${formatBdt(tx.amount)}`
                      : formatBdt(tx.netAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ============================================================================
// 2. Available Tasks & Proof Upload Sheet
// ============================================================================
export function MemberTasksView({
  tasks,
  submissions,
  onNavigate,
}: {
  tasks: TaskItem[];
  submissions: TaskSubmission[];
  onNavigate: (tab: MemberPageTab) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofLink, setProofLink] = useState('');
  const [submissionNote, setSubmissionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submissionByTask = useMemo(() => {
    const map = new Map<string, TaskSubmission>();
    for (const sub of submissions) {
      const existing = map.get(sub.taskId);
      if (!existing || toMillis(sub.createdAt) > toMillis(existing.createdAt)) {
        map.set(sub.taskId, sub);
      }
    }
    return map;
  }, [submissions]);

  const activeTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks
      .filter((t) => t.isActive)
      .filter(
        (t) =>
          !q ||
          t.title.toLowerCase().includes(q) ||
          t.taskCode.toLowerCase().includes(q) ||
          t.instructions.toLowerCase().includes(q)
      );
  }, [tasks, searchQuery]);

  const handleSelectProofFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (proofPreview) URL.revokeObjectURL(proofPreview);
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
    setFeedback(null);
  };

  const closeSheet = () => {
    if (proofPreview) URL.revokeObjectURL(proofPreview);
    setSelectedTask(null);
    setProofFile(null);
    setProofPreview(null);
    setProofLink('');
    setSubmissionNote('');
    setFeedback(null);
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    if (!proofFile) {
      setFeedback({ type: 'error', text: 'Select a screenshot showing your completed task work.' });
      return;
    }

    const rawLink = proofLink.trim();
    const normalizedProofLink =
      rawLink && !/^https?:\/\//i.test(rawLink) ? `https://${rawLink}` : rawLink;
    if (normalizedProofLink && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(normalizedProofLink)) {
      setFeedback({
        type: 'error',
        text: 'Enter a valid shared work link URL (e.g., https://facebook.com/...).',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const { assetId, previewDataUrl } = await uploadCompressedMedia(proofFile, 'proof');
      primeMediaCache(assetId, previewDataUrl);
      await apiRequest('/api/submissions', {
        method: 'POST',
        body: {
          taskId: selectedTask.taskId,
          screenshotAssetId: assetId,
          proofLink: normalizedProofLink.slice(0, MAX_PROOF_LINK_LENGTH),
          submissionNote: submissionNote.trim().slice(0, MAX_SUBMISSION_NOTE_LENGTH),
        },
      });
      closeSheet();
      onNavigate('proof');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not submit proof.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Available Tasks</h1>
          <p className="text-xs sm:text-sm text-sky-200/70 mt-0.5">
            Open the external link, complete the task, and submit your screenshot & shared proof link.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('custom_task')}
            className="min-h-[44px] px-4 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 border border-teal-400/35 text-xs sm:text-sm font-semibold text-teal-200 flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <FilePlus2 className="w-4 h-4 text-teal-300" />
            <span>Custom Task Submission</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('completed')}
            className="min-h-[44px] px-4 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-xs sm:text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Award className="w-4 h-4 text-teal-300" />
            <span>Completed Tasks</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tasks by title, code, or instructions..."
          className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-[#0D1730] border border-white/12 text-sm text-white placeholder:text-sky-200/40 focus:outline-none focus:border-teal-400"
        />
      </div>

      {activeTasks.length === 0 ? (
        <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center space-y-2">
          <p className="text-base font-semibold text-white">No active tasks match your search</p>
          <p className="text-xs sm:text-sm text-sky-200/65">
            New tasks published by the Admin team appear here automatically in real time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeTasks.map((task) => {
            const latestSub = submissionByTask.get(task.taskId);
            const isApproved = latestSub?.status === 'approved';
            const isPending = latestSub?.status === 'pending';
            const isRejected = latestSub?.status === 'rejected';

            return (
              <article
                key={task.taskId}
                className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-sky-200/65 font-mono tabular-nums">
                        {task.taskCode}
                        <span aria-hidden="true"> · </span>
                        <span>Posted {formatShortDate(task.createdAt)}</span>
                      </p>
                      <h2 className="text-base sm:text-lg font-bold text-white mt-0.5 leading-snug">
                        {task.title}
                      </h2>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-teal-300">
                        {formatBdt(task.rewardAmount)}
                      </p>
                      <p className="text-[11px] text-sky-200/60">Reward</p>
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm text-sky-100/80 whitespace-pre-line leading-relaxed">
                    {task.instructions}
                  </p>

                  {isRejected && latestSub?.rejectionReason && (
                    <div className="pt-2 border-t border-white/10 text-xs text-rose-300">
                      Previous proof declined: {latestSub.rejectionReason}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
                  <a
                    href={task.externalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] px-3.5 rounded-xl bg-white/6 hover:bg-white/12 border border-white/12 text-xs sm:text-sm font-medium text-sky-100 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>Open Task Link</span>
                    <ExternalLink className="w-3.5 h-3.5 text-teal-300" />
                  </a>

                  {isApproved ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 min-h-[44px] px-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Completed · Credited</span>
                    </span>
                  ) : isPending ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-300 min-h-[44px] px-2">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>Pending Review</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTask(task);
                        setFeedback(null);
                      }}
                      className="min-h-[44px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Upload className="w-4 h-4" />
                      <span>{isRejected ? 'Resubmit Proof' : 'Submit Proof'}</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Submit Screenshot Proof Bottom Sheet / Modal */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={closeSheet}
        >
          <div
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-white/15 p-5 sm:p-6 max-h-[90dvh] overflow-y-auto space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-white/20 rounded-full mx-auto sm:hidden" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-mono tabular-nums text-teal-300">
                  {selectedTask.taskCode} · Reward {formatBdt(selectedTask.rewardAmount)}
                </p>
                <h2 className="text-lg font-bold text-white mt-0.5">{selectedTask.title}</h2>
              </div>
              <button
                type="button"
                onClick={closeSheet}
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-1 flex items-center justify-center text-sky-200/75 hover:text-white rounded-xl"
                aria-label="Close submission sheet"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {feedback && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/30 text-xs text-rose-200">
                {feedback.text}
              </div>
            )}

            <form onSubmit={handleSubmitProof} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-2">
                  Screenshot Proof (Required)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleSelectProofFile}
                  className="hidden"
                />

                {proofPreview ? (
                  <div className="space-y-2.5">
                    <div className="rounded-xl overflow-hidden border border-teal-400/30 bg-[#060B19] max-h-56 flex items-center justify-center">
                      <img
                        src={proofPreview}
                        alt="Selected proof preview"
                        referrerPolicy="no-referrer"
                        className="max-h-56 w-auto object-contain"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[44px] px-3.5 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white"
                    >
                      Choose Different Screenshot
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full min-h-[120px] rounded-2xl border border-dashed border-teal-400/35 bg-[#070E20] hover:bg-[#09132B] flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors"
                  >
                    <Camera className="w-6 h-6 text-teal-300" />
                    <span className="text-sm font-medium text-white">Tap to Upload Screenshot</span>
                    <span className="text-xs text-sky-200/60">PNG, JPG, or WebP · Auto-optimized</span>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                  Shared Work / Proof Link (Optional)
                </label>
                <input
                  type="text"
                  inputMode="url"
                  maxLength={MAX_PROOF_LINK_LENGTH}
                  value={proofLink}
                  onChange={(e) => setProofLink(e.target.value)}
                  placeholder="https://facebook.com/... or your shared post/profile link"
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                  Completion Note / Username (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={MAX_SUBMISSION_NOTE_LENGTH}
                  value={submissionNote}
                  onChange={(e) => setSubmissionNote(e.target.value)}
                  placeholder="Add any username, handle, or reference requested in instructions..."
                  className="w-full p-3 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? 'Uploading & Submitting...' : 'Submit Proof for Review'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2B. Custom Task Submission & History View
// ============================================================================
export function CustomTaskSubmissionView({
  customTasks,
  notifications,
}: {
  customTasks: CustomTaskSubmission[];
  notifications: MemberNotification[];
}) {
  const [taskName, setTaskName] = useState('');
  const [taskDetails, setTaskDetails] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  );
  const [historyFilter, setHistoryFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'all'
  );
  const [markingNotifId, setMarkingNotifId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customNotifications = useMemo(
    () =>
      notifications.filter(
        (n) =>
          !n.isRead && (n.type === 'custom_task_approved' || n.type === 'custom_task_rejected')
      ),
    [notifications]
  );

  const counts = useMemo(
    () => ({
      all: customTasks.length,
      pending: customTasks.filter((c) => c.status === 'pending').length,
      approved: customTasks.filter((c) => c.status === 'approved').length,
      rejected: customTasks.filter((c) => c.status === 'rejected').length,
    }),
    [customTasks]
  );

  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return customTasks;
    return customTasks.filter((c) => c.status === historyFilter);
  }, [customTasks, historyFilter]);

  const handleSelectProof = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (proofPreview) URL.revokeObjectURL(proofPreview);
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
    setFeedback(null);
  };

  const handleClearProof = () => {
    if (proofPreview) URL.revokeObjectURL(proofPreview);
    setProofFile(null);
    setProofPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDismissNotif = async (notificationId: string) => {
    setMarkingNotifId(notificationId);
    try {
      await apiRequest(`/api/notifications/${notificationId}/read`, { method: 'POST' });
    } catch {
      // Handled silently
    } finally {
      setMarkingNotifId(null);
    }
  };

  const handleSubmitCustomTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const cleanName = taskName.trim().slice(0, MAX_TASK_TITLE_LENGTH);
    const cleanDetails = taskDetails.trim().slice(0, MAX_TASK_INSTRUCTIONS_LENGTH);
    const parsedAmount = Number(requestedAmount);

    if (cleanName.length < 2) {
      setFeedback({ type: 'error', text: 'Task Name must be at least 2 characters.' });
      return;
    }
    if (cleanDetails.length < 5) {
      setFeedback({
        type: 'error',
        text: 'Task Details must be at least 5 characters describing your completed work.',
      });
      return;
    }
    if (
      !requestedAmount.trim() ||
      !Number.isFinite(parsedAmount) ||
      !Number.isInteger(parsedAmount) ||
      parsedAmount < 1 ||
      parsedAmount > 100000
    ) {
      setFeedback({
        type: 'error',
        text: 'Requested Amount must be a whole Taka integer between ৳1 and ৳100,000.',
      });
      return;
    }

    setSubmitting(true);
    try {
      let screenshotAssetId = '';
      if (proofFile) {
        const uploaded = await uploadCompressedMedia(proofFile, 'proof');
        primeMediaCache(uploaded.assetId, uploaded.previewDataUrl);
        screenshotAssetId = uploaded.assetId;
      }

      const res = await apiRequest<{ customTaskCode?: string }>('/api/custom-tasks', {
        method: 'POST',
        body: {
          taskName: cleanName,
          taskDetails: cleanDetails,
          requestedAmount: parsedAmount,
          screenshotAssetId,
        },
      });

      setTaskName('');
      setTaskDetails('');
      setRequestedAmount('');
      handleClearProof();
      setFeedback({
        type: 'success',
        text: `Custom task ${res.customTaskCode ? `(${res.customTaskCode}) ` : ''}submitted for review! Payment will be credited once approved by Main Admin.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not submit custom task request.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Custom Task Submission</h1>
        <p className="text-xs sm:text-sm text-sky-200/70 mt-0.5">
          Submit work completed outside the official task list and request an individual BDT
          payment.
        </p>
      </div>

      {/* Decision Notifications for Custom Tasks */}
      {customNotifications.length > 0 && (
        <div className="space-y-2.5">
          {customNotifications.map((n) => (
            <div
              key={n.notificationId}
              className={`p-4 rounded-2xl border flex items-start justify-between gap-3 ${
                n.type === 'custom_task_approved'
                  ? 'bg-emerald-500/12 border-emerald-400/35 text-emerald-100'
                  : 'bg-rose-500/12 border-rose-400/35 text-rose-100'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <Bell className="w-4 h-4 shrink-0 mt-0.5 text-teal-300" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs sm:text-sm font-bold text-white">{n.title}</p>
                  <p className="text-xs leading-relaxed">{n.message}</p>
                  <p className="text-[11px] font-mono tabular-nums opacity-70">
                    {formatDateTime(n.createdAt)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={markingNotifId === n.notificationId}
                onClick={() => void handleDismissNotif(n.notificationId)}
                className="min-h-[34px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white shrink-0"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Submission Form */}
        <form
          onSubmit={handleSubmitCustomTask}
          className="lg:col-span-5 rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 sm:p-6 space-y-4"
        >
          <div className="pb-3 border-b border-white/10">
            <h2 className="text-base font-bold text-white">New Custom Task Request</h2>
            <p className="text-xs text-sky-200/65 mt-0.5">
              Wallet funds are credited only after Main Admin payment approval.
            </p>
          </div>

          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/12 border-emerald-400/30 text-emerald-200'
                  : 'bg-rose-500/12 border-rose-400/30 text-rose-200'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* 1. Task Name */}
          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-1.5">1. Task Name</label>
            <input
              type="text"
              required
              maxLength={MAX_TASK_TITLE_LENGTH}
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Enter custom task name..."
              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
            />
          </div>

          {/* 2. Task Details */}
          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
              2. Task Details
            </label>
            <textarea
              rows={4}
              required
              maxLength={MAX_TASK_INSTRUCTIONS_LENGTH}
              value={taskDetails}
              onChange={(e) => setTaskDetails(e.target.value)}
              placeholder="Describe the completed work, links, usernames, or deliverables..."
              className="w-full p-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
            />
          </div>

          {/* 3. Requested Amount (BDT) */}
          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
              3. Requested Amount (BDT)
            </label>
            <input
              type="number"
              required
              min={1}
              max={100000}
              step={1}
              value={requestedAmount}
              onChange={(e) => setRequestedAmount(e.target.value)}
              placeholder="e.g., 50"
              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-base font-bold font-mono tabular-nums text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
            />
          </div>

          {/* 4. Screenshot/Proof (Optional) */}
          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-2">
              4. Screenshot / Proof (Optional)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleSelectProof}
              className="hidden"
            />

            {proofPreview ? (
              <div className="space-y-2.5">
                <div className="rounded-xl overflow-hidden border border-teal-400/30 bg-[#060B19] max-h-52 flex items-center justify-center">
                  <img
                    src={proofPreview}
                    alt="Custom task proof preview"
                    referrerPolicy="no-referrer"
                    className="max-h-52 w-auto object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[40px] px-3.5 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white"
                  >
                    Change Screenshot
                  </button>
                  <button
                    type="button"
                    onClick={handleClearProof}
                    className="min-h-[40px] px-3.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-xs font-medium text-rose-300 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[104px] rounded-2xl border border-dashed border-teal-400/35 bg-[#070E20] hover:bg-[#09132B] flex flex-col items-center justify-center gap-1.5 p-4 text-center transition-colors"
              >
                <Camera className="w-5 h-5 text-teal-300" />
                <span className="text-xs sm:text-sm font-medium text-white">
                  Tap to Upload Proof Screenshot (Optional)
                </span>
                <span className="text-[11px] text-sky-200/55">
                  PNG, JPG, or WebP · Auto-compressed
                </span>
              </button>
            )}
          </div>

          {/* 5. Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Send className="w-4 h-4" />
            <span>{submitting ? 'Submitting Request...' : 'Submit'}</span>
          </button>
        </form>

        {/* Custom Task Submission History & Status */}
        <section className="lg:col-span-7 rounded-2xl bg-[#0D1730]/95 border border-white/10 overflow-hidden">
          <div className="p-4 sm:px-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">
                Custom Task Submission History
              </h2>
              <p className="text-xs text-sky-200/65">
                Live review status, approved amounts, and Admin decisions
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 overflow-x-auto">
              {(
                [
                  { id: 'all', label: `All (${counts.all})` },
                  { id: 'pending', label: `Pending (${counts.pending})` },
                  { id: 'approved', label: `Approved (${counts.approved})` },
                  { id: 'rejected', label: `Rejected (${counts.rejected})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHistoryFilter(tab.id)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                    historyFilter === tab.id
                      ? 'bg-teal-500 text-slate-950'
                      : 'text-sky-200/75 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-white">No custom task submissions found</p>
              <p className="text-xs text-sky-200/65">
                Submit a custom task using the form to track its inspection and payment approval
                here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/8">
              {filteredHistory.map((item) => (
                <div key={item.customTaskId} className="p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-mono tabular-nums text-sky-200/65">
                        <span className="text-teal-300 font-semibold">{item.customTaskCode}</span>
                        <span aria-hidden="true"> · </span>
                        <span>Submitted {formatDateTime(item.createdAt)}</span>
                      </p>
                      <h3 className="text-sm sm:text-base font-bold text-white">{item.taskName}</h3>
                      <p className="text-xs text-sky-100/80 whitespace-pre-line leading-relaxed">
                        {item.taskDetails}
                      </p>
                    </div>

                    <div className="sm:text-right shrink-0 font-mono tabular-nums">
                      <p className="text-[11px] font-sans text-sky-200/60">Requested Amount</p>
                      <p className="text-base font-bold text-amber-300">
                        {formatBdt(item.requestedAmount)}
                      </p>
                      {item.status === 'approved' && (
                        <p className="text-xs font-bold text-emerald-400 mt-0.5">
                          Paid: +{formatBdt(item.approvedAmount)}
                        </p>
                      )}
                    </div>
                  </div>

                  {item.screenshotAssetId && (
                    <ProofScreenshotViewer
                      assetId={item.screenshotAssetId}
                      title={`${item.customTaskCode} · ${item.taskName}`}
                      compact
                    />
                  )}

                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                    {item.status === 'approved' ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Approved by Main Admin · Credited {formatBdt(item.approvedAmount)}
                        </span>
                      </span>
                    ) : item.status === 'rejected' ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-rose-400">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Rejected by Main Admin · No Wallet Credit</span>
                        </span>
                        {item.rejectionReason && (
                          <p className="text-xs text-rose-200/90">
                            Reason: {item.rejectionReason}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-purple-300">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>Pending Main Admin Payment Decision</span>
                        </span>
                        {item.assistantStatus !== 'unreviewed' && (
                          <span className="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-400/30 text-[11px] text-sky-200">
                            Inspected by Assistant Admin
                          </span>
                        )}
                      </div>
                    )}

                    {item.reviewedAt && (
                      <span className="text-[11px] font-mono tabular-nums text-sky-200/55">
                        {formatDateTime(item.reviewedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ============================================================================
// 3. Dedicated Completed Tasks Page
// ============================================================================
export function CompletedTasksView({
  submissions,
  onNavigate,
}: {
  submissions: TaskSubmission[];
  onNavigate: (tab: MemberPageTab) => void;
}) {
  const approvedSubmissions = useMemo(
    () => submissions.filter((s) => s.status === 'approved'),
    [submissions]
  );

  const totalEarnedFromTasks = useMemo(
    () => approvedSubmissions.reduce((acc, s) => acc + Number(s.rewardAmount || 0), 0),
    [approvedSubmissions]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Completed Tasks</h1>
          <p className="text-xs sm:text-sm text-sky-200/70 mt-0.5">
            Verified tasks approved by Admin and credited to your wallet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('proof')}
          className="min-h-[44px] px-4 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-xs sm:text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0"
        >
          View All Proof Submissions
        </button>
      </div>

      {/* Summary Banner */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-[#0D1730]/95 border border-emerald-400/25 p-4 sm:p-5">
          <p className="text-xs text-sky-200/75">Completed Tasks</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-white">
            {approvedSubmissions.length}
          </p>
        </div>
        <div className="rounded-2xl bg-[#0D1730]/95 border border-blue-400/25 p-4 sm:p-5">
          <p className="text-xs text-sky-200/75">Credited Rewards</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-teal-300">
            {formatBdt(totalEarnedFromTasks)}
          </p>
        </div>
      </div>

      {approvedSubmissions.length === 0 ? (
        <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center space-y-3">
          <p className="text-base font-semibold text-white">No completed tasks yet</p>
          <p className="text-xs sm:text-sm text-sky-200/65 max-w-md mx-auto">
            Only Admin-approved proof submissions count as completed tasks and credit BDT rewards.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('tasks')}
            className="min-h-[44px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <span>Browse Available Tasks</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
          {approvedSubmissions.map((item) => (
            <div
              key={item.submissionId}
              className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-4 min-w-0">
                <ProofScreenshotViewer
                  assetId={item.screenshotAssetId}
                  title={`${item.taskCode} · ${item.taskTitle}`}
                  compact
                />
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-mono tabular-nums text-sky-200/70">
                    {item.taskCode}
                    <span aria-hidden="true"> · </span>
                    <span>Approved {formatDateTime(item.reviewedAt || item.updatedAt)}</span>
                  </p>
                  <h2 className="text-sm sm:text-base font-semibold text-white truncate">
                    {item.taskTitle}
                  </h2>
                  {item.proofLink && (
                    <a
                      href={item.proofLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline max-w-full"
                    >
                      <span className="truncate max-w-[240px] sm:max-w-xs">{item.proofLink}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                  <p className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Completed · Reward Credited</span>
                  </p>
                </div>
              </div>

              <div className="sm:text-right shrink-0">
                <p className="text-lg font-bold font-mono tabular-nums text-teal-300">
                  +{formatBdt(item.rewardAmount)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4. Proof Submission History (Pending Review, Approved, Rejected Filters)
// ============================================================================
export function ProofSubmissionsView({
  submissions,
  onNavigate,
}: {
  submissions: TaskSubmission[];
  onNavigate: (tab: MemberPageTab) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const counts = useMemo(() => {
    return {
      all: submissions.length,
      pending: submissions.filter((s) => s.status === 'pending').length,
      approved: submissions.filter((s) => s.status === 'approved').length,
      rejected: submissions.filter((s) => s.status === 'rejected').length,
    };
  }, [submissions]);

  const filtered = useMemo(() => {
    if (filter === 'all') return submissions;
    return submissions.filter((s) => s.status === filter);
  }, [submissions, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Proof Submissions</h1>
          <p className="text-xs sm:text-sm text-sky-200/70 mt-0.5">
            Track Pending Review, Approved, and Rejected task proof screenshots.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('completed')}
          className="min-h-[44px] px-4 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-xs sm:text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0"
        >
          Completed Tasks ({counts.approved})
        </button>
      </div>

      {/* Interactive Segmented Filter Bar */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 overflow-x-auto">
        {(
          [
            { id: 'all', label: `All (${counts.all})` },
            { id: 'pending', label: `Pending Review (${counts.pending})` },
            { id: 'approved', label: `Approved (${counts.approved})` },
            { id: 'rejected', label: `Rejected (${counts.rejected})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`min-h-[42px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex-1 ${
              filter === tab.id
                ? 'bg-teal-500 text-slate-950'
                : 'text-sky-200/75 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center space-y-2">
          <p className="text-base font-semibold text-white">No submissions in this filter</p>
          <p className="text-xs sm:text-sm text-sky-200/65">
            Complete an open task and upload screenshot proof to track review status here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
          {filtered.map((sub) => (
            <div key={sub.submissionId} className="p-5 flex flex-col sm:flex-row gap-4 justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <ProofScreenshotViewer
                  assetId={sub.screenshotAssetId}
                  title={`${sub.taskCode} · ${sub.taskTitle}`}
                  compact
                />
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-mono tabular-nums text-sky-200/65">
                    {sub.taskCode}
                    <span aria-hidden="true"> · </span>
                    <span>Submitted {formatDateTime(sub.createdAt)}</span>
                  </p>
                  <h2 className="text-sm sm:text-base font-semibold text-white truncate">
                    {sub.taskTitle}
                  </h2>
                  {sub.proofLink && (
                    <a
                      href={sub.proofLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline max-w-full"
                    >
                      <span className="truncate max-w-[240px] sm:max-w-xs">{sub.proofLink}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                  {sub.submissionNote && (
                    <p className="text-xs text-sky-200/75">Note: {sub.submissionNote}</p>
                  )}

                  {sub.status === 'approved' && (
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Approved · Credited {formatBdt(sub.rewardAmount)}</span>
                    </p>
                  )}
                  {sub.status === 'pending' && (
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-300">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span>Pending Review · Reward {formatBdt(sub.rewardAmount)} upon approval</span>
                    </p>
                  )}
                  {sub.status === 'rejected' && (
                    <div className="space-y-1">
                      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Rejected</span>
                      </p>
                      {sub.rejectionReason && (
                        <p className="text-xs text-rose-200/90">Reason: {sub.rejectionReason}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between shrink-0 gap-2">
                <span className="text-base font-bold font-mono tabular-nums text-white">
                  {formatBdt(sub.rewardAmount)}
                </span>
                {sub.status === 'rejected' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('tasks')}
                    className="min-h-[40px] px-3 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-teal-300 whitespace-nowrap"
                  >
                    Go to Tasks
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. Member Wallet & Transaction History
// ============================================================================
export function MemberWalletView({
  wallet,
  transactions,
  onNavigate,
}: {
  wallet: MemberWallet | null;
  transactions: WalletTransaction[];
  onNavigate: (tab: MemberPageTab) => void;
}) {
  const [txFilter, setTxFilter] = useState<'all' | 'task_reward' | 'withdrawals' | 'withdrawal_refund'>('all');

  const filteredTx = useMemo(() => {
    if (txFilter === 'all') return transactions;
    if (txFilter === 'task_reward') {
      return transactions.filter(
        (t) => t.type === 'task_reward' || t.type === 'custom_task_reward'
      );
    }
    if (txFilter === 'withdrawals') {
      return transactions.filter(
        (t) => t.type === 'withdrawal_request' || t.type === 'withdrawal_paid'
      );
    }
    return transactions.filter((t) => t.type === txFilter);
  }, [transactions, txFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Wallet & Earnings</h1>
          <p className="text-xs sm:text-sm text-sky-200/70 mt-0.5">
            Server-verified atomic balances and immutable transaction ledger.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('withdraw')}
          className="min-h-[44px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          Request Withdrawal
        </button>
      </div>

      {/* 4 Required Wallet Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-[#0C1731] border border-emerald-400/30 p-5">
          <p className="text-xs text-sky-100/80">Available Wallet Balance</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-teal-300">
            {formatBdt(wallet?.availableBalance ?? 0)}
          </p>
          {(wallet?.reservedWithdrawals ?? 0) > 0 && (
            <p className="mt-1 text-xs font-mono tabular-nums text-amber-300">
              {formatBdt(wallet?.reservedWithdrawals)} reserved in pending request
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-[#0C1731] border border-blue-400/30 p-5">
          <p className="text-xs text-sky-100/80">Total Earnings</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">
            {formatBdt(wallet?.totalEarnings ?? 0)}
          </p>
          <p className="mt-1 text-xs text-sky-200/65">Cumulative approved task rewards</p>
        </div>

        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/12 p-5">
          <p className="text-xs text-sky-100/80">Total Withdrawals</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">
            {formatBdt(wallet?.totalWithdrawals ?? 0)}
          </p>
          <p className="mt-1 text-xs text-sky-200/65">Settled gross withdrawal volume</p>
        </div>

        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/12 p-5">
          <p className="text-xs text-sky-100/80">Total Withdrawal Fees</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-300">
            {formatBdt(wallet?.totalWithdrawalFees ?? 0)}
          </p>
          <p className="mt-1 text-xs text-sky-200/65">Fixed ৳5 fee per paid withdrawal</p>
        </div>
      </div>

      {/* Transaction History */}
      <section className="rounded-2xl bg-[#0D1730]/95 border border-white/10 overflow-hidden">
        <div className="p-4 sm:px-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-teal-300" />
            <h2 className="text-base font-semibold text-white">Transaction History</h2>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'task_reward', label: 'Task Rewards' },
                { id: 'withdrawals', label: 'Withdrawals & Fees' },
                { id: 'withdrawal_refund', label: 'Refunds' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTxFilter(f.id)}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  txFilter === f.id
                    ? 'bg-teal-500 text-slate-950'
                    : 'text-sky-200/75 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredTx.length === 0 ? (
          <div className="p-10 text-center space-y-1.5">
            <p className="text-sm font-semibold text-white">No ledger entries found</p>
            <p className="text-xs text-sky-200/65">
              Task rewards, withdrawal deductions, ৳5 fees, payouts, and refunds are logged here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/8">
            {filteredTx.map((tx) => (
              <div
                key={tx.transactionId}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-white">{tx.description}</p>
                  <p className="text-xs text-sky-200/60 font-mono tabular-nums">
                    {formatDateTime(tx.approvedAt || tx.createdAt)}
                    <span aria-hidden="true"> · </span>
                    <span>
                      {tx.type === 'task_reward'
                        ? 'Reward Credit'
                        : tx.type === 'custom_task_reward'
                        ? 'Custom Task Payment Credit'
                        : tx.type === 'withdrawal_request'
                        ? `Gross ${formatBdt(tx.amount)} · Fee ${formatBdt(tx.feeAmount)} · Net ${formatBdt(tx.netAmount)}`
                        : tx.type === 'withdrawal_paid'
                        ? `Paid Settlement · Net ${formatBdt(tx.netAmount)}`
                        : 'Full Gross Refund'}
                    </span>
                    {tx.submissionId ? ` · ID ${tx.submissionId}` : ''}
                  </p>
                </div>

                <div className="sm:text-right shrink-0 font-mono tabular-nums">
                  <p
                    className={`text-sm font-bold ${
                      tx.direction === 'credit'
                        ? 'text-emerald-400'
                        : tx.direction === 'debit'
                        ? 'text-amber-300'
                        : 'text-teal-300'
                    }`}
                  >
                    {tx.direction === 'credit'
                      ? `+${formatBdt(tx.amount)}`
                      : tx.direction === 'debit'
                      ? `-${formatBdt(tx.amount)}`
                      : `Paid ${formatBdt(tx.netAmount)}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// 6. Withdrawal System With Fixed ৳5 Fee
// ============================================================================
export function MemberWithdrawView({
  profile,
  wallet,
  withdrawals,
}: {
  profile: UserProfile;
  wallet: MemberWallet | null;
  withdrawals: WithdrawalRequest[];
}) {
  const availableBalance = wallet?.availableBalance ?? 0;
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('bKash');
  const [accountNumber, setAccountNumber] = useState(() =>
    BD_MOBILE_PATTERN.test(profile.phone || '') ? profile.phone : ''
  );
  const [amountInput, setAmountInput] = useState('100');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const parsedGross = Number(amountInput);
  const isValidInteger = Number.isFinite(parsedGross) && Number.isInteger(parsedGross) && amountInput.trim() !== '';
  const feeAmount = FIXED_WITHDRAWAL_FEE;
  const netAmount = isValidInteger ? Math.max(0, parsedGross - feeAmount) : 0;

  const validationError = useMemo(() => {
    if (!amountInput.trim()) return 'Enter a withdrawal amount in Bangladeshi Taka (৳).';
    if (!isValidInteger) return 'Enter a whole Taka integer amount.';
    if (parsedGross < MIN_WITHDRAWAL_GROSS) {
      return `Minimum Withdraw ${MIN_WITHDRAWAL_GROSS} Tk (৳${MIN_WITHDRAWAL_GROSS}). You cannot withdraw less than ${MIN_WITHDRAWAL_GROSS} Tk.`;
    }
    if (parsedGross > availableBalance) {
      return `Insufficient available balance (${formatBdt(availableBalance)}) to cover ${formatBdt(parsedGross)} gross withdrawal.`;
    }
    if (!BD_MOBILE_PATTERN.test(accountNumber.trim())) {
      return 'Enter a valid 11-digit Bangladeshi bKash/Nagad mobile number (e.g., 01712345678).';
    }
    return null;
  }, [amountInput, isValidInteger, parsedGross, availableBalance, accountNumber]);

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    if (validationError) {
      setBanner({ type: 'error', text: validationError });
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmWithdrawal = async () => {
    if (submitting) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await apiRequest<{
        transactionCode: string;
        grossAmount: number;
        feeAmount: number;
        netAmount: number;
      }>('/api/withdrawals', {
        method: 'POST',
        body: {
          payoutMethod,
          accountNumber: accountNumber.trim(),
          grossAmount: parsedGross,
        },
      });
      setConfirmOpen(false);
      setBanner({
        type: 'success',
        text: `Withdrawal ${res.transactionCode} submitted: Total Withdraw ${formatBdt(
          res.grossAmount
        )} · Fee ${formatBdt(res.feeAmount)} · Received Amount ${formatBdt(res.netAmount)}.`,
      });
    } catch (err) {
      setConfirmOpen(false);
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Withdrawal request failed.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Withdraw Funds</h1>
          <p className="text-xs sm:text-sm text-sky-200/70 mt-0.5">
            Minimum Withdraw 100 Tk · Request payout via bKash or Nagad with a fixed ৳5 processing fee.
          </p>
        </div>
        <div className="text-xs sm:text-sm font-mono tabular-nums font-semibold text-amber-300 shrink-0">
          Minimum Withdraw 100 Tk
        </div>
      </div>

      {banner && (
        <div
          className={`p-4 rounded-2xl border text-xs sm:text-sm ${
            banner.type === 'success'
              ? 'bg-emerald-500/12 border-emerald-400/30 text-emerald-200'
              : 'bg-rose-500/12 border-rose-400/30 text-rose-200'
          }`}
        >
          {banner.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Request Form & Pre-Confirmation Breakdown */}
        <form
          onSubmit={handleOpenConfirm}
          className="lg:col-span-6 rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 sm:p-6 space-y-5"
        >
          <div className="pb-4 border-b border-white/10 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm text-sky-200/80">Available Balance</span>
              <span className="text-xl font-bold font-mono tabular-nums text-teal-300">
                {formatBdt(availableBalance)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-sky-200/65">Withdrawal Limit</span>
              <span className="font-mono tabular-nums font-semibold text-amber-300">
                Minimum Withdraw 100 Tk
              </span>
            </div>
          </div>

          {/* Payout Method */}
          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-2">Payout Method</label>
            <div className="grid grid-cols-2 gap-3">
              {(['bKash', 'Nagad'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPayoutMethod(method)}
                  className={`min-h-[48px] px-4 rounded-xl border text-sm font-semibold transition-colors whitespace-nowrap ${
                    payoutMethod === method
                      ? 'bg-teal-500/20 border-teal-400 text-teal-200'
                      : 'bg-[#070E20] border-white/12 text-sky-200/75 hover:text-white'
                  }`}
                >
                  {method} Personal
                </button>
              ))}
            </div>
          </div>

          {/* Account Number */}
          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
              {payoutMethod} Account Number
            </label>
            <input
              type="tel"
              required
              maxLength={14}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="01712345678"
              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono tabular-nums text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
            />
          </div>

          {/* Gross Amount Input + Presets */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-xs font-medium text-sky-200/80">
                Total Withdraw Amount (৳)
              </label>
              <span className="text-xs font-mono tabular-nums font-semibold text-amber-300">
                Minimum Withdraw 100 Tk
              </span>
            </div>
            <input
              type="number"
              step={1}
              min={MIN_WITHDRAWAL_GROSS}
              required
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="100"
              className="w-full min-h-[48px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-base font-bold font-mono tabular-nums text-white focus:outline-none focus:border-teal-400"
            />
            {isValidInteger && parsedGross > 0 && parsedGross < MIN_WITHDRAWAL_GROSS && (
              <p className="mt-1.5 text-xs text-rose-300 font-medium">
                Minimum Withdraw 100 Tk — requests under ৳100 are not allowed.
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {[100, 200, 500, 1000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmountInput(String(preset))}
                  className="min-h-[38px] px-3 rounded-lg bg-white/6 hover:bg-white/12 text-xs font-mono tabular-nums text-sky-100"
                >
                  ৳{preset}
                </button>
              ))}
              {availableBalance >= MIN_WITHDRAWAL_GROSS && (
                <button
                  type="button"
                  onClick={() => setAmountInput(String(Math.floor(availableBalance)))}
                  className="min-h-[38px] px-3 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 text-xs font-semibold text-teal-300"
                >
                  Max ({formatBdt(Math.floor(availableBalance))})
                </button>
              )}
            </div>
          </div>

          {/* Live Fee Breakdown Box */}
          <div className="pt-4 border-t border-white/10 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-sky-200/75">Total Withdraw</span>
              <span className="font-mono tabular-nums font-semibold text-white">
                {isValidInteger && parsedGross > 0 ? formatBdt(parsedGross) : '৳0'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sky-200/75">Fee (Fixed)</span>
              <span className="font-mono tabular-nums font-semibold text-amber-300">
                {formatBdt(feeAmount)}
              </span>
            </div>
            <div className="pt-2 border-t border-white/10 flex items-center justify-between">
              <span className="font-semibold text-white">Received Amount</span>
              <span className="text-lg font-bold font-mono tabular-nums text-teal-300">
                {isValidInteger && parsedGross >= MIN_WITHDRAWAL_GROSS
                  ? formatBdt(netAmount)
                  : '৳0'}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-sky-200/60 leading-relaxed">
            Policy: Minimum Withdraw 100 Tk (৳100). The gross amount is reserved once upon request.
            No additional fee is charged when marked Paid. If a request is rejected, 100% of the
            gross amount (including the ৳5 fee) is automatically refunded to your Available Balance.
          </p>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap"
          >
            Review & Confirm Withdrawal
          </button>
        </form>

        {/* Member Withdrawal History */}
        <section className="lg:col-span-6 rounded-2xl bg-[#0D1730]/95 border border-white/10 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <h2 className="text-base font-semibold text-white">Withdrawal History</h2>
            <p className="text-xs text-sky-200/65">Full gross, ৳5 fee, and net payout records</p>
          </div>

          {withdrawals.length === 0 ? (
            <div className="p-10 text-center space-y-1.5">
              <p className="text-sm font-semibold text-white">No withdrawal requests yet</p>
              <p className="text-xs text-sky-200/65">
                Submitted bKash and Nagad payout requests will appear here with live status updates.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/8">
              {withdrawals.map((w) => (
                <div key={w.withdrawalId} className="p-5 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono tabular-nums text-sky-200/70">
                        {w.transactionCode}
                        <span aria-hidden="true"> · </span>
                        <span>{w.payoutMethod}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{w.accountNumber}</span>
                      </p>
                      <p className="text-xs text-sky-200/55 mt-0.5">{formatDateTime(w.createdAt)}</p>
                    </div>

                    <div className="text-right shrink-0">
                      {w.status === 'paid' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Paid</span>
                        </span>
                      )}
                      {w.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Pending Review</span>
                        </span>
                      )}
                      {w.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Rejected · Refunded</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-sky-100/85 pt-1">
                    <span>Total Withdraw: {formatBdt(w.grossAmount)}</span>
                    <span>Fee: {formatBdt(w.feeAmount)}</span>
                    <span className="font-bold text-teal-300">
                      Received: {formatBdt(w.netAmount)}
                    </span>
                  </div>

                  {w.paymentReference && (
                    <p className="text-xs font-mono tabular-nums text-emerald-300/90">
                      Payout TrxID: {w.paymentReference}
                    </p>
                  )}
                  {w.adminNote && (
                    <p className="text-xs text-sky-200/75">Admin note: {w.adminNote}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Explicit Confirmation Modal */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !submitting && setConfirmOpen(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-teal-400/30 p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-lg font-bold text-white">Confirm Withdrawal Breakdown</h2>
              <p className="text-xs text-sky-200/70 mt-1">
                Verify your {payoutMethod} account and net payout before reserving funds.
              </p>
            </div>

            <div className="divide-y divide-white/10 border-t border-b border-white/10 text-sm">
              <div className="py-2.5 flex justify-between">
                <span className="text-sky-200/75">Method & Account</span>
                <span className="font-mono tabular-nums text-white font-medium">
                  {payoutMethod} · {accountNumber.trim()}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-sky-200/75">Total Withdraw</span>
                <span className="font-mono tabular-nums text-white font-semibold">
                  {formatBdt(parsedGross)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-sky-200/75">Fee</span>
                <span className="font-mono tabular-nums text-amber-300 font-semibold">
                  {formatBdt(feeAmount)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between">
                <span className="text-white font-semibold">Received Amount</span>
                <span className="font-mono tabular-nums text-teal-300 font-bold text-base">
                  {formatBdt(netAmount)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmOpen(false)}
                className="min-h-[46px] px-4 rounded-xl bg-white/8 hover:bg-white/12 text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmWithdrawal}
                className="min-h-[46px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 text-sm font-semibold"
              >
                {submitting ? 'Processing...' : 'Confirm Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 7. Member Profile & Settings (Photo Manager + Approved Password Change Flow)
// ============================================================================
export function MemberProfileView({
  profile,
  wallet,
  submissions,
  passwordRequests,
  onLogout,
}: {
  profile: UserProfile;
  wallet: MemberWallet | null;
  submissions: TaskSubmission[];
  passwordRequests: PasswordChangeRequest[];
  onLogout: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone || '');
  const [stagedAvatarFile, setStagedAvatarFile] = useState<File | null>(null);
  const [stagedPreview, setStagedPreview] = useState<string | null | undefined>(undefined);
  const [removePhotoFlag, setRemovePhotoFlag] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Password Change Request state
  const [pcrReason, setPcrReason] = useState('');
  const [pcrBusy, setPcrBusy] = useState(false);
  const [pcrMsg, setPcrMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const avatarInputRef = useRef<HTMLInputElement>(null);

  const approvedTasksCount = useMemo(
    () => submissions.filter((s) => s.status === 'approved').length,
    [submissions]
  );

  const activeApprovedRequest = useMemo(
    () => passwordRequests.find((r) => r.status === 'approved'),
    [passwordRequests]
  );
  const activePendingRequest = useMemo(
    () => passwordRequests.find((r) => r.status === 'pending'),
    [passwordRequests]
  );

  const handleSelectAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (stagedPreview) URL.revokeObjectURL(stagedPreview);
    const localUrl = URL.createObjectURL(file);
    setStagedPreview(localUrl);
    setStagedAvatarFile(null);
    setRemovePhotoFlag(false);
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const uploaded = await uploadCompressedMedia(file, 'avatar');
      primeMediaCache(uploaded.assetId, uploaded.previewDataUrl);
      const safeName = (fullName.trim() || profile.fullName).slice(0, MAX_NAME_LENGTH);
      const safePhone = BD_MOBILE_PATTERN.test(phone.trim()) ? phone.trim() : profile.phone || '';
      await apiRequest('/api/profile', {
        method: 'PUT',
        body: {
          fullName: safeName,
          phone: safePhone,
          photoAssetId: uploaded.assetId,
        },
      });
      URL.revokeObjectURL(localUrl);
      setStagedPreview(undefined);
      setProfileMsg({ type: 'success', text: 'Profile photo uploaded and saved!' });
    } catch (err) {
      setStagedAvatarFile(file);
      setProfileMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to upload profile photo.',
      });
    } finally {
      setSavingProfile(false);
      e.target.value = '';
    }
  };

  const handleStageRemoveAvatar = async () => {
    if (stagedPreview) URL.revokeObjectURL(stagedPreview);
    setStagedAvatarFile(null);
    setStagedPreview(null);
    setRemovePhotoFlag(true);
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const safeName = (fullName.trim() || profile.fullName).slice(0, MAX_NAME_LENGTH);
      const safePhone = BD_MOBILE_PATTERN.test(phone.trim()) ? phone.trim() : profile.phone || '';
      await apiRequest('/api/profile', {
        method: 'PUT',
        body: {
          fullName: safeName,
          phone: safePhone,
          photoAssetId: '',
        },
      });
      setStagedPreview(undefined);
      setRemovePhotoFlag(false);
      setProfileMsg({ type: 'success', text: 'Profile photo removed.' });
    } catch (err) {
      setProfileMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to remove profile photo.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);

    const cleanName = fullName.trim().slice(0, MAX_NAME_LENGTH);
    const cleanPhone = phone.trim();
    if (cleanName.length < 2) {
      setProfileMsg({ type: 'error', text: 'Full name must be at least 2 characters.' });
      return;
    }
    if (cleanPhone && !BD_MOBILE_PATTERN.test(cleanPhone)) {
      setProfileMsg({
        type: 'error',
        text: 'Enter a valid Bangladeshi phone number (e.g., 01712345678).',
      });
      return;
    }

    setSavingProfile(true);
    try {
      let nextPhotoAssetId = removePhotoFlag ? '' : profile.photoAssetId;
      if (stagedAvatarFile) {
        const uploaded = await uploadCompressedMedia(stagedAvatarFile, 'avatar');
        primeMediaCache(uploaded.assetId, uploaded.previewDataUrl);
        nextPhotoAssetId = uploaded.assetId;
      }

      await apiRequest('/api/profile', {
        method: 'PUT',
        body: {
          fullName: cleanName,
          phone: cleanPhone,
          photoAssetId: nextPhotoAssetId,
        },
      });

      if (stagedPreview) URL.revokeObjectURL(stagedPreview);
      setStagedAvatarFile(null);
      setStagedPreview(undefined);
      setRemovePhotoFlag(false);
      setProfileMsg({ type: 'success', text: 'Profile and photo updated securely.' });
    } catch (err) {
      setProfileMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update profile.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSubmitPasswordRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setPcrMsg(null);
    if (pcrReason.trim().length < 5) {
      setPcrMsg({ type: 'error', text: 'Enter a brief reason (minimum 5 characters).' });
      return;
    }
    setPcrBusy(true);
    try {
      await apiRequest('/api/password-requests', {
        method: 'POST',
        body: { reason: pcrReason.trim() },
      });
      setPcrReason('');
      setPcrMsg({
        type: 'success',
        text: 'Password change request submitted. You can update your password once Admin approves it.',
      });
    } catch (err) {
      setPcrMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not submit request.',
      });
    } finally {
      setPcrBusy(false);
    }
  };

  const handleExecuteApprovedPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeApprovedRequest || !auth.currentUser) return;
    setPcrMsg(null);

    if (newPassword.length < 6) {
      setPcrMsg({ type: 'error', text: 'New password must be at least 6 characters.' });
      return;
    }

    setPcrBusy(true);
    try {
      const credential = EmailAuthProvider.credential(profile.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
      await apiRequest(`/api/password-requests/${activeApprovedRequest.requestId}/complete`, {
        method: 'POST',
      });
      setCurrentPassword('');
      setNewPassword('');
      setPcrMsg({
        type: 'success',
        text: 'Password updated directly via Firebase Authentication and authorization marked Completed.',
      });
    } catch (err) {
      setPcrMsg({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Re-authentication or password update failed. Check your current password.',
      });
    } finally {
      setPcrBusy(false);
    }
  };

  const handleApprovedResetEmailDispatch = async () => {
    if (!activeApprovedRequest) return;
    setPcrBusy(true);
    setPcrMsg(null);
    try {
      await sendPasswordResetEmail(auth, profile.email);
      await apiRequest(`/api/password-requests/${activeApprovedRequest.requestId}/complete`, {
        method: 'POST',
      });
      setPcrMsg({
        type: 'success',
        text: `Verified password reset link sent to ${profile.email} and request marked Completed.`,
      });
    } catch (err) {
      setPcrMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not send reset email.',
      });
    } finally {
      setPcrBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Member Profile & Settings</h1>
          <p className="text-xs sm:text-sm text-sky-200/70 mt-0.5">
            Manage your identity, profile photo, and security requests.
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="min-h-[44px] px-4 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-xs sm:text-sm font-medium text-white shrink-0"
        >
          Sign Out
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Profile Details & Photo Editor */}
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-6 rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-5 border-b border-white/10">
            <AvatarDisplay
              photoAssetId={profile.photoAssetId}
              fullName={fullName || profile.fullName}
              sizeClass="w-24 h-24 text-xl"
              previewOverride={stagedPreview}
              zoomable
            />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Member Profile Photo</p>
              <p className="text-xs text-sky-200/70">
                Upload a clear profile photo. Visible on your dashboard and to Admin during verification.
              </p>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleSelectAvatar}
                className="hidden"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={savingProfile}
                  onClick={() => avatarInputRef.current?.click()}
                  className="min-h-[42px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-xs font-semibold text-slate-950 inline-flex items-center gap-1.5"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>
                    {savingProfile
                      ? 'Uploading Photo...'
                      : profile.photoAssetId || stagedPreview
                      ? 'Change Profile Photo'
                      : 'Upload Profile Photo'}
                  </span>
                </button>
                {(profile.photoAssetId || stagedPreview) && !removePhotoFlag && (
                  <button
                    type="button"
                    disabled={savingProfile}
                    onClick={handleStageRemoveAvatar}
                    className="min-h-[42px] px-3.5 rounded-xl bg-rose-500/12 hover:bg-rose-500/20 text-xs font-medium text-rose-300 inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {profileMsg && (
            <div
              className={`p-3.5 rounded-xl border text-xs ${
                profileMsg.type === 'success'
                  ? 'bg-emerald-500/12 border-emerald-400/30 text-emerald-200'
                  : 'bg-rose-500/12 border-rose-400/30 text-rose-200'
              }`}
            >
              {profileMsg.text}
            </div>
          )}

          {/* Read-only System Identifiers & Summaries */}
          <div className="divide-y divide-white/8 text-xs sm:text-sm border-b border-white/10 pb-2">
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Unique Member ID</span>
              <span className="font-mono tabular-nums font-semibold text-teal-300">
                {profile.memberId}
              </span>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Account Status</span>
              <span className="text-emerald-400 font-medium capitalize">
                {profile.status} ({profile.role})
              </span>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Registered Email</span>
              <span className="text-white truncate">{profile.email}</span>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Registration Date</span>
              <span className="font-mono tabular-nums text-sky-100">
                {formatShortDate(profile.createdAt)}
              </span>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Task & Earnings Summary</span>
              <span className="font-mono tabular-nums text-white">
                {approvedTasksCount} Completed · {formatBdt(wallet?.totalEarnings ?? profile.totalEarnings)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-1.5">Full Name</label>
            <input
              type="text"
              required
              maxLength={MAX_NAME_LENGTH}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white focus:outline-none focus:border-teal-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
              Mobile Number (bKash / Nagad)
            </label>
            <input
              type="tel"
              maxLength={15}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01712345678"
              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono tabular-nums text-white focus:outline-none focus:border-teal-400"
            />
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="w-full min-h-[48px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap"
          >
            {savingProfile ? 'Saving Changes...' : 'Save Profile Changes'}
          </button>
        </form>

        {/* Right: Member Settings — Password Change Requests */}
        <section className="lg:col-span-6 rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 sm:p-6 space-y-5">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-teal-300 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-bold text-white">Password Change Requests</h2>
              <p className="text-xs text-sky-200/70 mt-1 leading-relaxed">
                Submit an authorization request to update your password. Passwords are never stored in
                the database or exposed to Administrators.
              </p>
            </div>
          </div>

          {pcrMsg && (
            <div
              className={`p-3.5 rounded-xl border text-xs ${
                pcrMsg.type === 'success'
                  ? 'bg-emerald-500/12 border-emerald-400/30 text-emerald-200'
                  : 'bg-rose-500/12 border-rose-400/30 text-rose-200'
              }`}
            >
              {pcrMsg.text}
            </div>
          )}

          {activeApprovedRequest ? (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-400/30 space-y-4">
              <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Admin Approved Your Password Change Request</span>
              </div>
              {activeApprovedRequest.decisionNote && (
                <p className="text-xs text-sky-100">
                  Admin note: {activeApprovedRequest.decisionNote}
                </p>
              )}

              {profile.authProvider === 'password' ? (
                <form onSubmit={handleExecuteApprovedPasswordChange} className="space-y-3">
                  <div>
                    <label className="block text-xs text-sky-200/80 mb-1">Current Password</label>
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-sky-200/80 mb-1">
                      New Password (sent directly to Firebase Auth)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={pcrBusy}
                    className="w-full min-h-[46px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-sm"
                  >
                    {pcrBusy ? 'Updating Password...' : 'Update Password Now'}
                  </button>
                </form>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-sky-100/85 leading-relaxed">
                    Your account signs in with Google OAuth. Click below to dispatch a verified
                    Firebase password-setup link to <span className="font-medium">{profile.email}</span>{' '}
                    and complete this approved request.
                  </p>
                  <button
                    type="button"
                    disabled={pcrBusy}
                    onClick={handleApprovedResetEmailDispatch}
                    className="w-full min-h-[46px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>Send Verified Password Link & Complete</span>
                  </button>
                </div>
              )}
            </div>
          ) : activePendingRequest ? (
            <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-400/25 space-y-1.5">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-300">
                <Clock className="w-4 h-4" />
                <span>Request Pending Admin Review</span>
              </p>
              <p className="text-xs text-sky-200/80">Reason: {activePendingRequest.reason}</p>
              <p className="text-[11px] text-sky-200/55">
                Submitted {formatDateTime(activePendingRequest.createdAt)}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmitPasswordRequest} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                  Reason for Password Change Request
                </label>
                <textarea
                  rows={2}
                  required
                  maxLength={400}
                  value={pcrReason}
                  onChange={(e) => setPcrReason(e.target.value)}
                  placeholder="e.g., Routine security rotation or shared device precaution (do NOT type any password here)"
                  className="w-full p-3 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
                />
              </div>
              <button
                type="submit"
                disabled={pcrBusy}
                className="w-full min-h-[46px] px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-sm font-semibold text-white transition-colors"
              >
                {pcrBusy ? 'Submitting...' : 'Submit Password Change Request'}
              </button>
            </form>
          )}

          <div className="pt-3 border-t border-white/10 flex items-start gap-2.5 text-[11px] text-sky-200/60 leading-relaxed">
            <ShieldAlert className="w-4 h-4 text-sky-300/70 shrink-0 mt-0.5" />
            <p>
              Provider Security Note: MTS Freelancing Zone gates in-app credential updates behind
              single-use Admin approval records without storing passwords. At the underlying Google
              Identity Toolkit layer, Firebase Authentication always permits account owners with valid
              email access to perform emergency email recovery.
            </p>
          </div>

          {passwordRequests.length > 0 && (
            <div className="pt-3 border-t border-white/10 space-y-2.5">
              <h3 className="text-xs font-semibold text-sky-200/80">Request History</h3>
              <div className="divide-y divide-white/8">
                {passwordRequests.map((req) => (
                  <div key={req.requestId} className="py-2.5 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-medium truncate">{req.reason}</span>
                      <span
                        className={`font-semibold capitalize shrink-0 ${
                          req.status === 'approved' || req.status === 'completed'
                            ? 'text-emerald-400'
                            : req.status === 'rejected'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-sky-200/55 font-mono tabular-nums">
                      {formatDateTime(req.createdAt)}
                      {req.decisionNote ? ` · Decision: ${req.decisionNote}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
