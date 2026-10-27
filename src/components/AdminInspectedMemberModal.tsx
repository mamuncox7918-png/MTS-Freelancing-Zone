import React from 'react';
import { ExternalLink, X } from 'lucide-react';
import { formatBdt, formatDateTime } from '../lib/api';
import { AvatarDisplay } from './MediaView';
import {
  MAX_REASON_LENGTH,
  MemberWallet,
  TaskSubmission,
  UserProfile,
  WithdrawalRequest,
} from '../types';

interface AdminInspectedMemberModalProps {
  liveMember: UserProfile;
  wallet?: MemberWallet;
  memberSubs: TaskSubmission[];
  memberWdrs: WithdrawalRequest[];
  approvedCount: number;
  busyId: string | null;
  busyDecision: string | null;
  inspectorRejectSubId: string | null;
  inspectorRejectReason: string;
  setInspectorRejectSubId: (id: string | null) => void;
  setInspectorRejectReason: (reason: string) => void;
  onClose: () => void;
  onReviewMember: (uid: string, decision: 'approved' | 'rejected', reason?: string) => void;
  onReviewSubmission: (
    submissionId: string,
    decision: 'approved' | 'rejected',
    reason?: string
  ) => void;
}

export function AdminInspectedMemberModal({
  liveMember,
  wallet: w,
  memberSubs,
  memberWdrs,
  approvedCount,
  busyId,
  busyDecision,
  inspectorRejectSubId,
  inspectorRejectReason,
  setInspectorRejectSubId,
  setInspectorRejectReason,
  onClose,
  onReviewMember,
  onReviewSubmission,
}: AdminInspectedMemberModalProps) {
  const pendingCount = memberSubs.filter((s) => s.status === 'pending').length;
  const rejectedCount = memberSubs.filter((s) => s.status === 'rejected').length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl bg-[#0C1630] border-t sm:border border-white/15 p-6 max-h-[92dvh] overflow-y-auto space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
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
            onClick={onClose}
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
              onClick={() => onReviewMember(liveMember.uid, 'approved')}
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
              Pending / Rejected Proof Submissions ({memberSubs.length})
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
                          onClick={() => onReviewSubmission(s.submissionId, 'approved')}
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
                              onReviewSubmission(
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
      </div>
    </div>
  );
}
