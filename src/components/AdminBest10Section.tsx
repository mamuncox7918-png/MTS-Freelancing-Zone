import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardList,
  Gift,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  Trophy,
  X,
} from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { apiRequest, formatBdt, formatDateTime } from '../lib/api';
import {
  computeMonthlyLeaderboardFromTransactions,
  createEmptyRewardConfigs,
  formatDhakaDateTime,
  getDhakaMonthBounds,
  getDhakaMonthKey,
  getRecentDhakaMonthKeys,
  normalizeRewardConfigs,
  type ComputedMemberMonthlyLedger,
} from '../lib/leaderboard';
import { AvatarDisplay } from './MediaView';
import type {
  AdminAuditLog,
  LeaderboardPeriod,
  LeaderboardRankRewardConfig,
  LeaderboardRewardStatus,
  LeaderboardWinner,
  LeaderboardWinnerAdminMeta,
  MonthlyMemberEarning,
  UserProfile,
  WalletTransaction,
} from '../types';

type Best10AdminSubTab = 'standings' | 'rewards' | 'winners' | 'audit';

export function AdminBest10Section({
  users,
  transactions,
  auditLogs,
  onBanner,
}: {
  users: UserProfile[];
  transactions: WalletTransaction[];
  auditLogs: AdminAuditLog[];
  onBanner: (banner: { type: 'error' | 'success'; text: string } | null) => void;
}) {
  const currentMonthKey = useMemo(() => getDhakaMonthKey(), []);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(currentMonthKey);
  const [subTab, setSubTab] = useState<Best10AdminSubTab>('standings');

  const [periods, setPeriods] = useState<LeaderboardPeriod[]>([]);
  const [monthEntries, setMonthEntries] = useState<MonthlyMemberEarning[]>([]);
  const [winners, setWinners] = useState<LeaderboardWinner[]>([]);
  const [winnerNotes, setWinnerNotes] = useState<LeaderboardWinnerAdminMeta[]>([]);

  // Search & inspection states
  const [memberSearch, setMemberSearch] = useState('');
  const [inspectedLedgerMember, setInspectedLedgerMember] = useState<
    (ComputedMemberMonthlyLedger & { rank: number }) | null
  >(null);
  const [reversingTx, setReversingTx] = useState<WalletTransaction | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  // Reward configuration draft states
  const [rewardDrafts, setRewardDrafts] = useState<LeaderboardRankRewardConfig[]>(() =>
    createEmptyRewardConfigs()
  );
  const [rewardsPublished, setRewardsPublished] = useState<boolean>(false);
  const [announcementDate, setAnnouncementDate] = useState<string>('');
  const [rewardNote, setRewardNote] = useState<string>('');

  // Confirmation modals (no window.confirm / window.alert)
  const [finalizeModalOpen, setFinalizeModalOpen] = useState<boolean>(false);
  const [finalizeNote, setFinalizeNote] = useState<string>('');

  const [recalcModalOpen, setRecalcModalOpen] = useState<boolean>(false);
  const [recalcReason, setRecalcReason] = useState<string>('');

  const [rewardConfirmModalOpen, setRewardConfirmModalOpen] = useState<boolean>(false);
  const [rewardEditReason, setRewardEditReason] = useState<string>('');

  // Winner fulfillment editor modal
  const [editingWinner, setEditingWinner] = useState<LeaderboardWinner | null>(null);
  const [winStatusDraft, setWinStatusDraft] = useState<LeaderboardRewardStatus>('pending');
  const [winDeliveredAtDraft, setWinDeliveredAtDraft] = useState<string>('');
  const [winAdminNoteDraft, setWinAdminNoteDraft] = useState<string>('');
  const [winNotifyMember, setWinNotifyMember] = useState<boolean>(true);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const autoSyncedMonthsRef = useRef<Set<string>>(new Set());

  // Subscribe to all leaderboardPeriods
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'leaderboardPeriods'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as LeaderboardPeriod);
        list.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
        setPeriods(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'leaderboardPeriods')
    );
    return () => unsub();
  }, []);

  // Subscribe to selected month's projections, winners, and admin notes
  useEffect(() => {
    const unsubs = [
      onSnapshot(
        query(collection(db, 'monthlyMemberEarnings'), where('monthKey', '==', selectedMonthKey)),
        (snap) => {
          setMonthEntries(snap.docs.map((d) => d.data() as MonthlyMemberEarning));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'monthlyMemberEarnings')
      ),
      onSnapshot(
        query(collection(db, 'leaderboardWinners'), where('monthKey', '==', selectedMonthKey)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as LeaderboardWinner);
          list.sort((a, b) => a.rank - b.rank);
          setWinners(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'leaderboardWinners')
      ),
      onSnapshot(
        query(collection(db, 'leaderboardAdminNotes'), where('monthKey', '==', selectedMonthKey)),
        (snap) => {
          setWinnerNotes(snap.docs.map((d) => d.data() as LeaderboardWinnerAdminMeta));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'leaderboardAdminNotes')
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [selectedMonthKey]);

  const activePeriod = useMemo(
    () => periods.find((p) => p.monthKey === selectedMonthKey) || null,
    [periods, selectedMonthKey]
  );
  const isFinalized = activePeriod?.status === 'finalized';

  // Populate reward draft form whenever selectedMonthKey or activePeriod updates
  useEffect(() => {
    if (activePeriod) {
      setRewardDrafts(normalizeRewardConfigs(activePeriod.rewards));
      setRewardsPublished(Boolean(activePeriod.rewardsPublished));
      setAnnouncementDate(activePeriod.announcementDate || '');
      setRewardNote(activePeriod.rewardNote || '');
    } else {
      setRewardDrafts(createEmptyRewardConfigs());
      setRewardsPublished(false);
      setAnnouncementDate('');
      setRewardNote('');
    }
  }, [selectedMonthKey, activePeriod]);

  // Selectable months: recent 12 Asia/Dhaka months + any older archived periods
  const selectableMonths = useMemo(() => {
    const set = new Set<string>(getRecentDhakaMonthKeys(12));
    for (const p of periods) {
      if (p.monthKey) set.add(p.monthKey);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [periods]);

  const bounds = useMemo(() => getDhakaMonthBounds(selectedMonthKey), [selectedMonthKey]);

  // Authoritative live computation from wallet transactions & approved members
  const computedLedger = useMemo(
    () => computeMonthlyLeaderboardFromTransactions(selectedMonthKey, transactions, users),
    [selectedMonthKey, transactions, users]
  );

  // Detect whether Firestore monthlyMemberEarnings projection needs reconciliation for open months
  const outOfSyncCount = useMemo(() => {
    const existingMap = new Map(monthEntries.map((e) => [e.userId, e]));
    let diffs = 0;
    for (const stat of computedLedger.allMemberStats) {
      const prev = existingMap.get(stat.userId);
      if (
        !prev ||
        prev.eligibleEarnings !== stat.eligibleEarnings ||
        prev.approvedTaskCount !== stat.approvedTaskCount ||
        prev.reachedAtMs !== stat.reachedAtMs ||
        prev.displayName !== stat.displayName ||
        prev.photoAssetId !== stat.photoAssetId ||
        prev.isEligibleMember !== true
      ) {
        diffs++;
      }
    }
    for (const prev of monthEntries) {
      if (
        prev.eligibleEarnings > 0 &&
        !computedLedger.allMemberStats.some((s) => s.userId === prev.userId)
      ) {
        diffs++;
      }
    }
    return diffs;
  }, [monthEntries, computedLedger.allMemberStats]);

  // Silent auto-reconcile once per open month if out of sync so members see exact live rankings
  useEffect(() => {
    if (isFinalized) return;
    if (users.length === 0) return;
    if (outOfSyncCount === 0) return;
    const syncKey = `${selectedMonthKey}_${outOfSyncCount}`;
    if (autoSyncedMonthsRef.current.has(syncKey)) return;
    autoSyncedMonthsRef.current.add(syncKey);

    apiRequest('/api/admin/leaderboard/recalculate', {
      method: 'POST',
      body: {
        monthKey: selectedMonthKey,
        silentAutoSync: true,
      },
    }).catch(() => undefined);
  }, [selectedMonthKey, isFinalized, users.length, outOfSyncCount]);

  const noteByWinnerId = useMemo(() => {
    const map = new Map<string, LeaderboardWinnerAdminMeta>();
    for (const n of winnerNotes) map.set(n.winnerId, n);
    return map;
  }, [winnerNotes]);

  const filteredRankedMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return computedLedger.rankedAll;
    return computedLedger.rankedAll.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.memberId.toLowerCase().includes(q)
    );
  }, [computedLedger.rankedAll, memberSearch]);

  const leaderboardAuditLogs = useMemo(
    () =>
      auditLogs.filter(
        (l) =>
          l.targetType === 'leaderboardPeriod' ||
          l.targetType === 'leaderboardWinner' ||
          l.action.includes('LEADERBOARD') ||
          l.action === 'EARNING_REVERSED'
      ),
    [auditLogs]
  );

  // Handlers
  const updateRewardSlot = (
    rank: number,
    patch: Partial<LeaderboardRankRewardConfig>
  ) => {
    setRewardDrafts((prev) =>
      prev.map((slot) => (slot.rank === rank ? { ...slot, ...patch } : slot))
    );
  };

  const executeSaveRewards = async (confirmFinalizedEdit: boolean, reasonText: string) => {
    onBanner(null);
    setBusyAction('save_rewards');
    try {
      await apiRequest('/api/admin/leaderboard/rewards', {
        method: 'POST',
        body: {
          monthKey: selectedMonthKey,
          rewards: rewardDrafts,
          rewardsPublished,
          announcementDate: announcementDate.trim(),
          rewardNote: rewardNote.trim(),
          confirmFinalizedEdit,
          reason: reasonText.trim(),
        },
      });
      setRewardConfirmModalOpen(false);
      setRewardEditReason('');
      onBanner({
        type: 'success',
        text: `Best 10 rewards saved for ${bounds.monthLabel} (${
          rewardsPublished ? 'Published to members' : 'Saved as draft'
        }).`,
      });
    } catch (err) {
      onBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save Best 10 rewards.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveRewardsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const invalidEnabled = rewardDrafts.find(
      (r) => r.enabled && r.prizeTitle.trim().length === 0
    );
    if (invalidEnabled) {
      onBanner({
        type: 'error',
        text: `Enter a Prize Title for Rank #${invalidEnabled.rank} or uncheck Enable.`,
      });
      return;
    }

    if (isFinalized) {
      setRewardEditReason('');
      setRewardConfirmModalOpen(true);
      return;
    }

    void executeSaveRewards(false, '');
  };

  const executeRecalculate = async (confirmOverride: boolean, reasonText: string) => {
    onBanner(null);
    setBusyAction('recalculate');
    try {
      const res = await apiRequest<{ changedCount: number; eligibleMemberCount: number }>(
        '/api/admin/leaderboard/recalculate',
        {
          method: 'POST',
          body: {
            monthKey: selectedMonthKey,
            confirmFinalizedOverride: confirmOverride,
            reason: reasonText.trim(),
          },
        }
      );
      setRecalcModalOpen(false);
      setRecalcReason('');
      onBanner({
        type: 'success',
        text: `Recalculated ${bounds.monthLabel} leaderboard from verified wallet ledger (${res.eligibleMemberCount} eligible members, ${res.changedCount} records updated).`,
      });
    } catch (err) {
      onBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Leaderboard recalculation failed.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleFinalizeMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isFinalized && finalizeNote.trim().length < 3) {
      onBanner({
        type: 'error',
        text: 'Enter a reason (at least 3 characters) to re-finalize an archived month.',
      });
      return;
    }
    onBanner(null);
    setBusyAction('finalize');
    try {
      const res = await apiRequest<{ winnerCount: number }>('/api/admin/leaderboard/finalize', {
        method: 'POST',
        body: {
          monthKey: selectedMonthKey,
          confirmReFinalize: isFinalized,
          note: finalizeNote.trim(),
        },
      });
      setFinalizeModalOpen(false);
      setFinalizeNote('');
      setSubTab('winners');
      onBanner({
        type: 'success',
        text: `Finalized ${bounds.monthLabel} Best 10 leaderboard and locked ${res.winnerCount} archived winners.`,
      });
    } catch (err) {
      onBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to finalize monthly leaderboard.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReverseEarning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingTx) return;
    if (reversalReason.trim().length < 5) {
      onBanner({
        type: 'error',
        text: 'Enter a clear reversal reason (at least 5 characters) for the audit log.',
      });
      return;
    }
    onBanner(null);
    setBusyAction(`reverse_${reversingTx.transactionId}`);
    try {
      await apiRequest('/api/admin/leaderboard/reverse-earning', {
        method: 'POST',
        body: {
          transactionId: reversingTx.transactionId,
          reason: reversalReason.trim(),
          confirmFinalizedOverride: isFinalized,
        },
      });
      setReversingTx(null);
      setReversalReason('');
      setInspectedLedgerMember(null);
      onBanner({
        type: 'success',
        text: `Earning reversed, wallet adjusted, and ${bounds.monthLabel} Best 10 recalculated.`,
      });
    } catch (err) {
      onBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not reverse task earning.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const openEditWinnerModal = (w: LeaderboardWinner) => {
    const meta = noteByWinnerId.get(w.winnerId);
    setEditingWinner(w);
    setWinStatusDraft(w.rewardStatus || 'pending');
    setWinDeliveredAtDraft(
      w.deliveredAt ? w.deliveredAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
    );
    setWinAdminNoteDraft(meta?.adminNote || '');
    setWinNotifyMember(true);
  };

  const handleSaveWinnerStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWinner) return;
    onBanner(null);
    setBusyAction(`winner_${editingWinner.winnerId}`);
    try {
      await apiRequest(`/api/admin/leaderboard/winners/${editingWinner.winnerId}/status`, {
        method: 'POST',
        body: {
          rewardStatus: winStatusDraft,
          deliveredAt:
            winStatusDraft === 'awarded' || winStatusDraft === 'approved'
              ? winDeliveredAtDraft.trim()
              : '',
          adminNote: winAdminNoteDraft.trim(),
          notifyWinner: winNotifyMember,
        },
      });
      setEditingWinner(null);
      onBanner({
        type: 'success',
        text: `Updated Rank #${editingWinner.rank} (${editingWinner.displayName}) reward status to ${winStatusDraft}.`,
      });
    } catch (err) {
      onBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update winner fulfillment status.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const formatRewardStatusBadge = (status: LeaderboardRewardStatus) => {
    switch (status) {
      case 'awarded':
        return 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300';
      case 'approved':
        return 'bg-sky-500/15 border-sky-400/35 text-sky-200';
      case 'cancelled':
        return 'bg-rose-500/15 border-rose-400/35 text-rose-300';
      default:
        return 'bg-amber-500/15 border-amber-400/35 text-amber-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Month & Controls Bar */}
      <div className="rounded-2xl bg-[#0D1730]/95 border border-amber-400/30 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-300">
                <Trophy className="w-4 h-4" />
                <span>Best 10 Monthly Leaderboard Control</span>
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${
                  isFinalized
                    ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                    : 'bg-teal-500/15 border-teal-400/35 text-teal-200'
                }`}
              >
                {isFinalized ? 'Finalized & Locked' : 'Open · Live Updating'}
              </span>
            </div>
            <p className="text-xs text-sky-200/75 font-mono tabular-nums">
              {bounds.monthLabel} ({bounds.daysInMonth} days · Asia/Dhaka UTC+6) · Next Reset:{' '}
              {bounds.nextResetLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Select leaderboard month"
              value={selectedMonthKey}
              onChange={(e) => setSelectedMonthKey(e.target.value)}
              className="min-h-[42px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-xs sm:text-sm font-mono tabular-nums text-white"
            >
              {selectableMonths.map((mKey) => {
                const b = getDhakaMonthBounds(mKey);
                const p = periods.find((item) => item.monthKey === mKey);
                const tag =
                  p?.status === 'finalized'
                    ? 'Finalized'
                    : mKey === currentMonthKey
                    ? 'Current Live'
                    : 'Open';
                return (
                  <option key={mKey} value={mKey}>
                    {b.monthLabel} ({mKey}) — {tag}
                  </option>
                );
              })}
            </select>

            <button
              type="button"
              disabled={busyAction === 'recalculate'}
              onClick={() => {
                if (isFinalized) {
                  setRecalcReason('');
                  setRecalcModalOpen(true);
                } else {
                  void executeRecalculate(false, '');
                }
              }}
              className="min-h-[42px] px-3.5 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${busyAction === 'recalculate' ? 'animate-spin' : ''}`}
              />
              <span>Recalculate from Ledger</span>
            </button>

            <button
              type="button"
              disabled={busyAction === 'finalize'}
              onClick={() => {
                setFinalizeNote('');
                setFinalizeModalOpen(true);
              }}
              className="min-h-[42px] px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isFinalized ? 'Re-Finalize Snapshot' : 'Finalize Month'}</span>
            </button>
          </div>
        </div>

        {/* Sub-navigation */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 overflow-x-auto">
          {(
            [
              {
                id: 'standings',
                label: `Live Standings (${computedLedger.allMemberStats.length})`,
                icon: Trophy,
              },
              {
                id: 'rewards',
                label: `Monthly Rewards (${
                  rewardDrafts.filter((r) => r.enabled).length
                }/10)`,
                icon: Gift,
              },
              {
                id: 'winners',
                label: `Finalized Winners & Delivery (${winners.length})`,
                icon: Archive,
              },
              {
                id: 'audit',
                label: `Best 10 Audit Log (${leaderboardAuditLogs.length})`,
                icon: ClipboardList,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`min-h-[40px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  active ? 'bg-teal-500 text-slate-950' : 'text-sky-200/75 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SUB-TAB 1: LIVE STANDINGS & ALL MEMBER MONTHLY EARNINGS */}
      {subTab === 'standings' && (
        <div className="space-y-6">
          {/* Summary KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-4">
              <p className="text-xs text-sky-200/70">Eligible Earning Members ({bounds.monthLabel})</p>
              <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-white">
                {computedLedger.allMemberStats.length}
              </p>
              <p className="mt-1 text-[11px] text-sky-200/60">
                Approved members with ≥ ৳1 task reward this month
              </p>
            </div>

            <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-4">
              <p className="text-xs text-sky-200/70">Top 10 Combined Monthly Earnings</p>
              <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-teal-300">
                {formatBdt(
                  computedLedger.top10.reduce((sum, r) => sum + r.eligibleEarnings, 0)
                )}
              </p>
              <p className="mt-1 text-[11px] text-sky-200/60">
                Excludes pending, rejected, withdrawals & reversed items
              </p>
            </div>

            <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-4">
              <p className="text-xs text-sky-200/70">Rewards Publication Status</p>
              <p className="mt-1.5 text-lg font-bold text-amber-300">
                {activePeriod?.rewardsPublished ? 'Published on Best 10' : 'Hidden / Not Published'}
              </p>
              <button
                type="button"
                onClick={() => setSubTab('rewards')}
                className="mt-1 text-xs font-semibold text-teal-300 hover:underline"
              >
                Configure 1st–10th Prizes →
              </button>
            </div>
          </div>

          {/* Searchable Member Monthly Earnings & Reversal Controls */}
          <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">
                  {bounds.monthLabel} Member Rankings & Eligible Earnings
                </h2>
                <p className="text-xs text-sky-200/65">
                  Tie-breaker: earliest Asia/Dhaka timestamp at which final monthly total was reached
                </p>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search name or MTS ID..."
                  className="w-full min-h-[42px] pl-9 pr-3.5 rounded-xl bg-[#070E20] border border-white/15 text-xs sm:text-sm text-white"
                />
              </div>
            </div>

            {filteredRankedMembers.length === 0 ? (
              <div className="p-10 text-center text-sm text-sky-200/65">
                No approved eligible task earnings found for {bounds.monthLabel}.
              </div>
            ) : (
              <div className="divide-y divide-white/8">
                {filteredRankedMembers.map((row) => {
                  const isTop10 = row.rank <= 10;
                  const configuredSlot = rewardDrafts[row.rank - 1];
                  return (
                    <div
                      key={row.userId}
                      className={`p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isTop10 ? 'bg-amber-400/[0.03]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl border flex items-center justify-center font-mono tabular-nums text-xs sm:text-sm font-bold shrink-0 ${
                            row.rank === 1
                              ? 'bg-amber-400 text-slate-950 border-amber-300'
                              : row.rank <= 3
                              ? 'bg-amber-400/20 text-amber-200 border-amber-400/40'
                              : isTop10
                              ? 'bg-teal-500/15 text-teal-200 border-teal-400/35'
                              : 'bg-[#081024] text-sky-200/80 border-white/10'
                          }`}
                        >
                          #{row.rank}
                        </div>

                        <AvatarDisplay
                          photoAssetId={row.photoAssetId}
                          fullName={row.displayName}
                          sizeClass="w-10 h-10 text-xs"
                        />

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-white truncate">
                              {row.displayName}
                            </p>
                            <span className="text-xs font-mono tabular-nums text-teal-300">
                              {row.memberId}
                            </span>
                            {isTop10 && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-400/15 border border-amber-400/30 text-[10px] font-semibold text-amber-200">
                                Best 10
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-mono tabular-nums text-sky-200/60 mt-0.5">
                            {row.approvedTaskCount} approved tasks · Reached{' '}
                            {formatDhakaDateTime(row.reachedAtMs)}
                          </p>
                          {isTop10 && configuredSlot?.enabled && configuredSlot.prizeTitle && (
                            <p className="text-[11px] text-amber-200/90 mt-0.5">
                              Configured Prize: {configuredSlot.prizeTitle}
                              {configuredSlot.monetaryValue > 0
                                ? ` (${formatBdt(configuredSlot.monetaryValue)})`
                                : ''}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="sm:text-right">
                          <p className="text-base font-bold font-mono tabular-nums text-teal-300">
                            {formatBdt(row.eligibleEarnings)}
                          </p>
                          <p className="text-[10px] text-sky-200/55">Monthly Eligible</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setInspectedLedgerMember(row);
                            setReversingTx(null);
                            setReversalReason('');
                          }}
                          className="min-h-[38px] px-3 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-xs font-semibold text-sky-100 whitespace-nowrap"
                        >
                          Inspect / Reverse
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

      {/* SUB-TAB 2: CONFIGURE MONTHLY REWARDS (POSITIONS 1ST–10TH) */}
      {subTab === 'rewards' && (
        <form
          onSubmit={handleSaveRewardsSubmit}
          className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 sm:p-6 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                {bounds.monthLabel} Rewards Configuration (Ranks 1–10)
              </h2>
              <p className="text-xs text-sky-200/70 mt-0.5">
                Only enabled prizes are shown to members, and only when “Publish Rewards” is turned
                on. Unconfigured prizes are never shown.
              </p>
            </div>

            <label className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#070E20] border border-amber-400/35 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={rewardsPublished}
                onChange={(e) => setRewardsPublished(e.target.checked)}
                className="w-4 h-4 accent-teal-400"
              />
              <span className="text-xs sm:text-sm font-semibold text-white">
                Publish Rewards on Best 10 Page
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                Reward Announcement / Distribution Date (Optional)
              </label>
              <input
                type="text"
                maxLength={40}
                value={announcementDate}
                onChange={(e) => setAnnouncementDate(e.target.value)}
                placeholder="e.g., Nov 2, 2026"
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                Reward Terms / Eligibility Note (Optional)
              </label>
              <input
                type="text"
                maxLength={500}
                value={rewardNote}
                onChange={(e) => setRewardNote(e.target.value)}
                placeholder="e.g., Prizes are distributed after final end-of-month verification."
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
              />
            </div>
          </div>

          <div className="space-y-3">
            {rewardDrafts.map((slot) => (
              <div
                key={slot.rank}
                className={`rounded-xl border p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 items-start ${
                  slot.enabled
                    ? 'bg-[#09132B] border-teal-400/35'
                    : 'bg-[#070E20]/70 border-white/10'
                }`}
              >
                <div className="lg:col-span-2 flex items-center justify-between lg:justify-start gap-2.5 pt-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(e) => updateRewardSlot(slot.rank, { enabled: e.target.checked })}
                      className="w-4 h-4 accent-teal-400"
                    />
                    <span className="font-mono tabular-nums text-xs sm:text-sm font-bold text-amber-300">
                      Rank #{slot.rank}
                    </span>
                  </label>
                </div>

                <div className="lg:col-span-4">
                  <label className="block text-[11px] text-sky-200/65 mb-1">Prize Title</label>
                  <input
                    type="text"
                    maxLength={160}
                    value={slot.prizeTitle}
                    onChange={(e) =>
                      updateRewardSlot(slot.rank, {
                        prizeTitle: e.target.value,
                        enabled: e.target.value.trim().length > 0 ? true : slot.enabled,
                      })
                    }
                    placeholder={`e.g., Rank #${slot.rank} Monthly Bonus`}
                    className="w-full min-h-[42px] px-3 rounded-lg bg-[#050B19] border border-white/15 text-xs sm:text-sm text-white"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-[11px] text-sky-200/65 mb-1">
                    Value in BDT (Optional)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000000}
                    step={1}
                    value={slot.monetaryValue || ''}
                    onChange={(e) =>
                      updateRewardSlot(slot.rank, {
                        monetaryValue: Math.max(0, Math.round(Number(e.target.value || 0))),
                      })
                    }
                    placeholder="0"
                    className="w-full min-h-[42px] px-3 rounded-lg bg-[#050B19] border border-white/15 text-xs sm:text-sm font-mono tabular-nums text-white"
                  />
                </div>

                <div className="lg:col-span-4">
                  <label className="block text-[11px] text-sky-200/65 mb-1">
                    Prize Description (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    value={slot.prizeDescription}
                    onChange={(e) =>
                      updateRewardSlot(slot.rank, { prizeDescription: e.target.value })
                    }
                    placeholder="Cash bonus, mobile recharge, gift pack, etc."
                    className="w-full min-h-[42px] px-3 rounded-lg bg-[#050B19] border border-white/15 text-xs sm:text-sm text-white"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={busyAction === 'save_rewards'}
              className="min-h-[46px] px-6 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 text-sm font-semibold transition-colors"
            >
              {busyAction === 'save_rewards'
                ? 'Saving Rewards...'
                : `Save ${bounds.monthLabel} Rewards`}
            </button>
          </div>
        </form>
      )}

      {/* SUB-TAB 3: FINALIZED WINNERS ARCHIVE & PRIZE FULFILLMENT */}
      {subTab === 'winners' && (
        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 overflow-hidden">
          <div className="p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white">
                {bounds.monthLabel} Finalized Winners & Prize Delivery Tracker
              </h2>
              <p className="text-xs text-sky-200/65">
                {isFinalized
                  ? `Locked on ${formatDateTime(activePeriod?.finalizedAt)} · Track Pending, Approved, Awarded, or Cancelled delivery.`
                  : 'This month has not been finalized yet. Finalize the month to lock the official Top 10 winners snapshot.'}
              </p>
            </div>

            {!isFinalized && (
              <button
                type="button"
                onClick={() => {
                  setFinalizeNote('');
                  setFinalizeModalOpen(true);
                }}
                className="min-h-[42px] px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Finalize {bounds.monthLabel} Now</span>
              </button>
            )}
          </div>

          {winners.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-white">
                No finalized winner records for {bounds.monthLabel}
              </p>
              <p className="text-xs text-sky-200/65">
                {isFinalized
                  ? 'No members had approved eligible earnings during this month.'
                  : 'Click "Finalize Month" once the monthly period concludes to generate official winner records.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/8">
              {winners.map((w) => {
                const meta = noteByWinnerId.get(w.winnerId);
                return (
                  <div
                    key={w.winnerId}
                    className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-400/40 text-amber-200 font-mono tabular-nums text-sm font-bold flex items-center justify-center shrink-0">
                        #{w.rank}
                      </div>
                      <AvatarDisplay
                        photoAssetId={w.photoAssetId}
                        fullName={w.displayName}
                        sizeClass="w-11 h-11 text-xs"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-white">{w.displayName}</p>
                          {meta?.memberId && (
                            <span className="text-xs font-mono tabular-nums text-teal-300">
                              {meta.memberId}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold capitalize ${formatRewardStatusBadge(
                              w.rewardStatus
                            )}`}
                          >
                            {w.rewardStatus}
                          </span>
                        </div>

                        <p className="text-xs font-mono tabular-nums text-sky-200/75">
                          Eligible Earnings: {formatBdt(w.eligibleEarnings)} ·{' '}
                          {w.approvedTaskCount} tasks
                        </p>

                        <p className="text-xs text-amber-200/95">
                          Prize:{' '}
                          {w.prizeTitle
                            ? `${w.prizeTitle}${
                                w.monetaryValue > 0 ? ` (${formatBdt(w.monetaryValue)})` : ''
                              }`
                            : 'No prize configured for this rank'}
                        </p>

                        {w.deliveredAt && (
                          <p className="text-[11px] font-mono tabular-nums text-emerald-300">
                            Delivery Date: {w.deliveredAt}
                          </p>
                        )}
                        {meta?.adminNote && (
                          <p className="text-xs text-sky-200/70">Admin Note: {meta.adminNote}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditWinnerModal(w)}
                        className="min-h-[40px] px-4 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 border border-teal-400/35 text-xs font-semibold text-teal-200 whitespace-nowrap"
                      >
                        Update Delivery Status
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: BEST 10 AUDIT LOG */}
      {subTab === 'audit' && (
        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
          {leaderboardAuditLogs.length === 0 ? (
            <div className="p-10 text-center text-sm text-sky-200/65">
              No Best 10 administrative actions logged yet.
            </div>
          ) : (
            leaderboardAuditLogs.map((log) => (
              <div
                key={log.logId}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <p className="text-sm font-medium text-white">{log.summary}</p>
                  <p className="text-xs font-mono tabular-nums text-sky-200/60 mt-0.5">
                    {log.action} · {log.targetType}/{log.targetId} · {log.adminEmail}
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

      {/* MODAL 1: Inspect Member's Monthly Eligible Transactions & Reverse Earning */}
      {inspectedLedgerMember && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !busyAction && setInspectedLedgerMember(null)}
        >
          <div
            className="w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-white/15 p-5 sm:p-6 max-h-[90dvh] overflow-y-auto space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/10">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white">
                  Rank #{inspectedLedgerMember.rank} · {inspectedLedgerMember.displayName} (
                  {inspectedLedgerMember.memberId})
                </h3>
                <p className="text-xs text-sky-200/70 font-mono tabular-nums mt-0.5">
                  {bounds.monthLabel} Eligible Total:{' '}
                  {formatBdt(inspectedLedgerMember.eligibleEarnings)} across{' '}
                  {inspectedLedgerMember.approvedTaskCount} approved tasks
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedLedgerMember(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-sky-200/75 hover:text-white rounded-xl"
                aria-label="Close member monthly ledger modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isFinalized && (
              <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-400/35 text-xs text-amber-100 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                <span>
                  This month is already finalized. Reversing an earning here will also update the
                  finalized Best 10 winners snapshot and record an audit entry.
                </span>
              </div>
            )}

            <div className="divide-y divide-white/10 rounded-xl bg-[#070E20] border border-white/10">
              {inspectedLedgerMember.transactions.map((tx) => {
                const isSelected = reversingTx?.transactionId === tx.transactionId;
                return (
                  <div key={tx.transactionId} className="p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-white">
                          {tx.description}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-sky-200/60 mt-0.5">
                          {tx.transactionId} · {formatDhakaDateTime(tx.approvedAt || tx.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono tabular-nums font-bold text-sm text-emerald-400">
                          +{formatBdt(tx.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setReversingTx(isSelected ? null : tx);
                            setReversalReason('');
                          }}
                          className="min-h-[36px] px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-xs font-semibold text-rose-200 inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{isSelected ? 'Cancel' : 'Reverse Earning'}</span>
                        </button>
                      </div>
                    </div>

                    {isSelected && (
                      <form
                        onSubmit={handleReverseEarning}
                        className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/30 space-y-3"
                      >
                        <p className="text-xs text-rose-100 leading-relaxed">
                          Confirm reversal: Deducts{' '}
                          <span className="font-mono font-bold">{formatBdt(tx.amount)}</span> from{' '}
                          {inspectedLedgerMember.memberId}&apos;s available wallet balance, excludes
                          this task from Best 10, notifies the member, and logs an audit record.
                        </p>
                        <input
                          type="text"
                          required
                          minLength={5}
                          maxLength={300}
                          value={reversalReason}
                          onChange={(e) => setReversalReason(e.target.value)}
                          placeholder="Mandatory reason for reversing this earning (min 5 chars)..."
                          className="w-full min-h-[42px] px-3 rounded-lg bg-[#060C1D] border border-white/15 text-xs sm:text-sm text-white"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setReversingTx(null)}
                            className="min-h-[38px] px-3.5 rounded-lg bg-white/10 text-xs font-medium text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={busyAction === `reverse_${tx.transactionId}`}
                            className="min-h-[38px] px-4 rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-60 text-slate-950 text-xs font-semibold"
                          >
                            {busyAction === `reverse_${tx.transactionId}`
                              ? 'Reversing...'
                              : `Confirm Reverse ${formatBdt(tx.amount)}`}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Finalize Month Confirmation */}
      {finalizeModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !busyAction && setFinalizeModalOpen(false)}
        >
          <form
            onSubmit={handleFinalizeMonth}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-amber-400/35 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 text-amber-300">
              <Lock className="w-5 h-5 shrink-0" />
              <h3 className="text-lg font-bold text-white">
                {isFinalized
                  ? `Re-Finalize ${bounds.monthLabel} Snapshot`
                  : `Finalize ${bounds.monthLabel} Best 10`}
              </h3>
            </div>

            <p className="text-xs sm:text-sm text-sky-200/80 leading-relaxed">
              This will reconcile all verified wallet transactions for{' '}
              <span className="font-semibold text-white">{bounds.monthLabel}</span> and lock{' '}
              <span className="font-mono font-bold text-teal-300">
                {computedLedger.top10.length}
              </span>{' '}
              Top 10 winner records into the permanent monthly archive.
            </p>

            <div>
              <label className="block text-xs text-sky-200/80 mb-1">
                {isFinalized
                  ? 'Reason for Re-Finalizing Archived Month (Required)'
                  : 'Admin Audit Note (Optional)'}
              </label>
              <input
                type="text"
                required={isFinalized}
                minLength={isFinalized ? 3 : undefined}
                maxLength={300}
                value={finalizeNote}
                onChange={(e) => setFinalizeNote(e.target.value)}
                placeholder={
                  isFinalized
                    ? 'Explain why the finalized snapshot is being refreshed...'
                    : 'Optional month-end finalization note...'
                }
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={busyAction === 'finalize'}
                onClick={() => setFinalizeModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-white/8 hover:bg-white/12 text-xs sm:text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction === 'finalize'}
                className="min-h-[44px] px-4 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 text-xs sm:text-sm font-semibold"
              >
                {busyAction === 'finalize' ? 'Finalizing...' : 'Confirm & Lock Winners'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: Recalculate Finalized Month Override Confirmation */}
      {recalcModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !busyAction && setRecalcModalOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void executeRecalculate(true, recalcReason);
            }}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-rose-400/35 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 text-rose-300">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-lg font-bold text-white">
                Recalculate Finalized Month ({bounds.monthLabel})
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-sky-200/80 leading-relaxed">
              {bounds.monthLabel} is already finalized. Recalculating will recompute rankings from
              the wallet ledger and update archived winners if any earnings changed.
            </p>
            <div>
              <label className="block text-xs text-sky-200/80 mb-1">
                Mandatory Audit Reason (min 5 characters)
              </label>
              <input
                type="text"
                required
                minLength={5}
                maxLength={300}
                value={recalcReason}
                onChange={(e) => setRecalcReason(e.target.value)}
                placeholder="Reason for recalculating finalized month..."
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busyAction === 'recalculate'}
                onClick={() => setRecalcModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-white/8 text-xs sm:text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction === 'recalculate'}
                className="min-h-[44px] px-4 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-60 text-slate-950 text-xs sm:text-sm font-semibold"
              >
                {busyAction === 'recalculate' ? 'Recalculating...' : 'Confirm Recalculate'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 4: Confirm Editing Rewards on Finalized Month */}
      {rewardConfirmModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !busyAction && setRewardConfirmModalOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void executeSaveRewards(true, rewardEditReason);
            }}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-amber-400/35 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white">
              Update Finalized Month Rewards ({bounds.monthLabel})
            </h3>
            <p className="text-xs sm:text-sm text-sky-200/80 leading-relaxed">
              This month is finalized. Confirming will update the reward configuration and sync the
              prize titles/values on the archived winners for {bounds.monthLabel}.
            </p>
            <div>
              <label className="block text-xs text-sky-200/80 mb-1">
                Audit Reason (Required)
              </label>
              <input
                type="text"
                required
                minLength={3}
                maxLength={300}
                value={rewardEditReason}
                onChange={(e) => setRewardEditReason(e.target.value)}
                placeholder="Reason for updating finalized rewards..."
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRewardConfirmModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-white/8 text-xs sm:text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction === 'save_rewards'}
                className="min-h-[44px] px-4 rounded-xl bg-teal-500 text-slate-950 text-xs sm:text-sm font-semibold"
              >
                {busyAction === 'save_rewards' ? 'Saving...' : 'Confirm Update'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 5: Update Winner Reward Delivery Status */}
      {editingWinner && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !busyAction && setEditingWinner(null)}
        >
          <form
            onSubmit={handleSaveWinnerStatus}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-teal-400/35 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Rank #{editingWinner.rank} · {editingWinner.displayName}
                </h3>
                <p className="text-xs text-sky-200/70 mt-0.5">
                  {editingWinner.prizeTitle || 'Monthly Best 10 Winner'} ·{' '}
                  {formatBdt(editingWinner.eligibleEarnings)} earned
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingWinner(null)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center text-sky-200/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                Reward Delivery Status
              </label>
              <select
                value={winStatusDraft}
                onChange={(e) => setWinStatusDraft(e.target.value as LeaderboardRewardStatus)}
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white"
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="awarded">Awarded (Delivered)</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {(winStatusDraft === 'awarded' || winStatusDraft === 'approved') && (
              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                  Delivery / Approval Date
                </label>
                <input
                  type="date"
                  value={winDeliveredAtDraft}
                  onChange={(e) => setWinDeliveredAtDraft(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                Private Admin Delivery Note (Hidden from Public Leaderboard)
              </label>
              <textarea
                rows={3}
                maxLength={1000}
                value={winAdminNoteDraft}
                onChange={(e) => setWinAdminNoteDraft(e.target.value)}
                placeholder="bKash/Nagad payout TrxID, courier details, or internal fulfillment note..."
                className="w-full p-3 rounded-xl bg-[#070E20] border border-white/15 text-xs sm:text-sm text-white"
              />
            </div>

            {winStatusDraft === 'awarded' && editingWinner.rewardStatus !== 'awarded' && (
              <label className="flex items-center gap-2.5 text-xs text-sky-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={winNotifyMember}
                  onChange={(e) => setWinNotifyMember(e.target.checked)}
                  className="w-4 h-4 accent-teal-400"
                />
                <span>Send congratulatory reward delivery notification to winner</span>
              </label>
            )}

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setEditingWinner(null)}
                className="min-h-[44px] px-4 rounded-xl bg-white/8 text-xs sm:text-sm font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction === `winner_${editingWinner.winnerId}`}
                className="min-h-[44px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {busyAction === `winner_${editingWinner.winnerId}` ? 'Saving...' : 'Save Status'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
