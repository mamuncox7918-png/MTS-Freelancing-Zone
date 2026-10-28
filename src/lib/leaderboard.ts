import type {
  LeaderboardRankRewardConfig,
  MonthlyMemberEarning,
  UserProfile,
  WalletTransaction,
} from '../types';

/**
 * Bangladesh Standard Time (Asia/Dhaka) fixed offset: UTC+06:00.
 * Bangladesh does not observe Daylight Saving Time, so UTC+6 is invariant across all months/years.
 */
export const DHAKA_UTC_OFFSET_MS = 6 * 60 * 60 * 1000;
export const MONTH_KEY_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
export const VALID_FIRESTORE_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeFirestoreId(val: unknown, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (trimmed.length >= 1 && trimmed.length <= 128 && VALID_FIRESTORE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export function sanitizeMemberCode(val: unknown, fallback = 'MTS-000000'): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim().slice(0, 20);
  return trimmed.length >= 6 ? trimmed : fallback;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface DhakaMonthBounds {
  monthKey: string;
  year: number;
  monthNumber: number; // 1..12
  daysInMonth: number; // 28, 29, 30, or 31
  startMs: number; // 1st day 00:00:00.000+06:00
  endMs: number; // Last day 23:59:59.999+06:00
  nextResetMs: number; // Next month 1st day 00:00:00.000+06:00
  monthLabel: string; // e.g., "October 2026"
  nextResetLabel: string; // e.g., "Nov 1, 2026 · 12:00 AM BST"
}

export function extractTimestampMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : 0;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof ts === 'object') {
    const candidate = ts as {
      toMillis?: () => number;
      seconds?: number;
      __rawTimestamp?: string;
    };
    if (typeof candidate.toMillis === 'function') {
      return candidate.toMillis();
    }
    if (typeof candidate.seconds === 'number') {
      return candidate.seconds * 1000;
    }
    if (typeof candidate.__rawTimestamp === 'string') {
      const parsed = Date.parse(candidate.__rawTimestamp);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
  }
  return 0;
}

/**
 * Returns the YYYY-MM month key in Asia/Dhaka (UTC+6) for any epoch millisecond timestamp.
 */
export function getDhakaMonthKey(epochMs: number = Date.now()): string {
  const shifted = new Date(epochMs + DHAKA_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function isValidMonthKey(monthKey: unknown): monthKey is string {
  return typeof monthKey === 'string' && MONTH_KEY_REGEX.test(monthKey);
}

/**
 * Computes exact Asia/Dhaka (UTC+6) calendar-month boundaries, automatically handling
 * 28, 29, 30, and 31-day months and December -> January year rollovers.
 */
export function getDhakaMonthBounds(monthKey: string): DhakaMonthBounds {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`Invalid month key "${monthKey}". Expected YYYY-MM.`);
  }
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthNumber = Number(monthStr); // 1..12
  const monthIndex = monthNumber - 1; // 0..11

  const startMs = Date.UTC(year, monthIndex, 1, 0, 0, 0, 0) - DHAKA_UTC_OFFSET_MS;
  const nextResetMs = Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0) - DHAKA_UTC_OFFSET_MS;
  const endMs = nextResetMs - 1;

  // Exact day count in this calendar month (28, 29, 30, or 31)
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const nextShifted = new Date(nextResetMs + DHAKA_UTC_OFFSET_MS);
  const nextYear = nextShifted.getUTCFullYear();
  const nextMonthShort = SHORT_MONTH_NAMES[nextShifted.getUTCMonth()];

  return {
    monthKey,
    year,
    monthNumber,
    daysInMonth,
    startMs,
    endMs,
    nextResetMs,
    monthLabel: `${MONTH_NAMES[monthIndex]} ${year}`,
    nextResetLabel: `${nextMonthShort} 1, ${nextYear} · 12:00 AM BST`,
  };
}

/**
 * Returns recent YYYY-MM month keys in Asia/Dhaka (current month + N previous months).
 */
export function getRecentDhakaMonthKeys(count = 6, nowMs: number = Date.now()): string[] {
  const shifted = new Date(nowMs + DHAKA_UTC_OFFSET_MS);
  const baseYear = shifted.getUTCFullYear();
  const baseMonthIndex = shifted.getUTCMonth();
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(baseYear, baseMonthIndex - i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    keys.push(`${y}-${m}`);
  }
  return keys;
}

export function formatDhakaDateTime(ts: unknown): string {
  const ms = extractTimestampMs(ts);
  if (!ms) return '—';
  const shifted = new Date(ms + DHAKA_UTC_OFFSET_MS);
  const month = SHORT_MONTH_NAMES[shifted.getUTCMonth()];
  const day = shifted.getUTCDate();
  const year = shifted.getUTCFullYear();
  const rawHours = shifted.getUTCHours();
  const ampm = rawHours >= 12 ? 'PM' : 'AM';
  const hours12 = rawHours % 12 || 12;
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day}, ${year}, ${hours12}:${minutes} ${ampm} BST`;
}

export function buildMonthlyEntryId(monthKey: string, userId: string): string {
  return `${monthKey}_${userId}`;
}

export function buildWinnerDocId(monthKey: string, rank: number): string {
  return `${monthKey}_${String(rank).padStart(2, '0')}`;
}

export function createEmptyRewardConfigs(): LeaderboardRankRewardConfig[] {
  return Array.from({ length: 10 }, (_, idx) => ({
    rank: idx + 1,
    prizeTitle: '',
    prizeDescription: '',
    monetaryValue: 0,
    enabled: false,
  }));
}

export function normalizeRewardConfigs(raw: unknown): LeaderboardRankRewardConfig[] {
  const defaults = createEmptyRewardConfigs();
  if (!Array.isArray(raw)) return defaults;

  return defaults.map((fallback) => {
    const match = raw.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        Number((item as Record<string, unknown>).rank) === fallback.rank
    ) as Record<string, unknown> | undefined;
    if (!match) return fallback;

    const prizeTitle =
      typeof match.prizeTitle === 'string' ? match.prizeTitle.trim().slice(0, 160) : '';
    const prizeDescription =
      typeof match.prizeDescription === 'string' ? match.prizeDescription.trim().slice(0, 500) : '';
    const rawVal = Number(match.monetaryValue || 0);
    const monetaryValue =
      Number.isFinite(rawVal) && rawVal >= 0 ? Math.min(10000000, Math.round(rawVal)) : 0;
    const enabled = Boolean(match.enabled) && prizeTitle.length > 0;

    return {
      rank: fallback.rank,
      prizeTitle,
      prizeDescription,
      monetaryValue,
      enabled,
    };
  });
}

/**
 * Deterministic Tie-Breaking & Ranking Comparator:
 * 1. Higher monthly eligible earnings (BDT) ranks higher (descending).
 * 2. Tie-breaker #1: Earlier timestamp (`reachedAtMs`) at which the member reached their final
 *    monthly eligible total ranks higher (ascending).
 * 3. Tie-breaker #2: Deterministic lexical `userId` comparison (ascending).
 */
export function compareLeaderboardEntries(
  a: Pick<MonthlyMemberEarning, 'userId' | 'eligibleEarnings' | 'reachedAtMs'>,
  b: Pick<MonthlyMemberEarning, 'userId' | 'eligibleEarnings' | 'reachedAtMs'>
): number {
  if (b.eligibleEarnings !== a.eligibleEarnings) {
    return b.eligibleEarnings - a.eligibleEarnings;
  }
  const aReached = a.reachedAtMs > 0 ? a.reachedAtMs : Number.MAX_SAFE_INTEGER;
  const bReached = b.reachedAtMs > 0 ? b.reachedAtMs : Number.MAX_SAFE_INTEGER;
  if (aReached !== bReached) {
    return aReached - bReached;
  }
  return a.userId.localeCompare(b.userId);
}

export interface RankedLeaderboardRow extends MonthlyMemberEarning {
  rank: number;
}

export function rankMonthlyMemberEarnings(
  entries: MonthlyMemberEarning[],
  limit?: number
): RankedLeaderboardRow[] {
  const valid = entries.filter(
    (e) =>
      e.isEligibleMember === true &&
      Number.isFinite(e.eligibleEarnings) &&
      e.eligibleEarnings > 0
  );
  valid.sort(compareLeaderboardEntries);
  const sliced = typeof limit === 'number' ? valid.slice(0, limit) : valid;
  return sliced.map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));
}

export interface ComputedMemberMonthlyLedger {
  userId: string;
  memberId: string;
  displayName: string;
  photoAssetId: string;
  isEligibleMember: boolean;
  eligibleEarnings: number;
  approvedTaskCount: number;
  reachedAtMs: number;
  lastTransactionId: string;
  lastSubmissionId: string;
  transactions: WalletTransaction[];
}

/**
 * Authoritative Ranking Calculation from Wallet Transactions & User Profiles:
 * - Includes ONLY `task_reward` and `custom_task_reward` credits with `amount > 0` recorded
 *   inside the target Asia/Dhaka calendar month `[startMs, endMs]`.
 * - Excludes pending/rejected work, withdrawals, withdrawal refunds, and any credit whose
 *   `referenceId` has an `earning_reversal` record.
 * - Deduplicates by both `transactionId` and `${type}:${referenceId}` so each approved task
 *   submission can only ever be counted once.
 * - Filters strictly to approved eligible members (`role === 'member' && status === 'approved'`).
 */
export function computeMonthlyLeaderboardFromTransactions(
  monthKey: string,
  transactions: WalletTransaction[],
  users: Pick<
    UserProfile,
    'uid' | 'memberId' | 'fullName' | 'photoAssetId' | 'role' | 'status'
  >[]
): {
  bounds: DhakaMonthBounds;
  allMemberStats: ComputedMemberMonthlyLedger[];
  rankedAll: (ComputedMemberMonthlyLedger & { rank: number })[];
  top10: (ComputedMemberMonthlyLedger & { rank: number })[];
  reversedReferenceIds: Set<string>;
} {
  const bounds = getDhakaMonthBounds(monthKey);

  const userMap = new Map<
    string,
    Pick<UserProfile, 'uid' | 'memberId' | 'fullName' | 'photoAssetId' | 'role' | 'status'>
  >();
  for (const u of users) {
    if (u && sanitizeFirestoreId(u.uid)) {
      const cleanUid = u.uid.trim();
      if (buildMonthlyEntryId(monthKey, cleanUid).length <= 128) {
        userMap.set(cleanUid, u);
      }
    }
  }

  // 1. Identify any reversed/invalidated submission referenceIds
  const reversedReferenceIds = new Set<string>();
  for (const tx of transactions) {
    if (tx.type === 'earning_reversal' && tx.referenceId) {
      reversedReferenceIds.add(tx.referenceId);
    }
  }

  // 2. Collect deduplicated eligible credit transactions within [bounds.startMs, bounds.endMs]
  const seenTxIds = new Set<string>();
  const seenRefKeys = new Set<string>();

  interface NormalizedEligibleTx {
    tx: WalletTransaction;
    effectiveMs: number;
    amount: number;
  }

  const perUserTxs = new Map<string, NormalizedEligibleTx[]>();

  for (const tx of transactions) {
    if (!tx || !tx.transactionId || !tx.userId || !tx.referenceId) continue;
    if (tx.type !== 'task_reward' && tx.type !== 'custom_task_reward') continue;
    if (tx.direction !== 'credit') continue;

    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    // Exclude reversed/invalidated earnings
    const subRef = tx.submissionId || tx.referenceId;
    if (reversedReferenceIds.has(tx.referenceId) || reversedReferenceIds.has(subRef)) {
      continue;
    }

    // Deduplicate so simultaneous or retried writes never count twice
    if (seenTxIds.has(tx.transactionId)) continue;
    const refKey = `${tx.type}:${subRef}`;
    if (seenRefKeys.has(refKey)) continue;

    const effectiveMs = extractTimestampMs(tx.approvedAt) || extractTimestampMs(tx.createdAt);
    if (effectiveMs < bounds.startMs || effectiveMs > bounds.endMs) {
      continue;
    }

    const owner = userMap.get(tx.userId);
    if (!owner || owner.role !== 'member' || owner.status !== 'approved') {
      continue;
    }

    seenTxIds.add(tx.transactionId);
    seenRefKeys.add(refKey);

    const list = perUserTxs.get(tx.userId) || [];
    list.push({ tx, effectiveMs, amount });
    perUserTxs.set(tx.userId, list);
  }

  const allMemberStats: ComputedMemberMonthlyLedger[] = [];

  for (const [userId, items] of perUserTxs.entries()) {
    const owner = userMap.get(userId);
    if (!owner) continue;

    // Sort chronologically so reachedAtMs is deterministically the exact instant the final sum was reached
    items.sort((a, b) =>
      a.effectiveMs !== b.effectiveMs
        ? a.effectiveMs - b.effectiveMs
        : a.tx.transactionId.localeCompare(b.tx.transactionId)
    );

    let total = 0;
    let reachedAtMs = 0;
    let lastTxId = 'admin_sync';
    let lastSubId = '';

    for (const item of items) {
      total += item.amount;
      reachedAtMs = item.effectiveMs;
      lastTxId = item.tx.transactionId;
      lastSubId = item.tx.submissionId || item.tx.referenceId;
    }

    if (total > 0) {
      const safeMemberId = sanitizeMemberCode(owner.memberId);
      const safeDisplayName =
        (typeof owner.fullName === 'string' ? owner.fullName.trim() : '').slice(0, 300) ||
        safeMemberId;
      const safePhotoAssetId = sanitizeFirestoreId(owner.photoAssetId, '');
      const safeEarnings = Math.min(100000000, Math.max(0, Math.round(total * 100) / 100));
      const safeTaskCount = Math.min(1000000, Math.max(1, items.length));
      const safeReachedAtMs = Math.max(
        0,
        Math.floor(Number.isFinite(reachedAtMs) ? reachedAtMs : 0)
      );

      if (safeEarnings > 0) {
        allMemberStats.push({
          userId,
          memberId: safeMemberId,
          displayName: safeDisplayName,
          photoAssetId: safePhotoAssetId,
          isEligibleMember: true,
          eligibleEarnings: safeEarnings,
          approvedTaskCount: safeTaskCount,
          reachedAtMs: safeReachedAtMs,
          lastTransactionId: sanitizeFirestoreId(lastTxId, 'admin_sync'),
          lastSubmissionId: sanitizeFirestoreId(lastSubId, ''),
          transactions: items.map((i) => i.tx),
        });
      }
    }
  }

  allMemberStats.sort(compareLeaderboardEntries);

  const rankedAll = allMemberStats.map((row, idx) => ({
    ...row,
    rank: idx + 1,
  }));

  return {
    bounds,
    allMemberStats,
    rankedAll,
    top10: rankedAll.slice(0, 10),
    reversedReferenceIds,
  };
}

export interface UnreversedRewardSummary {
  rewards: WalletTransaction[];
  allRewards: WalletTransaction[];
  officialRewards: WalletTransaction[];
  customRewards: WalletTransaction[];
  completedTaskIds: Set<string>;
  completedTaskCodes: Set<string>;
  reversedReferenceIds: Set<string>;
}

/**
 * Extracts deduplicated, unreversed `task_reward` and `custom_task_reward` credit transactions,
 * along with the sets of completed official `taskId`s and `taskCode`s (including regex fallback
 * for historical `TSK-XXXXX` / `CTK-XXXXX` descriptions) so approved task submissions never
 * need to remain stored in `submissions` or `customTasks`.
 */
export function getUnreversedRewardTransactions(
  transactions: WalletTransaction[]
): UnreversedRewardSummary {
  const reversedReferenceIds = new Set<string>();
  for (const tx of transactions) {
    if (tx && tx.type === 'earning_reversal' && tx.referenceId) {
      reversedReferenceIds.add(tx.referenceId);
    }
  }

  const seenTxIds = new Set<string>();
  const seenRefKeys = new Set<string>();
  const rewards: WalletTransaction[] = [];
  const completedTaskIds = new Set<string>();
  const completedTaskCodes = new Set<string>();

  for (const tx of transactions) {
    if (!tx || !tx.transactionId || !tx.userId || !tx.referenceId) continue;
    if (tx.type !== 'task_reward' && tx.type !== 'custom_task_reward') continue;
    if (tx.direction !== 'credit') continue;

    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const subRef = tx.submissionId || tx.referenceId;
    if (reversedReferenceIds.has(tx.referenceId) || reversedReferenceIds.has(subRef)) {
      continue;
    }

    if (seenTxIds.has(tx.transactionId)) continue;
    const refKey = `${tx.type}:${subRef}`;
    if (seenRefKeys.has(refKey)) continue;

    seenTxIds.add(tx.transactionId);
    seenRefKeys.add(refKey);
    rewards.push(tx);

    if (tx.type === 'task_reward') {
      if (tx.taskId) {
        completedTaskIds.add(tx.taskId);
      }
      if (tx.taskCode) {
        completedTaskCodes.add(tx.taskCode);
      } else if (tx.description) {
        const match = tx.description.match(/\b(TSK-\d{4,6})\b/);
        if (match && match[1]) {
          completedTaskCodes.add(match[1]);
        }
      }
    }
  }

  rewards.sort((a, b) => {
    const bMs = extractTimestampMs(b.approvedAt) || extractTimestampMs(b.createdAt);
    const aMs = extractTimestampMs(a.approvedAt) || extractTimestampMs(a.createdAt);
    return bMs - aMs;
  });

  const officialRewards = rewards.filter((tx) => tx.type === 'task_reward');
  const customRewards = rewards.filter((tx) => tx.type === 'custom_task_reward');

  return {
    rewards,
    allRewards: rewards,
    officialRewards,
    customRewards,
    completedTaskIds,
    completedTaskCodes,
    reversedReferenceIds,
  };
}

