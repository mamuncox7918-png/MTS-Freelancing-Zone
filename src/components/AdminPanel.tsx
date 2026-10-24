import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Plus,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { apiRequest, formatBdt, formatDateTime, formatShortDate, toMillis } from '../lib/api';
import { AvatarDisplay, ProofScreenshotViewer } from './MediaView';
import {
  AdminAuditLog,
  MAX_REASON_LENGTH,
  MAX_TASK_INSTRUCTIONS_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  MemberWallet,
  PasswordChangeRequest,
  TaskItem,
  TaskSubmission,
  UserProfile,
  WalletTransaction,
  WithdrawalRequest,
} from '../types';

type AdminTab =
  | 'overview'
  | 'members'
  | 'tasks'
  | 'submissions'
  | 'completed'
  | 'withdrawals'
  | 'ledger'
  | 'passwords'
  | 'audit';

export function AdminPanel({ currentAdmin }: { currentAdmin: UserProfile }) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [wallets, setWallets] = useState<MemberWallet[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [passwordRequests, setPasswordRequests] = useState<PasswordChangeRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);

  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Member filters & details drawer
  const [memberFilter, setMemberFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [memberSearch, setMemberSearch] = useState('');
  const [rejectingMemberUid, setRejectingMemberUid] = useState<string | null>(null);
  const [memberRejectReason, setMemberRejectReason] = useState('');
  const [inspectedMember, setInspectedMember] = useState<UserProfile | null>(null);

  // Task creation & editing
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskInstructions, setTaskInstructions] = useState('');
  const [taskLink, setTaskLink] = useState('');
  const [taskReward, setTaskReward] = useState('20');
  const [taskActive, setTaskActive] = useState(true);

  // Proof submission review state
  const [subFilter, setSubFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rejectingSubId, setRejectingSubId] = useState<string | null>(null);
  const [subRejectReason, setSubRejectReason] = useState('');

  // Completed records & ledger search
  const [completedSearch, setCompletedSearch] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');

  // Withdrawal review state
  const [wdrFilter, setWdrFilter] = useState<'pending' | 'paid' | 'rejected'>('pending');
  const [actionWithdrawal, setActionWithdrawal] = useState<{
    item: WithdrawalRequest;
    mode: 'paid' | 'rejected';
  } | null>(null);
  const [wdrPaymentRef, setWdrPaymentRef] = useState('');
  const [wdrAdminNote, setWdrAdminNote] = useState('');

  // Password request decision note
  const [pcrNotes, setPcrNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (currentAdmin.role !== 'admin') return;

    const unsubs = [
      onSnapshot(
        collection(db, 'users'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as UserProfile);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setUsers(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'users')
      ),
      onSnapshot(
        collection(db, 'wallets'),
        (snap) => {
          setWallets(snap.docs.map((d) => d.data() as MemberWallet));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'wallets')
      ),
      onSnapshot(
        collection(db, 'tasks'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as TaskItem);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setTasks(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
      ),
      onSnapshot(
        collection(db, 'submissions'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as TaskSubmission);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setSubmissions(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'submissions')
      ),
      onSnapshot(
        collection(db, 'withdrawals'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as WithdrawalRequest);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setWithdrawals(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'withdrawals')
      ),
      onSnapshot(
        collection(db, 'transactions'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as WalletTransaction);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setTransactions(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
      ),
      onSnapshot(
        collection(db, 'passwordChangeRequests'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as PasswordChangeRequest);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setPasswordRequests(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'passwordChangeRequests')
      ),
      onSnapshot(
        collection(db, 'adminAuditLogs'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as AdminAuditLog);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setAuditLogs(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'adminAuditLogs')
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, [currentAdmin.role]);

  const walletByUid = useMemo(() => {
    const map = new Map<string, MemberWallet>();
    for (const w of wallets) map.set(w.userId, w);
    return map;
  }, [wallets]);

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of users) map.set(u.uid, u);
    return map;
  }, [users]);

  const stats = useMemo(() => {
    const membersOnly = users.filter((u) => u.role === 'member');
    const pendingMembers = membersOnly.filter((u) => u.status === 'pending').length;
    const approvedMembers = membersOnly.filter((u) => u.status === 'approved').length;
    const activeTasks = tasks.filter((t) => t.isActive).length;
    const pendingProofs = submissions.filter((s) => s.status === 'pending').length;
    const approvedProofs = submissions.filter((s) => s.status === 'approved').length;
    const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
    const paidWithdrawals = withdrawals.filter((w) => w.status === 'paid');

    const totalRewardsCredited = wallets.reduce((acc, w) => acc + Number(w.totalEarnings || 0), 0);
    const totalPaidGross = paidWithdrawals.reduce((acc, w) => acc + Number(w.grossAmount || 0), 0);
    const totalPaidNet = paidWithdrawals.reduce((acc, w) => acc + Number(w.netAmount || 0), 0);
    const totalFeesCollected = paidWithdrawals.reduce((acc, w) => acc + Number(w.feeAmount || 0), 0);
    const pendingReservedBdt = pendingWithdrawals.reduce(
      (acc, w) => acc + Number(w.grossAmount || 0),
      0
    );

    return {
      totalMembers: membersOnly.length,
      pendingMembers,
      approvedMembers,
      activeTasks,
      pendingProofs,
      approvedProofs,
      pendingWithdrawalsCount: pendingWithdrawals.length,
      pendingReservedBdt,
      totalRewardsCredited,
      totalPaidGross,
      totalPaidNet,
      totalFeesCollected,
      pendingPasswordReqs: passwordRequests.filter((p) => p.status === 'pending').length,
    };
  }, [users, wallets, tasks, submissions, withdrawals, passwordRequests]);

  // Handlers
  const handleReviewMember = async (targetUid: string, decision: 'approved' | 'rejected') => {
    setBanner(null);
    if (decision === 'rejected' && memberRejectReason.trim().length < 3) {
      setBanner({ type: 'error', text: 'Enter a clear rejection reason (at least 3 characters).' });
      return;
    }
    setBusyId(targetUid);
    try {
      await apiRequest(`/api/admin/members/${targetUid}/review`, {
        method: 'POST',
        body: {
          decision,
          rejectionReason: decision === 'rejected' ? memberRejectReason.trim() : '',
        },
      });
      setRejectingMemberUid(null);
      setMemberRejectReason('');
      setBanner({
        type: 'success',
        text: `Member registration ${decision === 'approved' ? 'approved' : 'rejected'}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Member review action failed.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const openCreateTask = () => {
    setEditingTask(null);
    setTaskTitle('');
    setTaskInstructions('');
    setTaskLink('https://');
    setTaskReward('20');
    setTaskActive(true);
    setTaskModalOpen(true);
  };

  const openEditTask = (task: TaskItem) => {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskInstructions(task.instructions);
    setTaskLink(task.externalLink);
    setTaskReward(String(task.rewardAmount));
    setTaskActive(task.isActive);
    setTaskModalOpen(true);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const reward = Number(taskReward);
    if (!Number.isInteger(reward) || reward < 1) {
      setBanner({ type: 'error', text: 'Reward must be a whole Taka integer >= ৳1.' });
      return;
    }

    setBusyId('save_task');
    try {
      if (editingTask) {
        await apiRequest(`/api/admin/tasks/${editingTask.taskId}`, {
          method: 'PUT',
          body: {
            title: taskTitle.trim().slice(0, MAX_TASK_TITLE_LENGTH),
            instructions: taskInstructions.trim().slice(0, MAX_TASK_INSTRUCTIONS_LENGTH),
            externalLink: taskLink.trim(),
            rewardAmount: reward,
            isActive: taskActive,
          },
        });
        setBanner({ type: 'success', text: `Task ${editingTask.taskCode} updated.` });
      } else {
        await apiRequest('/api/admin/tasks', {
          method: 'POST',
          body: {
            title: taskTitle.trim().slice(0, MAX_TASK_TITLE_LENGTH),
            instructions: taskInstructions.trim().slice(0, MAX_TASK_INSTRUCTIONS_LENGTH),
            externalLink: taskLink.trim(),
            rewardAmount: reward,
            isActive: taskActive,
          },
        });
        setBanner({ type: 'success', text: 'New task published to approved members.' });
      }
      setTaskModalOpen(false);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save task.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleTaskStatus = async (task: TaskItem) => {
    setBusyId(task.taskId);
    setBanner(null);
    try {
      await apiRequest(`/api/admin/tasks/${task.taskId}`, {
        method: 'PUT',
        body: {
          title: task.title,
          instructions: task.instructions,
          externalLink: task.externalLink,
          rewardAmount: task.rewardAmount,
          isActive: !task.isActive,
        },
      });
      setBanner({
        type: 'success',
        text: `Task ${task.taskCode} is now ${!task.isActive ? 'Active' : 'Inactive'}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update task status.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewSubmission = async (
    submissionId: string,
    decision: 'approved' | 'rejected'
  ) => {
    setBanner(null);
    if (decision === 'rejected' && subRejectReason.trim().length < 3) {
      setBanner({ type: 'error', text: 'Provide a clear rejection reason for the member.' });
      return;
    }
    setBusyId(submissionId);
    try {
      await apiRequest(`/api/admin/submissions/${submissionId}/review`, {
        method: 'POST',
        body: {
          decision,
          rejectionReason: decision === 'rejected' ? subRejectReason.trim().slice(0, MAX_REASON_LENGTH) : '',
        },
      });
      setRejectingSubId(null);
      setSubRejectReason('');
      setBanner({
        type: 'success',
        text:
          decision === 'approved'
            ? 'Proof approved and task reward credited once to member wallet.'
            : 'Proof rejected with explanation.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Submission review failed.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleProcessWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionWithdrawal) return;
    setBanner(null);

    const { item, mode } = actionWithdrawal;
    if (mode === 'rejected' && wdrAdminNote.trim().length < 3) {
      setBanner({ type: 'error', text: 'Enter a rejection reason for the full refund ledger.' });
      return;
    }

    setBusyId(item.withdrawalId);
    try {
      await apiRequest(`/api/admin/withdrawals/${item.withdrawalId}/process`, {
        method: 'POST',
        body: {
          decision: mode,
          paymentReference: mode === 'paid' ? wdrPaymentRef.trim() : '',
          adminNote: wdrAdminNote.trim().slice(0, MAX_REASON_LENGTH),
        },
      });
      setActionWithdrawal(null);
      setWdrPaymentRef('');
      setWdrAdminNote('');
      setBanner({
        type: 'success',
        text:
          mode === 'paid'
            ? `Withdrawal ${item.transactionCode} marked Paid (Sent ${formatBdt(
                item.netAmount
              )}, no extra fee charged).`
            : `Withdrawal ${item.transactionCode} rejected and full ${formatBdt(
                item.grossAmount
              )} refunded to member wallet.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Withdrawal processing failed.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewPasswordRequest = async (
    requestId: string,
    decision: 'approved' | 'rejected'
  ) => {
    setBanner(null);
    setBusyId(requestId);
    try {
      await apiRequest(`/api/admin/password-requests/${requestId}/review`, {
        method: 'POST',
        body: {
          decision,
          decisionNote: (pcrNotes[requestId] || '').trim().slice(0, MAX_REASON_LENGTH),
        },
      });
      setBanner({
        type: 'success',
        text: `Password change request ${decision}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to review password request.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return users
      .filter((u) => (memberFilter === 'all' ? true : u.status === memberFilter))
      .filter(
        (u) =>
          !q ||
          u.fullName.toLowerCase().includes(q) ||
          u.memberId.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q)
      );
  }, [users, memberFilter, memberSearch]);

  const completedRecords = useMemo(() => {
    const q = completedSearch.trim().toLowerCase();
    return submissions
      .filter((s) => s.status === 'approved')
      .filter(
        (s) =>
          !q ||
          s.taskCode.toLowerCase().includes(q) ||
          s.taskTitle.toLowerCase().includes(q) ||
          s.memberId.toLowerCase().includes(q) ||
          s.memberName.toLowerCase().includes(q)
      );
  }, [submissions, completedSearch]);

  const filteredLedger = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return transactions.filter(
      (t) =>
        !q ||
        t.memberId.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q)
    );
  }, [transactions, ledgerSearch]);

  const navItems: { id: AdminTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: `Members (${stats.pendingMembers})` },
    { id: 'tasks', label: `Tasks (${tasks.length})` },
    { id: 'submissions', label: `Proofs (${stats.pendingProofs})` },
    { id: 'completed', label: 'Completed' },
    { id: 'withdrawals', label: `Withdrawals (${stats.pendingWithdrawalsCount})` },
    { id: 'ledger', label: 'Ledger' },
    { id: 'passwords', label: `Passwords (${stats.pendingPasswordReqs})` },
    { id: 'audit', label: 'Audit Log' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center text-teal-300 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Admin Control Panel</h1>
            <p className="text-xs text-sky-200/70">
              Authorized Administrator · {currentAdmin.email}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreateTask}
          className="min-h-[44px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Task</span>
        </button>
      </div>

      {/* Section Navigation */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 overflow-x-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveTab(item.id);
              setBanner(null);
            }}
            className={`min-h-[42px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === item.id
                ? 'bg-teal-500 text-slate-950'
                : 'text-sky-200/75 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
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

      {/* 1. OVERVIEW STATS */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => {
                setMemberFilter('pending');
                setActiveTab('members');
              }}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-amber-400/30 p-5"
            >
              <p className="text-xs text-sky-200/75">Pending Registrations</p>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-300">
                {stats.pendingMembers}
              </p>
              <p className="mt-1 text-xs text-sky-200/60">
                {stats.approvedMembers} approved of {stats.totalMembers} members
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setSubFilter('pending');
                setActiveTab('submissions');
              }}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-purple-400/30 p-5"
            >
              <p className="text-xs text-sky-200/75">Pending Proof Reviews</p>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-purple-300">
                {stats.pendingProofs}
              </p>
              <p className="mt-1 text-xs text-sky-200/60">
                {stats.approvedProofs} completed tasks credited
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setWdrFilter('pending');
                setActiveTab('withdrawals');
              }}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-emerald-400/30 p-5"
            >
              <p className="text-xs text-sky-200/75">Pending Withdrawals</p>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-teal-300">
                {stats.pendingWithdrawalsCount}
              </p>
              <p className="mt-1 text-xs font-mono tabular-nums text-sky-200/60">
                {formatBdt(stats.pendingReservedBdt)} gross reserved
              </p>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-blue-400/30 p-5"
            >
              <p className="text-xs text-sky-200/75">Total Rewards Credited</p>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">
                {formatBdt(stats.totalRewardsCredited)}
              </p>
              <p className="mt-1 text-xs font-mono tabular-nums text-sky-200/60">
                Paid Net: {formatBdt(stats.totalPaidNet)} · Fees: {formatBdt(stats.totalFeesCollected)}
              </p>
            </button>
          </div>

          {/* Recent Admin Audit Preview */}
          <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Recent Administrative Actions</h2>
              <button
                type="button"
                onClick={() => setActiveTab('audit')}
                className="text-xs font-semibold text-teal-300 hover:text-teal-200"
              >
                Full Audit Log
              </button>
            </div>
            {auditLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-sky-200/65">
                Administrative actions will be recorded here automatically.
              </div>
            ) : (
              <div className="divide-y divide-white/8">
                {auditLogs.slice(0, 6).map((log) => (
                  <div key={log.logId} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <p className="text-xs sm:text-sm text-white font-medium">{log.summary}</p>
                      <p className="text-[11px] font-mono tabular-nums text-sky-200/55">
                        {log.action} · {log.adminEmail}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-sky-200/60 shrink-0">
                      {formatDateTime(log.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. MEMBERS MANAGEMENT */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 overflow-x-auto">
              {(['pending', 'approved', 'rejected', 'all'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setMemberFilter(st)}
                  className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap shrink-0 ${
                    memberFilter === st
                      ? 'bg-teal-500 text-slate-950'
                      : 'text-sky-200/75 hover:text-white'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search ID, name, email, phone..."
                className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-[#0D1730] border border-white/12 text-xs sm:text-sm text-white"
              />
            </div>
          </div>

          {filteredMembers.length === 0 ? (
            <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center text-sm text-sky-200/70">
              No member accounts match this filter.
            </div>
          ) : (
            <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
              {filteredMembers.map((m) => {
                const mWallet = walletByUid.get(m.uid);
                return (
                  <div key={m.uid} className="p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <AvatarDisplay
                          photoAssetId={m.photoAssetId}
                          fullName={m.fullName}
                          sizeClass="w-14 h-14 text-sm"
                          zoomable
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-sky-200/70">
                            <span className="font-mono tabular-nums text-teal-300 font-semibold">
                              {m.memberId}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="capitalize">{m.status}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatShortDate(m.createdAt)}</span>
                            <span aria-hidden="true">·</span>
                            <span className={m.photoAssetId ? 'text-emerald-300' : 'text-sky-200/50'}>
                              {m.photoAssetId ? 'Photo Uploaded' : 'No Photo'}
                            </span>
                          </div>
                          <p className="text-base font-bold text-white truncate">{m.fullName}</p>
                          <p className="text-xs text-sky-200/70 truncate">
                            {m.email}
                            {m.phone ? ` · ${m.phone}` : ''}
                            {` · Balance ${formatBdt(mWallet?.availableBalance ?? 0)}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setInspectedMember(m)}
                          className="min-h-[40px] px-3.5 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-xs font-semibold text-white whitespace-nowrap"
                        >
                          View Full Info
                        </button>

                        {m.role !== 'admin' && m.status !== 'approved' && (
                          <button
                            type="button"
                            disabled={busyId === m.uid}
                            onClick={() => handleReviewMember(m.uid, 'approved')}
                            className="min-h-[40px] px-3.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold"
                          >
                            Approve
                          </button>
                        )}

                        {m.role !== 'admin' && m.status !== 'rejected' && (
                          <button
                            type="button"
                            disabled={busyId === m.uid}
                            onClick={() => {
                              setRejectingMemberUid(rejectingMemberUid === m.uid ? null : m.uid);
                              setMemberRejectReason(m.rejectionReason || '');
                            }}
                            className="min-h-[40px] px-3.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </div>

                    {rejectingMemberUid === m.uid && (
                      <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          maxLength={MAX_REASON_LENGTH}
                          value={memberRejectReason}
                          onChange={(e) => setMemberRejectReason(e.target.value)}
                          placeholder="Enter rejection reason shown to applicant..."
                          className="flex-1 min-h-[42px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-xs sm:text-sm text-white"
                        />
                        <button
                          type="button"
                          disabled={busyId === m.uid}
                          onClick={() => handleReviewMember(m.uid, 'rejected')}
                          className="min-h-[42px] px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-semibold whitespace-nowrap"
                        >
                          Confirm Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. TASK MANAGEMENT */}
      {activeTab === 'tasks' && (
        <div className="space-y-4">
          {tasks.length === 0 ? (
            <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center space-y-3">
              <p className="text-base font-semibold text-white">No tasks created yet</p>
              <button
                type="button"
                onClick={openCreateTask}
                className="min-h-[44px] px-4 rounded-xl bg-teal-500 text-slate-950 text-xs font-semibold"
              >
                Create First Task
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
              {tasks.map((task) => (
                <div
                  key={task.taskId}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                      <span className="text-teal-300 font-semibold">{task.taskCode}</span>
                      <span aria-hidden="true">·</span>
                      <span className={task.isActive ? 'text-emerald-400' : 'text-sky-200/50'}>
                        {task.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-sky-200/60">{formatShortDate(task.createdAt)}</span>
                    </div>
                    <h3 className="text-base font-bold text-white">{task.title}</h3>
                    <p className="text-xs text-sky-200/75 line-clamp-2">{task.instructions}</p>
                    <a
                      href={task.externalLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline"
                    >
                      <span className="truncate max-w-xs">{task.externalLink}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <span className="text-lg font-bold font-mono tabular-nums text-white mr-2">
                      {formatBdt(task.rewardAmount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEditTask(task)}
                      className="min-h-[40px] px-3 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white inline-flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === task.taskId}
                      onClick={() => handleToggleTaskStatus(task)}
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold ${
                        task.isActive
                          ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                          : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                      }`}
                    >
                      {task.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. PROOF SUBMISSIONS REVIEW */}
      {activeTab === 'submissions' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 w-fit">
            {(['pending', 'approved', 'rejected'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setSubFilter(st)}
                className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap ${
                  subFilter === st
                    ? 'bg-teal-500 text-slate-950'
                    : 'text-sky-200/75 hover:text-white'
                }`}
              >
                {st === 'pending' ? 'Pending Review' : st}
              </button>
            ))}
          </div>

          {submissions.filter((s) => s.status === subFilter).length === 0 ? (
            <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center text-sm text-sky-200/70">
              No proof submissions in this status.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {submissions
                .filter((s) => s.status === subFilter)
                .map((sub) => {
                  const subMember = userByUid.get(sub.userId);
                  return (
                  <div
                    key={sub.submissionId}
                    className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <AvatarDisplay
                            photoAssetId={subMember?.photoAssetId}
                            fullName={sub.memberName}
                            sizeClass="w-10 h-10 text-xs"
                            zoomable
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums text-sky-200/70">
                              <span>{sub.taskCode}</span>
                              <span aria-hidden="true">·</span>
                              <button
                                type="button"
                                onClick={() => subMember && setInspectedMember(subMember)}
                                className="text-teal-300 hover:underline font-semibold text-left"
                              >
                                {sub.memberId} ({sub.memberName})
                              </button>
                            </div>
                            <h3 className="text-base font-bold text-white mt-0.5">{sub.taskTitle}</h3>
                            <p className="text-[11px] font-mono tabular-nums text-sky-200/55">
                              Submitted {formatDateTime(sub.createdAt)}
                            </p>
                          </div>
                        </div>
                        <span className="text-lg font-bold font-mono tabular-nums text-teal-300 shrink-0">
                          {formatBdt(sub.rewardAmount)}
                        </span>
                      </div>

                      <ProofScreenshotViewer
                        assetId={sub.screenshotAssetId}
                        title={`${sub.memberName} (${sub.memberId}) · ${sub.taskTitle}`}
                      />

                      {sub.proofLink && (
                        <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-400/25 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] text-sky-200/70">Shared Proof Link</p>
                            <a
                              href={sub.proofLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-medium text-teal-300 hover:underline truncate block"
                            >
                              {sub.proofLink}
                            </a>
                          </div>
                          <a
                            href={sub.proofLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[36px] px-3 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
                          >
                            <span>Open Link</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}

                      {sub.submissionNote && (
                        <p className="text-xs text-sky-100 bg-white/[0.03] p-3 rounded-xl">
                          Member note: {sub.submissionNote}
                        </p>
                      )}

                      {sub.status === 'rejected' && sub.rejectionReason && (
                        <p className="text-xs text-rose-300">Rejected: {sub.rejectionReason}</p>
                      )}
                    </div>

                    {sub.status === 'pending' && (
                      <div className="pt-3 border-t border-white/10 space-y-3">
                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            disabled={busyId === sub.submissionId}
                            onClick={() => handleReviewSubmission(sub.submissionId, 'approved')}
                            className="min-h-[44px] px-3 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold"
                          >
                            Approve & Credit {formatBdt(sub.rewardAmount)}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === sub.submissionId}
                            onClick={() => {
                              setRejectingSubId(
                                rejectingSubId === sub.submissionId ? null : sub.submissionId
                              );
                              setSubRejectReason('');
                            }}
                            className="min-h-[44px] px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold"
                          >
                            Reject Proof
                          </button>
                        </div>

                        {rejectingSubId === sub.submissionId && (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              maxLength={MAX_REASON_LENGTH}
                              value={subRejectReason}
                              onChange={(e) => setSubRejectReason(e.target.value)}
                              placeholder="Reason for rejecting screenshot..."
                              className="flex-1 min-h-[42px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-xs text-white"
                            />
                            <button
                              type="button"
                              disabled={busyId === sub.submissionId}
                              onClick={() => handleReviewSubmission(sub.submissionId, 'rejected')}
                              className="min-h-[42px] px-3.5 rounded-xl bg-rose-500 text-slate-950 text-xs font-semibold whitespace-nowrap"
                            >
                              Confirm
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* 5. COMPLETED TASK RECORDS */}
      {activeTab === 'completed' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={completedSearch}
              onChange={(e) => setCompletedSearch(e.target.value)}
              placeholder="Search task code, title, member..."
              className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-[#0D1730] border border-white/12 text-xs sm:text-sm text-white"
            />
          </div>

          <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
            {completedRecords.length === 0 ? (
              <div className="p-10 text-center text-sm text-sky-200/70">
                No approved task completions recorded yet.
              </div>
            ) : (
              completedRecords.map((rec) => {
                const recMember = userByUid.get(rec.userId);
                return (
                <div
                  key={rec.submissionId}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <AvatarDisplay
                      photoAssetId={recMember?.photoAssetId}
                      fullName={rec.memberName}
                      sizeClass="w-10 h-10 text-xs"
                      zoomable
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {rec.taskTitle}{' '}
                        <span className="font-mono tabular-nums text-xs text-sky-200/70">
                          ({rec.taskCode})
                        </span>
                      </p>
                      <p className="text-xs text-sky-200/65 font-mono tabular-nums">
                        <button
                          type="button"
                          onClick={() => recMember && setInspectedMember(recMember)}
                          className="text-teal-300 hover:underline font-semibold"
                        >
                          {rec.memberId} · {rec.memberName}
                        </button>{' '}
                        · Approved {formatDateTime(rec.reviewedAt || rec.updatedAt)}
                      </p>
                      {rec.proofLink && (
                        <a
                          href={rec.proofLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline mt-0.5"
                        >
                          <span className="truncate max-w-xs">{rec.proofLink}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-teal-300 text-sm shrink-0">
                    +{formatBdt(rec.rewardAmount)}
                  </span>
                </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 6. WITHDRAWAL REQUESTS & PAYOUT PROCESSING */}
      {activeTab === 'withdrawals' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 w-fit">
            {(['pending', 'paid', 'rejected'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setWdrFilter(st)}
                className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap ${
                  wdrFilter === st
                    ? 'bg-teal-500 text-slate-950'
                    : 'text-sky-200/75 hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {withdrawals.filter((w) => w.status === wdrFilter).length === 0 ? (
            <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center text-sm text-sky-200/70">
              No withdrawal requests in this status.
            </div>
          ) : (
            <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
              {withdrawals
                .filter((w) => w.status === wdrFilter)
                .map((w) => {
                  const wMember = userByUid.get(w.userId);
                  return (
                  <div key={w.withdrawalId} className="p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <AvatarDisplay
                          photoAssetId={wMember?.photoAssetId}
                          fullName={w.memberName}
                          sizeClass="w-11 h-11 text-xs"
                          zoomable
                        />
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs font-mono tabular-nums text-sky-200/70">
                            <span className="text-teal-300 font-semibold">{w.transactionCode}</span>
                            <span aria-hidden="true"> · </span>
                            <button
                              type="button"
                              onClick={() => wMember && setInspectedMember(wMember)}
                              className="text-white hover:underline font-semibold"
                            >
                              {w.memberId} · {w.memberName}
                            </button>
                          </p>
                          <p className="text-sm font-bold text-white font-mono tabular-nums">
                            {w.payoutMethod} Account: {w.accountNumber}
                          </p>
                          <p className="text-xs text-sky-200/60 font-mono tabular-nums">
                            Requested {formatDateTime(w.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="sm:text-right font-mono tabular-nums space-y-0.5 shrink-0">
                        <p className="text-xs text-sky-200/75">
                          Gross {formatBdt(w.grossAmount)} · Fee {formatBdt(w.feeAmount)}
                        </p>
                        <p className="text-lg font-bold text-teal-300">
                          Send Net: {formatBdt(w.netAmount)}
                        </p>
                      </div>
                    </div>

                    {w.paymentReference && (
                      <p className="text-xs font-mono tabular-nums text-emerald-300">
                        Paid Reference (TrxID): {w.paymentReference}
                      </p>
                    )}
                    {w.adminNote && <p className="text-xs text-sky-200/75">Note: {w.adminNote}</p>}

                    {w.status === 'pending' && (
                      <div className="pt-2 flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setActionWithdrawal({ item: w, mode: 'paid' });
                            setWdrPaymentRef('');
                            setWdrAdminNote('');
                          }}
                          className="min-h-[42px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold"
                        >
                          Mark Paid (Sent {formatBdt(w.netAmount)})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionWithdrawal({ item: w, mode: 'rejected' });
                            setWdrPaymentRef('');
                            setWdrAdminNote('');
                          }}
                          className="min-h-[42px] px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold"
                        >
                          Reject & Refund {formatBdt(w.grossAmount)}
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* 7. WALLET TRANSACTION LEDGER */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={ledgerSearch}
              onChange={(e) => setLedgerSearch(e.target.value)}
              placeholder="Search member ID or description..."
              className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-[#0D1730] border border-white/12 text-xs sm:text-sm text-white"
            />
          </div>

          <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
            {filteredLedger.length === 0 ? (
              <div className="p-10 text-center text-sm text-sky-200/70">No transactions found.</div>
            ) : (
              filteredLedger.map((tx) => (
                <div
                  key={tx.transactionId}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <p className="text-xs sm:text-sm font-medium text-white">{tx.description}</p>
                    <p className="text-[11px] font-mono tabular-nums text-sky-200/60">
                      {tx.memberId} · {tx.type} · {formatDateTime(tx.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`font-mono tabular-nums font-bold text-sm shrink-0 ${
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
                      : `Settled ${formatBdt(tx.netAmount)}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 8. PASSWORD CHANGE REQUESTS */}
      {activeTab === 'passwords' && (
        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
          {passwordRequests.length === 0 ? (
            <div className="p-10 text-center text-sm text-sky-200/70">
              No member password change requests submitted.
            </div>
          ) : (
            passwordRequests.map((req) => (
              <div key={req.requestId} className="p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-mono tabular-nums text-sky-200/70">
                      {req.memberId} · {req.memberName} · {req.memberEmail} ({req.authProvider})
                    </p>
                    <p className="text-sm font-semibold text-white mt-0.5">Reason: {req.reason}</p>
                    <p className="text-[11px] font-mono tabular-nums text-sky-200/55">
                      Requested {formatDateTime(req.createdAt)}
                    </p>
                  </div>

                  <span className="text-xs font-semibold capitalize text-teal-300">
                    Status: {req.status}
                  </span>
                </div>

                {req.status === 'pending' && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <input
                      type="text"
                      maxLength={MAX_REASON_LENGTH}
                      value={pcrNotes[req.requestId] || ''}
                      onChange={(e) =>
                        setPcrNotes((prev) => ({ ...prev, [req.requestId]: e.target.value }))
                      }
                      placeholder="Optional Admin decision note..."
                      className="flex-1 min-h-[42px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-xs text-white"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === req.requestId}
                        onClick={() => handleReviewPasswordRequest(req.requestId, 'approved')}
                        className="min-h-[42px] px-4 rounded-xl bg-teal-500 text-slate-950 text-xs font-semibold"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === req.requestId}
                        onClick={() => handleReviewPasswordRequest(req.requestId, 'rejected')}
                        className="min-h-[42px] px-4 rounded-xl bg-rose-500/15 text-rose-300 text-xs font-semibold"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 9. AUDIT LOG */}
      {activeTab === 'audit' && (
        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
          {auditLogs.length === 0 ? (
            <div className="p-10 text-center text-sm text-sky-200/70">No audit records yet.</div>
          ) : (
            auditLogs.map((log) => (
              <div
                key={log.logId}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <p className="text-sm font-medium text-white">{log.summary}</p>
                  <p className="text-xs font-mono tabular-nums text-sky-200/60 mt-0.5">
                    {log.action} · Target {log.targetType}/{log.targetId} · {log.adminEmail}
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-sky-200/65 shrink-0">
                  {formatDateTime(log.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* MODAL: Create / Edit Task */}
      {taskModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setTaskModalOpen(false)}
        >
          <div
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-white/15 p-6 max-h-[90dvh] overflow-y-auto space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingTask ? `Edit ${editingTask.taskCode}` : 'Create New Task'}
              </h2>
              <button
                type="button"
                onClick={() => setTaskModalOpen(false)}
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-sky-200/75 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_TASK_TITLE_LENGTH}
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="e.g., Follow Official Page & Screenshot Confirmation"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-sky-200/80 mb-1">
                    Reward Amount (৳)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    step={1}
                    value={taskReward}
                    onChange={(e) => setTaskReward(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono tabular-nums text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-sky-200/80 mb-1">Status</label>
                  <button
                    type="button"
                    onClick={() => setTaskActive((v) => !v)}
                    className={`w-full min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold ${
                      taskActive
                        ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                        : 'bg-white/5 border-white/15 text-sky-200/70'
                    }`}
                  >
                    {taskActive ? 'Active (Visible to Members)' : 'Inactive (Hidden)'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1">
                  External Task Link
                </label>
                <input
                  type="url"
                  required
                  value={taskLink}
                  onChange={(e) => setTaskLink(e.target.value)}
                  placeholder="https://..."
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1">
                  Step-by-Step Instructions
                </label>
                <textarea
                  rows={4}
                  required
                  maxLength={MAX_TASK_INSTRUCTIONS_LENGTH}
                  value={taskInstructions}
                  onChange={(e) => setTaskInstructions(e.target.value)}
                  placeholder="Describe clearly what the member must complete and what must be visible in the screenshot..."
                  className="w-full p-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                />
              </div>

              <button
                type="submit"
                disabled={busyId === 'save_task'}
                className="w-full min-h-[48px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-sm"
              >
                {busyId === 'save_task'
                  ? 'Saving Task...'
                  : editingTask
                  ? 'Update Task'
                  : 'Publish Task'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Process Withdrawal (Mark Paid or Reject & Refund) */}
      {actionWithdrawal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setActionWithdrawal(null)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-white/15 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white">
              {actionWithdrawal.mode === 'paid'
                ? `Mark ${actionWithdrawal.item.transactionCode} Paid`
                : `Reject & Refund ${actionWithdrawal.item.transactionCode}`}
            </h2>

            <div className="divide-y divide-white/10 border-t border-b border-white/10 text-xs sm:text-sm font-mono tabular-nums">
              <div className="py-2 flex justify-between">
                <span className="font-sans text-sky-200/75">Account</span>
                <span className="text-white">
                  {actionWithdrawal.item.payoutMethod} · {actionWithdrawal.item.accountNumber}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="font-sans text-sky-200/75">Gross Reserved</span>
                <span className="text-white">{formatBdt(actionWithdrawal.item.grossAmount)}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="font-sans text-sky-200/75">Fixed Fee</span>
                <span className="text-amber-300">{formatBdt(actionWithdrawal.item.feeAmount)}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="font-sans text-white font-semibold">
                  {actionWithdrawal.mode === 'paid' ? 'Net Sent to Member' : 'Full Refund Amount'}
                </span>
                <span className="text-teal-300 font-bold">
                  {actionWithdrawal.mode === 'paid'
                    ? formatBdt(actionWithdrawal.item.netAmount)
                    : formatBdt(actionWithdrawal.item.grossAmount)}
                </span>
              </div>
            </div>

            <form onSubmit={handleProcessWithdrawal} className="space-y-3">
              {actionWithdrawal.mode === 'paid' && (
                <div>
                  <label className="block text-xs text-sky-200/80 mb-1">
                    {actionWithdrawal.item.payoutMethod} TrxID / Reference (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={wdrPaymentRef}
                    onChange={(e) => setWdrPaymentRef(e.target.value)}
                    placeholder="e.g., BKS98472A1"
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono text-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-sky-200/80 mb-1">
                  {actionWithdrawal.mode === 'paid'
                    ? 'Admin Note (Optional)'
                    : 'Rejection & Refund Reason (Required)'}
                </label>
                <input
                  type="text"
                  required={actionWithdrawal.mode === 'rejected'}
                  maxLength={MAX_REASON_LENGTH}
                  value={wdrAdminNote}
                  onChange={(e) => setWdrAdminNote(e.target.value)}
                  placeholder={
                    actionWithdrawal.mode === 'paid'
                      ? 'Payment sent to personal wallet'
                      : 'e.g., Invalid bKash number — full gross refunded'
                  }
                  className="w-full min-h-[44px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActionWithdrawal(null)}
                  className="min-h-[44px] rounded-xl bg-white/8 text-sm text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyId === actionWithdrawal.item.withdrawalId}
                  className={`min-h-[44px] rounded-xl text-sm font-semibold text-slate-950 ${
                    actionWithdrawal.mode === 'paid'
                      ? 'bg-teal-500 hover:bg-teal-400'
                      : 'bg-rose-500 hover:bg-rose-400'
                  }`}
                >
                  {actionWithdrawal.mode === 'paid' ? 'Confirm Paid' : 'Reject & Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Inspect Complete Member Profile, Photo & Activity */}
      {inspectedMember && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setInspectedMember(null)}
        >
          <div
            className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-white/15 p-6 max-h-[92dvh] overflow-y-auto space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const liveMember = userByUid.get(inspectedMember.uid) || inspectedMember;
              const w = walletByUid.get(liveMember.uid);
              const memberSubs = submissions.filter((s) => s.userId === liveMember.uid);
              const memberWdrs = withdrawals.filter((wd) => wd.userId === liveMember.uid);
              const approvedCount = memberSubs.filter((s) => s.status === 'approved').length;
              const pendingCount = memberSubs.filter((s) => s.status === 'pending').length;
              const rejectedCount = memberSubs.filter((s) => s.status === 'rejected').length;

              return (
                <>
                  {/* Member Photo & Primary Identity */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <AvatarDisplay
                        photoAssetId={liveMember.photoAssetId}
                        fullName={liveMember.fullName}
                        sizeClass="w-20 h-20 text-lg"
                        zoomable
                      />
                      <div className="min-w-0 space-y-1">
                        <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                          {liveMember.fullName}
                        </h2>
                        <p className="text-xs font-mono tabular-nums text-teal-300 font-semibold">
                          {liveMember.memberId}
                          <span aria-hidden="true"> · </span>
                          <span className="capitalize">{liveMember.status}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="capitalize">{liveMember.role}</span>
                        </p>
                        <p className="text-xs text-sky-200/70">
                          {liveMember.photoAssetId
                            ? 'Tap photo to inspect full size'
                            : 'Member has not uploaded a profile photo yet'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectedMember(null)}
                      className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-sky-200/75 hover:text-white shrink-0"
                      aria-label="Close member inspector"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Quick Approve / Reject Actions inside Inspector */}
                  {liveMember.role !== 'admin' && liveMember.status === 'pending' && (
                    <div className="flex flex-wrap gap-2.5 pt-1">
                      <button
                        type="button"
                        disabled={busyId === liveMember.uid}
                        onClick={() => handleReviewMember(liveMember.uid, 'approved')}
                        className="min-h-[42px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold"
                      >
                        Approve Member Registration
                      </button>
                    </div>
                  )}

                  {liveMember.status === 'rejected' && liveMember.rejectionReason && (
                    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/25 text-xs text-rose-200">
                      Rejection reason: {liveMember.rejectionReason}
                    </div>
                  )}

                  {/* Wallet & Task KPI Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono tabular-nums">
                    <div className="p-3 rounded-xl bg-[#070E20] border border-white/10">
                      <p className="font-sans text-[11px] text-sky-200/70">Available Balance</p>
                      <p className="text-sm font-bold text-teal-300 mt-0.5">
                        {formatBdt(w?.availableBalance ?? 0)}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#070E20] border border-white/10">
                      <p className="font-sans text-[11px] text-sky-200/70">Total Earnings</p>
                      <p className="text-sm font-bold text-white mt-0.5">
                        {formatBdt(w?.totalEarnings ?? liveMember.totalEarnings)}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#070E20] border border-white/10">
                      <p className="font-sans text-[11px] text-sky-200/70">Total Withdrawals</p>
                      <p className="text-sm font-bold text-white mt-0.5">
                        {formatBdt(w?.totalWithdrawals ?? 0)}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#070E20] border border-white/10">
                      <p className="font-sans text-[11px] text-sky-200/70">Completed Tasks</p>
                      <p className="text-sm font-bold text-emerald-400 mt-0.5">{approvedCount}</p>
                    </div>
                  </div>

                  {/* Complete Member Personal & Account Details */}
                  <div className="divide-y divide-white/8 border-t border-b border-white/10 text-xs sm:text-sm">
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Full Name</span>
                      <span className="text-white font-medium text-right">{liveMember.fullName}</span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Unique Member ID</span>
                      <span className="font-mono tabular-nums text-teal-300 font-semibold">
                        {liveMember.memberId}
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Email Address</span>
                      <span className="text-white break-all text-right">{liveMember.email}</span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Mobile / bKash-Nagad</span>
                      <span className="font-mono tabular-nums text-white">
                        {liveMember.phone || 'Not provided'}
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Sign-In Method</span>
                      <span className="text-white">
                        {liveMember.authProvider === 'google.com' ? 'Google OAuth' : 'Email & Password'}
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Registered On</span>
                      <span className="font-mono tabular-nums text-sky-100">
                        {formatDateTime(liveMember.createdAt)}
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Last Profile Update</span>
                      <span className="font-mono tabular-nums text-sky-100">
                        {formatDateTime(liveMember.updatedAt)}
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Proof Submissions</span>
                      <span className="font-mono tabular-nums text-white">
                        {approvedCount} Approved · {pendingCount} Pending · {rejectedCount} Rejected
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-sky-200/70">Withdrawal Fees & Reserved</span>
                      <span className="font-mono tabular-nums text-white">
                        Fees {formatBdt(w?.totalWithdrawalFees ?? 0)} · Reserved{' '}
                        {formatBdt(w?.reservedWithdrawals ?? 0)}
                      </span>
                    </div>
                    {liveMember.lastPasswordChangedAt && (
                      <div className="py-2.5 flex justify-between gap-4">
                        <span className="text-sky-200/70">Last Password Update</span>
                        <span className="font-mono tabular-nums text-sky-100">
                          {formatDateTime(liveMember.lastPasswordChangedAt)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Recent Member Task Submissions */}
                  {memberSubs.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-sky-200/80">
                        Recent Proof Submissions ({memberSubs.length})
                      </h3>
                      <div className="divide-y divide-white/8 rounded-xl bg-[#070E20] border border-white/10 px-3.5">
                        {memberSubs.slice(0, 5).map((s) => (
                          <div key={s.submissionId} className="py-2.5 text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-white font-medium truncate">
                                {s.taskCode} · {s.taskTitle}
                              </span>
                              <span className="font-mono tabular-nums text-teal-300 shrink-0 capitalize">
                                {s.status} ({formatBdt(s.rewardAmount)})
                              </span>
                            </div>
                            {s.proofLink && (
                              <a
                                href={s.proofLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-teal-300 hover:underline"
                              >
                                <span className="truncate max-w-xs">{s.proofLink}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent Member Withdrawals */}
                  {memberWdrs.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-sky-200/80">
                        Recent Withdrawals ({memberWdrs.length})
                      </h3>
                      <div className="divide-y divide-white/8 rounded-xl bg-[#070E20] border border-white/10 px-3.5">
                        {memberWdrs.slice(0, 5).map((wd) => (
                          <div
                            key={wd.withdrawalId}
                            className="py-2.5 text-xs flex items-center justify-between gap-2 font-mono tabular-nums"
                          >
                            <span className="text-white truncate">
                              {wd.transactionCode} · {wd.payoutMethod} {wd.accountNumber}
                            </span>
                            <span className="text-teal-300 shrink-0 capitalize">
                              {wd.status} · Net {formatBdt(wd.netAmount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
