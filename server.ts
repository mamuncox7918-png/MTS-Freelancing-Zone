import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  HttpError,
  type RestWriteOperation,
  type VerifiedAuthUser,
  buildCreateWrite,
  buildDeleteWrite,
  buildReplaceUpdateWrite,
  commitSingleOrBatchWrites,
  firebaseConfig,
  getDocRest,
  listCollectionRest,
  preserveTimestamp,
  queryByUserFieldRest,
  runAtomicTransaction,
  verifyFirebaseIdToken,
} from './server/firestoreRest.ts';
import {
  buildMonthlyEntryId,
  buildWinnerDocId,
  computeMonthlyLeaderboardFromTransactions,
  createEmptyRewardConfigs,
  extractTimestampMs,
  getDhakaMonthKey,
  getUnreversedRewardTransactions,
  isValidMonthKey,
  normalizeRewardConfigs,
  sanitizeFirestoreId,
} from './src/lib/leaderboard.ts';
import type { UserProfile, WalletTransaction } from './src/types.ts';

dotenv.config();

const FIXED_WITHDRAWAL_FEE_BDT = 5;
const MIN_WITHDRAWAL_GROSS_BDT = 100;
const BD_PHONE_REGEX = /^(\+88)?01[3-9][0-9]{8}$/;
const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

function isConfiguredAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === BOOTSTRAPPED_ADMIN_EMAIL) return true;
  const envAdmin = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  return Boolean(envAdmin && normalized === envAdmin);
}

function generateNumericCode(prefix: string, digits: number): string {
  const max = 10 ** digits;
  const min = 10 ** (digits - 1);
  const num = crypto.randomInt(min, max);
  return `${prefix}-${num}`;
}

function generateDocId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

interface AuthedRequest extends Request {
  authUser?: VerifiedAuthUser;
}

async function requireVerifiedAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const authUser = await verifyFirebaseIdToken(
      req.headers['x-firebase-token'],
      req.headers.authorization
    );
    req.authUser = authUser;
    next();
  } catch (err) {
    next(err);
  }
}

async function assertCallerIsAdmin(authUser: VerifiedAuthUser): Promise<{
  role: 'admin';
  reviewerId: string;
  reviewerName: string;
}> {
  if (!authUser.emailVerified) {
    throw new HttpError(403, 'Administrator accounts require a verified email.');
  }
  const profileDoc = await getDocRest('users', authUser.uid, authUser.idToken);
  const reviewerId = String(profileDoc?.data?.memberId || 'ADMIN');
  const reviewerName = String(profileDoc?.data?.fullName || 'Main Admin');

  if (isConfiguredAdminEmail(authUser.email)) {
    return { role: 'admin', reviewerId, reviewerName };
  }
  const adminDoc = await getDocRest('admins', authUser.uid, authUser.idToken);
  if (!adminDoc) {
    throw new HttpError(403, 'Main Administrator authorization required.');
  }
  return { role: 'admin', reviewerId, reviewerName };
}

async function assertCallerIsAdminOrAssistant(authUser: VerifiedAuthUser): Promise<{
  role: 'admin' | 'assistant_admin';
  reviewerId: string;
  reviewerName: string;
}> {
  if (authUser.emailVerified && isConfiguredAdminEmail(authUser.email)) {
    const profileDoc = await getDocRest('users', authUser.uid, authUser.idToken);
    return {
      role: 'admin',
      reviewerId: String(profileDoc?.data?.memberId || 'ADMIN'),
      reviewerName: String(profileDoc?.data?.fullName || 'Main Admin'),
    };
  }

  if (authUser.emailVerified) {
    const adminDoc = await getDocRest('admins', authUser.uid, authUser.idToken);
    if (adminDoc) {
      const profileDoc = await getDocRest('users', authUser.uid, authUser.idToken);
      return {
        role: 'admin',
        reviewerId: String(profileDoc?.data?.memberId || 'ADMIN'),
        reviewerName: String(profileDoc?.data?.fullName || 'Main Admin'),
      };
    }
  }

  const [assistantDoc, profileDoc] = await Promise.all([
    getDocRest('assistantAdmins', authUser.uid, authUser.idToken),
    getDocRest('users', authUser.uid, authUser.idToken),
  ]);
  if (!assistantDoc || !profileDoc || profileDoc.data.status !== 'approved') {
    throw new HttpError(403, 'Admin or Assistant Admin authorization required.');
  }
  return {
    role: 'assistant_admin',
    reviewerId: String(profileDoc.data.memberId || assistantDoc.data.memberId || 'ASSISTANT'),
    reviewerName: String(profileDoc.data.fullName || assistantDoc.data.fullName || 'Assistant Admin'),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'MTS Freelancing Zone API' });
  });

  // =========================================================================
  // 1. Account Registration & Secure Initial Admin Bootstrap
  // =========================================================================
  app.post('/api/auth/register', requireVerifiedAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const rawName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
      const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
      const rawProvider = req.body?.authProvider === 'google.com' ? 'google.com' : 'password';

      const fullName = rawName.slice(0, 100);
      if (fullName.length < 2) {
        throw new HttpError(400, 'Full name must be between 2 and 100 characters.');
      }
      if (rawPhone.length > 25) {
        throw new HttpError(400, 'Phone number must be 25 characters or fewer.');
      }
      if (rawPhone && !BD_PHONE_REGEX.test(rawPhone)) {
        throw new HttpError(400, 'Enter a valid Bangladeshi phone number (e.g., 01712345678).');
      }

      const isInitialAdmin = Boolean(user.emailVerified) && isConfiguredAdminEmail(user.email);

      const outcome = await runAtomicTransaction<{
        status: string;
        role: string;
        memberId?: string;
        alreadyExisted: boolean;
      }>(user.idToken, async (tx) => {
        const existingProfile = await tx.get('users', user.uid);
        const existingWallet = await tx.get('wallets', user.uid);

        if (existingProfile) {
          // If bootstrapped admin had a member profile, elevate cleanly
          if (isInitialAdmin && existingProfile.data.role !== 'admin') {
            const writes = [
              buildReplaceUpdateWrite(
                'users',
                user.uid,
                {
                  ...existingProfile.data,
                  role: 'admin',
                  status: 'approved',
                  createdAt: preserveTimestamp(existingProfile.raw, 'createdAt'),
                },
                existingProfile.updateTime
              ),
            ];
            const existingAdminDoc = await tx.get('admins', user.uid);
            if (!existingAdminDoc) {
              writes.push(
                buildCreateWrite('admins', user.uid, { uid: user.uid, email: user.email }, ['createdAt'])
              );
            }
            return { writes, result: { status: 'approved', role: 'admin', alreadyExisted: true } };
          }
          return {
            writes: [],
            result: {
              status: String(existingProfile.data.status),
              role: String(existingProfile.data.role),
              alreadyExisted: true,
            },
          };
        }

        const memberId = generateNumericCode('MTS', 6);
        const role = isInitialAdmin ? 'admin' : 'member';
        const status = isInitialAdmin ? 'approved' : 'pending';

        const writes = [
          buildCreateWrite(
            'users',
            user.uid,
            {
              uid: user.uid,
              memberId,
              fullName,
              email: user.email,
              phone: rawPhone,
              authProvider: rawProvider,
              photoAssetId: '',
              role,
              status,
              rejectionReason: '',
              completedTasksCount: 0,
              pendingSubmissionsCount: 0,
              totalEarnings: 0,
              lastPasswordChangedAt: '',
            },
            ['createdAt', 'updatedAt']
          ),
        ];

        if (!existingWallet) {
          writes.push(
            buildCreateWrite(
              'wallets',
              user.uid,
              {
                userId: user.uid,
                memberId,
                availableBalance: 0,
                totalEarnings: 0,
                totalWithdrawals: 0,
                totalWithdrawalFees: 0,
                reservedWithdrawals: 0,
                lastWithdrawalId: '',
              },
              ['createdAt', 'updatedAt']
            )
          );
        }

        if (isInitialAdmin) {
          const existingAdminDoc = await tx.get('admins', user.uid);
          if (!existingAdminDoc) {
            writes.push(
              buildCreateWrite('admins', user.uid, { uid: user.uid, email: user.email }, ['createdAt'])
            );
          }
          const logId = generateDocId('log');
          writes.push(
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: user.uid,
                adminEmail: user.email,
                action: 'INITIAL_ADMIN_PROVISIONED',
                targetType: 'user',
                targetId: user.uid,
                summary: `Provisioned initial Admin account (${memberId}) for ${user.email}`,
              },
              ['createdAt']
            )
          );
        }

        return { writes, result: { status, role, memberId, alreadyExisted: false } };
      });

      res.json({ ok: true, ...outcome });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 2. Secure Media Upload (Profile Avatars & Proof Screenshots)
  // =========================================================================
  app.post('/api/media/upload', requireVerifiedAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const purpose = req.body?.purpose;
      const mimeType = req.body?.mimeType;
      const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';

      if (purpose !== 'avatar' && purpose !== 'proof') {
        throw new HttpError(400, 'Invalid upload purpose.');
      }
      if (!['image/webp', 'image/jpeg', 'image/png'].includes(mimeType)) {
        throw new HttpError(400, 'Unsupported image format. Use JPEG, PNG, or WebP.');
      }
      if (!dataUrl.startsWith(`data:${mimeType};base64,`) || dataUrl.length < 20 || dataUrl.length > 250000) {
        throw new HttpError(400, 'Compressed image exceeds the 200 KB security threshold.');
      }

      const base64Part = dataUrl.split(',')[1] || '';
      const sizeBytes = Math.ceil((base64Part.length * 3) / 4);
      if (sizeBytes <= 0 || sizeBytes > 200000) {
        throw new HttpError(400, 'Decoded image size must be between 1 B and 200 KB.');
      }

      const profileDoc = await getDocRest('users', user.uid, user.idToken);
      if (!profileDoc) {
        throw new HttpError(403, 'Complete registration before uploading media.');
      }
      if (purpose === 'proof' && profileDoc.data.status !== 'approved' && profileDoc.data.role !== 'admin') {
        throw new HttpError(403, 'Only approved members can upload task proof screenshots.');
      }

      const assetId = generateDocId(purpose === 'avatar' ? 'ava' : 'prf');
      await commitSingleOrBatchWrites(user.idToken, [
        buildCreateWrite(
          'mediaAssets',
          assetId,
          {
            assetId,
            ownerId: user.uid,
            purpose,
            mimeType,
            dataUrl,
            sizeBytes,
          },
          ['createdAt']
        ),
      ]);

      res.json({ ok: true, assetId });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 3. Member Own Profile Update (Name, Phone, Profile Photo Change/Remove)
  // =========================================================================
  app.put('/api/profile', requireVerifiedAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().slice(0, 100) : '';
      const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 25) : '';
      const photoAssetId = typeof req.body?.photoAssetId === 'string' ? req.body.photoAssetId.trim() : '';

      if (fullName.length < 2) {
        throw new HttpError(400, 'Full name must be at least 2 characters.');
      }
      if (phone && !BD_PHONE_REGEX.test(phone)) {
        throw new HttpError(400, 'Enter a valid Bangladeshi phone number (e.g., 01712345678).');
      }
      if (photoAssetId && !VALID_ID_REGEX.test(photoAssetId)) {
        throw new HttpError(400, 'Invalid profile photo reference.');
      }

      await runAtomicTransaction(user.idToken, async (tx) => {
        const profile = await tx.get('users', user.uid);
        if (!profile) {
          throw new HttpError(404, 'Member profile not found.');
        }

        if (photoAssetId) {
          const asset = await tx.get('mediaAssets', photoAssetId);
          if (!asset || asset.data.ownerId !== user.uid || asset.data.purpose !== 'avatar') {
            throw new HttpError(403, 'Profile photo must be uploaded by your own account.');
          }
        }

        const currentMonthKey = getDhakaMonthKey(Date.now());
        const monthlyEntryId = buildMonthlyEntryId(currentMonthKey, user.uid);
        const monthlyEntry = await tx.get('monthlyMemberEarnings', monthlyEntryId);

        const prevPhotoId = String(profile.data.photoAssetId || '');
        const writes = [
          buildReplaceUpdateWrite(
            'users',
            user.uid,
            {
              ...profile.data,
              fullName,
              phone,
              photoAssetId,
              createdAt: preserveTimestamp(profile.raw, 'createdAt'),
            },
            profile.updateTime
          ),
        ];

        if (monthlyEntry) {
          writes.push(
            buildReplaceUpdateWrite(
              'monthlyMemberEarnings',
              monthlyEntryId,
              {
                ...monthlyEntry.data,
                displayName: fullName,
                photoAssetId,
                createdAt: preserveTimestamp(monthlyEntry.raw, 'createdAt'),
              },
              monthlyEntry.updateTime
            )
          );
        }

        if (prevPhotoId && prevPhotoId !== photoAssetId) {
          writes.push(buildDeleteWrite('mediaAssets', prevPhotoId));
        }

        return { writes, result: true };
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 4. Member Task Proof Submission
  // =========================================================================
  app.post('/api/submissions', requireVerifiedAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId.trim() : '';
      const screenshotAssetId =
        typeof req.body?.screenshotAssetId === 'string' ? req.body.screenshotAssetId.trim() : '';
      const rawProofLink =
        typeof req.body?.proofLink === 'string' ? req.body.proofLink.trim().slice(0, 500) : '';
      const proofLink =
        rawProofLink && !/^https?:\/\//i.test(rawProofLink)
          ? `https://${rawProofLink}`.slice(0, 500)
          : rawProofLink;
      const submissionNote =
        typeof req.body?.submissionNote === 'string' ? req.body.submissionNote.trim().slice(0, 500) : '';

      if (!VALID_ID_REGEX.test(taskId)) {
        throw new HttpError(400, 'Valid task ID is required.');
      }
      if (!VALID_ID_REGEX.test(screenshotAssetId)) {
        throw new HttpError(400, 'Please upload a proof screenshot before submitting.');
      }
      if (proofLink && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(proofLink)) {
        throw new HttpError(400, 'Enter a valid proof link URL (e.g., https://facebook.com/...).');
      }

      // Check existing submissions and reward ledger for this member to block duplicate pending/approved submissions
      const [memberSubmissions, memberTransactions] = await Promise.all([
        queryByUserFieldRest('submissions', 'userId', user.uid, user.idToken),
        queryByUserFieldRest<WalletTransaction>('transactions', 'userId', user.uid, user.idToken),
      ]);
      const duplicate = memberSubmissions.find(
        (s) => s.data.taskId === taskId && (s.data.status === 'pending' || s.data.status === 'approved')
      );
      if (duplicate) {
        throw new HttpError(
          409,
          duplicate.data.status === 'approved'
            ? 'You have already completed and received the reward for this task.'
            : 'You already have a proof submission pending Admin review for this task.'
        );
      }

      const rewardSummary = getUnreversedRewardTransactions(
        memberTransactions.map((t) => ({
          ...t.data,
          transactionId: String(t.data.transactionId || t.raw.name.split('/').pop() || ''),
        }))
      );
      if (rewardSummary.completedTaskIds.has(taskId)) {
        throw new HttpError(409, 'You have already completed and received the reward for this task.');
      }

      const submissionId = generateDocId('sub');

      await runAtomicTransaction(user.idToken, async (tx) => {
        const profile = await tx.get('users', user.uid);
        if (!profile || profile.data.status !== 'approved') {
          throw new HttpError(403, 'Your account must be approved by an Admin before submitting task proof.');
        }

        const task = await tx.get('tasks', taskId);
        if (!task || task.data.isActive !== true) {
          throw new HttpError(400, 'This task is no longer active.');
        }

        const taskCodeStr = String(task.data.taskCode || '');
        if (taskCodeStr && rewardSummary.completedTaskCodes.has(taskCodeStr)) {
          throw new HttpError(409, 'You have already completed and received the reward for this task.');
        }

        const asset = await tx.get('mediaAssets', screenshotAssetId);
        if (!asset || asset.data.ownerId !== user.uid || asset.data.purpose !== 'proof') {
          throw new HttpError(403, 'Invalid proof screenshot asset.');
        }

        const rewardAmount = Number(task.data.rewardAmount);
        const currentPending = Number(profile.data.pendingSubmissionsCount || 0);

        const writes = [
          buildCreateWrite(
            'submissions',
            submissionId,
            {
              submissionId,
              taskId,
              taskCode: String(task.data.taskCode),
              taskTitle: String(task.data.taskTitle || task.data.title),
              rewardAmount,
              userId: user.uid,
              memberId: String(profile.data.memberId),
              memberName: String(profile.data.fullName),
              screenshotAssetId,
              proofLink,
              submissionNote,
              status: 'pending',
              rejectionReason: '',
              reviewedBy: '',
              reviewedAt: '',
            },
            ['createdAt', 'updatedAt']
          ),
          buildReplaceUpdateWrite(
            'users',
            user.uid,
            {
              ...profile.data,
              pendingSubmissionsCount: currentPending + 1,
              createdAt: preserveTimestamp(profile.raw, 'createdAt'),
            },
            profile.updateTime
          ),
        ];

        return { writes, result: true };
      });

      res.json({ ok: true, submissionId });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 5. Atomic Member Withdrawal Request With Fixed 5 BDT Fee
  // =========================================================================
  app.post('/api/withdrawals', requireVerifiedAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const payoutMethod = req.body?.payoutMethod;
      const accountNumber = typeof req.body?.accountNumber === 'string' ? req.body.accountNumber.trim() : '';
      const rawGross = Number(req.body?.grossAmount);

      if (payoutMethod !== 'bKash' && payoutMethod !== 'Nagad') {
        throw new HttpError(400, 'Select a valid payout method (bKash or Nagad).');
      }
      if (!BD_PHONE_REGEX.test(accountNumber)) {
        throw new HttpError(400, 'Enter a valid 11-digit Bangladeshi bKash/Nagad number (e.g., 01712345678).');
      }
      if (!Number.isFinite(rawGross) || !Number.isInteger(rawGross)) {
        throw new HttpError(400, 'Withdrawal amount must be a whole Taka integer.');
      }
      if (rawGross < MIN_WITHDRAWAL_GROSS_BDT) {
        throw new HttpError(
          400,
          `Minimum Withdraw ${MIN_WITHDRAWAL_GROSS_BDT} Tk (৳${MIN_WITHDRAWAL_GROSS_BDT}). Requests below ${MIN_WITHDRAWAL_GROSS_BDT} Tk are not allowed.`
        );
      }
      if (rawGross > 500000) {
        throw new HttpError(400, 'Maximum single withdrawal request is ৳500,000.');
      }

      const grossAmount = rawGross;
      const feeAmount = FIXED_WITHDRAWAL_FEE_BDT;
      const netAmount = grossAmount - feeAmount;

      const withdrawalId = generateDocId('wdr');
      const transactionCode = generateNumericCode('WDR', 6);
      const txLedgerId = generateDocId('tx');

      await runAtomicTransaction(user.idToken, async (tx) => {
        const profile = await tx.get('users', user.uid);
        if (!profile || profile.data.status !== 'approved') {
          throw new HttpError(403, 'Only approved members can request withdrawals.');
        }

        const wallet = await tx.get('wallets', user.uid);
        if (!wallet) {
          throw new HttpError(404, 'Member wallet not initialized.');
        }

        const availableBalance = Number(wallet.data.availableBalance || 0);
        const reservedWithdrawals = Number(wallet.data.reservedWithdrawals || 0);

        if (availableBalance < grossAmount) {
          throw new HttpError(
            400,
            `Insufficient available wallet balance (৳${availableBalance}) to cover ৳${grossAmount} gross withdrawal.`
          );
        }

        const writes = [
          buildReplaceUpdateWrite(
            'wallets',
            user.uid,
            {
              ...wallet.data,
              availableBalance: availableBalance - grossAmount,
              reservedWithdrawals: reservedWithdrawals + grossAmount,
              lastWithdrawalId: withdrawalId,
              createdAt: preserveTimestamp(wallet.raw, 'createdAt'),
            },
            wallet.updateTime
          ),
          buildCreateWrite(
            'withdrawals',
            withdrawalId,
            {
              withdrawalId,
              transactionCode,
              userId: user.uid,
              memberId: String(profile.data.memberId),
              memberName: String(profile.data.fullName),
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
            },
            ['createdAt', 'updatedAt']
          ),
          buildCreateWrite(
            'transactions',
            txLedgerId,
            {
              transactionId: txLedgerId,
              userId: user.uid,
              memberId: String(profile.data.memberId),
              type: 'withdrawal_request',
              amount: grossAmount,
              feeAmount,
              netAmount,
              direction: 'debit',
              description: `${payoutMethod} withdrawal requested (${transactionCode}): Gross ৳${grossAmount}, Fee ৳${feeAmount}, Net ৳${netAmount}`,
              referenceId: withdrawalId,
            },
            ['createdAt']
          ),
        ];

        return { writes, result: true };
      });

      res.json({
        ok: true,
        withdrawalId,
        transactionCode,
        grossAmount,
        feeAmount,
        netAmount,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 6. Password Change Request Workflow (Zero Plaintext Password Storage)
  // =========================================================================
  app.post(
    '/api/password-requests',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.authUser!;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 400) : '';

        if (reason.length < 5) {
          throw new HttpError(400, 'Please provide a brief security reason (at least 5 characters).');
        }

        const existingRequests = await queryByUserFieldRest('passwordChangeRequests', 'userId', user.uid, user.idToken);
        const activeReq = existingRequests.find(
          (r) => r.data.status === 'pending' || r.data.status === 'approved'
        );
        if (activeReq) {
          throw new HttpError(
            409,
            activeReq.data.status === 'pending'
              ? 'You already have a password change request awaiting Admin review.'
              : 'Your previous password change request is already approved and ready to use in Settings.'
          );
        }

        const requestId = generateDocId('pcr');

        await runAtomicTransaction(user.idToken, async (tx) => {
          const profile = await tx.get('users', user.uid);
          if (!profile || profile.data.status !== 'approved') {
            throw new HttpError(403, 'Only approved members can submit password change requests.');
          }

          const writes = [
            buildCreateWrite(
              'passwordChangeRequests',
              requestId,
              {
                requestId,
                userId: user.uid,
                memberId: String(profile.data.memberId),
                memberName: String(profile.data.fullName),
                memberEmail: String(profile.data.email),
                authProvider: profile.data.authProvider === 'google.com' ? 'google.com' : 'password',
                reason,
                status: 'pending',
                decisionNote: '',
                reviewedBy: '',
                reviewedAt: '',
              },
              ['createdAt', 'updatedAt']
            ),
          ];

          return { writes, result: true };
        });

        res.json({ ok: true, requestId });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/password-requests/:requestId/complete',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.authUser!;
        const requestId = String(req.params.requestId || '');
        if (!VALID_ID_REGEX.test(requestId)) {
          throw new HttpError(400, 'Invalid request ID.');
        }

        const nowIso = new Date().toISOString();

        await runAtomicTransaction(user.idToken, async (tx) => {
          const pcr = await tx.get('passwordChangeRequests', requestId);
          if (!pcr || pcr.data.userId !== user.uid) {
            throw new HttpError(404, 'Password change request not found.');
          }
          if (pcr.data.status !== 'approved') {
            throw new HttpError(400, 'This password change request is not in an approved state.');
          }

          const profile = await tx.get('users', user.uid);
          if (!profile) {
            throw new HttpError(404, 'Member profile not found.');
          }

          const writes = [
            buildReplaceUpdateWrite(
              'passwordChangeRequests',
              requestId,
              {
                ...pcr.data,
                status: 'completed',
                createdAt: preserveTimestamp(pcr.raw, 'createdAt'),
              },
              pcr.updateTime
            ),
            buildReplaceUpdateWrite(
              'users',
              user.uid,
              {
                ...profile.data,
                lastPasswordChangedAt: nowIso,
                createdAt: preserveTimestamp(profile.raw, 'createdAt'),
              },
              profile.updateTime
            ),
          ];

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // =========================================================================
  // 7. Admin Operations (RBAC Enforced + Immutable Audit Logs)
  // =========================================================================

  // 7A. Approve or Reject Member Registration
  app.post(
    '/api/admin/members/:targetUid/review',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const targetUid = String(req.params.targetUid || '');
        const decision = req.body?.decision;
        const rejectionReason =
          typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason.trim().slice(0, 300) : '';

        if (!VALID_ID_REGEX.test(targetUid)) {
          throw new HttpError(400, 'Invalid member UID.');
        }
        if (decision !== 'approved' && decision !== 'rejected') {
          throw new HttpError(400, 'Decision must be approved or rejected.');
        }
        const finalMemberRejectReason =
          decision === 'rejected'
            ? rejectionReason || 'Application did not meet verification requirements'
            : '';

        await runAtomicTransaction(admin.idToken, async (tx) => {
          const targetUser = await tx.get('users', targetUid);
          if (!targetUser) {
            throw new HttpError(404, 'Member registration not found.');
          }
          if (targetUser.data.role === 'admin') {
            throw new HttpError(400, 'Cannot modify another Admin role status here.');
          }

          const targetWallet = await tx.get('wallets', targetUid);
          const logId = generateDocId('log');

          const writes = [
            buildReplaceUpdateWrite(
              'users',
              targetUid,
              {
                ...targetUser.data,
                status: decision,
                rejectionReason: finalMemberRejectReason,
                createdAt: preserveTimestamp(targetUser.raw, 'createdAt'),
              },
              targetUser.updateTime
            ),
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: admin.uid,
                adminEmail: admin.email,
                action: decision === 'approved' ? 'MEMBER_APPROVED' : 'MEMBER_REJECTED',
                targetType: 'user',
                targetId: targetUid,
                summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} member ${targetUser.data.memberId} (${targetUser.data.fullName})`,
              },
              ['createdAt']
            ),
          ];

          if (!targetWallet) {
            writes.push(
              buildCreateWrite(
                'wallets',
                targetUid,
                {
                  userId: targetUid,
                  memberId: String(targetUser.data.memberId),
                  availableBalance: 0,
                  totalEarnings: 0,
                  totalWithdrawals: 0,
                  totalWithdrawalFees: 0,
                  reservedWithdrawals: 0,
                  lastWithdrawalId: '',
                },
                ['createdAt', 'updatedAt']
              )
            );
          }

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 7B. Create Task
  app.post('/api/admin/tasks', requireVerifiedAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authUser!;
      await assertCallerIsAdmin(admin);

      const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 140) : '';
      const instructions =
        typeof req.body?.instructions === 'string' ? req.body.instructions.trim().slice(0, 2000) : '';
      const externalLink =
        typeof req.body?.externalLink === 'string' ? req.body.externalLink.trim().slice(0, 500) : '';
      const rewardAmount = Number(req.body?.rewardAmount);
      const isActive = req.body?.isActive !== false;

      if (title.length < 3) {
        throw new HttpError(400, 'Task title must be at least 3 characters.');
      }
      if (instructions.length < 5) {
        throw new HttpError(400, 'Task instructions must be at least 5 characters.');
      }
      if (!/^https?:\/\/.+/i.test(externalLink)) {
        throw new HttpError(400, 'External task link must start with http:// or https://.');
      }
      if (!Number.isInteger(rewardAmount) || rewardAmount < 1 || rewardAmount > 100000) {
        throw new HttpError(400, 'Reward amount must be a whole Taka integer between ৳1 and ৳100,000.');
      }

      const taskId = generateDocId('tsk');
      const taskCode = generateNumericCode('TSK', 5);
      const logId = generateDocId('log');

      await commitSingleOrBatchWrites(admin.idToken, [
        buildCreateWrite(
          'tasks',
          taskId,
          {
            taskId,
            taskCode,
            title,
            instructions,
            externalLink,
            rewardAmount,
            isActive,
            createdBy: admin.uid,
          },
          ['createdAt', 'updatedAt']
        ),
        buildCreateWrite(
          'adminAuditLogs',
          logId,
          {
            logId,
            adminUid: admin.uid,
            adminEmail: admin.email,
            action: 'TASK_CREATED',
            targetType: 'task',
            targetId: taskId,
            summary: `Created task ${taskCode} "${title}" with reward ৳${rewardAmount}`,
          },
          ['createdAt']
        ),
      ]);

      res.json({ ok: true, taskId, taskCode });
    } catch (err) {
      next(err);
    }
  });

  // 7C. Edit / Activate / Deactivate Task
  app.put(
    '/api/admin/tasks/:taskId',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const taskId = String(req.params.taskId || '');
        if (!VALID_ID_REGEX.test(taskId)) {
          throw new HttpError(400, 'Invalid task ID.');
        }

        const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 140) : '';
        const instructions =
          typeof req.body?.instructions === 'string' ? req.body.instructions.trim().slice(0, 2000) : '';
        const externalLink =
          typeof req.body?.externalLink === 'string' ? req.body.externalLink.trim().slice(0, 500) : '';
        const rewardAmount = Number(req.body?.rewardAmount);
        const isActive = Boolean(req.body?.isActive);

        if (title.length < 3 || instructions.length < 5) {
          throw new HttpError(400, 'Valid title and instructions are required.');
        }
        if (!/^https?:\/\/.+/i.test(externalLink)) {
          throw new HttpError(400, 'External link must start with http:// or https://.');
        }
        if (!Number.isInteger(rewardAmount) || rewardAmount < 1 || rewardAmount > 100000) {
          throw new HttpError(400, 'Reward amount must be a whole Taka integer between ৳1 and ৳100,000.');
        }

        await runAtomicTransaction(admin.idToken, async (tx) => {
          const existingTask = await tx.get('tasks', taskId);
          if (!existingTask) {
            throw new HttpError(404, 'Task not found.');
          }

          const logId = generateDocId('log');
          const writes = [
            buildReplaceUpdateWrite(
              'tasks',
              taskId,
              {
                ...existingTask.data,
                title,
                instructions,
                externalLink,
                rewardAmount,
                isActive,
                createdAt: preserveTimestamp(existingTask.raw, 'createdAt'),
              },
              existingTask.updateTime
            ),
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: admin.uid,
                adminEmail: admin.email,
                action: 'TASK_UPDATED',
                targetType: 'task',
                targetId: taskId,
                summary: `Updated task ${existingTask.data.taskCode} ("${title}", ৳${rewardAmount}, ${isActive ? 'Active' : 'Inactive'})`,
              },
              ['createdAt']
            ),
          ];

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 7D. Review Official Proof Submission & Atomically Credit Task Reward Exactly Once (Main Admin or Assistant Admin)
  app.post(
    '/api/admin/submissions/:submissionId/review',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const reviewerAuth = req.authUser!;
        const reviewerInfo = await assertCallerIsAdminOrAssistant(reviewerAuth);

        const submissionId = String(req.params.submissionId || '');
        const decision = req.body?.decision;
        const rawReason =
          typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason.trim().slice(0, 300) : '';

        if (!VALID_ID_REGEX.test(submissionId)) {
          throw new HttpError(400, 'Invalid submission ID.');
        }
        if (decision !== 'approved' && decision !== 'rejected') {
          throw new HttpError(400, 'Decision must be approved or rejected.');
        }
        if (decision === 'rejected' && rawReason.length < 3) {
          throw new HttpError(400, 'Please enter a rejection reason (at least 3 characters) when rejecting a task.');
        }
        const rejectionReason = decision === 'rejected' ? rawReason : '';

        const nowIso = new Date().toISOString();

        await runAtomicTransaction(reviewerAuth.idToken, async (tx) => {
          const submission = await tx.get('submissions', submissionId);
          if (!submission) {
            throw new HttpError(404, 'Submission not found.');
          }
          if (submission.data.status !== 'pending') {
            throw new HttpError(
              409,
              `Submission has already been ${submission.data.status}. Duplicate review blocked.`
            );
          }

          const memberUid = String(submission.data.userId);
          const memberCode = String(submission.data.memberId || 'MTS-000000');
          const taskId = String(submission.data.taskId || '').trim();
          const taskTitle = String(submission.data.taskTitle || 'Official Task').slice(0, 400);
          const taskCode = String(submission.data.taskCode || 'TSK-00000').slice(0, 20);
          const screenshotAssetId = String(submission.data.screenshotAssetId || '').trim();
          const rewardAmount = Number(submission.data.rewardAmount);

          const nowMs = Date.parse(nowIso);
          const monthKey = getDhakaMonthKey(nowMs);
          const monthlyEntryId = buildMonthlyEntryId(monthKey, memberUid);

          const [memberProfile, memberWallet, monthlyEntry] = await Promise.all([
            tx.get('users', memberUid),
            tx.get('wallets', memberUid),
            decision === 'approved'
              ? tx.get('monthlyMemberEarnings', monthlyEntryId)
              : Promise.resolve(null),
          ]);

          const logId = generateDocId('log');
          const notifId = generateDocId('ntf');
          const writes: RestWriteOperation[] = [];

          if (decision === 'approved') {
            // Delete approved submission and its heavy proof screenshot immediately to conserve Firestore quota
            writes.push(buildDeleteWrite('submissions', submissionId));
            if (screenshotAssetId && VALID_ID_REGEX.test(screenshotAssetId)) {
              writes.push(buildDeleteWrite('mediaAssets', screenshotAssetId));
            }

            // Deterministic ledger ID prevents duplicate wallet credits for the same submission
            const txLedgerId = `tx_reward_${submissionId}`;

            if (memberWallet) {
              const prevAvail = Number(memberWallet.data.availableBalance || 0);
              const prevWalletEarnings = Number(memberWallet.data.totalEarnings || 0);
              writes.push(
                buildReplaceUpdateWrite(
                  'wallets',
                  memberUid,
                  {
                    ...memberWallet.data,
                    availableBalance: prevAvail + rewardAmount,
                    totalEarnings: prevWalletEarnings + rewardAmount,
                    lastCreditedSubmissionId: submissionId,
                    createdAt: preserveTimestamp(memberWallet.raw, 'createdAt'),
                  },
                  memberWallet.updateTime
                )
              );
            } else {
              writes.push(
                buildCreateWrite(
                  'wallets',
                  memberUid,
                  {
                    userId: memberUid,
                    memberId: memberCode,
                    availableBalance: rewardAmount,
                    totalEarnings: rewardAmount,
                    totalWithdrawals: 0,
                    totalWithdrawalFees: 0,
                    reservedWithdrawals: 0,
                    lastWithdrawalId: '',
                    lastCreditedSubmissionId: submissionId,
                  },
                  ['createdAt', 'updatedAt']
                )
              );
            }

            if (memberProfile) {
              const prevPending = Number(memberProfile.data.pendingSubmissionsCount || 0);
              const prevCompleted = Number(memberProfile.data.completedTasksCount || 0);
              const prevUserEarnings = Number(memberProfile.data.totalEarnings || 0);
              writes.push(
                buildReplaceUpdateWrite(
                  'users',
                  memberUid,
                  {
                    ...memberProfile.data,
                    pendingSubmissionsCount: Math.max(0, prevPending - 1),
                    completedTasksCount: prevCompleted + 1,
                    totalEarnings: prevUserEarnings + rewardAmount,
                    createdAt: preserveTimestamp(memberProfile.raw, 'createdAt'),
                  },
                  memberProfile.updateTime
                )
              );

              if (
                memberProfile.data.role === 'member' &&
                memberProfile.data.status === 'approved' &&
                monthlyEntryId.length <= 128
              ) {
                const displayName =
                  String(
                    memberProfile.data.fullName || submission.data.memberName || 'Member'
                  )
                    .trim()
                    .slice(0, 300) || 'Member';
                const photoAssetId = sanitizeFirestoreId(memberProfile.data.photoAssetId, '');
                if (monthlyEntry) {
                  writes.push(
                    buildReplaceUpdateWrite(
                      'monthlyMemberEarnings',
                      monthlyEntryId,
                      {
                        entryId: monthlyEntryId,
                        monthKey,
                        userId: memberUid,
                        displayName,
                        photoAssetId,
                        isEligibleMember: true,
                        eligibleEarnings:
                          Number(monthlyEntry.data.eligibleEarnings || 0) + rewardAmount,
                        approvedTaskCount:
                          Number(monthlyEntry.data.approvedTaskCount || 0) + 1,
                        reachedAtMs: Math.max(
                          nowMs,
                          Number(monthlyEntry.data.reachedAtMs || 0)
                        ),
                        lastTransactionId: txLedgerId,
                        lastSubmissionId: submissionId,
                        createdAt: preserveTimestamp(monthlyEntry.raw, 'createdAt'),
                      },
                      monthlyEntry.updateTime
                    )
                  );
                } else {
                  writes.push(
                    buildCreateWrite(
                      'monthlyMemberEarnings',
                      monthlyEntryId,
                      {
                        entryId: monthlyEntryId,
                        monthKey,
                        userId: memberUid,
                        displayName,
                        photoAssetId,
                        isEligibleMember: true,
                        eligibleEarnings: rewardAmount,
                        approvedTaskCount: 1,
                        reachedAtMs: nowMs,
                        lastTransactionId: txLedgerId,
                        lastSubmissionId: submissionId,
                      },
                      ['createdAt', 'updatedAt']
                    )
                  );
                }
              }
            }

            writes.push(
              buildCreateWrite(
                'transactions',
                txLedgerId,
                {
                  transactionId: txLedgerId,
                  userId: memberUid,
                  memberId: memberCode,
                  type: 'task_reward',
                  amount: rewardAmount,
                  feeAmount: 0,
                  netAmount: rewardAmount,
                  direction: 'credit',
                  description: `Task reward credited for ${taskCode} (${taskTitle.slice(0, 140)})`.slice(0, 240),
                  referenceId: submissionId,
                  ...(taskId && VALID_ID_REGEX.test(taskId) ? { taskId } : {}),
                  taskCode,
                  taskName: taskTitle,
                  submissionId,
                  approvedAt: nowIso,
                },
                ['createdAt']
              ),
              buildCreateWrite(
                'notifications',
                notifId,
                {
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
                },
                ['createdAt', 'updatedAt']
              ),
              buildCreateWrite(
                'adminAuditLogs',
                logId,
                {
                  logId,
                  adminUid: reviewerAuth.uid,
                  adminEmail: reviewerAuth.email || reviewerInfo.reviewerId,
                  action: 'SUBMISSION_APPROVED',
                  targetType: 'submission',
                  targetId: submissionId,
                  summary: `[${reviewerInfo.role === 'admin' ? 'Main Admin' : 'Assistant Admin'} ${reviewerInfo.reviewerId}] Approved proof for ${taskCode} by ${memberCode}, credited ৳${rewardAmount}, and cleared proof storage`.slice(
                    0,
                    450
                  ),
                },
                ['createdAt']
              )
            );
          } else {
            writes.push(
              buildReplaceUpdateWrite(
                'submissions',
                submissionId,
                {
                  ...submission.data,
                  status: 'rejected',
                  rejectionReason,
                  reviewedBy: reviewerAuth.uid,
                  reviewerId: reviewerInfo.reviewerId,
                  reviewerName: reviewerInfo.reviewerName,
                  reviewerRole: reviewerInfo.role,
                  reviewAction: 'rejected',
                  reviewedAt: nowIso,
                  createdAt: preserveTimestamp(submission.raw, 'createdAt'),
                },
                submission.updateTime
              )
            );

            if (memberProfile) {
              const prevPending = Number(memberProfile.data.pendingSubmissionsCount || 0);
              writes.push(
                buildReplaceUpdateWrite(
                  'users',
                  memberUid,
                  {
                    ...memberProfile.data,
                    pendingSubmissionsCount: Math.max(0, prevPending - 1),
                    createdAt: preserveTimestamp(memberProfile.raw, 'createdAt'),
                  },
                  memberProfile.updateTime
                )
              );
            }
            writes.push(
              buildCreateWrite(
                'notifications',
                notifId,
                {
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
                },
                ['createdAt', 'updatedAt']
              ),
              buildCreateWrite(
                'adminAuditLogs',
                logId,
                {
                  logId,
                  adminUid: reviewerAuth.uid,
                  adminEmail: reviewerAuth.email || reviewerInfo.reviewerId,
                  action: 'SUBMISSION_REJECTED',
                  targetType: 'submission',
                  targetId: submissionId,
                  summary: `[${reviewerInfo.role === 'admin' ? 'Main Admin' : 'Assistant Admin'} ${reviewerInfo.reviewerId}] Rejected proof for ${taskCode} by ${memberCode}: ${rejectionReason}`.slice(
                    0,
                    450
                  ),
                },
                ['createdAt']
              )
            );
          }

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 7E. Process Withdrawal Request (Mark Paid Without Double-Charging OR Reject With Full Gross Refund)
  app.post(
    '/api/admin/withdrawals/:withdrawalId/process',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const withdrawalId = String(req.params.withdrawalId || '');
        const decision = req.body?.decision;
        const paymentReference =
          typeof req.body?.paymentReference === 'string' ? req.body.paymentReference.trim().slice(0, 100) : '';
        const adminNote =
          typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim().slice(0, 300) : '';

        if (!VALID_ID_REGEX.test(withdrawalId)) {
          throw new HttpError(400, 'Invalid withdrawal ID.');
        }
        if (decision !== 'paid' && decision !== 'rejected') {
          throw new HttpError(400, 'Decision must be paid or rejected.');
        }
        if (decision === 'rejected' && adminNote.length < 3) {
          throw new HttpError(400, 'Please provide a rejection reason for the refund record.');
        }

        const nowIso = new Date().toISOString();

        await runAtomicTransaction(admin.idToken, async (tx) => {
          const withdrawal = await tx.get('withdrawals', withdrawalId);
          if (!withdrawal) {
            throw new HttpError(404, 'Withdrawal request not found.');
          }
          if (withdrawal.data.status !== 'pending') {
            throw new HttpError(
              409,
              `Withdrawal ${withdrawal.data.transactionCode} is already ${withdrawal.data.status}. Duplicate processing prevented.`
            );
          }

          const memberUid = String(withdrawal.data.userId);
          const grossAmount = Number(withdrawal.data.grossAmount);
          const feeAmount = Number(withdrawal.data.feeAmount);
          const netAmount = Number(withdrawal.data.netAmount);
          const payoutMethod = String(withdrawal.data.payoutMethod);
          const txCode = String(withdrawal.data.transactionCode);

          const wallet = await tx.get('wallets', memberUid);
          if (!wallet) {
            throw new HttpError(404, 'Member wallet not found.');
          }

          const prevAvail = Number(wallet.data.availableBalance || 0);
          const prevReserved = Number(wallet.data.reservedWithdrawals || 0);
          const prevTotalWithdrawals = Number(wallet.data.totalWithdrawals || 0);
          const prevTotalFees = Number(wallet.data.totalWithdrawalFees || 0);

          const txLedgerId = generateDocId('tx');
          const logId = generateDocId('log');

          const writes = [
            buildReplaceUpdateWrite(
              'withdrawals',
              withdrawalId,
              {
                ...withdrawal.data,
                status: decision,
                paymentReference: decision === 'paid' ? paymentReference : '',
                adminNote,
                processedBy: admin.uid,
                processedAt: nowIso,
                createdAt: preserveTimestamp(withdrawal.raw, 'createdAt'),
              },
              withdrawal.updateTime
            ),
          ];

          if (decision === 'paid') {
            // Gross amount was ALREADY reserved when the request was submitted; never charge fee or balance twice!
            writes.push(
              buildReplaceUpdateWrite(
                'wallets',
                memberUid,
                {
                  ...wallet.data,
                  reservedWithdrawals: Math.max(0, prevReserved - grossAmount),
                  totalWithdrawals: prevTotalWithdrawals + grossAmount,
                  totalWithdrawalFees: prevTotalFees + feeAmount,
                  createdAt: preserveTimestamp(wallet.raw, 'createdAt'),
                },
                wallet.updateTime
              ),
              buildCreateWrite(
                'transactions',
                txLedgerId,
                {
                  transactionId: txLedgerId,
                  userId: memberUid,
                  memberId: String(withdrawal.data.memberId),
                  type: 'withdrawal_paid',
                  amount: grossAmount,
                  feeAmount,
                  netAmount,
                  direction: 'settlement',
                  description: `${payoutMethod} payout completed (${txCode})${paymentReference ? ` · Ref ${paymentReference}` : ''} · Sent ৳${netAmount} (Fee ৳${feeAmount})`,
                  referenceId: withdrawalId,
                },
                ['createdAt']
              ),
              buildCreateWrite(
                'adminAuditLogs',
                logId,
                {
                  logId,
                  adminUid: admin.uid,
                  adminEmail: admin.email,
                  action: 'WITHDRAWAL_PAID',
                  targetType: 'withdrawal',
                  targetId: withdrawalId,
                  summary: `Marked withdrawal ${txCode} Paid via ${payoutMethod}: Gross ৳${grossAmount}, Fee ৳${feeAmount}, Net Sent ৳${netAmount}`,
                },
                ['createdAt']
              )
            );
          } else {
            // Consistent Refund Policy: Full 100% gross amount (including the 5 BDT fee) is refunded to availableBalance
            writes.push(
              buildReplaceUpdateWrite(
                'wallets',
                memberUid,
                {
                  ...wallet.data,
                  availableBalance: prevAvail + grossAmount,
                  reservedWithdrawals: Math.max(0, prevReserved - grossAmount),
                  createdAt: preserveTimestamp(wallet.raw, 'createdAt'),
                },
                wallet.updateTime
              ),
              buildCreateWrite(
                'transactions',
                txLedgerId,
                {
                  transactionId: txLedgerId,
                  userId: memberUid,
                  memberId: String(withdrawal.data.memberId),
                  type: 'withdrawal_refund',
                  amount: grossAmount,
                  feeAmount: 0,
                  netAmount: grossAmount,
                  direction: 'credit',
                  description: `Full refund for rejected ${payoutMethod} withdrawal (${txCode}): ৳${grossAmount} restored (${adminNote})`,
                  referenceId: withdrawalId,
                },
                ['createdAt']
              ),
              buildCreateWrite(
                'adminAuditLogs',
                logId,
                {
                  logId,
                  adminUid: admin.uid,
                  adminEmail: admin.email,
                  action: 'WITHDRAWAL_REJECTED_REFUNDED',
                  targetType: 'withdrawal',
                  targetId: withdrawalId,
                  summary: `Rejected withdrawal ${txCode} and refunded full ৳${grossAmount} to ${withdrawal.data.memberId}: ${adminNote}`,
                },
                ['createdAt']
              )
            );
          }

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 7F. Approve or Reject Password Change Request
  app.post(
    '/api/admin/password-requests/:requestId/review',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const requestId = String(req.params.requestId || '');
        const decision = req.body?.decision;
        const decisionNote =
          typeof req.body?.decisionNote === 'string' ? req.body.decisionNote.trim().slice(0, 300) : '';

        if (!VALID_ID_REGEX.test(requestId)) {
          throw new HttpError(400, 'Invalid request ID.');
        }
        if (decision !== 'approved' && decision !== 'rejected') {
          throw new HttpError(400, 'Decision must be approved or rejected.');
        }

        const nowIso = new Date().toISOString();

        await runAtomicTransaction(admin.idToken, async (tx) => {
          const pcr = await tx.get('passwordChangeRequests', requestId);
          if (!pcr) {
            throw new HttpError(404, 'Password change request not found.');
          }
          if (pcr.data.status !== 'pending') {
            throw new HttpError(409, `Request is already ${pcr.data.status}.`);
          }

          const logId = generateDocId('log');
          const writes = [
            buildReplaceUpdateWrite(
              'passwordChangeRequests',
              requestId,
              {
                ...pcr.data,
                status: decision,
                decisionNote,
                reviewedBy: admin.uid,
                reviewedAt: nowIso,
                createdAt: preserveTimestamp(pcr.raw, 'createdAt'),
              },
              pcr.updateTime
            ),
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: admin.uid,
                adminEmail: admin.email,
                action: decision === 'approved' ? 'PASSWORD_REQUEST_APPROVED' : 'PASSWORD_REQUEST_REJECTED',
                targetType: 'passwordChangeRequest',
                targetId: requestId,
                summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} password change request for ${pcr.data.memberId}`,
              },
              ['createdAt']
            ),
          ];

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // =========================================================================
  // 8. Assistant Admin Creation & Management (Main Admin Exclusive)
  // =========================================================================
  app.post(
    '/api/admin/assistants',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().slice(0, 100) : '';
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 25) : '';

        if (fullName.length < 2) {
          throw new HttpError(400, 'Assistant Admin full name must be between 2 and 100 characters.');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) {
          throw new HttpError(400, 'Enter a valid email address for the Assistant Admin.');
        }
        if (password.length < 6 || password.length > 128) {
          throw new HttpError(400, 'Password must be between 6 and 128 characters.');
        }
        if (phone && !BD_PHONE_REGEX.test(phone)) {
          throw new HttpError(400, 'Enter a valid Bangladeshi phone number (e.g., 01712345678).');
        }

        // Create Firebase Auth user via Identity Toolkit REST API so Main Admin stays signed in
        const signUpRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
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
            throw new HttpError(
              409,
              'An account with this email already exists. Promote that existing account directly in the Assistant Admins section.'
            );
          }
          if (code.includes('OPERATION_NOT_ALLOWED')) {
            throw new HttpError(
              400,
              'Email/Password sign-in is disabled in Firebase Console. Enable Email/Password or promote a Google-registered member.'
            );
          }
          throw new HttpError(400, `Could not create Assistant Admin credentials: ${code || 'Invalid input'}`);
        }

        const newUid = signUpBody.localId;
        if (signUpBody.idToken) {
          await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
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

        const memberId = generateNumericCode('MTS', 6);
        const logId = generateDocId('log');

        await commitSingleOrBatchWrites(admin.idToken, [
          buildCreateWrite(
            'assistantAdmins',
            newUid,
            {
              uid: newUid,
              memberId,
              fullName,
              email,
              createdBy: admin.uid,
            },
            ['createdAt']
          ),
          buildCreateWrite(
            'users',
            newUid,
            {
              uid: newUid,
              memberId,
              fullName,
              email,
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
            },
            ['createdAt', 'updatedAt']
          ),
          buildCreateWrite(
            'wallets',
            newUid,
            {
              userId: newUid,
              memberId,
              availableBalance: 0,
              totalEarnings: 0,
              totalWithdrawals: 0,
              totalWithdrawalFees: 0,
              reservedWithdrawals: 0,
              lastWithdrawalId: '',
            },
            ['createdAt', 'updatedAt']
          ),
          buildCreateWrite(
            'adminAuditLogs',
            logId,
            {
              logId,
              adminUid: admin.uid,
              adminEmail: admin.email,
              action: 'ASSISTANT_ADMIN_CREATED',
              targetType: 'assistantAdmin',
              targetId: newUid,
              summary: `Created Assistant Admin account ${memberId} (${fullName} · ${email})`.slice(0, 450),
            },
            ['createdAt']
          ),
        ]);

        res.json({ ok: true, uid: newUid, memberId });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/admin/assistants/:targetUid/role',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const targetUid = String(req.params.targetUid || '');
        const action = req.body?.action;
        const reason =
          typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';

        if (!VALID_ID_REGEX.test(targetUid)) {
          throw new HttpError(400, 'Invalid target account ID.');
        }
        if (action !== 'promote' && action !== 'suspend' && action !== 'reactivate' && action !== 'demote') {
          throw new HttpError(400, 'Action must be promote, suspend, reactivate, or demote.');
        }

        await runAtomicTransaction(admin.idToken, async (tx) => {
          const targetUser = await tx.get('users', targetUid);
          if (!targetUser) {
            throw new HttpError(404, 'Target account not found.');
          }
          if (targetUser.data.role === 'admin' || targetUid === admin.uid) {
            throw new HttpError(400, 'Cannot modify Main Admin role.');
          }

          const existingAssistant = await tx.get('assistantAdmins', targetUid);
          const logId = generateDocId('log');
          const writes = [];

          if (action === 'promote' || action === 'reactivate') {
            writes.push(
              buildReplaceUpdateWrite(
                'users',
                targetUid,
                {
                  ...targetUser.data,
                  role: 'assistant_admin',
                  status: 'approved',
                  rejectionReason: '',
                  createdAt: preserveTimestamp(targetUser.raw, 'createdAt'),
                },
                targetUser.updateTime
              )
            );
            if (!existingAssistant) {
              writes.push(
                buildCreateWrite(
                  'assistantAdmins',
                  targetUid,
                  {
                    uid: targetUid,
                    memberId: String(targetUser.data.memberId),
                    fullName: String(targetUser.data.fullName),
                    email: String(targetUser.data.email),
                    createdBy: admin.uid,
                  },
                  ['createdAt']
                )
              );
            }
          } else if (action === 'suspend') {
            writes.push(
              buildReplaceUpdateWrite(
                'users',
                targetUid,
                {
                  ...targetUser.data,
                  role: 'assistant_admin',
                  status: 'rejected',
                  rejectionReason: reason || 'Assistant Admin access suspended by Main Admin',
                  createdAt: preserveTimestamp(targetUser.raw, 'createdAt'),
                },
                targetUser.updateTime
              )
            );
            if (existingAssistant) {
              writes.push(buildDeleteWrite('assistantAdmins', targetUid));
            }
          } else {
            // demote back to approved member
            writes.push(
              buildReplaceUpdateWrite(
                'users',
                targetUid,
                {
                  ...targetUser.data,
                  role: 'member',
                  status: 'approved',
                  rejectionReason: '',
                  createdAt: preserveTimestamp(targetUser.raw, 'createdAt'),
                },
                targetUser.updateTime
              )
            );
            if (existingAssistant) {
              writes.push(buildDeleteWrite('assistantAdmins', targetUid));
            }
          }

          writes.push(
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: admin.uid,
                adminEmail: admin.email,
                action: `ASSISTANT_ADMIN_${String(action).toUpperCase()}`,
                targetType: 'assistantAdmin',
                targetId: targetUid,
                summary: `${String(action).toUpperCase()} Assistant Admin role for ${targetUser.data.memberId} (${targetUser.data.fullName})`.slice(
                  0,
                  450
                ),
              },
              ['createdAt']
            )
          );

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // =========================================================================
  // 9. Custom Task Submission, Assistant Review & Main Admin Payment Approval
  // =========================================================================

  // 9A. Approved Member Submits Custom Task (Never credits wallet on submit)
  app.post(
    '/api/custom-tasks',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.authUser!;
        const taskName =
          typeof req.body?.taskName === 'string' ? req.body.taskName.trim().slice(0, 140) : '';
        const taskDetails =
          typeof req.body?.taskDetails === 'string' ? req.body.taskDetails.trim().slice(0, 2000) : '';
        const requestedAmount = Number(req.body?.requestedAmount);
        const screenshotAssetId =
          typeof req.body?.screenshotAssetId === 'string' ? req.body.screenshotAssetId.trim() : '';

        if (taskName.length < 2) {
          throw new HttpError(400, 'Task Name must be at least 2 characters.');
        }
        if (taskDetails.length < 5) {
          throw new HttpError(400, 'Task Details must be at least 5 characters.');
        }
        if (!Number.isFinite(requestedAmount) || !Number.isInteger(requestedAmount) || requestedAmount < 1 || requestedAmount > 100000) {
          throw new HttpError(400, 'Requested Amount must be a whole Taka integer between ৳1 and ৳100,000.');
        }
        if (screenshotAssetId && !VALID_ID_REGEX.test(screenshotAssetId)) {
          throw new HttpError(400, 'Invalid proof screenshot reference.');
        }

        const customTaskId = generateDocId('ctk');
        const customTaskCode = generateNumericCode('CTK', 5);

        await runAtomicTransaction(user.idToken, async (tx) => {
          const profile = await tx.get('users', user.uid);
          if (!profile || profile.data.status !== 'approved') {
            throw new HttpError(403, 'Your account must be approved before submitting a custom task.');
          }

          if (screenshotAssetId) {
            const asset = await tx.get('mediaAssets', screenshotAssetId);
            if (!asset || asset.data.ownerId !== user.uid || asset.data.purpose !== 'proof') {
              throw new HttpError(403, 'Invalid proof screenshot asset.');
            }
          }

          const writes = [
            buildCreateWrite(
              'customTasks',
              customTaskId,
              {
                customTaskId,
                customTaskCode,
                userId: user.uid,
                memberId: String(profile.data.memberId),
                memberName: String(profile.data.fullName),
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
              },
              ['createdAt', 'updatedAt']
            ),
          ];

          return { writes, result: true };
        });

        res.json({ ok: true, customTaskId, customTaskCode });
      } catch (err) {
        next(err);
      }
    }
  );

  // 9B. Assistant Admin (or Main Admin) Inspects Custom Task & Recommends (Zero Wallet Credit)
  app.post(
    '/api/admin/custom-tasks/:customTaskId/assist-review',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const reviewerAuth = req.authUser!;
        const reviewerInfo = await assertCallerIsAdminOrAssistant(reviewerAuth);

        const customTaskId = String(req.params.customTaskId || '');
        const assistantStatus = req.body?.assistantStatus;
        const assistantNote =
          typeof req.body?.assistantNote === 'string' ? req.body.assistantNote.trim().slice(0, 300) : '';

        if (!VALID_ID_REGEX.test(customTaskId)) {
          throw new HttpError(400, 'Invalid custom task ID.');
        }
        if (
          assistantStatus !== 'reviewed' &&
          assistantStatus !== 'recommended_approve' &&
          assistantStatus !== 'recommended_reject'
        ) {
          throw new HttpError(400, 'Invalid inspection status.');
        }
        if (assistantStatus === 'recommended_reject' && assistantNote.length < 3) {
          throw new HttpError(400, 'Please enter a recommendation note (at least 3 characters) when recommending rejection.');
        }

        const nowIso = new Date().toISOString();

        await runAtomicTransaction(reviewerAuth.idToken, async (tx) => {
          const customTask = await tx.get('customTasks', customTaskId);
          if (!customTask) {
            throw new HttpError(404, 'Custom task submission not found.');
          }
          if (customTask.data.status !== 'pending') {
            throw new HttpError(409, `Custom task has already been ${customTask.data.status} by Main Admin.`);
          }

          const logId = generateDocId('log');
          const writes = [
            buildReplaceUpdateWrite(
              'customTasks',
              customTaskId,
              {
                ...customTask.data,
                assistantStatus,
                assistantNote,
                assistantReviewedBy: reviewerAuth.uid,
                assistantReviewerId: reviewerInfo.reviewerId,
                assistantReviewerName: reviewerInfo.reviewerName,
                assistantReviewedAt: nowIso,
                createdAt: preserveTimestamp(customTask.raw, 'createdAt'),
              },
              customTask.updateTime
            ),
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: reviewerAuth.uid,
                adminEmail: reviewerAuth.email || reviewerInfo.reviewerId,
                action: 'CUSTOM_TASK_INSPECTED',
                targetType: 'customTask',
                targetId: customTaskId,
                summary: `[${reviewerInfo.reviewerId}] Marked custom task ${customTask.data.customTaskCode} as ${assistantStatus}${assistantNote ? `: ${assistantNote}` : ''}`.slice(
                  0,
                  450
                ),
              },
              ['createdAt']
            ),
          ];

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 9C. Main Admin Exclusive Final Approval or Rejection of Custom Task Payment
  app.post(
    '/api/admin/custom-tasks/:customTaskId/decision',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        const adminInfo = await assertCallerIsAdmin(admin);

        const customTaskId = String(req.params.customTaskId || '');
        const decision = req.body?.decision;
        const rawApprovedAmount = req.body?.approvedAmount;
        const rawReason =
          typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason.trim().slice(0, 300) : '';

        if (!VALID_ID_REGEX.test(customTaskId)) {
          throw new HttpError(400, 'Invalid custom task ID.');
        }
        if (decision !== 'approved' && decision !== 'rejected') {
          throw new HttpError(400, 'Decision must be approved or rejected.');
        }
        if (decision === 'rejected' && rawReason.length < 3) {
          throw new HttpError(400, 'Please provide a rejection reason (at least 3 characters).');
        }

        const nowIso = new Date().toISOString();

        await runAtomicTransaction(admin.idToken, async (tx) => {
          const customTask = await tx.get('customTasks', customTaskId);
          if (!customTask) {
            throw new HttpError(404, 'Custom task submission not found.');
          }
          if (customTask.data.status !== 'pending') {
            throw new HttpError(
              409,
              `Custom task ${customTask.data.customTaskCode} has already been ${customTask.data.status}. Duplicate payment prevented.`
            );
          }

          const memberUid = String(customTask.data.userId);
          const memberCode = String(customTask.data.memberId || 'MTS-000000');
          const taskName = String(customTask.data.taskName || 'Custom Task').slice(0, 400);
          const customCode = String(customTask.data.customTaskCode || 'CTK-00000').slice(0, 20);
          const screenshotAssetId = String(customTask.data.screenshotAssetId || '').trim();
          const requestedAmount = Number(customTask.data.requestedAmount);

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
            throw new HttpError(400, 'Approved amount must be a whole Taka integer between ৳1 and ৳100,000.');
          }

          const nowMs = Date.parse(nowIso);
          const monthKey = getDhakaMonthKey(nowMs);
          const monthlyEntryId = buildMonthlyEntryId(monthKey, memberUid);

          const [memberProfile, memberWallet, monthlyEntry] = await Promise.all([
            tx.get('users', memberUid),
            tx.get('wallets', memberUid),
            decision === 'approved'
              ? tx.get('monthlyMemberEarnings', monthlyEntryId)
              : Promise.resolve(null),
          ]);

          const txLedgerId = decision === 'approved' ? `tx_custom_${customTaskId}` : '';
          const notifId = generateDocId('ntf');
          const logId = generateDocId('log');

          const writes: RestWriteOperation[] = [];

          if (decision === 'approved') {
            // Delete approved custom task and optional proof screenshot immediately to conserve Firestore quota
            writes.push(buildDeleteWrite('customTasks', customTaskId));
            if (screenshotAssetId && VALID_ID_REGEX.test(screenshotAssetId)) {
              writes.push(buildDeleteWrite('mediaAssets', screenshotAssetId));
            }

            if (memberWallet) {
              const prevAvail = Number(memberWallet.data.availableBalance || 0);
              const prevWalletEarnings = Number(memberWallet.data.totalEarnings || 0);
              writes.push(
                buildReplaceUpdateWrite(
                  'wallets',
                  memberUid,
                  {
                    ...memberWallet.data,
                    availableBalance: prevAvail + finalApprovedAmount,
                    totalEarnings: prevWalletEarnings + finalApprovedAmount,
                    lastCreditedSubmissionId: customTaskId,
                    createdAt: preserveTimestamp(memberWallet.raw, 'createdAt'),
                  },
                  memberWallet.updateTime
                )
              );
            } else {
              writes.push(
                buildCreateWrite(
                  'wallets',
                  memberUid,
                  {
                    userId: memberUid,
                    memberId: memberCode,
                    availableBalance: finalApprovedAmount,
                    totalEarnings: finalApprovedAmount,
                    totalWithdrawals: 0,
                    totalWithdrawalFees: 0,
                    reservedWithdrawals: 0,
                    lastWithdrawalId: '',
                    lastCreditedSubmissionId: customTaskId,
                  },
                  ['createdAt', 'updatedAt']
                )
              );
            }

            if (memberProfile) {
              const prevCompleted = Number(memberProfile.data.completedTasksCount || 0);
              const prevUserEarnings = Number(memberProfile.data.totalEarnings || 0);
              writes.push(
                buildReplaceUpdateWrite(
                  'users',
                  memberUid,
                  {
                    ...memberProfile.data,
                    completedTasksCount: prevCompleted + 1,
                    totalEarnings: prevUserEarnings + finalApprovedAmount,
                    createdAt: preserveTimestamp(memberProfile.raw, 'createdAt'),
                  },
                  memberProfile.updateTime
                )
              );

              if (
                memberProfile.data.role === 'member' &&
                memberProfile.data.status === 'approved' &&
                monthlyEntryId.length <= 128
              ) {
                const displayName =
                  String(
                    memberProfile.data.fullName || customTask.data.memberName || 'Member'
                  )
                    .trim()
                    .slice(0, 300) || 'Member';
                const photoAssetId = sanitizeFirestoreId(memberProfile.data.photoAssetId, '');
                if (monthlyEntry) {
                  writes.push(
                    buildReplaceUpdateWrite(
                      'monthlyMemberEarnings',
                      monthlyEntryId,
                      {
                        entryId: monthlyEntryId,
                        monthKey,
                        userId: memberUid,
                        displayName,
                        photoAssetId,
                        isEligibleMember: true,
                        eligibleEarnings:
                          Number(monthlyEntry.data.eligibleEarnings || 0) + finalApprovedAmount,
                        approvedTaskCount:
                          Number(monthlyEntry.data.approvedTaskCount || 0) + 1,
                        reachedAtMs: Math.max(
                          nowMs,
                          Number(monthlyEntry.data.reachedAtMs || 0)
                        ),
                        lastTransactionId: txLedgerId,
                        lastSubmissionId: customTaskId,
                        createdAt: preserveTimestamp(monthlyEntry.raw, 'createdAt'),
                      },
                      monthlyEntry.updateTime
                    )
                  );
                } else {
                  writes.push(
                    buildCreateWrite(
                      'monthlyMemberEarnings',
                      monthlyEntryId,
                      {
                        entryId: monthlyEntryId,
                        monthKey,
                        userId: memberUid,
                        displayName,
                        photoAssetId,
                        isEligibleMember: true,
                        eligibleEarnings: finalApprovedAmount,
                        approvedTaskCount: 1,
                        reachedAtMs: nowMs,
                        lastTransactionId: txLedgerId,
                        lastSubmissionId: customTaskId,
                      },
                      ['createdAt', 'updatedAt']
                    )
                  );
                }
              }
            }

            writes.push(
              buildCreateWrite(
                'transactions',
                txLedgerId,
                {
                  transactionId: txLedgerId,
                  userId: memberUid,
                  memberId: memberCode,
                  type: 'custom_task_reward',
                  amount: finalApprovedAmount,
                  feeAmount: 0,
                  netAmount: finalApprovedAmount,
                  direction: 'credit',
                  description: `Custom task payment credited for ${customCode} (${taskName.slice(0, 140)})`.slice(0, 240),
                  referenceId: customTaskId,
                  taskCode: customCode,
                  taskName,
                  submissionId: customTaskId,
                  approvedAt: nowIso,
                },
                ['createdAt']
              ),
              buildCreateWrite(
                'notifications',
                notifId,
                {
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
                },
                ['createdAt', 'updatedAt']
              ),
              buildCreateWrite(
                'adminAuditLogs',
                logId,
                {
                  logId,
                  adminUid: admin.uid,
                  adminEmail: admin.email,
                  action: 'CUSTOM_TASK_APPROVED',
                  targetType: 'customTask',
                  targetId: customTaskId,
                  summary: `Approved custom task ${customCode} ("${taskName}") for ${memberCode}, credited ৳${finalApprovedAmount}, and cleared task storage`.slice(
                    0,
                    450
                  ),
                },
                ['createdAt']
              )
            );
          } else {
            writes.push(
              buildReplaceUpdateWrite(
                'customTasks',
                customTaskId,
                {
                  ...customTask.data,
                  status: 'rejected',
                  approvedAmount: 0,
                  rejectionReason: rawReason,
                  reviewedBy: admin.uid,
                  reviewerId: adminInfo.reviewerId,
                  reviewerName: adminInfo.reviewerName,
                  reviewedAt: nowIso,
                  transactionId: '',
                  createdAt: preserveTimestamp(customTask.raw, 'createdAt'),
                },
                customTask.updateTime
              ),
              buildCreateWrite(
                'notifications',
                notifId,
                {
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
                },
                ['createdAt', 'updatedAt']
              ),
              buildCreateWrite(
                'adminAuditLogs',
                logId,
                {
                  logId,
                  adminUid: admin.uid,
                  adminEmail: admin.email,
                  action: 'CUSTOM_TASK_REJECTED',
                  targetType: 'customTask',
                  targetId: customTaskId,
                  summary: `Rejected custom task ${customCode} ("${taskName}") for ${memberCode}: ${rawReason}`.slice(
                    0,
                    450
                  ),
                },
                ['createdAt']
              )
            );
          }

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 10. Member Marks Decision Notification as Read
  app.post(
    '/api/notifications/:notificationId/read',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.authUser!;
        const notificationId = String(req.params.notificationId || '');
        if (!VALID_ID_REGEX.test(notificationId)) {
          throw new HttpError(400, 'Invalid notification ID.');
        }

        await runAtomicTransaction(user.idToken, async (tx) => {
          const notif = await tx.get('notifications', notificationId);
          if (!notif || notif.data.userId !== user.uid) {
            throw new HttpError(404, 'Notification not found.');
          }
          if (notif.data.isRead === true) {
            return { writes: [], result: true };
          }
          return {
            writes: [
              buildReplaceUpdateWrite(
                'notifications',
                notificationId,
                {
                  ...notif.data,
                  isRead: true,
                  createdAt: preserveTimestamp(notif.raw, 'createdAt'),
                },
                notif.updateTime
              ),
            ],
            result: true,
          };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // =========================================================================
  // 11. Best 10 Monthly Leaderboard & Rewards Management (Main Admin Exclusive)
  // =========================================================================

  // 11A. Configure & Publish Monthly Rewards (Positions 1st–10th)
  app.post(
    '/api/admin/leaderboard/rewards',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const monthKey = typeof req.body?.monthKey === 'string' ? req.body.monthKey.trim() : '';
        if (!isValidMonthKey(monthKey)) {
          throw new HttpError(400, 'Valid month key (YYYY-MM) is required.');
        }

        const rewards = normalizeRewardConfigs(req.body?.rewards);
        const rewardsPublished = Boolean(req.body?.rewardsPublished);
        const announcementDate =
          typeof req.body?.announcementDate === 'string'
            ? req.body.announcementDate.trim().slice(0, 40)
            : '';
        const rewardNote =
          typeof req.body?.rewardNote === 'string'
            ? req.body.rewardNote.trim().slice(0, 1000)
            : '';
        const confirmFinalizedEdit = Boolean(req.body?.confirmFinalizedEdit);
        const reason =
          typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';

        const existingPeriod = await getDocRest('leaderboardPeriods', monthKey, admin.idToken);
        const isFinalized = existingPeriod?.data?.status === 'finalized';

        if (isFinalized && !confirmFinalizedEdit) {
          throw new HttpError(
            409,
            'This month is already finalized. Please confirm finalized reward modification with a reason.'
          );
        }
        if (isFinalized && reason.length < 3) {
          throw new HttpError(
            400,
            'Please provide a reason (at least 3 characters) when updating a finalized month.'
          );
        }

        const nowIso = new Date().toISOString();
        const logId = generateDocId('log');
        const writes = [];

        if (existingPeriod) {
          writes.push(
            buildReplaceUpdateWrite(
              'leaderboardPeriods',
              monthKey,
              {
                monthKey,
                status: existingPeriod.data.status === 'finalized' ? 'finalized' : 'open',
                rewardsPublished,
                announcementDate,
                rewardNote,
                rewards,
                finalizedAt: String(existingPeriod.data.finalizedAt || '').slice(0, 40),
                finalizedBy: sanitizeFirestoreId(existingPeriod.data.finalizedBy, ''),
                winnerCount: Math.min(
                  10,
                  Math.max(0, Math.floor(Number(existingPeriod.data.winnerCount || 0)))
                ),
                lastSyncedAt: String(existingPeriod.data.lastSyncedAt || nowIso).slice(0, 40),
                createdAt: preserveTimestamp(existingPeriod.raw, 'createdAt'),
              },
              existingPeriod.updateTime
            )
          );
        } else {
          writes.push(
            buildCreateWrite(
              'leaderboardPeriods',
              monthKey,
              {
                monthKey,
                status: 'open',
                rewardsPublished,
                announcementDate,
                rewardNote,
                rewards,
                finalizedAt: '',
                finalizedBy: '',
                winnerCount: 0,
                lastSyncedAt: nowIso,
              },
              ['createdAt', 'updatedAt']
            )
          );
        }

        if (isFinalized) {
          const existingWinners = await queryByUserFieldRest(
            'leaderboardWinners',
            'monthKey',
            monthKey,
            admin.idToken
          );
          for (const wDoc of existingWinners) {
            const r = Number(wDoc.data.rank);
            const slot = rewards[r - 1];
            const prizeTitle = slot && slot.enabled ? slot.prizeTitle : '';
            const prizeDescription = slot && slot.enabled ? slot.prizeDescription : '';
            const monetaryValue = slot && slot.enabled ? slot.monetaryValue : 0;
            writes.push(
              buildReplaceUpdateWrite(
                'leaderboardWinners',
                String(wDoc.data.winnerId),
                {
                  ...wDoc.data,
                  prizeTitle,
                  prizeDescription,
                  monetaryValue,
                  createdAt: preserveTimestamp(wDoc.raw, 'createdAt'),
                },
                wDoc.updateTime
              )
            );
          }
        }

        const enabledCount = rewards.filter((r) => r.enabled).length;
        writes.push(
          buildCreateWrite(
            'adminAuditLogs',
            logId,
            {
              logId,
              adminUid: admin.uid,
              adminEmail: admin.email,
              action: isFinalized
                ? 'FINALIZED_LEADERBOARD_REWARDS_UPDATED'
                : 'LEADERBOARD_REWARDS_UPDATED',
              targetType: 'leaderboardPeriod',
              targetId: monthKey,
              summary: `Saved Best 10 rewards for ${monthKey} (${enabledCount} active positions, ${
                rewardsPublished ? 'Published' : 'Draft'
              })${reason ? ` · Reason: ${reason}` : ''}`.slice(0, 450),
            },
            ['createdAt']
          )
        );

        await commitSingleOrBatchWrites(admin.idToken, writes);
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 11B. Recalculate / Reconcile Monthly Leaderboard from Verified Wallet Transactions
  app.post(
    '/api/admin/leaderboard/recalculate',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const monthKey = typeof req.body?.monthKey === 'string' ? req.body.monthKey.trim() : '';
        if (!isValidMonthKey(monthKey)) {
          throw new HttpError(400, 'Valid month key (YYYY-MM) is required.');
        }

        const silentAutoSync = Boolean(req.body?.silentAutoSync);
        const confirmFinalizedOverride = Boolean(req.body?.confirmFinalizedOverride);
        const reason =
          typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';

        const existingPeriod = await getDocRest('leaderboardPeriods', monthKey, admin.idToken);
        const isFinalized = existingPeriod?.data?.status === 'finalized';

        if (isFinalized && silentAutoSync) {
          res.json({ ok: true, skippedFinalized: true });
          return;
        }
        if (isFinalized && !confirmFinalizedOverride) {
          throw new HttpError(
            409,
            'This month is finalized. Explicit confirmation and reason are required to recalculate a finalized month.'
          );
        }
        if (isFinalized && reason.length < 5) {
          throw new HttpError(
            400,
            'Please provide a reason (at least 5 characters) when recalculating a finalized month.'
          );
        }

        const [txDocs, userDocs, existingMonthEntries] = await Promise.all([
          listCollectionRest<WalletTransaction>('transactions', admin.idToken, 4000),
          listCollectionRest<UserProfile>('users', admin.idToken, 2000),
          queryByUserFieldRest('monthlyMemberEarnings', 'monthKey', monthKey, admin.idToken),
        ]);

        const computed = computeMonthlyLeaderboardFromTransactions(
          monthKey,
          txDocs.map((d) => d.data),
          userDocs.map((d) => d.data)
        );

        const existingByEntryId = new Map(
          existingMonthEntries.map((d) => [String(d.data.entryId), d])
        );
        const activeEntryIds = new Set<string>();
        const writes = [];
        let changedCount = 0;

        for (const stat of computed.allMemberStats) {
          const entryId = buildMonthlyEntryId(monthKey, stat.userId);
          activeEntryIds.add(entryId);
          const prev = existingByEntryId.get(entryId);

          if (prev) {
            const unchanged =
              Number(prev.data.eligibleEarnings) === stat.eligibleEarnings &&
              Number(prev.data.approvedTaskCount) === stat.approvedTaskCount &&
              Number(prev.data.reachedAtMs) === stat.reachedAtMs &&
              prev.data.displayName === stat.displayName &&
              sanitizeFirestoreId(prev.data.photoAssetId, '') === stat.photoAssetId &&
              prev.data.isEligibleMember === true;
            if (!unchanged) {
              changedCount++;
              writes.push(
                buildReplaceUpdateWrite(
                  'monthlyMemberEarnings',
                  entryId,
                  {
                    entryId,
                    monthKey,
                    userId: stat.userId,
                    displayName: stat.displayName,
                    photoAssetId: stat.photoAssetId,
                    isEligibleMember: true,
                    eligibleEarnings: stat.eligibleEarnings,
                    approvedTaskCount: stat.approvedTaskCount,
                    reachedAtMs: stat.reachedAtMs,
                    lastTransactionId: stat.lastTransactionId,
                    lastSubmissionId: stat.lastSubmissionId,
                    createdAt: preserveTimestamp(prev.raw, 'createdAt'),
                  },
                  prev.updateTime
                )
              );
            }
          } else {
            changedCount++;
            writes.push(
              buildCreateWrite(
                'monthlyMemberEarnings',
                entryId,
                {
                  entryId,
                  monthKey,
                  userId: stat.userId,
                  displayName: stat.displayName,
                  photoAssetId: stat.photoAssetId,
                  isEligibleMember: true,
                  eligibleEarnings: stat.eligibleEarnings,
                  approvedTaskCount: stat.approvedTaskCount,
                  reachedAtMs: stat.reachedAtMs,
                  lastTransactionId: stat.lastTransactionId,
                  lastSubmissionId: stat.lastSubmissionId,
                },
                ['createdAt', 'updatedAt']
              )
            );
          }
        }

        // Zero out any stale entry in this month that no longer has eligible earnings
        for (const [entryId, prev] of existingByEntryId.entries()) {
          if (!activeEntryIds.has(entryId) && Number(prev.data.eligibleEarnings || 0) > 0) {
            const fallbackUid = sanitizeFirestoreId(prev.data.userId, '');
            if (!fallbackUid || buildMonthlyEntryId(monthKey, fallbackUid) !== entryId) continue;
            changedCount++;
            writes.push(
              buildReplaceUpdateWrite(
                'monthlyMemberEarnings',
                entryId,
                {
                  entryId,
                  monthKey,
                  userId: fallbackUid,
                  displayName:
                    String(prev.data.displayName || 'Member')
                      .trim()
                      .slice(0, 300) || 'Member',
                  photoAssetId: sanitizeFirestoreId(prev.data.photoAssetId, ''),
                  isEligibleMember: false,
                  eligibleEarnings: 0,
                  approvedTaskCount: 0,
                  reachedAtMs: 0,
                  lastTransactionId: 'admin_sync',
                  lastSubmissionId: '',
                  createdAt: preserveTimestamp(prev.raw, 'createdAt'),
                },
                prev.updateTime
              )
            );
          }
        }

        const nowIso = new Date().toISOString();
        const rewards = existingPeriod
          ? normalizeRewardConfigs(existingPeriod.data.rewards)
          : createEmptyRewardConfigs();

        if (!silentAutoSync) {
          if (existingPeriod) {
            writes.push(
              buildReplaceUpdateWrite(
                'leaderboardPeriods',
                monthKey,
                {
                  monthKey,
                  status: isFinalized ? 'finalized' : 'open',
                  rewardsPublished: Boolean(existingPeriod.data.rewardsPublished),
                  announcementDate: String(existingPeriod.data.announcementDate || '').slice(0, 40),
                  rewardNote: String(existingPeriod.data.rewardNote || '').slice(0, 1000),
                  rewards,
                  finalizedAt: String(existingPeriod.data.finalizedAt || '').slice(0, 40),
                  finalizedBy: sanitizeFirestoreId(existingPeriod.data.finalizedBy, ''),
                  winnerCount: isFinalized
                    ? computed.top10.length
                    : Math.min(
                        10,
                        Math.max(0, Math.floor(Number(existingPeriod.data.winnerCount || 0)))
                      ),
                  lastSyncedAt: nowIso,
                  createdAt: preserveTimestamp(existingPeriod.raw, 'createdAt'),
                },
                existingPeriod.updateTime
              )
            );
          } else {
            writes.push(
              buildCreateWrite(
                'leaderboardPeriods',
                monthKey,
                {
                  monthKey,
                  status: 'open',
                  rewardsPublished: false,
                  announcementDate: '',
                  rewardNote: '',
                  rewards,
                  finalizedAt: '',
                  finalizedBy: '',
                  winnerCount: 0,
                  lastSyncedAt: nowIso,
                },
                ['createdAt', 'updatedAt']
              )
            );
          }
        }

        if (isFinalized && confirmFinalizedOverride) {
          const [existingWinners, existingNotes] = await Promise.all([
            queryByUserFieldRest('leaderboardWinners', 'monthKey', monthKey, admin.idToken),
            queryByUserFieldRest('leaderboardAdminNotes', 'monthKey', monthKey, admin.idToken),
          ]);
          const winById = new Map(existingWinners.map((w) => [String(w.data.winnerId), w]));
          const noteById = new Map(existingNotes.map((n) => [String(n.data.winnerId), n]));

          for (const row of computed.top10) {
            const winnerId = buildWinnerDocId(monthKey, row.rank);
            const slot = rewards[row.rank - 1];
            const prevWin = winById.get(winnerId);
            const prevNote = noteById.get(winnerId);
            const sameWinner = prevWin && prevWin.data.userId === row.userId;

            const winPayload = {
              winnerId,
              monthKey,
              rank: row.rank,
              userId: row.userId,
              displayName: row.displayName,
              photoAssetId: row.photoAssetId,
              eligibleEarnings: row.eligibleEarnings,
              approvedTaskCount: row.approvedTaskCount,
              reachedAtMs: row.reachedAtMs,
              prizeTitle: slot && slot.enabled ? slot.prizeTitle : '',
              prizeDescription: slot && slot.enabled ? slot.prizeDescription : '',
              monetaryValue: slot && slot.enabled ? slot.monetaryValue : 0,
              rewardStatus: sameWinner ? String(prevWin.data.rewardStatus) : 'pending',
              deliveredAt: sameWinner ? String(prevWin.data.deliveredAt || '') : '',
            };

            if (prevWin) {
              writes.push(
                buildReplaceUpdateWrite(
                  'leaderboardWinners',
                  winnerId,
                  { ...winPayload, createdAt: preserveTimestamp(prevWin.raw, 'createdAt') },
                  prevWin.updateTime
                )
              );
            } else {
              writes.push(
                buildCreateWrite('leaderboardWinners', winnerId, winPayload, [
                  'createdAt',
                  'updatedAt',
                ])
              );
            }

            const notePayload = {
              winnerId,
              monthKey,
              rank: row.rank,
              userId: row.userId,
              memberId: row.memberId,
              adminNote:
                prevNote && prevNote.data.userId === row.userId
                  ? String(prevNote.data.adminNote || '')
                  : '',
              updatedBy: admin.uid,
            };
            if (prevNote) {
              writes.push(
                buildReplaceUpdateWrite(
                  'leaderboardAdminNotes',
                  winnerId,
                  { ...notePayload, createdAt: preserveTimestamp(prevNote.raw, 'createdAt') },
                  prevNote.updateTime
                )
              );
            } else {
              writes.push(
                buildCreateWrite('leaderboardAdminNotes', winnerId, notePayload, [
                  'createdAt',
                  'updatedAt',
                ])
              );
            }
          }

          for (let r = computed.top10.length + 1; r <= 10; r++) {
            const staleId = buildWinnerDocId(monthKey, r);
            if (winById.has(staleId)) {
              writes.push(buildDeleteWrite('leaderboardWinners', staleId));
            }
            if (noteById.has(staleId)) {
              writes.push(buildDeleteWrite('leaderboardAdminNotes', staleId));
            }
          }
        }

        if (!silentAutoSync) {
          const logId = generateDocId('log');
          writes.push(
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: admin.uid,
                adminEmail: admin.email,
                action: isFinalized
                  ? 'FINALIZED_LEADERBOARD_RECALCULATED'
                  : 'LEADERBOARD_RECALCULATED',
                targetType: 'leaderboardPeriod',
                targetId: monthKey,
                summary: `Recalculated Best 10 for ${monthKey} from verified ledger (${
                  computed.allMemberStats.length
                } eligible earners, ${changedCount} updated)${
                  reason ? ` · Reason: ${reason}` : ''
                }`.slice(0, 450),
              },
              ['createdAt']
            )
          );
        }

        if (writes.length > 0) {
          await commitSingleOrBatchWrites(admin.idToken, writes);
        }

        res.json({
          ok: true,
          changedCount,
          eligibleMemberCount: computed.allMemberStats.length,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // 11C. Reverse / Invalidate an Erroneous Task Earning & Recalculate Monthly Leaderboard
  app.post(
    '/api/admin/leaderboard/reverse-earning',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const transactionId =
          typeof req.body?.transactionId === 'string' ? req.body.transactionId.trim() : '';
        const reason =
          typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
        const confirmFinalizedOverride = Boolean(req.body?.confirmFinalizedOverride);

        if (!VALID_ID_REGEX.test(transactionId)) {
          throw new HttpError(400, 'Valid transaction ID is required.');
        }
        if (reason.length < 5) {
          throw new HttpError(
            400,
            'Please provide a clear reversal reason (at least 5 characters) for the audit log.'
          );
        }

        const targetTx = await getDocRest<WalletTransaction>(
          'transactions',
          transactionId,
          admin.idToken
        );
        if (!targetTx) {
          throw new HttpError(404, 'Target earning transaction not found.');
        }
        if (
          (targetTx.data.type !== 'task_reward' &&
            targetTx.data.type !== 'custom_task_reward') ||
          targetTx.data.direction !== 'credit'
        ) {
          throw new HttpError(400, 'Only approved task reward credits can be reversed.');
        }

        const refId = String(targetTx.data.referenceId);
        const reversalTxId = `tx_reversal_${refId}`;
        const existingReversal = await getDocRest('transactions', reversalTxId, admin.idToken);
        if (existingReversal) {
          throw new HttpError(409, 'This earning transaction has already been reversed.');
        }

        const txMs =
          extractTimestampMs(targetTx.data.approvedAt) ||
          extractTimestampMs(targetTx.data.createdAt);
        const monthKey = getDhakaMonthKey(txMs);
        const existingPeriod = await getDocRest('leaderboardPeriods', monthKey, admin.idToken);
        const isFinalized = existingPeriod?.data?.status === 'finalized';

        if (isFinalized && !confirmFinalizedOverride) {
          throw new HttpError(
            409,
            `Month ${monthKey} is finalized. Confirm finalized month override to reverse this earning.`
          );
        }

        const memberUid = String(targetTx.data.userId);
        const amount = Number(targetTx.data.amount);
        const nowIso = new Date().toISOString();

        // Execute atomic wallet deduction + reversal ledger record
        await runAtomicTransaction(admin.idToken, async (tx) => {
          const revCheck = await tx.get('transactions', reversalTxId);
          if (revCheck) {
            throw new HttpError(409, 'This earning transaction has already been reversed.');
          }

          const [wallet, profile] = await Promise.all([
            tx.get('wallets', memberUid),
            tx.get('users', memberUid),
          ]);
          if (!wallet) {
            throw new HttpError(404, 'Member wallet not found.');
          }
          const prevAvail = Number(wallet.data.availableBalance || 0);
          if (prevAvail < amount) {
            throw new HttpError(
              400,
              `Cannot deduct ৳${amount} automatically because member currently has only ৳${prevAvail} available wallet balance.`
            );
          }

          const writes = [
            buildReplaceUpdateWrite(
              'wallets',
              memberUid,
              {
                ...wallet.data,
                availableBalance: prevAvail - amount,
                totalEarnings: Math.max(0, Number(wallet.data.totalEarnings || 0) - amount),
                createdAt: preserveTimestamp(wallet.raw, 'createdAt'),
              },
              wallet.updateTime
            ),
            buildCreateWrite(
              'transactions',
              reversalTxId,
              {
                transactionId: reversalTxId,
                userId: memberUid,
                memberId: String(targetTx.data.memberId),
                type: 'earning_reversal',
                amount,
                feeAmount: 0,
                netAmount: amount,
                direction: 'debit',
                description: `Admin reversed task earning (${
                  targetTx.data.taskName || refId
                }): -৳${amount} · Reason: ${reason}`.slice(0, 900),
                referenceId: refId,
                taskName: String(targetTx.data.taskName || ''),
                submissionId: String(targetTx.data.submissionId || refId),
                approvedAt: nowIso,
              },
              ['createdAt']
            ),
          ];

          if (profile) {
            writes.push(
              buildReplaceUpdateWrite(
                'users',
                memberUid,
                {
                  ...profile.data,
                  completedTasksCount: Math.max(
                    0,
                    Number(profile.data.completedTasksCount || 0) - 1
                  ),
                  totalEarnings: Math.max(0, Number(profile.data.totalEarnings || 0) - amount),
                  createdAt: preserveTimestamp(profile.raw, 'createdAt'),
                },
                profile.updateTime
              )
            );
          }

          const notifId = generateDocId('ntf');
          const logId = generateDocId('log');
          writes.push(
            buildCreateWrite(
              'notifications',
              notifId,
              {
                notificationId: notifId,
                userId: memberUid,
                type: 'earning_reversed',
                title: 'Task Earning Reversed',
                message: `৳${amount} from "${
                  targetTx.data.taskName || refId
                }" was reversed by Admin. Reason: ${reason}`.slice(0, 900),
                referenceId: refId,
                isRead: false,
              },
              ['createdAt', 'updatedAt']
            ),
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: admin.uid,
                adminEmail: admin.email,
                action: 'EARNING_REVERSED',
                targetType: 'transaction',
                targetId: reversalTxId,
                summary: `Reversed ৳${amount} earning (${transactionId}) for ${targetTx.data.memberId} in ${monthKey} · Reason: ${reason}`.slice(
                  0,
                  450
                ),
              },
              ['createdAt']
            )
          );

          return { writes, result: true };
        });

        // Immediately recalculate the affected member's monthly leaderboard entry (and finalized snapshot if overridden)
        const [txDocs, userDocs, existingEntry] = await Promise.all([
          listCollectionRest<WalletTransaction>('transactions', admin.idToken, 4000),
          listCollectionRest<UserProfile>('users', admin.idToken, 2000),
          getDocRest('monthlyMemberEarnings', buildMonthlyEntryId(monthKey, memberUid), admin.idToken),
        ]);

        const computed = computeMonthlyLeaderboardFromTransactions(
          monthKey,
          txDocs.map((d) => d.data),
          userDocs.map((d) => d.data)
        );
        const updatedStat = computed.allMemberStats.find((s) => s.userId === memberUid);
        const entryId = buildMonthlyEntryId(monthKey, memberUid);
        const syncWrites = [];

        if (existingEntry) {
          syncWrites.push(
            buildReplaceUpdateWrite(
              'monthlyMemberEarnings',
              entryId,
              {
                ...existingEntry.data,
                isEligibleMember: Boolean(updatedStat),
                eligibleEarnings: updatedStat ? updatedStat.eligibleEarnings : 0,
                approvedTaskCount: updatedStat ? updatedStat.approvedTaskCount : 0,
                reachedAtMs: updatedStat ? updatedStat.reachedAtMs : 0,
                lastTransactionId: updatedStat ? updatedStat.lastTransactionId : reversalTxId,
                lastSubmissionId: updatedStat ? updatedStat.lastSubmissionId : refId,
                createdAt: preserveTimestamp(existingEntry.raw, 'createdAt'),
              },
              existingEntry.updateTime
            )
          );
        }

        if (isFinalized && confirmFinalizedOverride && existingPeriod) {
          const rewards = normalizeRewardConfigs(existingPeriod.data.rewards);
          const [existingWinners, existingNotes] = await Promise.all([
            queryByUserFieldRest('leaderboardWinners', 'monthKey', monthKey, admin.idToken),
            queryByUserFieldRest('leaderboardAdminNotes', 'monthKey', monthKey, admin.idToken),
          ]);
          const winById = new Map(existingWinners.map((w) => [String(w.data.winnerId), w]));
          const noteById = new Map(existingNotes.map((n) => [String(n.data.winnerId), n]));

          syncWrites.push(
            buildReplaceUpdateWrite(
              'leaderboardPeriods',
              monthKey,
              {
                ...existingPeriod.data,
                winnerCount: computed.top10.length,
                lastSyncedAt: nowIso,
                createdAt: preserveTimestamp(existingPeriod.raw, 'createdAt'),
              },
              existingPeriod.updateTime
            )
          );

          for (const row of computed.top10) {
            const winnerId = buildWinnerDocId(monthKey, row.rank);
            const slot = rewards[row.rank - 1];
            const prevWin = winById.get(winnerId);
            const prevNote = noteById.get(winnerId);
            const sameWinner = prevWin && prevWin.data.userId === row.userId;

            const winPayload = {
              winnerId,
              monthKey,
              rank: row.rank,
              userId: row.userId,
              displayName: row.displayName,
              photoAssetId: row.photoAssetId,
              eligibleEarnings: row.eligibleEarnings,
              approvedTaskCount: row.approvedTaskCount,
              reachedAtMs: row.reachedAtMs,
              prizeTitle: slot && slot.enabled ? slot.prizeTitle : '',
              prizeDescription: slot && slot.enabled ? slot.prizeDescription : '',
              monetaryValue: slot && slot.enabled ? slot.monetaryValue : 0,
              rewardStatus: sameWinner ? String(prevWin.data.rewardStatus) : 'pending',
              deliveredAt: sameWinner ? String(prevWin.data.deliveredAt || '') : '',
            };
            if (prevWin) {
              syncWrites.push(
                buildReplaceUpdateWrite(
                  'leaderboardWinners',
                  winnerId,
                  { ...winPayload, createdAt: preserveTimestamp(prevWin.raw, 'createdAt') },
                  prevWin.updateTime
                )
              );
            } else {
              syncWrites.push(
                buildCreateWrite('leaderboardWinners', winnerId, winPayload, [
                  'createdAt',
                  'updatedAt',
                ])
              );
            }

            const notePayload = {
              winnerId,
              monthKey,
              rank: row.rank,
              userId: row.userId,
              memberId: row.memberId,
              adminNote:
                prevNote && prevNote.data.userId === row.userId
                  ? String(prevNote.data.adminNote || '')
                  : '',
              updatedBy: admin.uid,
            };
            if (prevNote) {
              syncWrites.push(
                buildReplaceUpdateWrite(
                  'leaderboardAdminNotes',
                  winnerId,
                  { ...notePayload, createdAt: preserveTimestamp(prevNote.raw, 'createdAt') },
                  prevNote.updateTime
                )
              );
            } else {
              syncWrites.push(
                buildCreateWrite('leaderboardAdminNotes', winnerId, notePayload, [
                  'createdAt',
                  'updatedAt',
                ])
              );
            }
          }

          for (let r = computed.top10.length + 1; r <= 10; r++) {
            const staleId = buildWinnerDocId(monthKey, r);
            if (winById.has(staleId)) syncWrites.push(buildDeleteWrite('leaderboardWinners', staleId));
            if (noteById.has(staleId)) syncWrites.push(buildDeleteWrite('leaderboardAdminNotes', staleId));
          }
        }

        if (syncWrites.length > 0) {
          await commitSingleOrBatchWrites(admin.idToken, syncWrites);
        }

        res.json({ ok: true, reversalTransactionId: reversalTxId, monthKey });
      } catch (err) {
        next(err);
      }
    }
  );

  // 11D. Finalize Monthly Leaderboard & Lock Archived Winners Snapshot
  app.post(
    '/api/admin/leaderboard/finalize',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const monthKey = typeof req.body?.monthKey === 'string' ? req.body.monthKey.trim() : '';
        if (!isValidMonthKey(monthKey)) {
          throw new HttpError(400, 'Valid month key (YYYY-MM) is required.');
        }
        const confirmReFinalize = Boolean(req.body?.confirmReFinalize);
        const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';

        const existingPeriod = await getDocRest('leaderboardPeriods', monthKey, admin.idToken);
        if (existingPeriod?.data?.status === 'finalized' && !confirmReFinalize) {
          throw new HttpError(
            409,
            'This month is already finalized. Confirm re-finalization if you intend to refresh the archived snapshot.'
          );
        }
        if (existingPeriod?.data?.status === 'finalized' && note.length < 3) {
          throw new HttpError(
            400,
            'Please provide a reason (at least 3 characters) when re-finalizing an archived month.'
          );
        }

        const [txDocs, userDocs, existingMonthEntries, existingWinners, existingNotes] =
          await Promise.all([
            listCollectionRest<WalletTransaction>('transactions', admin.idToken, 4000),
            listCollectionRest<UserProfile>('users', admin.idToken, 2000),
            queryByUserFieldRest('monthlyMemberEarnings', 'monthKey', monthKey, admin.idToken),
            queryByUserFieldRest('leaderboardWinners', 'monthKey', monthKey, admin.idToken),
            queryByUserFieldRest('leaderboardAdminNotes', 'monthKey', monthKey, admin.idToken),
          ]);

        const computed = computeMonthlyLeaderboardFromTransactions(
          monthKey,
          txDocs.map((d) => d.data),
          userDocs.map((d) => d.data)
        );

        const rewards = existingPeriod
          ? normalizeRewardConfigs(existingPeriod.data.rewards)
          : createEmptyRewardConfigs();
        const nowIso = new Date().toISOString();
        const writes = [];

        // Sync monthlyMemberEarnings so live & finalized projections match 100%
        const existingByEntryId = new Map(
          existingMonthEntries.map((d) => [String(d.data.entryId), d])
        );
        const activeEntryIds = new Set<string>();
        for (const stat of computed.allMemberStats) {
          const entryId = buildMonthlyEntryId(monthKey, stat.userId);
          activeEntryIds.add(entryId);
          const prev = existingByEntryId.get(entryId);
          if (prev) {
            writes.push(
              buildReplaceUpdateWrite(
                'monthlyMemberEarnings',
                entryId,
                {
                  ...prev.data,
                  displayName: stat.displayName,
                  photoAssetId: stat.photoAssetId,
                  isEligibleMember: true,
                  eligibleEarnings: stat.eligibleEarnings,
                  approvedTaskCount: stat.approvedTaskCount,
                  reachedAtMs: stat.reachedAtMs,
                  lastTransactionId: stat.lastTransactionId,
                  lastSubmissionId: stat.lastSubmissionId,
                  createdAt: preserveTimestamp(prev.raw, 'createdAt'),
                },
                prev.updateTime
              )
            );
          } else {
            writes.push(
              buildCreateWrite(
                'monthlyMemberEarnings',
                entryId,
                {
                  entryId,
                  monthKey,
                  userId: stat.userId,
                  displayName: stat.displayName,
                  photoAssetId: stat.photoAssetId,
                  isEligibleMember: true,
                  eligibleEarnings: stat.eligibleEarnings,
                  approvedTaskCount: stat.approvedTaskCount,
                  reachedAtMs: stat.reachedAtMs,
                  lastTransactionId: stat.lastTransactionId,
                  lastSubmissionId: stat.lastSubmissionId,
                },
                ['createdAt', 'updatedAt']
              )
            );
          }
        }
        for (const [entryId, prev] of existingByEntryId.entries()) {
          if (!activeEntryIds.has(entryId) && Number(prev.data.eligibleEarnings || 0) > 0) {
            writes.push(
              buildReplaceUpdateWrite(
                'monthlyMemberEarnings',
                entryId,
                {
                  ...prev.data,
                  isEligibleMember: false,
                  eligibleEarnings: 0,
                  approvedTaskCount: 0,
                  reachedAtMs: 0,
                  lastTransactionId: 'admin_sync',
                  lastSubmissionId: '',
                  createdAt: preserveTimestamp(prev.raw, 'createdAt'),
                },
                prev.updateTime
              )
            );
          }
        }

        // Write finalized period status
        if (existingPeriod) {
          writes.push(
            buildReplaceUpdateWrite(
              'leaderboardPeriods',
              monthKey,
              {
                ...existingPeriod.data,
                status: 'finalized',
                finalizedAt: nowIso,
                finalizedBy: admin.uid,
                winnerCount: computed.top10.length,
                lastSyncedAt: nowIso,
                createdAt: preserveTimestamp(existingPeriod.raw, 'createdAt'),
              },
              existingPeriod.updateTime
            )
          );
        } else {
          writes.push(
            buildCreateWrite(
              'leaderboardPeriods',
              monthKey,
              {
                monthKey,
                status: 'finalized',
                rewardsPublished: false,
                announcementDate: '',
                rewardNote: '',
                rewards,
                finalizedAt: nowIso,
                finalizedBy: admin.uid,
                winnerCount: computed.top10.length,
                lastSyncedAt: nowIso,
              },
              ['createdAt', 'updatedAt']
            )
          );
        }

        // Write Top 10 winner records + private admin fulfillment metadata
        const winById = new Map(existingWinners.map((w) => [String(w.data.winnerId), w]));
        const noteById = new Map(existingNotes.map((n) => [String(n.data.winnerId), n]));

        for (const row of computed.top10) {
          const winnerId = buildWinnerDocId(monthKey, row.rank);
          const slot = rewards[row.rank - 1];
          const prevWin = winById.get(winnerId);
          const prevNote = noteById.get(winnerId);
          const sameWinner = prevWin && prevWin.data.userId === row.userId;

          const winPayload = {
            winnerId,
            monthKey,
            rank: row.rank,
            userId: row.userId,
            displayName: row.displayName,
            photoAssetId: row.photoAssetId,
            eligibleEarnings: row.eligibleEarnings,
            approvedTaskCount: row.approvedTaskCount,
            reachedAtMs: row.reachedAtMs,
            prizeTitle: slot && slot.enabled ? slot.prizeTitle : '',
            prizeDescription: slot && slot.enabled ? slot.prizeDescription : '',
            monetaryValue: slot && slot.enabled ? slot.monetaryValue : 0,
            rewardStatus: sameWinner ? String(prevWin.data.rewardStatus) : 'pending',
            deliveredAt: sameWinner ? String(prevWin.data.deliveredAt || '') : '',
          };

          if (prevWin) {
            writes.push(
              buildReplaceUpdateWrite(
                'leaderboardWinners',
                winnerId,
                { ...winPayload, createdAt: preserveTimestamp(prevWin.raw, 'createdAt') },
                prevWin.updateTime
              )
            );
          } else {
            writes.push(
              buildCreateWrite('leaderboardWinners', winnerId, winPayload, [
                'createdAt',
                'updatedAt',
              ])
            );
          }

          const notePayload = {
            winnerId,
            monthKey,
            rank: row.rank,
            userId: row.userId,
            memberId: row.memberId,
            adminNote:
              prevNote && prevNote.data.userId === row.userId
                ? String(prevNote.data.adminNote || '')
                : '',
            updatedBy: admin.uid,
          };

          if (prevNote) {
            writes.push(
              buildReplaceUpdateWrite(
                'leaderboardAdminNotes',
                winnerId,
                { ...notePayload, createdAt: preserveTimestamp(prevNote.raw, 'createdAt') },
                prevNote.updateTime
              )
            );
          } else {
            writes.push(
              buildCreateWrite('leaderboardAdminNotes', winnerId, notePayload, [
                'createdAt',
                'updatedAt',
              ])
            );
          }
        }

        for (let r = computed.top10.length + 1; r <= 10; r++) {
          const staleId = buildWinnerDocId(monthKey, r);
          if (winById.has(staleId)) writes.push(buildDeleteWrite('leaderboardWinners', staleId));
          if (noteById.has(staleId)) writes.push(buildDeleteWrite('leaderboardAdminNotes', staleId));
        }

        const logId = generateDocId('log');
        writes.push(
          buildCreateWrite(
            'adminAuditLogs',
            logId,
            {
              logId,
              adminUid: admin.uid,
              adminEmail: admin.email,
              action: confirmReFinalize
                ? 'LEADERBOARD_MONTH_REFINALIZED'
                : 'LEADERBOARD_MONTH_FINALIZED',
              targetType: 'leaderboardPeriod',
              targetId: monthKey,
              summary: `Finalized Best 10 month ${monthKey} with ${computed.top10.length} archived winners${
                note ? ` · Note: ${note}` : ''
              }`.slice(0, 450),
            },
            ['createdAt']
          )
        );

        await commitSingleOrBatchWrites(admin.idToken, writes);
        res.json({ ok: true, winnerCount: computed.top10.length });
      } catch (err) {
        next(err);
      }
    }
  );

  // 11E. Update Winner Reward Fulfillment Status & Delivery Record
  app.post(
    '/api/admin/leaderboard/winners/:winnerId/status',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const winnerId = String(req.params.winnerId || '');
        if (!/^[0-9]{4}-(0[1-9]|1[0-2])_(0[1-9]|10)$/.test(winnerId)) {
          throw new HttpError(400, 'Invalid winner record ID.');
        }

        const rewardStatus = req.body?.rewardStatus;
        if (
          rewardStatus !== 'pending' &&
          rewardStatus !== 'approved' &&
          rewardStatus !== 'awarded' &&
          rewardStatus !== 'cancelled'
        ) {
          throw new HttpError(400, 'Invalid reward status.');
        }

        const rawDeliveredAt =
          typeof req.body?.deliveredAt === 'string' ? req.body.deliveredAt.trim().slice(0, 40) : '';
        const adminNote =
          typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim().slice(0, 1000) : '';
        const notifyWinner = req.body?.notifyWinner !== false;
        const nowIso = new Date().toISOString();

        await runAtomicTransaction(admin.idToken, async (tx) => {
          const winnerDoc = await tx.get('leaderboardWinners', winnerId);
          if (!winnerDoc) {
            throw new HttpError(404, 'Finalized winner record not found.');
          }

          const noteDoc = await tx.get('leaderboardAdminNotes', winnerId);
          const userDoc = await tx.get('users', String(winnerDoc.data.userId));
          const memberCode = String(
            noteDoc?.data?.memberId || userDoc?.data?.memberId || 'MTS-000000'
          );

          const deliveredAt =
            rewardStatus === 'awarded'
              ? rawDeliveredAt || String(winnerDoc.data.deliveredAt || '') || nowIso
              : rewardStatus === 'cancelled' || rewardStatus === 'pending'
              ? ''
              : rawDeliveredAt;

          const writes = [
            buildReplaceUpdateWrite(
              'leaderboardWinners',
              winnerId,
              {
                ...winnerDoc.data,
                rewardStatus,
                deliveredAt,
                createdAt: preserveTimestamp(winnerDoc.raw, 'createdAt'),
              },
              winnerDoc.updateTime
            ),
          ];

          const notePayload = {
            winnerId,
            monthKey: String(winnerDoc.data.monthKey),
            rank: Number(winnerDoc.data.rank),
            userId: String(winnerDoc.data.userId),
            memberId: memberCode,
            adminNote,
            updatedBy: admin.uid,
          };

          if (noteDoc) {
            writes.push(
              buildReplaceUpdateWrite(
                'leaderboardAdminNotes',
                winnerId,
                { ...notePayload, createdAt: preserveTimestamp(noteDoc.raw, 'createdAt') },
                noteDoc.updateTime
              )
            );
          } else {
            writes.push(
              buildCreateWrite('leaderboardAdminNotes', winnerId, notePayload, [
                'createdAt',
                'updatedAt',
              ])
            );
          }

          if (
            rewardStatus === 'awarded' &&
            notifyWinner &&
            winnerDoc.data.rewardStatus !== 'awarded'
          ) {
            const notifId = generateDocId('ntf');
            const prizeText = String(winnerDoc.data.prizeTitle || 'Monthly Best 10 Prize');
            writes.push(
              buildCreateWrite(
                'notifications',
                notifId,
                {
                  notificationId: notifId,
                  userId: String(winnerDoc.data.userId),
                  type: 'leaderboard_reward',
                  title: `Best 10 Rank #${winnerDoc.data.rank} Reward Delivered!`,
                  message: `Congratulations! Your ${winnerDoc.data.monthKey} Best 10 reward (${prizeText}) has been marked as Awarded.`.slice(
                    0,
                    900
                  ),
                  referenceId: winnerId,
                  isRead: false,
                },
                ['createdAt', 'updatedAt']
              )
            );
          }

          const logId = generateDocId('log');
          writes.push(
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: admin.uid,
                adminEmail: admin.email,
                action: 'LEADERBOARD_REWARD_STATUS_UPDATED',
                targetType: 'leaderboardWinner',
                targetId: winnerId,
                summary: `Updated ${winnerDoc.data.monthKey} Rank #${winnerDoc.data.rank} (${memberCode}) reward status to ${rewardStatus}${
                  adminNote ? ` · Note: ${adminNote}` : ''
                }`.slice(0, 450),
              },
              ['createdAt']
            )
          );

          return { writes, result: true };
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // 16. Main Admin: Purge Legacy Approved Submissions & Proof Screenshots
  app.post(
    '/api/admin/submissions/purge-approved',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const [approvedSubs, approvedCustom] = await Promise.all([
          queryByUserFieldRest('submissions', 'status', 'approved', admin.idToken),
          queryByUserFieldRest('customTasks', 'status', 'approved', admin.idToken),
        ]);

        const writes: RestWriteOperation[] = [];
        const seenAssetIds = new Set<string>();
        let deletedSubmissions = 0;
        let deletedCustomTasks = 0;

        for (const sub of approvedSubs) {
          const docId = String(sub.data.submissionId || sub.raw.name.split('/').pop() || '');
          if (docId && VALID_ID_REGEX.test(docId)) {
            deletedSubmissions += 1;
            writes.push(buildDeleteWrite('submissions', docId));
          }
          const assetId = String(sub.data.screenshotAssetId || '').trim();
          if (assetId && VALID_ID_REGEX.test(assetId) && !seenAssetIds.has(assetId)) {
            seenAssetIds.add(assetId);
            writes.push(buildDeleteWrite('mediaAssets', assetId));
          }
        }

        for (const ct of approvedCustom) {
          const docId = String(ct.data.customTaskId || ct.raw.name.split('/').pop() || '');
          if (docId && VALID_ID_REGEX.test(docId)) {
            deletedCustomTasks += 1;
            writes.push(buildDeleteWrite('customTasks', docId));
          }
          const assetId = String(ct.data.screenshotAssetId || '').trim();
          if (assetId && VALID_ID_REGEX.test(assetId) && !seenAssetIds.has(assetId)) {
            seenAssetIds.add(assetId);
            writes.push(buildDeleteWrite('mediaAssets', assetId));
          }
        }

        if (writes.length > 0) {
          const logId = generateDocId('log');
          writes.push(
            buildCreateWrite(
              'adminAuditLogs',
              logId,
              {
                logId,
                adminUid: admin.uid,
                adminEmail: admin.email,
                action: 'APPROVED_SUBMISSIONS_PURGED',
                targetType: 'system',
                targetId: 'approved_cleanup',
                summary: `Purged ${deletedSubmissions} approved official submission(s), ${deletedCustomTasks} approved custom task(s), and ${seenAssetIds.size} proof screenshot(s) to conserve Firestore quota.`.slice(
                  0,
                  450
                ),
              },
              ['createdAt']
            )
          );
          await commitSingleOrBatchWrites(admin.idToken, writes);
        }

        res.json({
          ok: true,
          deletedSubmissions,
          deletedCustomTasks,
          deletedMediaAssets: seenAssetIds.size,
        });
      } catch (err) {
        next(err);
      }
    }
  );


  // Express Error Handler for API routes
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Unhandled API Error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unexpected server error.',
    });
  });

  // Mount Vite dev middleware in development or static dist in production
  const distPath = path.resolve(process.cwd(), 'dist');
  const isDevScript =
    process.env.NODE_ENV === 'development' || process.env.npm_lifecycle_event === 'dev';
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start' ||
    (!isDevScript && fs.existsSync(path.join(distPath, 'index.html')));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'manifest.webmanifest' ||
            base.startsWith('workbox-')
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const primaryPort = Number(process.env.DEFAULT_APP_PORT) || 3000;
  const primaryServer = http.createServer(app);
  primaryServer.listen(primaryPort, '0.0.0.0', () => {
    console.log(`MTS Freelancing Zone server running on http://0.0.0.0:${primaryPort}`);
  });

  // In standalone Cloud Run deployments without Nginx on 8080, also bind process.env.PORT
  const cloudRunPort = Number(process.env.PORT);
  if (isProduction && cloudRunPort && cloudRunPort !== primaryPort) {
    const cloudRunServer = http.createServer(app);
    cloudRunServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Nginx reverse proxy already owns 8080 and forwards to primaryPort (3000)
        return;
      }
      console.error('Secondary port listener error:', err);
    });
    cloudRunServer.listen(cloudRunPort, '0.0.0.0', () => {
      console.log(`Cloud Run production listener active on http://0.0.0.0:${cloudRunPort}`);
    });
  }
}

startServer();
