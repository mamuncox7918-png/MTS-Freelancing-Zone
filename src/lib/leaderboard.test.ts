import assert from 'node:assert/strict';
import {
  computeMonthlyLeaderboardFromTransactions,
  getDhakaMonthBounds,
  getDhakaMonthKey,
  normalizeRewardConfigs,
  rankMonthlyMemberEarnings,
} from './leaderboard';
import type { MonthlyMemberEarning, UserProfile, WalletTransaction } from '../types';

export function runLeaderboardUnitTests() {
  // 1. Month boundaries across 28, 29, 30, and 31-day months in Asia/Dhaka (UTC+6)
  const feb28 = getDhakaMonthBounds('2026-02');
  assert.equal(feb28.daysInMonth, 28);
  assert.equal(feb28.startMs, Date.parse('2026-02-01T00:00:00.000+06:00'));
  assert.equal(feb28.endMs, Date.parse('2026-02-28T23:59:59.999+06:00'));
  assert.equal(feb28.nextResetMs, Date.parse('2026-03-01T00:00:00.000+06:00'));

  const feb29Leap = getDhakaMonthBounds('2028-02');
  assert.equal(feb29Leap.daysInMonth, 29);
  assert.equal(feb29Leap.endMs, Date.parse('2028-02-29T23:59:59.999+06:00'));

  const apr30 = getDhakaMonthBounds('2026-04');
  assert.equal(apr30.daysInMonth, 30);
  assert.equal(apr30.endMs, Date.parse('2026-04-30T23:59:59.999+06:00'));

  const dec31 = getDhakaMonthBounds('2026-12');
  assert.equal(dec31.daysInMonth, 31);
  assert.equal(dec31.endMs, Date.parse('2026-12-31T23:59:59.999+06:00'));
  assert.equal(dec31.nextResetMs, Date.parse('2027-01-01T00:00:00.000+06:00'));
  assert.equal(dec31.nextResetLabel, 'Jan 1, 2027 · 12:00 AM BST');

  // Exact Asia/Dhaka midnight rollover check (18:00:00 UTC == 00:00:00+06:00 next day)
  assert.equal(getDhakaMonthKey(Date.parse('2026-10-31T23:59:59.999+06:00')), '2026-10');
  assert.equal(getDhakaMonthKey(Date.parse('2026-11-01T00:00:00.000+06:00')), '2026-11');

  // 2. Empty state when no eligible earnings exist
  const emptyRes = computeMonthlyLeaderboardFromTransactions('2026-10', [], []);
  assert.equal(emptyRes.top10.length, 0);
  assert.equal(emptyRes.allMemberStats.length, 0);

  // 3. Ranking calculation, tie-breaking, duplicate deduplication, withdrawal/non-member exclusion, and earning reversal
  const users: Pick<
    UserProfile,
    'uid' | 'memberId' | 'fullName' | 'photoAssetId' | 'role' | 'status'
  >[] = Array.from({ length: 12 }, (_, idx) => ({
    uid: `m_${String(idx + 1).padStart(2, '0')}`,
    memberId: `MTS-1000${String(idx + 1).padStart(2, '0')}`,
    fullName: `Member ${idx + 1}`,
    photoAssetId: idx % 2 === 0 ? `ava_${idx + 1}` : '',
    role: 'member',
    status: 'approved',
  }));
  users.push(
    {
      uid: 'pending_user',
      memberId: 'MTS-999001',
      fullName: 'Pending Account',
      photoAssetId: '',
      role: 'member',
      status: 'pending',
    },
    {
      uid: 'assistant_user',
      memberId: 'MTS-999002',
      fullName: 'Assistant Account',
      photoAssetId: '',
      role: 'assistant_admin',
      status: 'approved',
    }
  );

  const txs: WalletTransaction[] = [
    // Tie between m_02 and m_01 at ৳500: m_02 reached ৳500 earlier -> m_02 must rank #1, m_01 #2
    {
      transactionId: 'tx_m1_a',
      userId: 'm_01',
      memberId: 'MTS-100001',
      type: 'task_reward',
      amount: 300,
      feeAmount: 0,
      netAmount: 300,
      direction: 'credit',
      description: 'Task A',
      referenceId: 'sub_m1_a',
      submissionId: 'sub_m1_a',
      approvedAt: '2026-10-05T10:00:00.000+06:00',
      createdAt: '2026-10-05T10:00:00.000+06:00',
    },
    {
      transactionId: 'tx_m1_b',
      userId: 'm_01',
      memberId: 'MTS-100001',
      type: 'custom_task_reward',
      amount: 200,
      feeAmount: 0,
      netAmount: 200,
      direction: 'credit',
      description: 'Custom Task B',
      referenceId: 'ctk_m1_b',
      submissionId: 'ctk_m1_b',
      approvedAt: '2026-10-12T15:00:00.000+06:00',
      createdAt: '2026-10-12T15:00:00.000+06:00',
    },
    // Duplicate submission credit must be deduplicated and counted only once
    {
      transactionId: 'tx_m1_b_dup',
      userId: 'm_01',
      memberId: 'MTS-100001',
      type: 'custom_task_reward',
      amount: 200,
      feeAmount: 0,
      netAmount: 200,
      direction: 'credit',
      description: 'Duplicate Custom Task B',
      referenceId: 'ctk_m1_b',
      submissionId: 'ctk_m1_b',
      approvedAt: '2026-10-12T15:01:00.000+06:00',
      createdAt: '2026-10-12T15:01:00.000+06:00',
    },
    {
      transactionId: 'tx_m2_a',
      userId: 'm_02',
      memberId: 'MTS-100002',
      type: 'task_reward',
      amount: 500,
      feeAmount: 0,
      netAmount: 500,
      direction: 'credit',
      description: 'Task M2',
      referenceId: 'sub_m2_a',
      submissionId: 'sub_m2_a',
      approvedAt: '2026-10-10T09:00:00.000+06:00',
      createdAt: '2026-10-10T09:00:00.000+06:00',
    },
    // Withdrawal refund must NEVER count as eligible task earning
    {
      transactionId: 'tx_m2_refund',
      userId: 'm_02',
      memberId: 'MTS-100002',
      type: 'withdrawal_refund',
      amount: 100,
      feeAmount: 5,
      netAmount: 95,
      direction: 'credit',
      description: 'Refund',
      referenceId: 'wdr_1',
      createdAt: '2026-10-11T09:00:00.000+06:00',
    },
    // Previous month earning (2026-09-30 23:59:59+06:00) must be excluded from 2026-10
    {
      transactionId: 'tx_m2_prev_month',
      userId: 'm_02',
      memberId: 'MTS-100002',
      type: 'task_reward',
      amount: 900,
      feeAmount: 0,
      netAmount: 900,
      direction: 'credit',
      description: 'Prev month',
      referenceId: 'sub_prev',
      submissionId: 'sub_prev',
      approvedAt: '2026-09-30T23:59:59.000+06:00',
      createdAt: '2026-09-30T23:59:59.000+06:00',
    },
    // Pending & assistant accounts must be excluded
    {
      transactionId: 'tx_pending',
      userId: 'pending_user',
      memberId: 'MTS-999001',
      type: 'task_reward',
      amount: 1000,
      feeAmount: 0,
      netAmount: 1000,
      direction: 'credit',
      description: 'Ineligible',
      referenceId: 'sub_pend',
      approvedAt: '2026-10-05T12:00:00.000+06:00',
      createdAt: '2026-10-05T12:00:00.000+06:00',
    },
    {
      transactionId: 'tx_assistant',
      userId: 'assistant_user',
      memberId: 'MTS-999002',
      type: 'task_reward',
      amount: 1000,
      feeAmount: 0,
      netAmount: 1000,
      direction: 'credit',
      description: 'Ineligible assistant',
      referenceId: 'sub_asst',
      approvedAt: '2026-10-05T12:00:00.000+06:00',
      createdAt: '2026-10-05T12:00:00.000+06:00',
    },
  ];

  // Add earnings for m_03 .. m_12 so 12 members have valid earnings and Top 10 caps at 10
  for (let i = 3; i <= 12; i++) {
    const uid = `m_${String(i).padStart(2, '0')}`;
    txs.push({
      transactionId: `tx_${uid}`,
      userId: uid,
      memberId: `MTS-1000${String(i).padStart(2, '0')}`,
      type: 'task_reward',
      amount: (15 - i) * 20, // descending 240 .. 60
      feeAmount: 0,
      netAmount: (15 - i) * 20,
      direction: 'credit',
      description: `Task ${i}`,
      referenceId: `sub_${uid}`,
      submissionId: `sub_${uid}`,
      approvedAt: '2026-10-15T12:00:00.000+06:00',
      createdAt: '2026-10-15T12:00:00.000+06:00',
    });
  }

  const resBeforeReversal = computeMonthlyLeaderboardFromTransactions('2026-10', txs, users);
  assert.equal(resBeforeReversal.allMemberStats.length, 12);
  assert.equal(resBeforeReversal.top10.length, 10);
  assert.equal(resBeforeReversal.top10[0].userId, 'm_02'); // Reached 500 on Oct 10
  assert.equal(resBeforeReversal.top10[0].eligibleEarnings, 500);
  assert.equal(resBeforeReversal.top10[1].userId, 'm_01'); // Reached 500 on Oct 12 (dup ignored)
  assert.equal(resBeforeReversal.top10[1].eligibleEarnings, 500);

  // Now reverse m_02's ৳500 earning -> m_02 drops off and m_01 becomes Rank #1
  txs.push({
    transactionId: 'tx_reversal_sub_m2_a',
    userId: 'm_02',
    memberId: 'MTS-100002',
    type: 'earning_reversal',
    amount: 500,
    feeAmount: 0,
    netAmount: 500,
    direction: 'debit',
    description: 'Reversed invalid proof',
    referenceId: 'sub_m2_a',
    submissionId: 'sub_m2_a',
    approvedAt: '2026-10-16T10:00:00.000+06:00',
    createdAt: '2026-10-16T10:00:00.000+06:00',
  });

  const resAfterReversal = computeMonthlyLeaderboardFromTransactions('2026-10', txs, users);
  assert.equal(resAfterReversal.allMemberStats.length, 11);
  assert.equal(resAfterReversal.top10.length, 10);
  assert.equal(resAfterReversal.top10[0].userId, 'm_01');
  assert.equal(resAfterReversal.top10[0].rank, 1);

  // 4. Client projection ranker & reward config normalizer
  const entries: MonthlyMemberEarning[] = [
    {
      entryId: '2026-10_u2',
      monthKey: '2026-10',
      userId: 'u2',
      displayName: 'User Two',
      photoAssetId: '',
      isEligibleMember: true,
      eligibleEarnings: 400,
      approvedTaskCount: 2,
      reachedAtMs: 2000,
      lastTransactionId: 'tx2',
      lastSubmissionId: 's2',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      entryId: '2026-10_u1',
      monthKey: '2026-10',
      userId: 'u1',
      displayName: 'User One',
      photoAssetId: '',
      isEligibleMember: true,
      eligibleEarnings: 400,
      approvedTaskCount: 2,
      reachedAtMs: 1000,
      lastTransactionId: 'tx1',
      lastSubmissionId: 's1',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ];
  const ranked = rankMonthlyMemberEarnings(entries, 10);
  assert.equal(ranked[0].userId, 'u1');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].userId, 'u2');
  assert.equal(ranked[1].rank, 2);

  const normalizedRewards = normalizeRewardConfigs([
    { rank: 1, prizeTitle: 'Champion Bonus', prizeDescription: 'Cash', monetaryValue: 1000, enabled: true },
    { rank: 2, prizeTitle: '   ', prizeDescription: '', monetaryValue: 500, enabled: true }, // empty title auto-disables
  ]);
  assert.equal(normalizedRewards.length, 10);
  assert.equal(normalizedRewards[0].enabled, true);
  assert.equal(normalizedRewards[1].enabled, false);
}
