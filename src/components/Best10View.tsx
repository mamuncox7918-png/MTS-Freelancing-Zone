import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertCircle,
  Archive,
  Award,
  Calendar,
  Clock,
  Gift,
  Info,
  Layers,
  Medal,
  RefreshCw,
  Trophy,
} from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { formatBdt } from '../lib/api';
import {
  getDhakaMonthBounds,
  getDhakaMonthKey,
  normalizeRewardConfigs,
  rankMonthlyMemberEarnings,
} from '../lib/leaderboard';
import { AvatarDisplay } from './MediaView';
import type {
  LeaderboardPeriod,
  LeaderboardWinner,
  MemberPageTab,
  MonthlyMemberEarning,
} from '../types';

interface DisplayLeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  photoAssetId: string;
  eligibleEarnings: number;
  prizeTitle: string;
  prizeDescription: string;
  monetaryValue: number;
  rewardStatus?: string;
}

export function Best10View({
  currentUserUid,
  onNavigate,
}: {
  currentUserUid: string;
  onNavigate: (tab: MemberPageTab) => void;
}) {
  // Automatically track current calendar month in Bangladesh Standard Time (Asia/Dhaka, UTC+6)
  const [currentMonthKey, setCurrentMonthKey] = useState<string>(() => getDhakaMonthKey());
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(() => getDhakaMonthKey());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const [periods, setPeriods] = useState<LeaderboardPeriod[]>([]);
  const [periodsLoaded, setPeriodsLoaded] = useState<boolean>(false);

  const [monthEntries, setMonthEntries] = useState<MonthlyMemberEarning[]>([]);
  const [archivedWinners, setArchivedWinners] = useState<LeaderboardWinner[]>([]);
  const [dataLoading, setDataLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Automatic Dhaka midnight rollover detector (checks every 30s without network polling)
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      const nextKey = getDhakaMonthKey(current);
      setCurrentMonthKey((prevKey) => {
        if (prevKey !== nextKey) {
          setSelectedMonthKey((prevSelected) => (prevSelected === prevKey ? nextKey : prevSelected));
          return nextKey;
        }
        return prevKey;
      });
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Subscribe to leaderboardPeriods (rewards config + finalized month index)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'leaderboardPeriods'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as LeaderboardPeriod);
        list.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
        setPeriods(list);
        setPeriodsLoaded(true);
      },
      (err) => {
        setPeriodsLoaded(true);
        if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.LIST, 'leaderboardPeriods');
        } else {
          setLoadError('Unable to load leaderboard period configuration. Please try again.');
        }
      }
    );
    return () => unsub();
  }, [reloadNonce]);

  const activePeriod = useMemo(
    () => periods.find((p) => p.monthKey === selectedMonthKey) || null,
    [periods, selectedMonthKey]
  );

  const isSelectedFinalized = activePeriod?.status === 'finalized';

  // Subscribe in real time to either live monthlyMemberEarnings OR finalized leaderboardWinners
  useEffect(() => {
    setDataLoading(true);
    setLoadError(null);

    if (isSelectedFinalized) {
      const unsub = onSnapshot(
        query(collection(db, 'leaderboardWinners'), where('monthKey', '==', selectedMonthKey)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as LeaderboardWinner);
          list.sort((a, b) => a.rank - b.rank);
          setArchivedWinners(list);
          setDataLoading(false);
        },
        (err) => {
          setDataLoading(false);
          if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
            handleFirestoreError(err, OperationType.LIST, 'leaderboardWinners');
          } else {
            setLoadError('Could not load archived Best 10 results for this month.');
          }
        }
      );
      return () => unsub();
    }

    const unsub = onSnapshot(
      query(collection(db, 'monthlyMemberEarnings'), where('monthKey', '==', selectedMonthKey)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as MonthlyMemberEarning);
        setMonthEntries(list);
        setDataLoading(false);
      },
      (err) => {
        setDataLoading(false);
        if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.LIST, 'monthlyMemberEarnings');
        } else {
          setLoadError('Could not load live Best 10 rankings right now. Check your connection and retry.');
        }
      }
    );
    return () => unsub();
  }, [selectedMonthKey, isSelectedFinalized, reloadNonce]);

  const selectedBounds = useMemo(() => getDhakaMonthBounds(selectedMonthKey), [selectedMonthKey]);
  const currentBounds = useMemo(() => getDhakaMonthBounds(currentMonthKey), [currentMonthKey]);

  const finalizedMonths = useMemo(
    () => periods.filter((p) => p.status === 'finalized'),
    [periods]
  );

  const normalizedRewards = useMemo(
    () => (activePeriod ? normalizeRewardConfigs(activePeriod.rewards) : []),
    [activePeriod]
  );

  const publishedRewards = useMemo(() => {
    if (!activePeriod || !activePeriod.rewardsPublished) return [];
    return normalizedRewards.filter((r) => r.enabled && r.prizeTitle.trim().length > 0);
  }, [activePeriod, normalizedRewards]);

  const publishedRewardByRank = useMemo(() => {
    const map = new Map<
      number,
      { prizeTitle: string; prizeDescription: string; monetaryValue: number }
    >();
    for (const r of publishedRewards) {
      map.set(r.rank, {
        prizeTitle: r.prizeTitle,
        prizeDescription: r.prizeDescription,
        monetaryValue: r.monetaryValue,
      });
    }
    return map;
  }, [publishedRewards]);

  // Ranked rows (positions 1..10) + current member's own standing
  const { leaderboardRows, myStanding } = useMemo(() => {
    if (isSelectedFinalized) {
      const rows: DisplayLeaderboardRow[] = archivedWinners.slice(0, 10).map((w) => {
        const showPrize = Boolean(activePeriod?.rewardsPublished && w.prizeTitle);
        return {
          rank: w.rank,
          userId: w.userId,
          displayName: w.displayName || 'Member',
          photoAssetId: w.photoAssetId || '',
          eligibleEarnings: w.eligibleEarnings,
          prizeTitle: showPrize ? w.prizeTitle : '',
          prizeDescription: showPrize ? w.prizeDescription : '',
          monetaryValue: showPrize ? w.monetaryValue : 0,
          rewardStatus: w.rewardStatus,
        };
      });
      const mine = rows.find((r) => r.userId === currentUserUid) || null;
      return {
        leaderboardRows: rows,
        myStanding: mine
          ? { rank: mine.rank, eligibleEarnings: mine.eligibleEarnings }
          : null,
      };
    }

    const allRanked = rankMonthlyMemberEarnings(monthEntries);
    const mineFull = allRanked.find((r) => r.userId === currentUserUid) || null;
    const top10 = allRanked.slice(0, 10).map((r) => {
      const reward = publishedRewardByRank.get(r.rank);
      return {
        rank: r.rank,
        userId: r.userId,
        displayName: r.displayName || 'Member',
        photoAssetId: r.photoAssetId || '',
        eligibleEarnings: r.eligibleEarnings,
        prizeTitle: reward?.prizeTitle || '',
        prizeDescription: reward?.prizeDescription || '',
        monetaryValue: reward?.monetaryValue || 0,
      };
    });

    return {
      leaderboardRows: top10,
      myStanding: mineFull
        ? { rank: mineFull.rank, eligibleEarnings: mineFull.eligibleEarnings }
        : null,
    };
  }, [
    isSelectedFinalized,
    archivedWinners,
    activePeriod?.rewardsPublished,
    monthEntries,
    currentUserUid,
    publishedRewardByRank,
  ]);

  const timeUntilResetText = useMemo(() => {
    const diff = Math.max(0, currentBounds.nextResetMs - nowMs);
    const totalHours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days > 0) {
      return `${days}d ${hours}h remaining`;
    }
    const mins = Math.max(1, Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)));
    return `${hours}h ${mins}m remaining`;
  }, [currentBounds.nextResetMs, nowMs]);

  const topThree = useMemo(
    () => leaderboardRows.filter((r) => r.rank >= 1 && r.rank <= 3),
    [leaderboardRows]
  );
  const rankFourToTen = useMemo(
    () => leaderboardRows.filter((r) => r.rank >= 4 && r.rank <= 10),
    [leaderboardRows]
  );

  const isLoading = !periodsLoaded || dataLoading;

  const getPodiumStyle = (rank: number) => {
    if (rank === 1) {
      return {
        orderClass: 'order-1 md:order-2 md:-translate-y-2',
        cardBorder: 'border-amber-400/50 bg-gradient-to-b from-amber-500/20 via-[#0E1B3A] to-[#0B142C]',
        badgeBg: 'bg-amber-400 text-slate-950',
        accentText: 'text-amber-300',
        label: '1st Place · Champion',
        Icon: Trophy,
      };
    }
    if (rank === 2) {
      return {
        orderClass: 'order-2 md:order-1',
        cardBorder: 'border-slate-300/35 bg-gradient-to-b from-slate-300/15 via-[#0D1834] to-[#0B142C]',
        badgeBg: 'bg-slate-200 text-slate-950',
        accentText: 'text-slate-200',
        label: '2nd Place · Runner-Up',
        Icon: Medal,
      };
    }
    return {
      orderClass: 'order-3 md:order-3',
      cardBorder: 'border-orange-400/35 bg-gradient-to-b from-orange-500/15 via-[#0D1834] to-[#0B142C]',
      badgeBg: 'bg-orange-300 text-slate-950',
      accentText: 'text-orange-200',
      label: '3rd Place · Achiever',
      Icon: Award,
    };
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="rounded-3xl bg-gradient-to-br from-[#101F46] via-[#0C1734] to-[#0A1329] border border-amber-400/30 p-5 sm:p-7 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-400/15 border border-amber-400/30 text-amber-300 text-xs font-semibold">
              <Trophy className="w-3.5 h-3.5 shrink-0" />
              <span>
                {selectedBounds.monthLabel}
                {isSelectedFinalized ? ' · Finalized Archive' : ' · Live Bangladesh Time (UTC+6)'}
              </span>
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Best 10</h1>
              <p className="text-sm sm:text-base font-medium text-teal-300 mt-0.5">
                Monthly Top Earners
              </p>
            </div>

            <p className="text-xs sm:text-sm text-sky-100/85 leading-relaxed">
              Ranking is based on approved eligible earnings during this month.
            </p>
          </div>

          {/* Current Month & Next Reset Box */}
          <div className="rounded-2xl bg-[#070E20]/85 border border-white/10 p-4 sm:min-w-[270px] space-y-2.5 shrink-0">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-sky-200/70 inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-teal-300" />
                <span>Leaderboard Month</span>
              </span>
              <span className="font-mono tabular-nums font-semibold text-white">
                {selectedBounds.monthLabel}
              </span>
            </div>

            {selectedMonthKey === currentMonthKey && !isSelectedFinalized ? (
              <>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-sky-200/70 inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-300" />
                    <span>Next Reset (BST)</span>
                  </span>
                  <span className="font-mono tabular-nums font-medium text-amber-200">
                    {currentBounds.nextResetLabel}
                  </span>
                </div>
                <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-sky-200/65">
                    {currentBounds.daysInMonth}-day month (Asia/Dhaka)
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-teal-300">
                    {timeUntilResetText}
                  </span>
                </div>
              </>
            ) : (
              <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 text-xs">
                <span className="text-sky-200/70">Archive Status</span>
                <span className="font-semibold text-emerald-300">Finalized Official Results</span>
              </div>
            )}
          </div>
        </div>

        {/* Period Switcher (Current Live Month + Finalized Past Months) */}
        {finalizedMonths.length > 0 && (
          <div className="pt-4 border-t border-white/10 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-sky-200/75 inline-flex items-center gap-1.5 mr-1">
              <Archive className="w-3.5 h-3.5 text-sky-300" />
              <span>Leaderboard Period:</span>
            </span>

            <button
              type="button"
              onClick={() => setSelectedMonthKey(currentMonthKey)}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                selectedMonthKey === currentMonthKey
                  ? 'bg-teal-500 text-slate-950'
                  : 'bg-white/6 hover:bg-white/12 text-sky-100 border border-white/10'
              }`}
            >
              {currentBounds.monthLabel} (Current)
            </button>

            {finalizedMonths
              .filter((p) => p.monthKey !== currentMonthKey)
              .slice(0, 6)
              .map((p) => {
                const b = getDhakaMonthBounds(p.monthKey);
                const active = selectedMonthKey === p.monthKey;
                return (
                  <button
                    key={p.monthKey}
                    type="button"
                    onClick={() => setSelectedMonthKey(p.monthKey)}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-white/6 hover:bg-white/12 text-sky-100 border border-white/10'
                    }`}
                  >
                    {b.monthLabel} · Finalized
                  </button>
                );
              })}
          </div>
        )}
      </section>

      {/* Signed-in Member's Own Monthly Standing */}
      {!isLoading && !loadError && myStanding && (
        <div className="rounded-2xl bg-[#0D1A38] border border-teal-400/35 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/35 flex items-center justify-center font-mono tabular-nums text-sm font-bold text-teal-300 shrink-0">
              #{myStanding.rank}
            </div>
            <div>
              <p className="text-xs sm:text-sm font-semibold text-white">
                {myStanding.rank <= 10
                  ? `You are currently ranked #${myStanding.rank} in Best 10!`
                  : `Your current ${selectedBounds.monthLabel} position: #${myStanding.rank}`}
              </p>
              <p className="text-xs text-sky-200/70">
                Approved monthly eligible earnings:{' '}
                <span className="font-mono tabular-nums font-semibold text-teal-300">
                  {formatBdt(myStanding.eligibleEarnings)}
                </span>
              </p>
            </div>
          </div>

          {selectedMonthKey === currentMonthKey && !isSelectedFinalized && (
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="min-h-[42px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Complete More Tasks</span>
            </button>
          )}
        </div>
      )}

      {/* Published Monthly Rewards Showcase (Displayed ONLY when published by Admin) */}
      {publishedRewards.length > 0 && (
        <section className="rounded-2xl bg-[#0D1730]/95 border border-amber-400/30 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center text-amber-300 shrink-0">
                <Gift className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  {selectedBounds.monthLabel} Top 10 Rewards
                </h2>
                <p className="text-xs text-sky-200/70">
                  Official monthly prizes configured by Administration
                </p>
              </div>
            </div>
            {activePeriod?.announcementDate && (
              <span className="text-xs font-mono tabular-nums text-amber-200 bg-amber-400/10 border border-amber-400/25 px-3 py-1.5 rounded-lg shrink-0">
                Announcement: {activePeriod.announcementDate}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {publishedRewards.map((slot) => (
              <div
                key={slot.rank}
                className="rounded-xl bg-[#081024] border border-white/10 p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono tabular-nums font-bold text-amber-300">
                    Rank #{slot.rank}
                  </span>
                  {slot.monetaryValue > 0 && (
                    <span className="text-xs font-mono tabular-nums font-semibold text-teal-300">
                      {formatBdt(slot.monetaryValue)}
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm font-semibold text-white leading-snug">
                  {slot.prizeTitle}
                </p>
                {slot.prizeDescription && (
                  <p className="text-[11px] text-sky-200/70 leading-relaxed">
                    {slot.prizeDescription}
                  </p>
                )}
              </div>
            ))}
          </div>

          {activePeriod?.rewardNote && (
            <p className="text-xs text-sky-200/75 pt-2 border-t border-white/10 leading-relaxed">
              {activePeriod.rewardNote}
            </p>
          )}
        </section>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-8 sm:p-12 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-400/30 text-teal-300 flex items-center justify-center mx-auto animate-spin">
            <RefreshCw className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-white">Loading Best 10 Leaderboard...</p>
          <p className="text-xs text-sky-200/65">
            Verifying approved monthly task earnings for {selectedBounds.monthLabel}.
          </p>
        </div>
      )}

      {/* Error State */}
      {!isLoading && loadError && (
        <div className="rounded-2xl bg-rose-500/12 border border-rose-400/35 p-6 sm:p-8 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-300 flex items-center justify-center mx-auto">
            <AlertCircle className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-white">Unable to Load Leaderboard</p>
          <p className="text-xs text-rose-100/85 max-w-md mx-auto leading-relaxed">{loadError}</p>
          <div>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white inline-flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Loading</span>
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !loadError && leaderboardRows.length === 0 && (
        <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-8 sm:p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/30 text-amber-300 flex items-center justify-center mx-auto">
            <Trophy className="w-6 h-6" />
          </div>
          <h2 className="text-base sm:text-lg font-bold text-white">
            No Eligible Earnings Recorded Yet for {selectedBounds.monthLabel}
          </h2>
          <p className="text-xs sm:text-sm text-sky-200/70 max-w-md mx-auto leading-relaxed">
            As soon as members complete tasks and receive Admin approval during{' '}
            {selectedBounds.monthLabel}, the top 10 earners will appear here automatically in real
            time.
          </p>
          {selectedMonthKey === currentMonthKey && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className="min-h-[44px] px-5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors"
              >
                <Layers className="w-4 h-4" />
                <span>Start Earning in Available Tasks</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Top Three Podium */}
      {!isLoading && !loadError && topThree.length > 0 && (
        <section aria-label="Top three monthly earners" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm sm:text-base font-bold text-white">Top 3 Podium</h2>
            <span className="text-xs font-mono tabular-nums text-sky-200/65">
              {selectedBounds.monthLabel}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end pt-1">
            {topThree.map((entry) => {
              const style = getPodiumStyle(entry.rank);
              const PodiumIcon = style.Icon;
              const isMe = entry.userId === currentUserUid;

              return (
                <div
                  key={`${selectedMonthKey}_rank_${entry.rank}`}
                  className={`${style.orderClass} rounded-2xl border p-5 flex flex-col items-center text-center space-y-3 transition-transform ${style.cardBorder}`}
                >
                  <div className="w-full flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono tabular-nums font-bold ${style.badgeBg}`}
                    >
                      <PodiumIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>Rank #{entry.rank}</span>
                    </span>
                    {isMe && (
                      <span className="px-2 py-0.5 rounded-md bg-teal-500/20 border border-teal-400/40 text-[11px] font-semibold text-teal-200">
                        You
                      </span>
                    )}
                  </div>

                  <AvatarDisplay
                    photoAssetId={entry.photoAssetId}
                    fullName={entry.displayName}
                    sizeClass={entry.rank === 1 ? 'w-20 h-20 text-xl' : 'w-16 h-16 text-lg'}
                  />

                  <div className="min-w-0 w-full space-y-0.5">
                    <p className="text-xs font-medium text-sky-200/75">{style.label}</p>
                    <h3 className="text-base sm:text-lg font-bold text-white truncate px-2">
                      {entry.displayName}
                    </h3>
                  </div>

                  <div className="w-full rounded-xl bg-[#070E20]/80 border border-white/10 py-2.5 px-3">
                    <p className="text-[11px] text-sky-200/65">Monthly Eligible Earnings</p>
                    <p
                      className={`text-xl sm:text-2xl font-bold font-mono tabular-nums mt-0.5 ${style.accentText}`}
                    >
                      {formatBdt(entry.eligibleEarnings)}
                    </p>
                  </div>

                  {entry.prizeTitle && (
                    <div className="w-full rounded-xl bg-amber-400/10 border border-amber-400/25 px-3 py-2 text-xs text-amber-200 flex items-center justify-center gap-1.5">
                      <Gift className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                      <span className="font-medium truncate">
                        {entry.prizeTitle}
                        {entry.monetaryValue > 0 ? ` (${formatBdt(entry.monetaryValue)})` : ''}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Positions 4–10 List / Table */}
      {!isLoading && !loadError && leaderboardRows.length > 0 && (
        <section
          aria-label="Positions 4 to 10"
          className="rounded-2xl bg-[#0D1730]/95 border border-white/10 overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">Positions 4 – 10</h2>
              <p className="text-xs text-sky-200/65">
                Approved monthly task earnings in Bangladeshi Taka (৳)
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-sky-200/70">
              Showing {leaderboardRows.length} of Top 10
            </span>
          </div>

          {rankFourToTen.length === 0 ? (
            <div className="p-6 text-center text-xs sm:text-sm text-sky-200/65">
              Positions 4–10 will populate automatically as additional members earn approved task
              rewards during {selectedBounds.monthLabel}.
            </div>
          ) : (
            <div className="divide-y divide-white/8">
              {rankFourToTen.map((row) => {
                const isMe = row.userId === currentUserUid;
                return (
                  <div
                    key={`${selectedMonthKey}_rank_${row.rank}`}
                    className={`px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 ${
                      isMe ? 'bg-teal-500/[0.08]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[#081024] border border-white/12 flex items-center justify-center font-mono tabular-nums text-xs sm:text-sm font-bold text-sky-100 shrink-0">
                        #{row.rank}
                      </div>

                      <AvatarDisplay
                        photoAssetId={row.photoAssetId}
                        fullName={row.displayName}
                        sizeClass="w-10 h-10 text-xs"
                      />

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white truncate">
                            {row.displayName}
                          </p>
                          {isMe && (
                            <span className="px-2 py-0.5 rounded-md bg-teal-500/20 border border-teal-400/35 text-[10px] font-semibold text-teal-200 shrink-0">
                              You
                            </span>
                          )}
                        </div>
                        {row.prizeTitle && (
                          <p className="text-[11px] text-amber-200/90 truncate mt-0.5">
                            Prize: {row.prizeTitle}
                            {row.monetaryValue > 0 ? ` (${formatBdt(row.monetaryValue)})` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-sm sm:text-base font-bold font-mono tabular-nums text-teal-300">
                        {formatBdt(row.eligibleEarnings)}
                      </p>
                      <p className="text-[10px] text-sky-200/55">Eligible BDT</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Transparent Ranking & Tie-Breaker Rules Footer */}
      <section className="rounded-2xl bg-[#091229] border border-white/10 p-4 sm:p-5 flex items-start gap-3">
        <Info className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs text-sky-200/75 leading-relaxed">
          <p className="font-semibold text-white">Fair Ranking & Tie-Breaking Policy</p>
          <p>
            Only Admin-approved task and custom task earnings credited between the 1st day (00:00:00
            BST) and the final day (23:59:59 BST) of the calendar month count toward Best 10.
            Pending, rejected, or reversed items and wallet withdrawals do not increase rank. If two
            members have identical monthly eligible earnings, the member who reached that total
            earliest ranks higher.
          </p>
        </div>
      </section>
    </div>
  );
}
