import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Plus,
  Search,
  ShieldCheck,
  Trophy,
  UserCheck,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { apiRequest, formatBdt, formatDateTime, formatShortDate, toMillis } from '../lib/api';
import {
  computeMonthlyLeaderboardFromTransactions,
  getDhakaMonthBounds,
  getDhakaMonthKey,
} from '../lib/leaderboard';
import { AdminBest10Section } from './AdminBest10Section';
import { AvatarDisplay, ProofScreenshotViewer } from './MediaView';
import {
  AdminAuditLog,
  AssistantAdminRecord,
  BD_MOBILE_PATTERN,
  CustomTaskAssistantStatus,
  CustomTaskSubmission,
  MAX_NAME_LENGTH,
  MAX_REASON_LENGTH,
  MAX_TASK_INSTRUCTIONS_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  MemberWallet,
  MonthlyMemberEarning,
  PasswordChangeRequest,
  TaskItem,
  TaskSubmission,
  UserProfile,
  WalletTransaction,
  WithdrawalRequest,
} from '../types';

export type AdminTab =
  | 'overview'
  | 'best_10'
  | 'members'
  | 'assistants'
  | 'tasks'
  | 'submissions'
  | 'custom_tasks'
  | 'completed'
  | 'withdrawals'
  | 'ledger'
  | 'passwords'
  | 'audit';

export function AdminPanel({
  currentAdmin,
  activeTab: controlledTab,
  onTabChange,
}: {
  currentAdmin: UserProfile;
  activeTab?: AdminTab;
  onTabChange?: (tab: AdminTab) => void;
}) {
  const [internalTab, setInternalTab] = useState<AdminTab>('overview');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: AdminTab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [assistantRecords, setAssistantRecords] = useState<AssistantAdminRecord[]>([]);
  const [wallets, setWallets] = useState<MemberWallet[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [customTasks, setCustomTasks] = useState<CustomTaskSubmission[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [passwordRequests, setPasswordRequests] = useState<PasswordChangeRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [currentMonthEntries, setCurrentMonthEntries] = useState<MonthlyMemberEarning[]>([]);
  const initialLeaderboardSyncedRef = useRef<boolean>(false);

  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [cardError, setCardError] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyDecision, setBusyDecision] = useState<string | null>(null);

  // Member filters & details drawer
  const [memberFilter, setMemberFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [memberSearch, setMemberSearch] = useState('');
  const [rejectingMemberUid, setRejectingMemberUid] = useState<string | null>(null);
  const [memberRejectReason, setMemberRejectReason] = useState('');
  const [inspectedMember, setInspectedMember] = useState<UserProfile | null>(null);
  const [inspectorRejectSubId, setInspectorRejectSubId] = useState<string | null>(null);
  const [inspectorRejectReason, setInspectorRejectReason] = useState('');

  // Assistant Admin creation & management state
  const [asstFullName, setAsstFullName] = useState('');
  const [asstEmail, setAsstEmail] = useState('');
  const [asstPassword, setAsstPassword] = useState('');
  const [asstPhone, setAsstPhone] = useState('');
  const [promoteSearch, setPromoteSearch] = useState('');

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

  // Custom task review & payment state
  const [ctFilter, setCtFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [ctSearch, setCtSearch] = useState('');
  const [ctApprovedAmounts, setCtApprovedAmounts] = useState<Record<string, string>>({});
  const [rejectingCtId, setRejectingCtId] = useState<string | null>(null);
  const [ctRejectReason, setCtRejectReason] = useState('');

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
      onSnapshot(
        collection(db, 'customTasks'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as CustomTaskSubmission);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setCustomTasks(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'customTasks')
      ),
      onSnapshot(
        collection(db, 'assistantAdmins'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as AssistantAdminRecord);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setAssistantRecords(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'assistantAdmins')
      ),
      onSnapshot(
        query(
          collection(db, 'monthlyMemberEarnings'),
          where('monthKey', '==', getDhakaMonthKey())
        ),
        (snap) => {
          setCurrentMonthEntries(snap.docs.map((d) => d.data() as MonthlyMemberEarning));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'monthlyMemberEarnings')
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, [currentAdmin.role]);

  const currentDhakaMonthKey = useMemo(() => getDhakaMonthKey(), []);
  const currentDhakaBounds = useMemo(
    () => getDhakaMonthBounds(currentDhakaMonthKey),
    [currentDhakaMonthKey]
  );
  const currentMonthLeaderboard = useMemo(
    () => computeMonthlyLeaderboardFromTransactions(currentDhakaMonthKey, transactions, users),
    [currentDhakaMonthKey, transactions, users]
  );

  // One-time silent reconciliation for current Asia/Dhaka month if earlier tasks exist
  useEffect(() => {
    if (currentAdmin.role !== 'admin') return;
    if (initialLeaderboardSyncedRef.current) return;
    if (users.length === 0) return;

    const existingMap = new Map(currentMonthEntries.map((e) => [e.userId, e]));
    const needsSync =
      currentMonthLeaderboard.allMemberStats.some((stat) => {
        const prev = existingMap.get(stat.userId);
        return !prev || prev.eligibleEarnings !== stat.eligibleEarnings;
      }) ||
      currentMonthEntries.some(
        (prev) =>
          prev.eligibleEarnings > 0 &&
          !currentMonthLeaderboard.allMemberStats.some((s) => s.userId === prev.userId)
      );

    if (!needsSync) return;
    initialLeaderboardSyncedRef.current = true;
    apiRequest('/api/admin/leaderboard/recalculate', {
      method: 'POST',
      body: { monthKey: currentDhakaMonthKey, silentAutoSync: true },
    }).catch(() => undefined);
  }, [
    currentAdmin.role,
    users.length,
    currentMonthEntries,
    currentMonthLeaderboard.allMemberStats,
    currentDhakaMonthKey,
  ]);

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

  const activeAssistantUidSet = useMemo(() => {
    const set = new Set<string>();
    for (const a of assistantRecords) set.add(a.uid);
    return set;
  }, [assistantRecords]);

  const stats = useMemo(() => {
    const membersOnly = users.filter((u) => u.role === 'member');
    const assistantUsers = users.filter((u) => u.role === 'assistant_admin');
    const activeAssistantsCount = assistantUsers.filter(
      (u) => u.status === 'approved' && activeAssistantUidSet.has(u.uid)
    ).length;
    const pendingMembers = membersOnly.filter((u) => u.status === 'pending').length;
    const approvedMembers = membersOnly.filter((u) => u.status === 'approved').length;
    const activeTasks = tasks.filter((t) => t.isActive).length;
    const pendingProofs = submissions.filter((s) => s.status === 'pending').length;
    const approvedProofs = submissions.filter((s) => s.status === 'approved').length;
    const pendingCustomTasks = customTasks.filter((c) => c.status === 'pending').length;
    const approvedCustomTasks = customTasks.filter((c) => c.status === 'approved').length;
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
      totalAssistants: assistantUsers.length,
      activeAssistantsCount,
      pendingMembers,
      approvedMembers,
      activeTasks,
      pendingProofs,
      approvedProofs,
      pendingCustomTasks,
      approvedCustomTasks,
      pendingWithdrawalsCount: pendingWithdrawals.length,
      pendingReservedBdt,
      totalRewardsCredited,
      totalPaidGross,
      totalPaidNet,
      totalFeesCollected,
      pendingPasswordReqs: passwordRequests.filter((p) => p.status === 'pending').length,
    };
  }, [
    users,
    activeAssistantUidSet,
    wallets,
    tasks,
    submissions,
    customTasks,
    withdrawals,
    passwordRequests,
  ]);

  useEffect(() => {
    if (!banner || banner.type !== 'success') return;
    const timer = window.setTimeout(() => {
      setBanner(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [banner]);

  // Handlers
  const handleReviewMember = async (targetUid: string, decision: 'approved' | 'rejected') => {
    setBanner(null);
    setCardError(null);
    const reasonText =
      decision === 'rejected'
        ? memberRejectReason.trim().slice(0, MAX_REASON_LENGTH) ||
          'Application did not meet verification requirements'
        : '';

    setBusyId(targetUid);
    setBusyDecision(decision);
    try {
      await apiRequest(`/api/admin/members/${targetUid}/review`, {
        method: 'POST',
        body: {
          decision,
          rejectionReason: reasonText,
        },
      });
      setRejectingMemberUid(null);
      setMemberRejectReason('');
      setBanner({
        type: 'success',
        text: `Member registration ${decision === 'approved' ? 'approved' : 'rejected'} successfully.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Member review action failed.';
      setCardError({ id: targetUid, text: msg });
      setBanner({
        type: 'error',
        text: msg,
      });
    } finally {
      setBusyId(null);
      setBusyDecision(null);
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
    decision: 'approved' | 'rejected',
    overrideReason?: string
  ) => {
    setBanner(null);
    setCardError(null);
    const trimmedReason = (overrideReason !== undefined ? overrideReason : subRejectReason)
      .trim()
      .slice(0, MAX_REASON_LENGTH);

    if (decision === 'rejected' && trimmedReason.length < 3) {
      const msg = 'Please enter a rejection reason (at least 3 characters) when rejecting a task.';
      setCardError({ id: submissionId, text: msg });
      setBanner({ type: 'error', text: msg });
      return;
    }

    setBusyId(submissionId);
    setBusyDecision(decision);
    try {
      await apiRequest(`/api/admin/submissions/${submissionId}/review`, {
        method: 'POST',
        body: {
          decision,
          rejectionReason: decision === 'rejected' ? trimmedReason : '',
        },
      });
      setRejectingSubId(null);
      setSubRejectReason('');
      setInspectorRejectSubId(null);
      setInspectorRejectReason('');
      setBanner({
        type: 'success',
        text:
          decision === 'approved'
            ? 'Proof approved and task reward credited to member wallet.'
            : 'Proof rejected and reason recorded.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission review failed.';
      setCardError({ id: submissionId, text: msg });
      setBanner({
        type: 'error',
        text: msg,
      });
    } finally {
      setBusyId(null);
      setBusyDecision(null);
    }
  };

  const handleCustomTaskDecision = async (
    ct: CustomTaskSubmission,
    decision: 'approved' | 'rejected'
  ) => {
    setBanner(null);
    setCardError(null);

    const rawAmountStr =
      ctApprovedAmounts[ct.customTaskId] !== undefined
        ? ctApprovedAmounts[ct.customTaskId]
        : String(ct.requestedAmount);
    const parsedAmount = Number(rawAmountStr);

    if (
      decision === 'approved' &&
      (!Number.isFinite(parsedAmount) ||
        !Number.isInteger(parsedAmount) ||
        parsedAmount < 1 ||
        parsedAmount > 100000)
    ) {
      const msg = 'Approved payment amount must be a whole Taka integer between ৳1 and ৳100,000.';
      setCardError({ id: ct.customTaskId, text: msg });
      setBanner({ type: 'error', text: msg });
      return;
    }

    const trimmedReason = ctRejectReason.trim().slice(0, MAX_REASON_LENGTH);
    if (decision === 'rejected' && trimmedReason.length < 3) {
      const msg =
        'Please enter a rejection reason (at least 3 characters) when rejecting a custom task.';
      setCardError({ id: ct.customTaskId, text: msg });
      setBanner({ type: 'error', text: msg });
      return;
    }

    setBusyId(ct.customTaskId);
    setBusyDecision(decision);
    try {
      await apiRequest(`/api/admin/custom-tasks/${ct.customTaskId}/decision`, {
        method: 'POST',
        body: {
          decision,
          approvedAmount: decision === 'approved' ? parsedAmount : 0,
          rejectionReason: decision === 'rejected' ? trimmedReason : '',
        },
      });
      setRejectingCtId(null);
      setCtRejectReason('');
      setBanner({
        type: 'success',
        text:
          decision === 'approved'
            ? `Custom task ${ct.customTaskCode} approved and ${formatBdt(parsedAmount)} credited to ${ct.memberName}'s wallet.`
            : `Custom task ${ct.customTaskCode} rejected and member notified.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Custom task decision failed.';
      setCardError({ id: ct.customTaskId, text: msg });
      setBanner({ type: 'error', text: msg });
    } finally {
      setBusyId(null);
      setBusyDecision(null);
    }
  };

  const handleCreateAssistantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);

    const cleanName = asstFullName.trim().slice(0, MAX_NAME_LENGTH);
    const cleanEmail = asstEmail.trim().toLowerCase();
    const cleanPhone = asstPhone.trim();

    if (cleanName.length < 2) {
      setBanner({ type: 'error', text: 'Full Name must be at least 2 characters.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setBanner({ type: 'error', text: 'Enter a valid email address.' });
      return;
    }
    if (asstPassword.length < 6) {
      setBanner({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    if (cleanPhone && !BD_MOBILE_PATTERN.test(cleanPhone)) {
      setBanner({
        type: 'error',
        text: 'Enter a valid Bangladeshi mobile number (e.g., 01712345678) or leave blank.',
      });
      return;
    }

    setBusyId('create_assistant');
    try {
      const res = await apiRequest<{ memberId?: string }>('/api/admin/assistants', {
        method: 'POST',
        body: {
          fullName: cleanName,
          email: cleanEmail,
          password: asstPassword,
          phone: cleanPhone,
        },
      });
      setAsstFullName('');
      setAsstEmail('');
      setAsstPassword('');
      setAsstPhone('');
      setBanner({
        type: 'success',
        text: `Assistant Admin account ${res.memberId ? `(${res.memberId}) ` : ''}created! They can now log in directly to the Assistant Admin Dashboard.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create Assistant Admin account.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleManageAssistantRole = async (
    targetUid: string,
    action: 'promote' | 'suspend' | 'reactivate' | 'demote'
  ) => {
    setBanner(null);
    setBusyId(targetUid);
    setBusyDecision(action);
    try {
      await apiRequest(`/api/admin/assistants/${targetUid}/role`, {
        method: 'POST',
        body: { action },
      });
      setPromoteSearch('');
      setBanner({
        type: 'success',
        text:
          action === 'promote'
            ? 'Account promoted to Assistant Admin.'
            : action === 'suspend'
            ? 'Assistant Admin access suspended.'
            : action === 'reactivate'
            ? 'Assistant Admin access reactivated.'
            : 'Account returned to standard Member role.',
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update Assistant Admin role.',
      });
    } finally {
      setBusyId(null);
      setBusyDecision(null);
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
        t.type.toLowerCase().includes(q) ||
        (t.taskName || '').toLowerCase().includes(q) ||
        (t.submissionId || '').toLowerCase().includes(q) ||
        (t.referenceId || '').toLowerCase().includes(q)
    );
  }, [transactions, ledgerSearch]);

  const filteredCustomTasks = useMemo(() => {
    const q = ctSearch.trim().toLowerCase();
    return customTasks
      .filter((c) => c.status === ctFilter)
      .filter(
        (c) =>
          !q ||
          c.memberName.toLowerCase().includes(q) ||
          c.memberId.toLowerCase().includes(q) ||
          c.customTaskCode.toLowerCase().includes(q) ||
          c.taskName.toLowerCase().includes(q) ||
          c.taskDetails.toLowerCase().includes(q)
      );
  }, [customTasks, ctFilter, ctSearch]);

  const assistantUsers = useMemo(
    () => users.filter((u) => u.role === 'assistant_admin'),
    [users]
  );

  const promotableMembers = useMemo(() => {
    const q = promoteSearch.trim().toLowerCase();
    if (!q) return [];
    return users
      .filter((u) => u.role === 'member' && u.status === 'approved')
      .filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          u.memberId.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [users, promoteSearch]);

  const formatAssistantBadge = (status: CustomTaskAssistantStatus) => {
    switch (status) {
      case 'recommended_approve':
        return {
          label: 'Assistant Recommended Approval',
          cls: 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300',
        };
      case 'recommended_reject':
        return {
          label: 'Assistant Recommended Rejection',
          cls: 'bg-rose-500/15 border-rose-400/35 text-rose-300',
        };
      case 'reviewed':
        return {
          label: 'Assistant Reviewed',
          cls: 'bg-sky-500/15 border-sky-400/35 text-sky-200',
        };
      default:
        return {
          label: 'Unreviewed by Assistant',
          cls: 'bg-white/6 border-white/12 text-sky-200/70',
        };
    }
  };

  const navItems: { id: AdminTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'best_10', label: `Best 10 (${currentMonthLeaderboard.top10.length})` },
    { id: 'members', label: `Members (${stats.pendingMembers})` },
    { id: 'assistants', label: `Assistant Admins (${stats.activeAssistantsCount})` },
    { id: 'tasks', label: `Tasks (${tasks.length})` },
    { id: 'submissions', label: `Proofs (${stats.pendingProofs})` },
    { id: 'custom_tasks', label: `Custom Tasks (${stats.pendingCustomTasks})` },
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
          role="status"
          className={`fixed top-14 left-4 right-4 z-50 max-w-lg mx-auto p-3.5 rounded-2xl border shadow-2xl backdrop-blur-md flex items-start justify-between gap-3 text-xs sm:text-sm ${
            banner.type === 'success'
              ? 'bg-[#072922]/95 border-emerald-400/40 text-emerald-100'
              : 'bg-[#2A0B14]/95 border-rose-400/40 text-rose-100'
          }`}
        >
          <span className="leading-relaxed font-medium">{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-lg text-white/70 hover:text-white shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('best_10')}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-amber-400/35 p-5 flex items-center justify-between gap-4"
            >
              <div>
                <p className="text-xs text-sky-200/75 inline-flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-300" />
                  <span>Best 10 ({currentDhakaBounds.monthLabel})</span>
                </p>
                <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-amber-300">
                  {currentMonthLeaderboard.top10.length} / 10
                </p>
                <p className="mt-1 text-xs text-sky-200/60">
                  Configure prizes, finalize archives & track delivery
                </p>
              </div>
              <span className="min-h-[38px] px-3 rounded-xl bg-amber-400/15 text-amber-200 text-xs font-semibold inline-flex items-center shrink-0">
                Manage Best 10
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCtFilter('pending');
                setActiveTab('custom_tasks');
              }}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-teal-400/30 p-5 flex items-center justify-between gap-4"
            >
              <div>
                <p className="text-xs text-sky-200/75">Pending Custom Task Payments</p>
                <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-teal-300">
                  {stats.pendingCustomTasks}
                </p>
                <p className="mt-1 text-xs text-sky-200/60">
                  {stats.approvedCustomTasks} custom tasks paid · Final Main Admin approval required
                </p>
              </div>
              <span className="min-h-[38px] px-3 rounded-xl bg-teal-500/15 text-teal-200 text-xs font-semibold inline-flex items-center shrink-0">
                Review Custom Tasks
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('assistants')}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-sky-400/30 p-5 flex items-center justify-between gap-4"
            >
              <div>
                <p className="text-xs text-sky-200/75">Assistant Admins</p>
                <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-white">
                  {stats.activeAssistantsCount}
                </p>
                <p className="mt-1 text-xs text-sky-200/60">
                  {stats.totalAssistants} total accounts · Create & manage reviewers
                </p>
              </div>
              <span className="min-h-[38px] px-3 rounded-xl bg-white/8 text-sky-100 text-xs font-semibold inline-flex items-center shrink-0">
                Manage Assistants
              </span>
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
                            className="min-h-[40px] px-3.5 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 text-xs font-semibold cursor-pointer"
                          >
                            {busyId === m.uid && busyDecision === 'approved'
                              ? 'Approving...'
                              : 'Approve'}
                          </button>
                        )}

                        {m.role !== 'admin' && m.status !== 'rejected' && (
                          <button
                            type="button"
                            disabled={busyId === m.uid}
                            onClick={() => {
                              setRejectingMemberUid(m.uid);
                              setMemberRejectReason(m.rejectionReason || '');
                              setCardError(null);
                            }}
                            className="min-h-[40px] px-3.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-50 text-rose-300 text-xs font-semibold cursor-pointer"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </div>

                    {cardError?.id === m.uid && (
                      <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-400/30 text-xs text-rose-200">
                        {cardError.text}
                      </div>
                    )}

                    {rejectingMemberUid === m.uid && (
                      <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/25 space-y-2.5">
                        <input
                          type="text"
                          maxLength={MAX_REASON_LENGTH}
                          value={memberRejectReason}
                          onChange={(e) => setMemberRejectReason(e.target.value)}
                          placeholder="Optional rejection reason (or tap Confirm Reject directly)..."
                          className="w-full min-h-[42px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-xs sm:text-sm text-white"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={busyId === m.uid}
                            onClick={() => {
                              setRejectingMemberUid(null);
                              setMemberRejectReason('');
                            }}
                            className="min-h-[40px] px-3.5 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={busyId === m.uid}
                            onClick={() => handleReviewMember(m.uid, 'rejected')}
                            className="min-h-[40px] px-4 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-slate-950 text-xs font-semibold whitespace-nowrap cursor-pointer"
                          >
                            {busyId === m.uid && busyDecision === 'rejected'
                              ? 'Rejecting...'
                              : 'Confirm Reject'}
                          </button>
                        </div>
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

                      {sub.status !== 'pending' && (
                        <div className="p-3 rounded-xl bg-[#070E20] border border-white/10 space-y-1 text-xs">
                          <p
                            className={`font-semibold inline-flex items-center gap-1.5 ${
                              sub.status === 'approved' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {sub.status === 'approved' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span className="capitalize">
                              {sub.reviewAction || sub.status} ·{' '}
                              {sub.status === 'approved'
                                ? `Credited ${formatBdt(sub.rewardAmount)}`
                                : 'No Wallet Credit'}
                            </span>
                          </p>
                          {(sub.reviewerId || sub.reviewedBy) && (
                            <p className="text-[11px] font-mono tabular-nums text-sky-200/65">
                              Reviewer: {sub.reviewerId || sub.reviewedBy}
                              {sub.reviewerName ? ` (${sub.reviewerName})` : ''}
                              {sub.reviewerRole
                                ? ` · ${sub.reviewerRole === 'admin' ? 'Main Admin' : 'Assistant Admin'}`
                                : ''}
                            </p>
                          )}
                          {sub.reviewedAt && (
                            <p className="text-[11px] font-mono tabular-nums text-sky-200/55">
                              Reviewed At: {formatDateTime(sub.reviewedAt)}
                            </p>
                          )}
                          {sub.status === 'rejected' && sub.rejectionReason && (
                            <p className="text-xs text-rose-300 pt-1">
                              Reason: {sub.rejectionReason}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {sub.status === 'pending' && (
                      <div className="pt-3 border-t border-white/10 space-y-3">
                        {cardError?.id === sub.submissionId && (
                          <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-400/30 text-xs text-rose-200">
                            {cardError.text}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            disabled={busyId === sub.submissionId}
                            onClick={() => handleReviewSubmission(sub.submissionId, 'approved')}
                            className="min-h-[46px] px-3 rounded-xl bg-teal-500 hover:bg-teal-400 active:scale-[0.99] disabled:opacity-50 text-slate-950 text-xs font-semibold transition-all cursor-pointer"
                          >
                            {busyId === sub.submissionId && busyDecision === 'approved'
                              ? 'Approving...'
                              : `Approve & Credit ${formatBdt(sub.rewardAmount)}`}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === sub.submissionId}
                            onClick={() => {
                              setRejectingSubId(sub.submissionId);
                              setSubRejectReason('');
                              setCardError(null);
                            }}
                            className={`min-h-[46px] px-3 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer ${
                              rejectingSubId === sub.submissionId
                                ? 'bg-rose-500/30 border border-rose-400/40 text-rose-200'
                                : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300'
                            }`}
                          >
                            Reject Proof
                          </button>
                        </div>

                        {rejectingSubId === sub.submissionId && (
                          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/25 space-y-2.5">
                            <input
                              type="text"
                              required
                              maxLength={MAX_REASON_LENGTH}
                              value={subRejectReason}
                              onChange={(e) => setSubRejectReason(e.target.value)}
                              placeholder="Required rejection reason (minimum 3 characters)..."
                              className="w-full min-h-[42px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-xs text-white"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={busyId === sub.submissionId}
                                onClick={() => {
                                  setRejectingSubId(null);
                                  setSubRejectReason('');
                                }}
                                className="min-h-[42px] px-3 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={busyId === sub.submissionId}
                                onClick={() => handleReviewSubmission(sub.submissionId, 'rejected')}
                                className="min-h-[42px] px-3.5 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-slate-950 text-xs font-semibold whitespace-nowrap cursor-pointer"
                              >
                                {busyId === sub.submissionId && busyDecision === 'rejected'
                                  ? 'Rejecting...'
                                  : 'Confirm Reject'}
                              </button>
                            </div>
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

      {/* 4B. CUSTOM TASKS REVIEW & FINAL PAYMENT APPROVAL */}
      {activeTab === 'custom_tasks' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 w-fit overflow-x-auto">
              {(['pending', 'approved', 'rejected'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setCtFilter(st)}
                  className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap ${
                    ctFilter === st
                      ? 'bg-teal-500 text-slate-950'
                      : 'text-sky-200/75 hover:text-white'
                  }`}
                >
                  {st === 'pending'
                    ? `Pending Payment (${stats.pendingCustomTasks})`
                    : st === 'approved'
                    ? 'Approved & Paid'
                    : 'Rejected'}
                </button>
              ))}
            </div>

            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={ctSearch}
                onChange={(e) => setCtSearch(e.target.value)}
                placeholder="Search member, ID, custom task..."
                className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-[#0D1730] border border-white/12 text-xs sm:text-sm text-white"
              />
            </div>
          </div>

          {filteredCustomTasks.length === 0 ? (
            <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center text-sm text-sky-200/70">
              No custom task submissions in this status.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCustomTasks.map((ct) => {
                const ctMember = userByUid.get(ct.userId);
                const badge = formatAssistantBadge(ct.assistantStatus);
                const currentAmountStr =
                  ctApprovedAmounts[ct.customTaskId] !== undefined
                    ? ctApprovedAmounts[ct.customTaskId]
                    : String(ct.requestedAmount);

                return (
                  <div
                    key={ct.customTaskId}
                    className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <AvatarDisplay
                            photoAssetId={ctMember?.photoAssetId}
                            fullName={ct.memberName}
                            sizeClass="w-10 h-10 text-xs"
                            zoomable
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums text-sky-200/70">
                              <span className="text-teal-300 font-semibold">
                                {ct.customTaskCode}
                              </span>
                              <span aria-hidden="true">·</span>
                              <button
                                type="button"
                                onClick={() => ctMember && setInspectedMember(ctMember)}
                                className="text-white hover:underline font-semibold text-left"
                              >
                                {ct.memberId} ({ct.memberName})
                              </button>
                            </div>
                            <h3 className="text-base font-bold text-white mt-0.5">{ct.taskName}</h3>
                            <p className="text-[11px] font-mono tabular-nums text-sky-200/55">
                              Submitted {formatDateTime(ct.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-[11px] text-sky-200/65">Requested</p>
                          <p className="text-lg font-bold font-mono tabular-nums text-amber-300">
                            {formatBdt(ct.requestedAmount)}
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/8 space-y-1">
                        <p className="text-[11px] font-semibold text-sky-200/70">Task Details</p>
                        <p className="text-xs sm:text-sm text-sky-100 whitespace-pre-line leading-relaxed">
                          {ct.taskDetails}
                        </p>
                      </div>

                      {ct.screenshotAssetId ? (
                        <ProofScreenshotViewer
                          assetId={ct.screenshotAssetId}
                          title={`${ct.memberName} (${ct.memberId}) · ${ct.taskName}`}
                        />
                      ) : (
                        <div className="p-3 rounded-xl bg-[#070E20] border border-white/10 text-xs text-sky-200/60 text-center">
                          No screenshot uploaded (Optional proof)
                        </div>
                      )}

                      {/* Assistant Admin Inspection Summary */}
                      <div className="p-3 rounded-xl bg-[#070E20]/80 border border-white/10 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                          {ct.assistantReviewedAt && (
                            <span className="text-[11px] font-mono tabular-nums text-sky-200/60">
                              {ct.assistantReviewerId || 'Assistant'}{' '}
                              {ct.assistantReviewerName ? `(${ct.assistantReviewerName})` : ''} ·{' '}
                              {formatDateTime(ct.assistantReviewedAt)}
                            </span>
                          )}
                        </div>
                        {ct.assistantNote && (
                          <p className="text-xs text-sky-100/85">
                            Assistant Note: {ct.assistantNote}
                          </p>
                        )}
                      </div>

                      {ct.status !== 'pending' && (
                        <div className="p-3 rounded-xl bg-[#070E20] border border-white/10 space-y-1 text-xs">
                          <p
                            className={`font-semibold inline-flex items-center gap-1.5 ${
                              ct.status === 'approved' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {ct.status === 'approved' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>
                              {ct.status === 'approved'
                                ? `Approved & Credited ${formatBdt(ct.approvedAmount)}`
                                : 'Rejected — No Wallet Credit'}
                            </span>
                          </p>
                          <p className="text-[11px] font-mono tabular-nums text-sky-200/65">
                            Main Admin: {ct.reviewerId || 'ADMIN'}
                            {ct.reviewerName ? ` (${ct.reviewerName})` : ''} ·{' '}
                            {formatDateTime(ct.reviewedAt)}
                          </p>
                          {ct.transactionId && (
                            <p className="text-[11px] font-mono tabular-nums text-teal-300/85">
                              Ledger Ref: {ct.transactionId}
                            </p>
                          )}
                          {ct.status === 'rejected' && ct.rejectionReason && (
                            <p className="text-xs text-rose-300 pt-1">
                              Reason: {ct.rejectionReason}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {ct.status === 'pending' && (
                      <div className="pt-3 border-t border-white/10 space-y-3">
                        {cardError?.id === ct.customTaskId && (
                          <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-400/30 text-xs text-rose-200">
                            {cardError.text}
                          </div>
                        )}

                        <div>
                          <label className="block text-[11px] font-medium text-sky-200/80 mb-1">
                            Approved Payment Amount (BDT)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={100000}
                            step={1}
                            value={currentAmountStr}
                            onChange={(e) =>
                              setCtApprovedAmounts((prev) => ({
                                ...prev,
                                [ct.customTaskId]: e.target.value,
                              }))
                            }
                            className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono tabular-nums font-bold text-teal-300"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            disabled={busyId === ct.customTaskId}
                            onClick={() => handleCustomTaskDecision(ct, 'approved')}
                            className="min-h-[46px] px-3 rounded-xl bg-teal-500 hover:bg-teal-400 active:scale-[0.99] disabled:opacity-50 text-slate-950 text-xs font-semibold transition-all cursor-pointer"
                          >
                            {busyId === ct.customTaskId && busyDecision === 'approved'
                              ? 'Crediting...'
                              : `Approve & Pay ৳${currentAmountStr || ct.requestedAmount}`}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === ct.customTaskId}
                            onClick={() => {
                              setRejectingCtId(ct.customTaskId);
                              setCtRejectReason(
                                ct.assistantStatus === 'recommended_reject' ? ct.assistantNote : ''
                              );
                              setCardError(null);
                            }}
                            className={`min-h-[46px] px-3 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer ${
                              rejectingCtId === ct.customTaskId
                                ? 'bg-rose-500/30 border border-rose-400/40 text-rose-200'
                                : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300'
                            }`}
                          >
                            Reject Request
                          </button>
                        </div>

                        {rejectingCtId === ct.customTaskId && (
                          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/25 space-y-2.5">
                            <input
                              type="text"
                              required
                              maxLength={MAX_REASON_LENGTH}
                              value={ctRejectReason}
                              onChange={(e) => setCtRejectReason(e.target.value)}
                              placeholder="Required rejection reason for member notification..."
                              className="w-full min-h-[42px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-xs text-white"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={busyId === ct.customTaskId}
                                onClick={() => {
                                  setRejectingCtId(null);
                                  setCtRejectReason('');
                                }}
                                className="min-h-[42px] px-3 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={busyId === ct.customTaskId}
                                onClick={() => handleCustomTaskDecision(ct, 'rejected')}
                                className="min-h-[42px] px-3.5 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-slate-950 text-xs font-semibold whitespace-nowrap cursor-pointer"
                              >
                                {busyId === ct.customTaskId && busyDecision === 'rejected'
                                  ? 'Rejecting...'
                                  : 'Confirm Reject'}
                              </button>
                            </div>
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

      {/* 4C. ASSISTANT ADMIN ACCOUNTS MANAGEMENT */}
      {activeTab === 'assistants' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Create New Assistant Admin + Promote Existing */}
          <div className="lg:col-span-5 space-y-5">
            <form
              onSubmit={handleCreateAssistantAdmin}
              className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center gap-2.5">
                <UserPlus className="w-5 h-5 text-teal-300 shrink-0" />
                <div>
                  <h2 className="text-base font-bold text-white">Create Assistant Admin</h2>
                  <p className="text-xs text-sky-200/70">
                    Provision login credentials for the dedicated Assistant Admin Dashboard.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_NAME_LENGTH}
                  value={asstFullName}
                  onChange={(e) => setAsstFullName(e.target.value)}
                  placeholder="e.g., Assistant Reviewer"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1">
                  Login Email Address
                </label>
                <input
                  type="email"
                  required
                  maxLength={150}
                  value={asstEmail}
                  onChange={(e) => setAsstEmail(e.target.value)}
                  placeholder="assistant@example.com"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1">
                  Initial Password (min 6 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  maxLength={128}
                  value={asstPassword}
                  onChange={(e) => setAsstPassword(e.target.value)}
                  placeholder="Enter strong password"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1">
                  Mobile Number (Optional)
                </label>
                <input
                  type="tel"
                  maxLength={15}
                  value={asstPhone}
                  onChange={(e) => setAsstPhone(e.target.value)}
                  placeholder="01712345678"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono tabular-nums text-white"
                />
              </div>

              <button
                type="submit"
                disabled={busyId === 'create_assistant'}
                className="w-full min-h-[46px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-semibold text-sm transition-colors"
              >
                {busyId === 'create_assistant'
                  ? 'Creating Assistant Account...'
                  : 'Create Assistant Admin Account'}
              </button>
            </form>

            {/* Promote Existing Registered Member */}
            <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 space-y-3">
              <h3 className="text-sm font-bold text-white">Promote Existing Member</h3>
              <p className="text-xs text-sky-200/70">
                Search an existing approved member by ID, name, or email to assign Assistant Admin
                access.
              </p>
              <div className="relative">
                <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={promoteSearch}
                  onChange={(e) => setPromoteSearch(e.target.value)}
                  placeholder="Search member ID, name, or email..."
                  className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-[#070E20] border border-white/15 text-xs sm:text-sm text-white"
                />
              </div>

              {promotableMembers.length > 0 && (
                <div className="divide-y divide-white/8 rounded-xl bg-[#070E20] border border-white/10 px-3">
                  {promotableMembers.map((m) => (
                    <div
                      key={m.uid}
                      className="py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="text-white font-semibold truncate">
                          {m.fullName} ({m.memberId})
                        </p>
                        <p className="text-sky-200/65 truncate">{m.email}</p>
                      </div>
                      <button
                        type="button"
                        disabled={busyId === m.uid}
                        onClick={() => handleManageAssistantRole(m.uid, 'promote')}
                        className="min-h-[36px] px-3 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-semibold shrink-0"
                      >
                        Promote
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Manage Existing Assistant Admins */}
          <div className="lg:col-span-7 rounded-2xl bg-[#0D1730]/95 border border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-teal-300" />
                <h2 className="text-base font-semibold text-white">
                  Assistant Admin Accounts ({assistantUsers.length})
                </h2>
              </div>
              <span className="text-xs font-mono tabular-nums text-teal-300">
                {stats.activeAssistantsCount} Active
              </span>
            </div>

            {assistantUsers.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-white">No Assistant Admins created yet</p>
                <p className="text-xs text-sky-200/65 max-w-md mx-auto">
                  Use the form on the left to create an Assistant Admin account. Assistant Admins
                  can review official task proofs and inspect custom task requests without access to
                  withdrawals, manual wallet edits, or admin creation.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/8">
                {assistantUsers.map((asst) => {
                  const isActive =
                    asst.status === 'approved' && activeAssistantUidSet.has(asst.uid);

                  return (
                    <div key={asst.uid} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <AvatarDisplay
                          photoAssetId={asst.photoAssetId}
                          fullName={asst.fullName}
                          sizeClass="w-12 h-12 text-sm"
                        />
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums">
                            <span className="text-teal-300 font-semibold">{asst.memberId}</span>
                            <span aria-hidden="true" className="text-sky-200/50">
                              ·
                            </span>
                            <span
                              className={
                                isActive
                                  ? 'text-emerald-400 font-semibold'
                                  : 'text-rose-300 font-semibold'
                              }
                            >
                              {isActive ? 'Active Assistant Admin' : 'Suspended'}
                            </span>
                          </div>
                          <p className="text-sm sm:text-base font-bold text-white truncate">
                            {asst.fullName}
                          </p>
                          <p className="text-xs text-sky-200/70 truncate">
                            {asst.email}
                            {asst.phone ? ` · ${asst.phone}` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {isActive ? (
                          <button
                            type="button"
                            disabled={busyId === asst.uid}
                            onClick={() => handleManageAssistantRole(asst.uid, 'suspend')}
                            className="min-h-[38px] px-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 text-amber-300 text-xs font-semibold"
                          >
                            {busyId === asst.uid && busyDecision === 'suspend'
                              ? 'Suspending...'
                              : 'Suspend'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === asst.uid}
                            onClick={() => handleManageAssistantRole(asst.uid, 'reactivate')}
                            className="min-h-[38px] px-3.5 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 text-xs font-semibold"
                          >
                            {busyId === asst.uid && busyDecision === 'reactivate'
                              ? 'Activating...'
                              : 'Reactivate'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === asst.uid}
                          onClick={() => handleManageAssistantRole(asst.uid, 'demote')}
                          className="min-h-[38px] px-3.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-50 text-rose-300 text-xs font-semibold"
                        >
                          {busyId === asst.uid && busyDecision === 'demote'
                            ? 'Updating...'
                            : 'Demote to Member'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
                        {rec.reviewerId ? ` · Reviewer ${rec.reviewerId}` : ''}
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
                      {tx.memberId} · {tx.type} · {formatDateTime(tx.approvedAt || tx.createdAt)}
                      {tx.submissionId ? ` · Submission ${tx.submissionId}` : ''}
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

      {/* 10. BEST 10 MONTHLY LEADERBOARD MANAGEMENT */}
      {activeTab === 'best_10' && (
        <AdminBest10Section
          users={users}
          transactions={transactions}
          auditLogs={auditLogs}
          onBanner={setBanner}
        />
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
                          <div key={s.submissionId} className="py-3 text-xs space-y-2">
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
                            {s.status === 'pending' && (
                              <div className="space-y-2 pt-1">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={busyId === s.submissionId}
                                    onClick={() =>
                                      handleReviewSubmission(s.submissionId, 'approved')
                                    }
                                    className="min-h-[36px] px-3 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 text-xs font-semibold"
                                  >
                                    {busyId === s.submissionId && busyDecision === 'approved'
                                      ? 'Approving...'
                                      : `Approve ${formatBdt(s.rewardAmount)}`}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === s.submissionId}
                                    onClick={() => {
                                      setInspectorRejectSubId(s.submissionId);
                                      setInspectorRejectReason('');
                                    }}
                                    className="min-h-[36px] px-3 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 disabled:opacity-50 text-rose-200 text-xs font-semibold"
                                  >
                                    Reject
                                  </button>
                                </div>
                                {inspectorRejectSubId === s.submissionId && (
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                      type="text"
                                      maxLength={MAX_REASON_LENGTH}
                                      value={inspectorRejectReason}
                                      onChange={(e) => setInspectorRejectReason(e.target.value)}
                                      placeholder="Required rejection reason..."
                                      className="flex-1 min-h-[36px] px-2.5 rounded-lg bg-[#0B142C] border border-white/15 text-xs text-white"
                                    />
                                    <button
                                      type="button"
                                      disabled={busyId === s.submissionId}
                                      onClick={() =>
                                        handleReviewSubmission(
                                          s.submissionId,
                                          'rejected',
                                          inspectorRejectReason
                                        )
                                      }
                                      className="min-h-[36px] px-3 rounded-lg bg-rose-500 text-slate-950 text-xs font-semibold"
                                    >
                                      Confirm Reject
                                    </button>
                                  </div>
                                )}
                              </div>
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
