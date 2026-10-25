import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  FIREBASE_API_KEY,
  handleFirestoreError,
  OperationType,
} from './firebase';
import { FIXED_WITHDRAWAL_FEE, MIN_WITHDRAWAL_GROSS } from '../types';

const BD_PHONE_REGEX = /^(\+88)?01[3-9][0-9]{8}$/;
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

function randomNumericCode(prefix: string, digits: number): string {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits - 1;
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const num = min + (arr[0] % (max - min + 1));
  return `${prefix}-${num}`;
}

function randomDocId(prefix: string): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${Date.now().toString(36)}_${hex}`;
}

function wrapPermError(err: unknown, op: OperationType, path: string): never {
  if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
    handleFirestoreError(err, op, path);
  }
  throw err;
}

export async function executeClientFirestoreFallback<T = Record<string, unknown>>(
  path: string,
  method: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in to continue.');
  }

  const uid = currentUser.uid;
  const email = (currentUser.email || '').trim().toLowerCase();
  const isInitialAdmin = Boolean(currentUser.emailVerified) && email === BOOTSTRAPPED_ADMIN_EMAIL;

  // 1. POST /api/auth/register
  if (method === 'POST' && path === '/api/auth/register') {
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 100) : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const authProvider = body.authProvider === 'google.com' ? 'google.com' : 'password';

    if (fullName.length < 2) {
      throw new Error('Full name must be between 2 and 100 characters.');
    }
    if (phone.length > 25 || (phone && !BD_PHONE_REGEX.test(phone))) {
      throw new Error('Enter a valid Bangladeshi phone number (e.g., 01712345678).');
    }

    try {
      const userRef = doc(db, 'users', uid);
      const walletRef = doc(db, 'wallets', uid);
      const [userSnap, walletSnap] = await Promise.all([getDoc(userRef), getDoc(walletRef)]);

      if (userSnap.exists()) {
        const existingData = userSnap.data();
        if (isInitialAdmin && existingData.role !== 'admin') {
          const batch = writeBatch(db);
          batch.set(doc(db, 'admins', uid), {
            uid,
            email,
            createdAt: serverTimestamp(),
          });
          batch.update(userRef, {
            role: 'admin',
            status: 'approved',
            updatedAt: serverTimestamp(),
          });
          await batch.commit();
          return {
            ok: true,
            status: 'approved',
            role: 'admin',
            memberId: existingData.memberId,
            alreadyExisted: true,
          } as unknown as T;
        }
        return {
          ok: true,
          status: existingData.status,
          role: existingData.role,
          memberId: existingData.memberId,
          alreadyExisted: true,
        } as unknown as T;
      }

      const memberId = randomNumericCode('MTS', 6);
      const role = isInitialAdmin ? 'admin' : 'member';
      const status = isInitialAdmin ? 'approved' : 'pending';
      const batch = writeBatch(db);

      if (isInitialAdmin) {
        batch.set(doc(db, 'admins', uid), {
          uid,
          email,
          createdAt: serverTimestamp(),
        });
      }

      batch.set(userRef, {
        uid,
        memberId,
        fullName,
        email,
        phone,
        authProvider,
        photoAssetId: '',
        role,
        status,
        rejectionReason: '',
        completedTasksCount: 0,
        pendingSubmissionsCount: 0,
        totalEarnings: 0,
        lastPasswordChangedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (!walletSnap.exists()) {
        batch.set(walletRef, {
          userId: uid,
          memberId,
          availableBalance: 0,
          totalEarnings: 0,
          totalWithdrawals: 0,
          totalWithdrawalFees: 0,
          reservedWithdrawals: 0,
          lastWithdrawalId: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      return { ok: true, status, role, memberId, alreadyExisted: false } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.WRITE, `users/${uid}`);
    }
  }

  // 2. POST /api/media/upload
  if (method === 'POST' && path === '/api/media/upload') {
    const purpose = body.purpose;
    const mimeType = body.mimeType;
    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';

    if (purpose !== 'avatar' && purpose !== 'proof') {
      throw new Error('Invalid upload purpose.');
    }
    if (mimeType !== 'image/webp' && mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
      throw new Error('Unsupported image format. Use JPEG, PNG, or WebP.');
    }
    if (!dataUrl.startsWith(`data:${mimeType};base64,`) || dataUrl.length < 20 || dataUrl.length > 250000) {
      throw new Error('Compressed image exceeds the 200 KB security threshold.');
    }

    const base64Part = dataUrl.split(',')[1] || '';
    const sizeBytes = Math.ceil((base64Part.length * 3) / 4);
    const assetId = randomDocId(purpose === 'avatar' ? 'ava' : 'prf');

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'mediaAssets', assetId), {
        assetId,
        ownerId: uid,
        purpose,
        mimeType,
        dataUrl,
        sizeBytes,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true, assetId } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.CREATE, `mediaAssets/${assetId}`);
    }
  }

  // 3. PUT /api/profile
  if (method === 'PUT' && path === '/api/profile') {
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 100) : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 25) : '';
    const photoAssetId = typeof body.photoAssetId === 'string' ? body.photoAssetId.trim() : '';

    if (fullName.length < 2) {
      throw new Error('Full name must be at least 2 characters.');
    }
    if (phone && !BD_PHONE_REGEX.test(phone)) {
      throw new Error('Enter a valid Bangladeshi phone number (e.g., 01712345678).');
    }

    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        throw new Error('Member profile not found.');
      }
      const prevPhotoId = String(userSnap.data().photoAssetId || '');
      const batch = writeBatch(db);
      batch.update(userRef, {
        fullName,
        phone,
        photoAssetId,
        updatedAt: serverTimestamp(),
      });
      if (prevPhotoId && prevPhotoId !== photoAssetId) {
        batch.delete(doc(db, 'mediaAssets', prevPhotoId));
      }
      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `users/${uid}`);
    }
  }

  // 4. POST /api/submissions
  if (method === 'POST' && path === '/api/submissions') {
    const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
    const screenshotAssetId = typeof body.screenshotAssetId === 'string' ? body.screenshotAssetId.trim() : '';
    const rawProofLink = typeof body.proofLink === 'string' ? body.proofLink.trim().slice(0, 500) : '';
    const proofLink =
      rawProofLink && !/^https?:\/\//i.test(rawProofLink)
        ? `https://${rawProofLink}`.slice(0, 500)
        : rawProofLink;
    const submissionNote = typeof body.submissionNote === 'string' ? body.submissionNote.trim().slice(0, 500) : '';

    if (!VALID_ID_REGEX.test(taskId) || !VALID_ID_REGEX.test(screenshotAssetId)) {
      throw new Error('Please upload a proof screenshot before submitting.');
    }
    if (proofLink && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(proofLink)) {
      throw new Error('Enter a valid proof link URL (e.g., https://facebook.com/...).');
    }

    try {
      const [userSnap, taskSnap, existingSubsSnap] = await Promise.all([
        getDoc(doc(db, 'users', uid)),
        getDoc(doc(db, 'tasks', taskId)),
        getDocs(query(collection(db, 'submissions'), where('userId', '==', uid))),
      ]);

      if (!userSnap.exists() || userSnap.data().status !== 'approved') {
        throw new Error('Your account must be approved by an Admin before submitting task proof.');
      }
      if (!taskSnap.exists() || taskSnap.data().isActive !== true) {
        throw new Error('This task is no longer active.');
      }

      const duplicate = existingSubsSnap.docs.find((d) => {
        const s = d.data();
        return s.taskId === taskId && (s.status === 'pending' || s.status === 'approved');
      });
      if (duplicate) {
        throw new Error(
          duplicate.data().status === 'approved'
            ? 'You have already completed and received the reward for this task.'
            : 'You already have a proof submission pending Admin review for this task.'
        );
      }

      const profileData = userSnap.data();
      const taskData = taskSnap.data();
      const submissionId = randomDocId('sub');
      const batch = writeBatch(db);

      batch.set(doc(db, 'submissions', submissionId), {
        submissionId,
        taskId,
        taskCode: String(taskData.taskCode),
        taskTitle: String(taskData.title),
        rewardAmount: Number(taskData.rewardAmount),
        userId: uid,
        memberId: String(profileData.memberId),
        memberName: String(profileData.fullName),
        screenshotAssetId,
        proofLink,
        submissionNote,
        status: 'pending',
        rejectionReason: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.update(doc(db, 'users', uid), {
        pendingSubmissionsCount: Number(profileData.pendingSubmissionsCount || 0) + 1,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      return { ok: true, submissionId } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.CREATE, 'submissions');
    }
  }

  // 5. POST /api/withdrawals
  if (method === 'POST' && path === '/api/withdrawals') {
    const payoutMethod = body.payoutMethod;
    const accountNumber = typeof body.accountNumber === 'string' ? body.accountNumber.trim() : '';
    const grossAmount = Number(body.grossAmount);

    if (payoutMethod !== 'bKash' && payoutMethod !== 'Nagad') {
      throw new Error('Select a valid payout method (bKash or Nagad).');
    }
    if (!BD_PHONE_REGEX.test(accountNumber)) {
      throw new Error('Enter a valid 11-digit Bangladeshi bKash/Nagad number (e.g., 01712345678).');
    }
    if (!Number.isInteger(grossAmount) || grossAmount < MIN_WITHDRAWAL_GROSS) {
      throw new Error(
        `Minimum Withdraw ${MIN_WITHDRAWAL_GROSS} Tk (৳${MIN_WITHDRAWAL_GROSS}). Requests below ${MIN_WITHDRAWAL_GROSS} Tk are not allowed.`
      );
    }

    try {
      const [userSnap, walletSnap] = await Promise.all([
        getDoc(doc(db, 'users', uid)),
        getDoc(doc(db, 'wallets', uid)),
      ]);
      if (!userSnap.exists() || userSnap.data().status !== 'approved') {
        throw new Error('Only approved members can request withdrawals.');
      }
      if (!walletSnap.exists()) {
        throw new Error('Member wallet not found.');
      }

      const profileData = userSnap.data();
      const walletData = walletSnap.data();
      const avail = Number(walletData.availableBalance || 0);
      const reserved = Number(walletData.reservedWithdrawals || 0);

      if (avail < grossAmount) {
        throw new Error(`Insufficient wallet balance. Available: ৳${avail}.`);
      }

      const feeAmount = FIXED_WITHDRAWAL_FEE;
      const netAmount = grossAmount - feeAmount;
      const withdrawalId = randomDocId('wdr');
      const transactionId = randomDocId('tx');
      const transactionCode = randomNumericCode('WDR', 6);

      const batch = writeBatch(db);
      batch.update(doc(db, 'wallets', uid), {
        availableBalance: avail - grossAmount,
        reservedWithdrawals: reserved + grossAmount,
        lastWithdrawalId: withdrawalId,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'withdrawals', withdrawalId), {
        withdrawalId,
        transactionCode,
        userId: uid,
        memberId: String(profileData.memberId),
        memberName: String(profileData.fullName),
        payoutMethod,
        accountNumber,
        grossAmount,
        feeAmount,
        netAmount,
        status: 'pending',
        adminNote: '',
        paymentReference: '',
        processedBy: '',
        processedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'transactions', transactionId), {
        transactionId,
        userId: uid,
        memberId: String(profileData.memberId),
        type: 'withdrawal_request',
        amount: grossAmount,
        feeAmount,
        netAmount,
        direction: 'debit',
        description: `${payoutMethod} withdrawal requested (${transactionCode}) · Gross ৳${grossAmount}, Fee ৳${feeAmount}, Receivable ৳${netAmount}`,
        referenceId: withdrawalId,
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      return {
        ok: true,
        withdrawalId,
        transactionCode,
        grossAmount,
        feeAmount,
        netAmount,
      } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.CREATE, 'withdrawals');
    }
  }

  // 6. POST /api/password-requests
  if (method === 'POST' && path === '/api/password-requests') {
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 400) : '';
    if (reason.length < 5) {
      throw new Error('Please provide a brief security reason (at least 5 characters).');
    }

    try {
      const [userSnap, existingSnap] = await Promise.all([
        getDoc(doc(db, 'users', uid)),
        getDocs(query(collection(db, 'passwordChangeRequests'), where('userId', '==', uid))),
      ]);
      if (!userSnap.exists() || userSnap.data().status !== 'approved') {
        throw new Error('Only approved members can submit password change requests.');
      }
      const active = existingSnap.docs.find(
        (d) => d.data().status === 'pending' || d.data().status === 'approved'
      );
      if (active) {
        throw new Error('You already have an active password change request.');
      }

      const profileData = userSnap.data();
      const requestId = randomDocId('pcr');
      const batch = writeBatch(db);
      batch.set(doc(db, 'passwordChangeRequests', requestId), {
        requestId,
        userId: uid,
        memberId: String(profileData.memberId),
        memberName: String(profileData.fullName),
        memberEmail: String(profileData.email),
        authProvider: profileData.authProvider === 'google.com' ? 'google.com' : 'password',
        reason,
        status: 'pending',
        decisionNote: '',
        reviewedBy: '',
        reviewedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true, requestId } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.CREATE, 'passwordChangeRequests');
    }
  }

  // 7. POST /api/password-requests/:id/complete
  const pcrCompleteMatch = path.match(/^\/api\/password-requests\/([a-zA-Z0-9_\-]+)\/complete$/);
  if (method === 'POST' && pcrCompleteMatch) {
    const requestId = pcrCompleteMatch[1];
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'passwordChangeRequests', requestId), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', uid), {
        lastPasswordChangedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `passwordChangeRequests/${requestId}`);
    }
  }

  // 8. Admin: POST /api/admin/members/:targetUid/review
  const memberReviewMatch = path.match(/^\/api\/admin\/members\/([a-zA-Z0-9_\-]+)\/review$/);
  if (method === 'POST' && memberReviewMatch) {
    const targetUid = memberReviewMatch[1];
    const decision = body.decision;
    const rawReason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim().slice(0, 300) : '';
    const rejectionReason =
      decision === 'rejected'
        ? rawReason || 'Application did not meet verification requirements'
        : '';
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('Decision must be approved or rejected.');
    }

    try {
      const [targetSnap, walletSnap] = await Promise.all([
        getDoc(doc(db, 'users', targetUid)),
        getDoc(doc(db, 'wallets', targetUid)),
      ]);
      if (!targetSnap.exists()) throw new Error('Member registration not found.');
      const targetData = targetSnap.data();
      const logId = randomDocId('log');
      const batch = writeBatch(db);

      batch.update(doc(db, 'users', targetUid), {
        status: decision,
        rejectionReason,
        updatedAt: serverTimestamp(),
      });
      if (!walletSnap.exists()) {
        batch.set(doc(db, 'wallets', targetUid), {
          userId: targetUid,
          memberId: String(targetData.memberId),
          availableBalance: 0,
          totalEarnings: 0,
          totalWithdrawals: 0,
          totalWithdrawalFees: 0,
          reservedWithdrawals: 0,
          lastWithdrawalId: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      batch.set(doc(db, 'adminAuditLogs', logId), {
        logId,
        adminUid: uid,
        adminEmail: email,
        action: decision === 'approved' ? 'MEMBER_APPROVED' : 'MEMBER_REJECTED',
        targetType: 'user',
        targetId: targetUid,
        summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} member ${targetData.memberId} (${String(targetData.fullName || '').slice(0, 120)})`.slice(0, 450),
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  }

  // 9. Admin: POST /api/admin/tasks
  if (method === 'POST' && path === '/api/admin/tasks') {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : '';
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim().slice(0, 2000) : '';
    const externalLink = typeof body.externalLink === 'string' ? body.externalLink.trim().slice(0, 500) : '';
    const rewardAmount = Number(body.rewardAmount);
    const isActive = body.isActive !== false;

    const taskId = randomDocId('tsk');
    const taskCode = randomNumericCode('TSK', 5);
    const logId = randomDocId('log');

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'tasks', taskId), {
        taskId,
        taskCode,
        title,
        instructions,
        externalLink,
        rewardAmount,
        isActive,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'adminAuditLogs', logId), {
        logId,
        adminUid: uid,
        adminEmail: email,
        action: 'TASK_CREATED',
        targetType: 'task',
        targetId: taskId,
        summary: `Created task ${taskCode} "${title}" with reward ৳${rewardAmount}`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true, taskId, taskCode } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.CREATE, `tasks/${taskId}`);
    }
  }

  // 10. Admin: PUT /api/admin/tasks/:taskId
  const taskEditMatch = path.match(/^\/api\/admin\/tasks\/([a-zA-Z0-9_\-]+)$/);
  if (method === 'PUT' && taskEditMatch) {
    const taskId = taskEditMatch[1];
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : '';
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim().slice(0, 2000) : '';
    const externalLink = typeof body.externalLink === 'string' ? body.externalLink.trim().slice(0, 500) : '';
    const rewardAmount = Number(body.rewardAmount);
    const isActive = Boolean(body.isActive);

    try {
      const taskSnap = await getDoc(doc(db, 'tasks', taskId));
      if (!taskSnap.exists()) throw new Error('Task not found.');
      const logId = randomDocId('log');
      const batch = writeBatch(db);
      batch.update(doc(db, 'tasks', taskId), {
        title,
        instructions,
        externalLink,
        rewardAmount,
        isActive,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'adminAuditLogs', logId), {
        logId,
        adminUid: uid,
        adminEmail: email,
        action: 'TASK_UPDATED',
        targetType: 'task',
        targetId: taskId,
        summary: `Updated task ${taskSnap.data().taskCode} ("${title}", ৳${rewardAmount}, ${isActive ? 'Active' : 'Inactive'})`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `tasks/${taskId}`);
    }
  }

  // 11. Admin or Assistant Admin: POST /api/admin/submissions/:submissionId/review
  const subReviewMatch = path.match(/^\/api\/admin\/submissions\/([a-zA-Z0-9_\-]+)\/review$/);
  if (method === 'POST' && subReviewMatch) {
    const submissionId = subReviewMatch[1];
    const decision = body.decision;
    const rawReason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim().slice(0, 300) : '';
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('Decision must be approved or rejected.');
    }
    if (decision === 'rejected' && rawReason.length < 3) {
      throw new Error('Please enter a rejection reason (at least 3 characters) when rejecting a task.');
    }
    const rejectionReason = decision === 'rejected' ? rawReason : '';

    try {
      const [subSnap, callerProfileSnap, assistantSnap] = await Promise.all([
        getDoc(doc(db, 'submissions', submissionId)),
        getDoc(doc(db, 'users', uid)),
        getDoc(doc(db, 'assistantAdmins', uid)),
      ]);
      if (!subSnap.exists()) throw new Error('Submission not found.');
      const subData = subSnap.data();
      if (subData.status !== 'pending') {
        throw new Error(`Submission has already been ${subData.status}. Duplicate review blocked.`);
      }

      const callerProfile = callerProfileSnap.exists() ? callerProfileSnap.data() : null;
      const reviewerRole: 'admin' | 'assistant_admin' = isInitialAdmin
        ? 'admin'
        : assistantSnap.exists() && callerProfile?.status === 'approved'
        ? 'assistant_admin'
        : callerProfile?.role === 'admin' && Boolean(currentUser.emailVerified)
        ? 'admin'
        : (() => {
            throw new Error('Admin or Assistant Admin authorization required.');
          })();
      const reviewerId = String(
        callerProfile?.memberId || (assistantSnap.exists() ? assistantSnap.data().memberId : 'ADMIN')
      );
      const reviewerName = String(
        callerProfile?.fullName || (assistantSnap.exists() ? assistantSnap.data().fullName : 'Admin')
      );

      const memberUid = String(subData.userId);
      const memberCode = String(subData.memberId || 'MTS-000000');
      const taskTitle = String(subData.taskTitle || 'Official Task').slice(0, 400);
      const taskCode = String(subData.taskCode || 'TSK-00000');
      const rewardAmount = Number(subData.rewardAmount);
      const [memberSnap, walletSnap] = await Promise.all([
        getDoc(doc(db, 'users', memberUid)),
        getDoc(doc(db, 'wallets', memberUid)),
      ]);

      const nowIso = new Date().toISOString();
      const logId = randomDocId('log');
      const notifId = randomDocId('ntf');
      const batch = writeBatch(db);

      batch.update(doc(db, 'submissions', submissionId), {
        status: decision,
        rejectionReason,
        reviewedBy: uid,
        reviewerId,
        reviewerName,
        reviewerRole,
        reviewAction: decision,
        reviewedAt: nowIso,
        updatedAt: serverTimestamp(),
      });

      if (decision === 'approved') {
        // Deterministic ledger ID prevents duplicate wallet credits for the same submission
        const txId = `tx_reward_${submissionId}`;
        if (walletSnap.exists()) {
          const walletData = walletSnap.data();
          batch.update(doc(db, 'wallets', memberUid), {
            availableBalance: Number(walletData.availableBalance || 0) + rewardAmount,
            totalEarnings: Number(walletData.totalEarnings || 0) + rewardAmount,
            lastCreditedSubmissionId: submissionId,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'wallets', memberUid), {
            userId: memberUid,
            memberId: memberCode,
            availableBalance: rewardAmount,
            totalEarnings: rewardAmount,
            totalWithdrawals: 0,
            totalWithdrawalFees: 0,
            reservedWithdrawals: 0,
            lastWithdrawalId: '',
            lastCreditedSubmissionId: submissionId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (memberSnap.exists()) {
          const memberData = memberSnap.data();
          batch.update(doc(db, 'users', memberUid), {
            pendingSubmissionsCount: Math.max(0, Number(memberData.pendingSubmissionsCount || 0) - 1),
            completedTasksCount: Number(memberData.completedTasksCount || 0) + 1,
            totalEarnings: Number(memberData.totalEarnings || 0) + rewardAmount,
            updatedAt: serverTimestamp(),
          });
        }

        batch.set(doc(db, 'transactions', txId), {
          transactionId: txId,
          userId: memberUid,
          memberId: memberCode,
          type: 'task_reward',
          amount: rewardAmount,
          feeAmount: 0,
          netAmount: rewardAmount,
          direction: 'credit',
          description: `Task reward credited for ${taskCode} (${taskTitle.slice(0, 140)})`.slice(0, 240),
          referenceId: submissionId,
          taskName: taskTitle,
          submissionId,
          approvedAt: nowIso,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'notifications', notifId), {
          notificationId: notifId,
          userId: memberUid,
          type: 'task_approved',
          title: 'Official Task Approved',
          message: `Your proof for "${taskTitle}" (${taskCode}) was approved and ৳${rewardAmount} was credited to your wallet.`.slice(
            0,
            900
          ),
          referenceId: submissionId,
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'adminAuditLogs', logId), {
          logId,
          adminUid: uid,
          adminEmail: email || reviewerId,
          action: 'SUBMISSION_APPROVED',
          targetType: 'submission',
          targetId: submissionId,
          summary: `[${reviewerRole === 'admin' ? 'Main Admin' : 'Assistant Admin'} ${reviewerId}] Approved proof for ${taskCode} by ${memberCode} and credited ৳${rewardAmount}`.slice(
            0,
            450
          ),
          createdAt: serverTimestamp(),
        });
      } else {
        if (memberSnap.exists()) {
          const memberData = memberSnap.data();
          batch.update(doc(db, 'users', memberUid), {
            pendingSubmissionsCount: Math.max(0, Number(memberData.pendingSubmissionsCount || 0) - 1),
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(doc(db, 'notifications', notifId), {
          notificationId: notifId,
          userId: memberUid,
          type: 'task_rejected',
          title: 'Official Task Proof Rejected',
          message: `Your proof for "${taskTitle}" (${taskCode}) was rejected. Reason: ${rejectionReason}`.slice(
            0,
            900
          ),
          referenceId: submissionId,
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'adminAuditLogs', logId), {
          logId,
          adminUid: uid,
          adminEmail: email || reviewerId,
          action: 'SUBMISSION_REJECTED',
          targetType: 'submission',
          targetId: submissionId,
          summary: `[${reviewerRole === 'admin' ? 'Main Admin' : 'Assistant Admin'} ${reviewerId}] Rejected proof for ${taskCode} by ${memberCode}: ${rejectionReason}`.slice(
            0,
            450
          ),
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `submissions/${submissionId}`);
    }
  }

  // 12. Admin: POST /api/admin/withdrawals/:withdrawalId/process
  const wdrProcessMatch = path.match(/^\/api\/admin\/withdrawals\/([a-zA-Z0-9_\-]+)\/process$/);
  if (method === 'POST' && wdrProcessMatch) {
    const withdrawalId = wdrProcessMatch[1];
    const decision = body.decision;
    const paymentReference = typeof body.paymentReference === 'string' ? body.paymentReference.trim().slice(0, 100) : '';
    const adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 300) : '';
    if (decision !== 'paid' && decision !== 'rejected') {
      throw new Error('Decision must be paid or rejected.');
    }

    try {
      const wdrSnap = await getDoc(doc(db, 'withdrawals', withdrawalId));
      if (!wdrSnap.exists()) throw new Error('Withdrawal request not found.');
      const wdrData = wdrSnap.data();
      if (wdrData.status !== 'pending') {
        throw new Error(`Withdrawal ${wdrData.transactionCode} is already ${wdrData.status}.`);
      }

      const memberUid = String(wdrData.userId);
      const grossAmount = Number(wdrData.grossAmount);
      const feeAmount = Number(wdrData.feeAmount);
      const netAmount = Number(wdrData.netAmount);
      const walletSnap = await getDoc(doc(db, 'wallets', memberUid));
      if (!walletSnap.exists()) throw new Error('Member wallet not found.');
      const walletData = walletSnap.data();

      const nowIso = new Date().toISOString();
      const txId = randomDocId('tx');
      const logId = randomDocId('log');
      const batch = writeBatch(db);

      batch.update(doc(db, 'withdrawals', withdrawalId), {
        status: decision,
        paymentReference: decision === 'paid' ? paymentReference : '',
        adminNote,
        processedBy: uid,
        processedAt: nowIso,
        updatedAt: serverTimestamp(),
      });

      if (decision === 'paid') {
        batch.update(doc(db, 'wallets', memberUid), {
          reservedWithdrawals: Math.max(0, Number(walletData.reservedWithdrawals || 0) - grossAmount),
          totalWithdrawals: Number(walletData.totalWithdrawals || 0) + grossAmount,
          totalWithdrawalFees: Number(walletData.totalWithdrawalFees || 0) + feeAmount,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'transactions', txId), {
          transactionId: txId,
          userId: memberUid,
          memberId: String(wdrData.memberId),
          type: 'withdrawal_paid',
          amount: grossAmount,
          feeAmount,
          netAmount,
          direction: 'settlement',
          description: `${wdrData.payoutMethod} payout completed (${wdrData.transactionCode})${paymentReference ? ` · Ref ${paymentReference}` : ''} · Sent ৳${netAmount} (Fee ৳${feeAmount})`,
          referenceId: withdrawalId,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'adminAuditLogs', logId), {
          logId,
          adminUid: uid,
          adminEmail: email,
          action: 'WITHDRAWAL_PAID',
          targetType: 'withdrawal',
          targetId: withdrawalId,
          summary: `Marked withdrawal ${wdrData.transactionCode} Paid via ${wdrData.payoutMethod}: Gross ৳${grossAmount}, Fee ৳${feeAmount}, Net Sent ৳${netAmount}`,
          createdAt: serverTimestamp(),
        });
      } else {
        batch.update(doc(db, 'wallets', memberUid), {
          availableBalance: Number(walletData.availableBalance || 0) + grossAmount,
          reservedWithdrawals: Math.max(0, Number(walletData.reservedWithdrawals || 0) - grossAmount),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'transactions', txId), {
          transactionId: txId,
          userId: memberUid,
          memberId: String(wdrData.memberId),
          type: 'withdrawal_refund',
          amount: grossAmount,
          feeAmount: 0,
          netAmount: grossAmount,
          direction: 'credit',
          description: `Full refund for rejected ${wdrData.payoutMethod} withdrawal (${wdrData.transactionCode}): ৳${grossAmount} restored (${adminNote})`,
          referenceId: withdrawalId,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'adminAuditLogs', logId), {
          logId,
          adminUid: uid,
          adminEmail: email,
          action: 'WITHDRAWAL_REJECTED_REFUNDED',
          targetType: 'withdrawal',
          targetId: withdrawalId,
          summary: `Rejected withdrawal ${wdrData.transactionCode} and refunded full ৳${grossAmount} to ${wdrData.memberId}: ${adminNote}`,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `withdrawals/${withdrawalId}`);
    }
  }

  // 13. Admin: POST /api/admin/password-requests/:requestId/review
  const pcrReviewMatch = path.match(/^\/api\/admin\/password-requests\/([a-zA-Z0-9_\-]+)\/review$/);
  if (method === 'POST' && pcrReviewMatch) {
    const requestId = pcrReviewMatch[1];
    const decision = body.decision;
    const decisionNote = typeof body.decisionNote === 'string' ? body.decisionNote.trim().slice(0, 300) : '';
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('Decision must be approved or rejected.');
    }

    try {
      const pcrSnap = await getDoc(doc(db, 'passwordChangeRequests', requestId));
      if (!pcrSnap.exists()) throw new Error('Password change request not found.');
      const logId = randomDocId('log');
      const batch = writeBatch(db);
      batch.update(doc(db, 'passwordChangeRequests', requestId), {
        status: decision,
        decisionNote,
        reviewedBy: uid,
        reviewedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'adminAuditLogs', logId), {
        logId,
        adminUid: uid,
        adminEmail: email,
        action: decision === 'approved' ? 'PASSWORD_CHANGE_APPROVED' : 'PASSWORD_CHANGE_REJECTED',
        targetType: 'passwordChangeRequest',
        targetId: requestId,
        summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} password change request for ${pcrSnap.data().memberId}`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `passwordChangeRequests/${requestId}`);
    }
  }

  // 14. Main Admin: POST /api/admin/assistants (Create Assistant Admin Account)
  if (method === 'POST' && path === '/api/admin/assistants') {
    if (!currentUser.emailVerified || !isInitialAdmin) {
      const adminSnap = await getDoc(doc(db, 'admins', uid));
      if (!currentUser.emailVerified || !adminSnap.exists()) {
        throw new Error('Main Administrator authorization required.');
      }
    }

    const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 100) : '';
    const targetEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 25) : '';

    if (fullName.length < 2) {
      throw new Error('Assistant Admin full name must be between 2 and 100 characters.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail) || targetEmail.length > 150) {
      throw new Error('Enter a valid email address for the Assistant Admin.');
    }
    if (password.length < 6 || password.length > 128) {
      throw new Error('Password must be between 6 and 128 characters.');
    }
    if (phone && !BD_PHONE_REGEX.test(phone)) {
      throw new Error('Enter a valid Bangladeshi phone number (e.g., 01712345678).');
    }

    const signUpRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          password,
          returnSecureToken: true,
        }),
      }
    );
    const signUpBody = (await signUpRes.json().catch(() => ({}))) as {
      localId?: string;
      idToken?: string;
      error?: { message?: string };
    };
    if (!signUpRes.ok || !signUpBody.localId) {
      const code = signUpBody.error?.message || '';
      if (code.includes('EMAIL_EXISTS')) {
        throw new Error(
          'An account with this email already exists. Promote that existing account directly in the Assistant Admins section.'
        );
      }
      if (code.includes('OPERATION_NOT_ALLOWED')) {
        throw new Error(
          'Email/Password sign-in is disabled in Firebase Console. Enable Email/Password or promote a Google-registered member.'
        );
      }
      throw new Error(`Could not create Assistant Admin credentials: ${code || 'Invalid input'}`);
    }

    const newUid = signUpBody.localId;
    if (signUpBody.idToken) {
      await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken: signUpBody.idToken,
            displayName: fullName,
            returnSecureToken: false,
          }),
        }
      ).catch(() => undefined);
    }

    const memberId = randomNumericCode('MTS', 6);
    const logId = randomDocId('log');

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'assistantAdmins', newUid), {
        uid: newUid,
        memberId,
        fullName,
        email: targetEmail,
        createdBy: uid,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'users', newUid), {
        uid: newUid,
        memberId,
        fullName,
        email: targetEmail,
        phone,
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
      });
      batch.set(doc(db, 'wallets', newUid), {
        userId: newUid,
        memberId,
        availableBalance: 0,
        totalEarnings: 0,
        totalWithdrawals: 0,
        totalWithdrawalFees: 0,
        reservedWithdrawals: 0,
        lastWithdrawalId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'adminAuditLogs', logId), {
        logId,
        adminUid: uid,
        adminEmail: email,
        action: 'ASSISTANT_ADMIN_CREATED',
        targetType: 'assistantAdmin',
        targetId: newUid,
        summary: `Created Assistant Admin account ${memberId} (${fullName} · ${targetEmail})`.slice(0, 450),
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true, uid: newUid, memberId } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.CREATE, `assistantAdmins/${newUid}`);
    }
  }

  // 15. Main Admin: POST /api/admin/assistants/:targetUid/role
  const assistantRoleMatch = path.match(/^\/api\/admin\/assistants\/([a-zA-Z0-9_\-]+)\/role$/);
  if (method === 'POST' && assistantRoleMatch) {
    const targetUid = assistantRoleMatch[1];
    const action = body.action;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';

    if (action !== 'promote' && action !== 'suspend' && action !== 'reactivate' && action !== 'demote') {
      throw new Error('Action must be promote, suspend, reactivate, or demote.');
    }

    try {
      const [targetSnap, existingAssistantSnap] = await Promise.all([
        getDoc(doc(db, 'users', targetUid)),
        getDoc(doc(db, 'assistantAdmins', targetUid)),
      ]);
      if (!targetSnap.exists()) throw new Error('Target account not found.');
      const targetData = targetSnap.data();
      if (targetData.role === 'admin' || targetUid === uid) {
        throw new Error('Cannot modify Main Admin role.');
      }

      const logId = randomDocId('log');
      const batch = writeBatch(db);

      if (action === 'promote' || action === 'reactivate') {
        batch.update(doc(db, 'users', targetUid), {
          role: 'assistant_admin',
          status: 'approved',
          rejectionReason: '',
          updatedAt: serverTimestamp(),
        });
        if (!existingAssistantSnap.exists()) {
          batch.set(doc(db, 'assistantAdmins', targetUid), {
            uid: targetUid,
            memberId: String(targetData.memberId),
            fullName: String(targetData.fullName),
            email: String(targetData.email),
            createdBy: uid,
            createdAt: serverTimestamp(),
          });
        }
      } else if (action === 'suspend') {
        batch.update(doc(db, 'users', targetUid), {
          role: 'assistant_admin',
          status: 'rejected',
          rejectionReason: reason || 'Assistant Admin access suspended by Main Admin',
          updatedAt: serverTimestamp(),
        });
        if (existingAssistantSnap.exists()) {
          batch.delete(doc(db, 'assistantAdmins', targetUid));
        }
      } else {
        batch.update(doc(db, 'users', targetUid), {
          role: 'member',
          status: 'approved',
          rejectionReason: '',
          updatedAt: serverTimestamp(),
        });
        if (existingAssistantSnap.exists()) {
          batch.delete(doc(db, 'assistantAdmins', targetUid));
        }
      }

      batch.set(doc(db, 'adminAuditLogs', logId), {
        logId,
        adminUid: uid,
        adminEmail: email,
        action: `ASSISTANT_ADMIN_${String(action).toUpperCase()}`,
        targetType: 'assistantAdmin',
        targetId: targetUid,
        summary: `${String(action).toUpperCase()} Assistant Admin role for ${targetData.memberId} (${targetData.fullName})`.slice(
          0,
          450
        ),
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  }

  // 16. Approved Member: POST /api/custom-tasks (Never credits wallet on submit)
  if (method === 'POST' && path === '/api/custom-tasks') {
    const taskName = typeof body.taskName === 'string' ? body.taskName.trim().slice(0, 140) : '';
    const taskDetails = typeof body.taskDetails === 'string' ? body.taskDetails.trim().slice(0, 2000) : '';
    const requestedAmount = Number(body.requestedAmount);
    const screenshotAssetId =
      typeof body.screenshotAssetId === 'string' ? body.screenshotAssetId.trim() : '';

    if (taskName.length < 2) {
      throw new Error('Task Name must be at least 2 characters.');
    }
    if (taskDetails.length < 5) {
      throw new Error('Task Details must be at least 5 characters.');
    }
    if (!Number.isFinite(requestedAmount) || !Number.isInteger(requestedAmount) || requestedAmount < 1 || requestedAmount > 100000) {
      throw new Error('Requested Amount must be a whole Taka integer between ৳1 and ৳100,000.');
    }
    if (screenshotAssetId && !VALID_ID_REGEX.test(screenshotAssetId)) {
      throw new Error('Invalid proof screenshot reference.');
    }

    const customTaskId = randomDocId('ctk');
    const customTaskCode = randomNumericCode('CTK', 5);

    try {
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (!userSnap.exists() || userSnap.data().status !== 'approved') {
        throw new Error('Your account must be approved before submitting a custom task.');
      }
      const profileData = userSnap.data();

      const batch = writeBatch(db);
      batch.set(doc(db, 'customTasks', customTaskId), {
        customTaskId,
        customTaskCode,
        userId: uid,
        memberId: String(profileData.memberId),
        memberName: String(profileData.fullName),
        taskName,
        taskDetails,
        requestedAmount,
        approvedAmount: 0,
        screenshotAssetId,
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true, customTaskId, customTaskCode } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.CREATE, `customTasks/${customTaskId}`);
    }
  }

  // 17. Assistant Admin or Main Admin: POST /api/admin/custom-tasks/:customTaskId/assist-review
  const customAssistMatch = path.match(/^\/api\/admin\/custom-tasks\/([a-zA-Z0-9_\-]+)\/assist-review$/);
  if (method === 'POST' && customAssistMatch) {
    const customTaskId = customAssistMatch[1];
    const assistantStatus = body.assistantStatus;
    const assistantNote =
      typeof body.assistantNote === 'string' ? body.assistantNote.trim().slice(0, 300) : '';

    if (
      assistantStatus !== 'reviewed' &&
      assistantStatus !== 'recommended_approve' &&
      assistantStatus !== 'recommended_reject'
    ) {
      throw new Error('Invalid inspection status.');
    }
    if (assistantStatus === 'recommended_reject' && assistantNote.length < 3) {
      throw new Error('Please enter a recommendation note (at least 3 characters) when recommending rejection.');
    }

    try {
      const [ctSnap, callerSnap, assistantSnap] = await Promise.all([
        getDoc(doc(db, 'customTasks', customTaskId)),
        getDoc(doc(db, 'users', uid)),
        getDoc(doc(db, 'assistantAdmins', uid)),
      ]);
      if (!ctSnap.exists()) throw new Error('Custom task submission not found.');
      const ctData = ctSnap.data();
      if (ctData.status !== 'pending') {
        throw new Error(`Custom task has already been ${ctData.status} by Main Admin.`);
      }

      const callerData = callerSnap.exists() ? callerSnap.data() : null;
      const isAuthorized =
        isInitialAdmin ||
        (assistantSnap.exists() && callerData?.status === 'approved') ||
        (callerData?.role === 'admin' && Boolean(currentUser.emailVerified));
      if (!isAuthorized) {
        throw new Error('Admin or Assistant Admin authorization required.');
      }

      const reviewerId = String(
        callerData?.memberId || (assistantSnap.exists() ? assistantSnap.data().memberId : 'ADMIN')
      );
      const reviewerName = String(
        callerData?.fullName || (assistantSnap.exists() ? assistantSnap.data().fullName : 'Admin')
      );
      const nowIso = new Date().toISOString();
      const logId = randomDocId('log');

      const batch = writeBatch(db);
      batch.update(doc(db, 'customTasks', customTaskId), {
        assistantStatus,
        assistantNote,
        assistantReviewedBy: uid,
        assistantReviewerId: reviewerId,
        assistantReviewerName: reviewerName,
        assistantReviewedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'adminAuditLogs', logId), {
        logId,
        adminUid: uid,
        adminEmail: email || reviewerId,
        action: 'CUSTOM_TASK_INSPECTED',
        targetType: 'customTask',
        targetId: customTaskId,
        summary: `[${reviewerId}] Marked custom task ${ctData.customTaskCode} as ${assistantStatus}${assistantNote ? `: ${assistantNote}` : ''}`.slice(
          0,
          450
        ),
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `customTasks/${customTaskId}`);
    }
  }

  // 18. Main Admin ONLY: POST /api/admin/custom-tasks/:customTaskId/decision
  const customDecisionMatch = path.match(/^\/api\/admin\/custom-tasks\/([a-zA-Z0-9_\-]+)\/decision$/);
  if (method === 'POST' && customDecisionMatch) {
    const customTaskId = customDecisionMatch[1];
    const decision = body.decision;
    const rawApprovedAmount = body.approvedAmount;
    const rawReason =
      typeof body.rejectionReason === 'string' ? body.rejectionReason.trim().slice(0, 300) : '';

    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('Decision must be approved or rejected.');
    }
    if (decision === 'rejected' && rawReason.length < 3) {
      throw new Error('Please provide a rejection reason (at least 3 characters).');
    }

    try {
      const [ctSnap, adminProfileSnap] = await Promise.all([
        getDoc(doc(db, 'customTasks', customTaskId)),
        getDoc(doc(db, 'users', uid)),
      ]);
      if (!ctSnap.exists()) throw new Error('Custom task submission not found.');
      const ctData = ctSnap.data();
      if (ctData.status !== 'pending') {
        throw new Error(
          `Custom task ${ctData.customTaskCode} has already been ${ctData.status}. Duplicate payment prevented.`
        );
      }

      const adminProfile = adminProfileSnap.exists() ? adminProfileSnap.data() : null;
      const reviewerId = String(adminProfile?.memberId || 'ADMIN');
      const reviewerName = String(adminProfile?.fullName || 'Main Admin');

      const memberUid = String(ctData.userId);
      const memberCode = String(ctData.memberId || 'MTS-000000');
      const taskName = String(ctData.taskName || 'Custom Task').slice(0, 400);
      const customCode = String(ctData.customTaskCode || 'CTK-00000');
      const requestedAmount = Number(ctData.requestedAmount);

      const finalApprovedAmount =
        decision === 'approved'
          ? rawApprovedAmount !== undefined && rawApprovedAmount !== null && String(rawApprovedAmount) !== ''
            ? Number(rawApprovedAmount)
            : requestedAmount
          : 0;

      if (
        decision === 'approved' &&
        (!Number.isFinite(finalApprovedAmount) ||
          !Number.isInteger(finalApprovedAmount) ||
          finalApprovedAmount < 1 ||
          finalApprovedAmount > 100000)
      ) {
        throw new Error('Approved amount must be a whole Taka integer between ৳1 and ৳100,000.');
      }

      const [memberSnap, walletSnap] = await Promise.all([
        getDoc(doc(db, 'users', memberUid)),
        getDoc(doc(db, 'wallets', memberUid)),
      ]);

      const nowIso = new Date().toISOString();
      const txId = decision === 'approved' ? `tx_custom_${customTaskId}` : '';
      const notifId = randomDocId('ntf');
      const logId = randomDocId('log');
      const batch = writeBatch(db);

      batch.update(doc(db, 'customTasks', customTaskId), {
        status: decision,
        approvedAmount: finalApprovedAmount,
        rejectionReason: decision === 'rejected' ? rawReason : '',
        reviewedBy: uid,
        reviewerId,
        reviewerName,
        reviewedAt: nowIso,
        transactionId: txId,
        updatedAt: serverTimestamp(),
      });

      if (decision === 'approved') {
        if (walletSnap.exists()) {
          const walletData = walletSnap.data();
          batch.update(doc(db, 'wallets', memberUid), {
            availableBalance: Number(walletData.availableBalance || 0) + finalApprovedAmount,
            totalEarnings: Number(walletData.totalEarnings || 0) + finalApprovedAmount,
            lastCreditedSubmissionId: customTaskId,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'wallets', memberUid), {
            userId: memberUid,
            memberId: memberCode,
            availableBalance: finalApprovedAmount,
            totalEarnings: finalApprovedAmount,
            totalWithdrawals: 0,
            totalWithdrawalFees: 0,
            reservedWithdrawals: 0,
            lastWithdrawalId: '',
            lastCreditedSubmissionId: customTaskId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (memberSnap.exists()) {
          const memberData = memberSnap.data();
          batch.update(doc(db, 'users', memberUid), {
            completedTasksCount: Number(memberData.completedTasksCount || 0) + 1,
            totalEarnings: Number(memberData.totalEarnings || 0) + finalApprovedAmount,
            updatedAt: serverTimestamp(),
          });
        }

        batch.set(doc(db, 'transactions', txId), {
          transactionId: txId,
          userId: memberUid,
          memberId: memberCode,
          type: 'custom_task_reward',
          amount: finalApprovedAmount,
          feeAmount: 0,
          netAmount: finalApprovedAmount,
          direction: 'credit',
          description: `Custom task payment credited for ${customCode} (${taskName.slice(0, 140)})`.slice(0, 240),
          referenceId: customTaskId,
          taskName,
          submissionId: customTaskId,
          approvedAt: nowIso,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'notifications', notifId), {
          notificationId: notifId,
          userId: memberUid,
          type: 'custom_task_approved',
          title: 'Custom Task Approved & Paid',
          message: `Your custom task "${taskName}" (${customCode}) was approved by Admin and ৳${finalApprovedAmount} has been credited to your wallet.`.slice(
            0,
            900
          ),
          referenceId: customTaskId,
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'adminAuditLogs', logId), {
          logId,
          adminUid: uid,
          adminEmail: email,
          action: 'CUSTOM_TASK_APPROVED',
          targetType: 'customTask',
          targetId: customTaskId,
          summary: `Approved custom task ${customCode} ("${taskName}") for ${memberCode} and credited ৳${finalApprovedAmount}`.slice(
            0,
            450
          ),
          createdAt: serverTimestamp(),
        });
      } else {
        batch.set(doc(db, 'notifications', notifId), {
          notificationId: notifId,
          userId: memberUid,
          type: 'custom_task_rejected',
          title: 'Custom Task Not Approved',
          message: `Your custom task "${taskName}" (${customCode}) was rejected. Reason: ${rawReason}`.slice(
            0,
            900
          ),
          referenceId: customTaskId,
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'adminAuditLogs', logId), {
          logId,
          adminUid: uid,
          adminEmail: email,
          action: 'CUSTOM_TASK_REJECTED',
          targetType: 'customTask',
          targetId: customTaskId,
          summary: `Rejected custom task ${customCode} ("${taskName}") for ${memberCode}: ${rawReason}`.slice(
            0,
            450
          ),
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `customTasks/${customTaskId}`);
    }
  }

  // 19. Member: POST /api/notifications/:notificationId/read
  const notifReadMatch = path.match(/^\/api\/notifications\/([a-zA-Z0-9_\-]+)\/read$/);
  if (method === 'POST' && notifReadMatch) {
    const notificationId = notifReadMatch[1];
    try {
      const notifRef = doc(db, 'notifications', notificationId);
      const notifSnap = await getDoc(notifRef);
      if (!notifSnap.exists() || notifSnap.data().userId !== uid) {
        throw new Error('Notification not found.');
      }
      if (notifSnap.data().isRead === true) {
        return { ok: true } as unknown as T;
      }
      const batch = writeBatch(db);
      batch.update(notifRef, {
        isRead: true,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true } as unknown as T;
    } catch (err) {
      wrapPermError(err, OperationType.UPDATE, `notifications/${notificationId}`);
    }
  }

  throw new Error(`Unsupported operation (${method} ${path}).`);
}
