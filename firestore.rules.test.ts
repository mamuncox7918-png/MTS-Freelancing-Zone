import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';

/**
 * Security Rules Verification Suite — MTS Freelancing Zone
 * Verifies all 12 "Dirty Dozen" adversarial payloads defined in security_spec.md
 * return PERMISSION_DENIED, while valid RBAC (Main Admin, Assistant Admin, Approved Member)
 * and atomic single-credit wallet transactions succeed.
 */
export async function runFirestoreRulesAudit(emulatorHost = '127.0.0.1', emulatorPort = 8080) {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'mts-freelancing-zone-audit',
    firestore: {
      host: emulatorHost,
      port: emulatorPort,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      const now = new Date();
      await setDoc(doc(adminDb, 'assistantAdmins', 'assistant_1'), {
        uid: 'assistant_1',
        memberId: 'MTS-900001',
        fullName: 'Assistant Reviewer One',
        email: 'assistant1@example.com',
        createdBy: 'admin_1',
        createdAt: now,
      });
      await setDoc(doc(adminDb, 'users', 'assistant_1'), {
        uid: 'assistant_1',
        memberId: 'MTS-900001',
        fullName: 'Assistant Reviewer One',
        email: 'assistant1@example.com',
        phone: '01711111111',
        authProvider: 'password',
        photoAssetId: '',
        role: 'assistant_admin',
        status: 'approved',
        rejectionReason: '',
        completedTasksCount: 0,
        pendingSubmissionsCount: 0,
        totalEarnings: 0,
        lastPasswordChangedAt: '',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'users', 'member_1'), {
        uid: 'member_1',
        memberId: 'MTS-100001',
        fullName: 'Approved Member One',
        email: 'm1@example.com',
        phone: '01712345678',
        authProvider: 'password',
        photoAssetId: '',
        role: 'member',
        status: 'approved',
        rejectionReason: '',
        completedTasksCount: 0,
        pendingSubmissionsCount: 1,
        totalEarnings: 200,
        lastPasswordChangedAt: '',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'wallets', 'member_1'), {
        userId: 'member_1',
        memberId: 'MTS-100001',
        availableBalance: 200,
        totalEarnings: 200,
        totalWithdrawals: 0,
        totalWithdrawalFees: 0,
        reservedWithdrawals: 0,
        lastWithdrawalId: '',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'wallets', 'member_2'), {
        userId: 'member_2',
        memberId: 'MTS-100003',
        availableBalance: 500,
        totalEarnings: 500,
        totalWithdrawals: 0,
        totalWithdrawalFees: 0,
        reservedWithdrawals: 0,
        lastWithdrawalId: '',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'tasks', 'tsk_1'), {
        taskId: 'tsk_1',
        taskCode: 'TSK-10001',
        title: 'Official Channel Subscription',
        instructions: 'Subscribe and upload screenshot.',
        externalLink: 'https://example.com/task',
        rewardAmount: 20,
        isActive: true,
        createdBy: 'admin_1',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'mediaAssets', 'asset_m1'), {
        assetId: 'asset_m1',
        ownerId: 'member_1',
        purpose: 'proof',
        mimeType: 'image/webp',
        dataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
        sizeBytes: 64,
        createdAt: now,
      });
      await setDoc(doc(adminDb, 'mediaAssets', 'avatar_m1'), {
        assetId: 'avatar_m1',
        ownerId: 'member_1',
        purpose: 'avatar',
        mimeType: 'image/webp',
        dataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
        sizeBytes: 64,
        createdAt: now,
      });
      await setDoc(doc(adminDb, 'submissions', 'sub_pending_1'), {
        submissionId: 'sub_pending_1',
        taskId: 'tsk_1',
        taskCode: 'TSK-10001',
        taskTitle: 'Official Channel Subscription',
        rewardAmount: 20,
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        screenshotAssetId: 'asset_m1',
        submissionNote: 'Completed official task',
        status: 'pending',
        rejectionReason: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'submissions', 'sub_done'), {
        submissionId: 'sub_done',
        taskId: 'tsk_1',
        taskCode: 'TSK-10001',
        taskTitle: 'Official Channel Subscription',
        rewardAmount: 20,
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        screenshotAssetId: 'asset_m1',
        submissionNote: 'Done',
        status: 'approved',
        rejectionReason: '',
        reviewedBy: 'admin_1',
        reviewedAt: now.toISOString(),
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'customTasks', 'ctk_pending_1'), {
        customTaskId: 'ctk_pending_1',
        customTaskCode: 'CTK-10001',
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        taskName: 'Extra Video Editing Work',
        taskDetails: 'Edited promotional reel outside official task list.',
        requestedAmount: 150,
        approvedAmount: 0,
        screenshotAssetId: '',
        status: 'pending',
        assistantStatus: 'unreviewed',
        assistantNote: '',
        assistantReviewedBy: '',
        assistantReviewerId: '',
        assistantReviewerName: '',
        assistantReviewedAt: '',
        rejectionReason: '',
        reviewedBy: '',
        reviewerId: '',
        reviewerName: '',
        reviewedAt: '',
        transactionId: '',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'withdrawals', 'wdr_1'), {
        withdrawalId: 'wdr_1',
        transactionCode: 'WDR-100001',
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        payoutMethod: 'bKash',
        accountNumber: '01712345678',
        grossAmount: 100,
        feeAmount: 5,
        netAmount: 95,
        status: 'pending',
        adminNote: '',
        paymentReference: '',
        processedBy: '',
        processedAt: '',
        createdAt: now,
        updatedAt: now,
      });
    });

    const member1Db = testEnv.authenticatedContext('member_1', {
      email: 'm1@example.com',
      email_verified: false,
    }).firestore();

    const assistantDb = testEnv.authenticatedContext('assistant_1', {
      email: 'assistant1@example.com',
      email_verified: false,
    }).firestore();

    const attackerDb = testEnv.authenticatedContext('attacker_1', {
      email: 'attacker@example.com',
      email_verified: true,
    }).firestore();

    const spoofAdminDb = testEnv.authenticatedContext('spoof_admin', {
      email: 'mamuncox7918@gmail.com',
      email_verified: false,
    }).firestore();

    const realAdminDb = testEnv.authenticatedContext('admin_1', {
      email: 'mamuncox7918@gmail.com',
      email_verified: true,
    }).firestore();

    // Dirty Dozen #1: Self-assigned assistant_admin role during registration
    await assertFails(
      setDoc(doc(attackerDb, 'users', 'attacker_1'), {
        uid: 'attacker_1',
        memberId: 'MTS-999999',
        fullName: 'Attacker',
        email: 'attacker@example.com',
        phone: '01700000000',
        authProvider: 'password',
        photoAssetId: '',
        role: 'assistant_admin',
        status: 'approved',
        rejectionReason: '',
        completedTasksCount: 0,
        pendingSubmissionsCount: 0,
        totalEarnings: 0,
        lastPasswordChangedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #2: Assistant Admin attempting to create another Assistant Admin
    await assertFails(
      setDoc(doc(assistantDb, 'assistantAdmins', 'assistant_2'), {
        uid: 'assistant_2',
        memberId: 'MTS-900002',
        fullName: 'Unauthorized Assistant',
        email: 'assistant2@example.com',
        createdBy: 'assistant_1',
        createdAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #3: Assistant Admin attempting manual wallet balance modification
    await assertFails(
      updateDoc(doc(assistantDb, 'wallets', 'member_1'), {
        availableBalance: 99999,
        totalEarnings: 99999,
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #4: Assistant Admin attempting withdrawal approval
    await assertFails(
      updateDoc(doc(assistantDb, 'withdrawals', 'wdr_1'), {
        status: 'paid',
        paymentReference: 'TX123',
        adminNote: 'Paid by assistant',
        processedBy: 'assistant_1',
        processedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #5: Assistant Admin attempting final Custom Task payment approval
    await assertFails(
      updateDoc(doc(assistantDb, 'customTasks', 'ctk_pending_1'), {
        status: 'approved',
        approvedAmount: 150,
        rejectionReason: '',
        reviewedBy: 'assistant_1',
        reviewerId: 'MTS-900001',
        reviewerName: 'Assistant Reviewer One',
        reviewedAt: new Date().toISOString(),
        transactionId: 'tx_custom_ctk_pending_1',
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #6: Member submitting pre-approved Custom Task
    await assertFails(
      setDoc(doc(member1Db, 'customTasks', 'ctk_forged'), {
        customTaskId: 'ctk_forged',
        customTaskCode: 'CTK-99999',
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        taskName: 'Forged Custom Task',
        taskDetails: 'Attempting to pre-approve custom task.',
        requestedAmount: 5000,
        approvedAmount: 5000,
        screenshotAssetId: '',
        status: 'approved',
        assistantStatus: 'unreviewed',
        assistantNote: '',
        assistantReviewedBy: '',
        assistantReviewerId: '',
        assistantReviewerName: '',
        assistantReviewedAt: '',
        rejectionReason: '',
        reviewedBy: '',
        reviewerId: '',
        reviewerName: '',
        reviewedAt: '',
        transactionId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #7: Task rejection without required rejection reason
    await assertFails(
      updateDoc(doc(assistantDb, 'submissions', 'sub_pending_1'), {
        status: 'rejected',
        rejectionReason: '',
        reviewedBy: 'assistant_1',
        reviewerId: 'MTS-900001',
        reviewerName: 'Assistant Reviewer One',
        reviewerRole: 'assistant_admin',
        reviewAction: 'rejected',
        reviewedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #8: Duplicate approval of already-approved submission
    await assertFails(
      updateDoc(doc(realAdminDb, 'submissions', 'sub_done'), {
        status: 'approved',
        rejectionReason: '',
        reviewedBy: 'admin_1',
        reviewedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #9: Cross-member wallet read & unfiltered custom task list
    await assertFails(getDoc(doc(member1Db, 'wallets', 'member_2')));
    await assertFails(getDocs(collection(member1Db, 'customTasks')));
    await assertSucceeds(
      getDocs(query(collection(member1Db, 'customTasks'), where('userId', '==', 'member_1')))
    );

    // Dirty Dozen #10: Unverified Main Admin email spoofing
    await assertFails(
      setDoc(doc(spoofAdminDb, 'tasks', 'tsk_spoof'), {
        taskId: 'tsk_spoof',
        taskCode: 'TSK-99999',
        title: 'Spoofed Task',
        instructions: 'Malicious task creation',
        externalLink: 'https://example.com',
        rewardAmount: 500,
        isActive: true,
        createdBy: 'spoof_admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #11: Sub-minimum withdrawal (< 100 BDT)
    await assertFails(
      setDoc(doc(member1Db, 'withdrawals', 'wdr_low'), {
        withdrawalId: 'wdr_low',
        transactionCode: 'WDR-100009',
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        payoutMethod: 'bKash',
        accountNumber: '01712345678',
        grossAmount: 99,
        feeAmount: 5,
        netAmount: 94,
        status: 'pending',
        adminNote: '',
        paymentReference: '',
        processedBy: '',
        processedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #12: Shadow field injection, Best 10 leaderboard spoofing, & private proof/admin-note isolation
    await assertFails(
      updateDoc(doc(member1Db, 'users', 'member_1'), {
        fullName: 'Updated Name',
        isSuperAdmin: true,
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(member1Db, 'monthlyMemberEarnings', '2026-10_member_1'), {
        entryId: '2026-10_member_1',
        monthKey: '2026-10',
        userId: 'member_1',
        displayName: 'Approved Member One',
        photoAssetId: '',
        isEligibleMember: true,
        eligibleEarnings: 999999,
        approvedTaskCount: 50,
        reachedAtMs: Date.now(),
        lastTransactionId: 'tx_forged',
        lastSubmissionId: 'sub_forged',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(assistantDb, 'leaderboardWinners', '2026-10_01'), {
        winnerId: '2026-10_01',
        monthKey: '2026-10',
        rank: 1,
        userId: 'member_1',
        displayName: 'Approved Member One',
        photoAssetId: '',
        eligibleEarnings: 5000,
        approvedTaskCount: 10,
        reachedAtMs: Date.now(),
        prizeTitle: 'Unauthorized Winner',
        prizeDescription: '',
        monetaryValue: 1000,
        rewardStatus: 'awarded',
        deliveredAt: '2026-10-31',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(getDocs(collection(member1Db, 'leaderboardAdminNotes')));
    // Cross-member avatar GET is permitted for leaderboard rendering, whereas cross-member proof GET is denied
    await assertSucceeds(getDoc(doc(attackerDb, 'mediaAssets', 'avatar_m1')));
    await assertFails(getDoc(doc(attackerDb, 'mediaAssets', 'asset_m1')));

    // Positive Assertion A: Assistant Admin can inspect & recommend on custom task without crediting wallet
    await assertSucceeds(
      updateDoc(doc(assistantDb, 'customTasks', 'ctk_pending_1'), {
        assistantStatus: 'recommended_approve',
        assistantNote: 'Verified work details and deliverables.',
        assistantReviewedBy: 'assistant_1',
        assistantReviewerId: 'MTS-900001',
        assistantReviewerName: 'Assistant Reviewer One',
        assistantReviewedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      })
    );

    // Positive Assertion B: Assistant Admin atomic single-credit approval on official task submission
    const assistantBatch = writeBatch(assistantDb);
    const nowIso = new Date().toISOString();
    assistantBatch.update(doc(assistantDb, 'submissions', 'sub_pending_1'), {
      status: 'approved',
      rejectionReason: '',
      reviewedBy: 'assistant_1',
      reviewerId: 'MTS-900001',
      reviewerName: 'Assistant Reviewer One',
      reviewerRole: 'assistant_admin',
      reviewAction: 'approved',
      reviewedAt: nowIso,
      updatedAt: serverTimestamp(),
    });
    assistantBatch.update(doc(assistantDb, 'wallets', 'member_1'), {
      availableBalance: 220,
      totalEarnings: 220,
      lastCreditedSubmissionId: 'sub_pending_1',
      updatedAt: serverTimestamp(),
    });
    assistantBatch.update(doc(assistantDb, 'users', 'member_1'), {
      pendingSubmissionsCount: 0,
      completedTasksCount: 1,
      totalEarnings: 220,
      updatedAt: serverTimestamp(),
    });
    assistantBatch.set(doc(assistantDb, 'transactions', 'tx_reward_sub_pending_1'), {
      transactionId: 'tx_reward_sub_pending_1',
      userId: 'member_1',
      memberId: 'MTS-100001',
      type: 'task_reward',
      amount: 20,
      feeAmount: 0,
      netAmount: 20,
      direction: 'credit',
      description: 'Task reward credited for TSK-10001',
      referenceId: 'sub_pending_1',
      taskName: 'Official Channel Subscription',
      submissionId: 'sub_pending_1',
      approvedAt: nowIso,
      createdAt: serverTimestamp(),
    });
    assistantBatch.set(doc(assistantDb, 'monthlyMemberEarnings', '2026-10_member_1'), {
      entryId: '2026-10_member_1',
      monthKey: '2026-10',
      userId: 'member_1',
      displayName: 'Approved Member One',
      photoAssetId: '',
      isEligibleMember: true,
      eligibleEarnings: 20,
      approvedTaskCount: 1,
      reachedAtMs: Date.parse(nowIso),
      lastTransactionId: 'tx_reward_sub_pending_1',
      lastSubmissionId: 'sub_pending_1',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(assistantBatch.commit());
  } finally {
    await testEnv.cleanup();
  }
}
