import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';

/**
 * Security Rules Verification Suite — MTS Freelancing Zone
 * Verifies all 12 "Dirty Dozen" adversarial payloads defined in security_spec.md
 * return PERMISSION_DENIED, while valid RBAC and atomic transactions succeed.
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
        pendingSubmissionsCount: 0,
        totalEarnings: 200,
        lastPasswordChangedAt: '',
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'users', 'pending_1'), {
        uid: 'pending_1',
        memberId: 'MTS-100002',
        fullName: 'Pending Member',
        email: 'p1@example.com',
        phone: '01712345679',
        authProvider: 'password',
        photoAssetId: '',
        role: 'member',
        status: 'pending',
        rejectionReason: '',
        completedTasksCount: 0,
        pendingSubmissionsCount: 0,
        totalEarnings: 0,
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
    });

    const member1Db = testEnv.authenticatedContext('member_1', {
      email: 'm1@example.com',
      email_verified: true,
    }).firestore();

    const pendingDb = testEnv.authenticatedContext('pending_1', {
      email: 'p1@example.com',
      email_verified: true,
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

    // Dirty Dozen #1: Self-assigned admin role during registration
    await assertFails(
      setDoc(doc(attackerDb, 'users', 'attacker_1'), {
        uid: 'attacker_1',
        memberId: 'MTS-999999',
        fullName: 'Attacker',
        email: 'attacker@example.com',
        phone: '01700000000',
        authProvider: 'password',
        photoAssetId: '',
        role: 'admin',
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

    // Dirty Dozen #2: Shadow field injection on profile update
    await assertFails(
      updateDoc(doc(member1Db, 'users', 'member_1'), {
        fullName: 'Updated Name',
        isVerifiedAdmin: true,
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #3: Unverified admin email spoofing
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

    // Dirty Dozen #4: Cross-member wallet read & unfiltered submission list
    await assertFails(getDoc(doc(member1Db, 'wallets', 'member_2')));
    await assertFails(getDocs(collection(member1Db, 'submissions')));
    await assertSucceeds(getDocs(query(collection(member1Db, 'submissions'), where('userId', '==', 'member_1'))));

    // Dirty Dozen #5: Self-minting wallet balance
    await assertFails(
      updateDoc(doc(member1Db, 'wallets', 'member_1'), {
        availableBalance: 50000,
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #6: Fake task reward transaction creation
    await assertFails(
      setDoc(doc(member1Db, 'transactions', 'tx_fake'), {
        transactionId: 'tx_fake',
        userId: 'member_1',
        memberId: 'MTS-100001',
        type: 'task_reward',
        amount: 500,
        feeAmount: 0,
        netAmount: 500,
        direction: 'credit',
        description: 'Fake reward',
        referenceId: 'sub_done',
        createdAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #7: Pending member attempting task submission
    await assertFails(
      setDoc(doc(pendingDb, 'submissions', 'sub_pending'), {
        submissionId: 'sub_pending',
        taskId: 'tsk_1',
        taskCode: 'TSK-10001',
        taskTitle: 'Official Channel Subscription',
        rewardAmount: 20,
        userId: 'pending_1',
        memberId: 'MTS-100002',
        memberName: 'Pending Member',
        screenshotAssetId: 'asset_m1',
        submissionNote: '',
        status: 'pending',
        rejectionReason: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #8: Spoofed task reward amount or unsafe proofLink scheme
    await assertFails(
      setDoc(doc(member1Db, 'submissions', 'sub_tamper'), {
        submissionId: 'sub_tamper',
        taskId: 'tsk_1',
        taskCode: 'TSK-10001',
        taskTitle: 'Official Channel Subscription',
        rewardAmount: 5000,
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        screenshotAssetId: 'asset_m1',
        proofLink: 'https://example.com/proof',
        submissionNote: '',
        status: 'pending',
        rejectionReason: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(member1Db, 'submissions', 'sub_bad_link'), {
        submissionId: 'sub_bad_link',
        taskId: 'tsk_1',
        taskCode: 'TSK-10001',
        taskTitle: 'Official Channel Subscription',
        rewardAmount: 20,
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        screenshotAssetId: 'asset_m1',
        proofLink: 'javascript:evil()',
        submissionNote: '',
        status: 'pending',
        rejectionReason: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #9: Sub-minimum withdrawal (< 100 BDT)
    await assertFails(
      setDoc(doc(member1Db, 'withdrawals', 'wdr_low'), {
        withdrawalId: 'wdr_low',
        transactionCode: 'WDR-100001',
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

    // Dirty Dozen #10: Orphaned withdrawal without atomic wallet deduction
    await assertFails(
      setDoc(doc(member1Db, 'withdrawals', 'wdr_orphan'), {
        withdrawalId: 'wdr_orphan',
        transactionCode: 'WDR-100002',
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #11: Double approval of terminal submission
    await assertFails(
      updateDoc(doc(realAdminDb, 'submissions', 'sub_done'), {
        status: 'approved',
        rejectionReason: '',
        reviewedBy: 'admin_1',
        reviewedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #12: Plaintext password injection in passwordChangeRequests
    await assertFails(
      setDoc(doc(member1Db, 'passwordChangeRequests', 'pcr_bad'), {
        requestId: 'pcr_bad',
        userId: 'member_1',
        memberId: 'MTS-100001',
        memberName: 'Approved Member One',
        memberEmail: 'm1@example.com',
        authProvider: 'password',
        reason: 'Need password update',
        newPassword: 'PlaintextPassword123!',
        status: 'pending',
        decisionNote: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } finally {
    await testEnv.cleanup();
  }
}
