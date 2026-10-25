import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  HttpError,
  type VerifiedAuthUser,
  buildCreateWrite,
  buildDeleteWrite,
  buildReplaceUpdateWrite,
  commitSingleOrBatchWrites,
  getDocRest,
  preserveTimestamp,
  queryByUserFieldRest,
  runAtomicTransaction,
  verifyFirebaseIdToken,
} from './server/firestoreRest.ts';

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

async function assertCallerIsAdmin(authUser: VerifiedAuthUser): Promise<void> {
  if (!authUser.emailVerified) {
    throw new HttpError(403, 'Administrator accounts require a verified email.');
  }
  if (isConfiguredAdminEmail(authUser.email)) {
    return;
  }
  const adminDoc = await getDocRest('admins', authUser.uid, authUser.idToken);
  if (!adminDoc) {
    throw new HttpError(403, 'Administrator authorization required.');
  }
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

      // Check existing submissions for this member to block duplicate pending/approved submissions
      const memberSubmissions = await queryByUserFieldRest('submissions', 'userId', user.uid, user.idToken);
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

  // 7D. Review Proof Submission & Atomically Credit Task Reward Once
  app.post(
    '/api/admin/submissions/:submissionId/review',
    requireVerifiedAuth,
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const admin = req.authUser!;
        await assertCallerIsAdmin(admin);

        const submissionId = String(req.params.submissionId || '');
        const decision = req.body?.decision;
        const rawReason =
          typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason.trim().slice(0, 300) : '';
        const rejectionReason =
          decision === 'rejected'
            ? rawReason || 'Submitted proof did not match task instructions'
            : '';

        if (!VALID_ID_REGEX.test(submissionId)) {
          throw new HttpError(400, 'Invalid submission ID.');
        }
        if (decision !== 'approved' && decision !== 'rejected') {
          throw new HttpError(400, 'Decision must be approved or rejected.');
        }

        const nowIso = new Date().toISOString();

        await runAtomicTransaction(admin.idToken, async (tx) => {
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
          const rewardAmount = Number(submission.data.rewardAmount);

          const memberProfile = await tx.get('users', memberUid);
          const memberWallet = await tx.get('wallets', memberUid);

          const logId = generateDocId('log');
          const writes = [
            buildReplaceUpdateWrite(
              'submissions',
              submissionId,
              {
                ...submission.data,
                status: decision,
                rejectionReason,
                reviewedBy: admin.uid,
                reviewedAt: nowIso,
                createdAt: preserveTimestamp(submission.raw, 'createdAt'),
              },
              submission.updateTime
            ),
          ];

          if (decision === 'approved') {
            const txLedgerId = generateDocId('tx');

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
                  description: `Task reward credited for ${submission.data.taskCode} (${String(submission.data.taskTitle || '').slice(0, 140)})`.slice(0, 240),
                  referenceId: submissionId,
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
                  action: 'SUBMISSION_APPROVED',
                  targetType: 'submission',
                  targetId: submissionId,
                  summary: `Approved proof for ${submission.data.taskCode} by ${memberCode} and credited ৳${rewardAmount}`.slice(0, 450),
                },
                ['createdAt']
              )
            );
          } else {
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
                'adminAuditLogs',
                logId,
                {
                  logId,
                  adminUid: admin.uid,
                  adminEmail: admin.email,
                  action: 'SUBMISSION_REJECTED',
                  targetType: 'submission',
                  targetId: submissionId,
                  summary: `Rejected proof for ${submission.data.taskCode} by ${memberCode}: ${rejectionReason}`.slice(0, 450),
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
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
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
