import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  Award,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  LogOut,
  Search,
  ShieldCheck,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { apiRequest, formatBdt, formatDateTime, formatShortDate, toMillis } from '../lib/api';
import { AvatarDisplay, ProofScreenshotViewer } from './MediaView';
import {
  CustomTaskAssistantStatus,
  CustomTaskSubmission,
  MAX_REASON_LENGTH,
  TaskItem,
  TaskSubmission,
  UserProfile,
} from '../types';

export type AssistantAdminTab =
  | 'overview'
  | 'submissions'
  | 'custom_tasks'
  | 'completed'
  | 'profile';

export function AssistantAdminPanel({
  currentAssistant,
  activeTab: controlledTab,
  onTabChange,
  onLogout,
}: {
  currentAssistant: UserProfile;
  activeTab?: AssistantAdminTab;
  onTabChange?: (tab: AssistantAdminTab) => void;
  onLogout: () => Promise<void>;
}) {
  const [internalTab, setInternalTab] = useState<AssistantAdminTab>('overview');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: AssistantAdminTab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  // Assistant Admin subscribes strictly to authorized task & submission collections
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [customTasks, setCustomTasks] = useState<CustomTaskSubmission[]>([]);

  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [cardError, setCardError] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Official Proof Submissions review state
  const [subFilter, setSubFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [subSearch, setSubSearch] = useState('');
  const [rejectingSubId, setRejectingSubId] = useState<string | null>(null);
  const [subRejectReason, setSubRejectReason] = useState('');
  const [expandedTaskInstructions, setExpandedTaskInstructions] = useState<Record<string, boolean>>(
    {}
  );

  // Custom Task inspection state
  const [ctFilter, setCtFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [ctSearch, setCtSearch] = useState('');
  const [ctNotes, setCtNotes] = useState<Record<string, string>>({});

  // Completed Official Tasks search
  const [completedSearch, setCompletedSearch] = useState('');

  useEffect(() => {
    if (currentAssistant.role !== 'assistant_admin' || currentAssistant.status !== 'approved') {
      return;
    }

    const unsubs = [
      onSnapshot(
        collection(db, 'tasks'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as TaskItem);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setTasks(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'tasks')
      ),
      onSnapshot(
        collection(db, 'submissions'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as TaskSubmission);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setSubmissions(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'submissions')
      ),
      onSnapshot(
        collection(db, 'customTasks'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as CustomTaskSubmission);
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setCustomTasks(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'customTasks')
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, [currentAssistant.role, currentAssistant.status]);

  useEffect(() => {
    if (!banner || banner.type !== 'success') return;
    const timer = window.setTimeout(() => setBanner(null), 4500);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const taskById = useMemo(() => {
    const map = new Map<string, TaskItem>();
    for (const t of tasks) map.set(t.taskId, t);
    return map;
  }, [tasks]);

  const stats = useMemo(() => {
    const pendingProofs = submissions.filter((s) => s.status === 'pending').length;
    const approvedProofs = submissions.filter((s) => s.status === 'approved').length;
    const rejectedProofs = submissions.filter((s) => s.status === 'rejected').length;
    const myReviewedCount = submissions.filter(
      (s) => s.reviewedBy === currentAssistant.uid
    ).length;
    const pendingCustomTasks = customTasks.filter((c) => c.status === 'pending').length;
    const uninspectedCustomTasks = customTasks.filter(
      (c) => c.status === 'pending' && c.assistantStatus === 'unreviewed'
    ).length;
    const activeTasks = tasks.filter((t) => t.isActive).length;

    return {
      pendingProofs,
      approvedProofs,
      rejectedProofs,
      myReviewedCount,
      pendingCustomTasks,
      uninspectedCustomTasks,
      activeTasks,
    };
  }, [submissions, customTasks, tasks, currentAssistant.uid]);

  const filteredSubmissions = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return submissions
      .filter((s) => s.status === subFilter)
      .filter(
        (s) =>
          !q ||
          s.memberName.toLowerCase().includes(q) ||
          s.memberId.toLowerCase().includes(q) ||
          s.taskCode.toLowerCase().includes(q) ||
          s.taskTitle.toLowerCase().includes(q)
      );
  }, [submissions, subFilter, subSearch]);

  const filteredCustomTasks = useMemo(() => {
    const q = ctSearch.trim().toLowerCase();
    return customTasks
      .filter((c) => c.status === ctFilter)
      .filter(
        (c) =>
          !q ||
          c.memberName.toLowerCase().includes(q) ||
          c.memberId.toLowerCase().includes(q) ||
          c.customTaskCode.toLowerCase().includes(q) ||
          c.taskName.toLowerCase().includes(q) ||
          c.taskDetails.toLowerCase().includes(q)
      );
  }, [customTasks, ctFilter, ctSearch]);

  const completedOfficialTasks = useMemo(() => {
    const q = completedSearch.trim().toLowerCase();
    return submissions
      .filter((s) => s.status === 'approved')
      .filter(
        (s) =>
          !q ||
          s.taskCode.toLowerCase().includes(q) ||
          s.taskTitle.toLowerCase().includes(q) ||
          s.memberId.toLowerCase().includes(q) ||
          s.memberName.toLowerCase().includes(q)
      );
  }, [submissions, completedSearch]);

  const handleReviewOfficialSubmission = async (
    submissionId: string,
    decision: 'approved' | 'rejected'
  ) => {
    setBanner(null);
    setCardError(null);

    const trimmedReason = subRejectReason.trim().slice(0, MAX_REASON_LENGTH);
    if (decision === 'rejected' && trimmedReason.length < 3) {
      const msg = 'Please enter a rejection reason (at least 3 characters) before rejecting this task.';
      setCardError({ id: submissionId, text: msg });
      setBanner({ type: 'error', text: msg });
      return;
    }

    setBusyId(submissionId);
    setBusyAction(decision);
    try {
      await apiRequest(`/api/admin/submissions/${submissionId}/review`, {
        method: 'POST',
        body: {
          decision,
          rejectionReason: decision === 'rejected' ? trimmedReason : '',
        },
      });
      setRejectingSubId(null);
      setSubRejectReason('');
      setBanner({
        type: 'success',
        text:
          decision === 'approved'
            ? 'Official task approved and predefined reward credited to member wallet.'
            : 'Official task submission rejected with reason recorded.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not complete submission review.';
      setCardError({ id: submissionId, text: msg });
      setBanner({ type: 'error', text: msg });
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  const handleInspectCustomTask = async (
    customTask: CustomTaskSubmission,
    assistantStatus: Exclude<CustomTaskAssistantStatus, 'unreviewed'>
  ) => {
    setBanner(null);
    setCardError(null);

    const rawNote =
      ctNotes[customTask.customTaskId] !== undefined
        ? ctNotes[customTask.customTaskId]
        : customTask.assistantNote || '';
    const trimmedNote = rawNote.trim().slice(0, MAX_REASON_LENGTH);

    if (assistantStatus === 'recommended_reject' && trimmedNote.length < 3) {
      const msg =
        'Please enter a short inspection note (at least 3 characters) when recommending rejection.';
      setCardError({ id: customTask.customTaskId, text: msg });
      setBanner({ type: 'error', text: msg });
      return;
    }

    setBusyId(customTask.customTaskId);
    setBusyAction(assistantStatus);
    try {
      await apiRequest(`/api/admin/custom-tasks/${customTask.customTaskId}/assist-review`, {
        method: 'POST',
        body: {
          assistantStatus,
          assistantNote: trimmedNote,
        },
      });
      setBanner({
        type: 'success',
        text: `Custom task ${customTask.customTaskCode} marked as ${
          assistantStatus === 'recommended_approve'
            ? 'Recommended for Approval'
            : assistantStatus === 'recommended_reject'
            ? 'Recommended for Rejection'
            : 'Reviewed'
        } for Main Admin final decision.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save custom task inspection.';
      setCardError({ id: customTask.customTaskId, text: msg });
      setBanner({ type: 'error', text: msg });
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  };

  const formatAssistantBadge = (status: CustomTaskAssistantStatus) => {
    switch (status) {
      case 'recommended_approve':
        return {
          label: 'Recommended Approval',
          cls: 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300',
        };
      case 'recommended_reject':
        return {
          label: 'Recommended Rejection',
          cls: 'bg-rose-500/15 border-rose-400/35 text-rose-300',
        };
      case 'reviewed':
        return {
          label: 'Reviewed by Assistant',
          cls: 'bg-sky-500/15 border-sky-400/35 text-sky-200',
        };
      default:
        return {
          label: 'Awaiting Inspection',
          cls: 'bg-amber-500/15 border-amber-400/35 text-amber-300',
        };
    }
  };

  const navItems: { id: AssistantAdminTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'submissions', label: `Official Proofs (${stats.pendingProofs})` },
    { id: 'custom_tasks', label: `Custom Tasks (${stats.pendingCustomTasks})` },
    { id: 'completed', label: `Completed (${stats.approvedProofs})` },
    { id: 'profile', label: 'Assistant Profile' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center text-teal-300 shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Assistant Admin Dashboard</h1>
            <p className="text-xs text-sky-200/70">
              Reviewer ID{' '}
              <span className="font-mono tabular-nums text-teal-300 font-semibold">
                {currentAssistant.memberId}
              </span>{' '}
              · {currentAssistant.fullName} ({currentAssistant.email})
            </p>
          </div>
        </div>
      </div>

      {/* Section Navigation */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 overflow-x-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveTab(item.id);
              setBanner(null);
            }}
            className={`min-h-[42px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === item.id
                ? 'bg-teal-500 text-slate-950'
                : 'text-sky-200/75 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {banner && (
        <div
          role="status"
          className={`fixed top-14 left-4 right-4 z-50 max-w-lg mx-auto p-3.5 rounded-2xl border shadow-2xl backdrop-blur-md flex items-start justify-between gap-3 text-xs sm:text-sm ${
            banner.type === 'success'
              ? 'bg-[#072922]/95 border-emerald-400/40 text-emerald-100'
              : 'bg-[#2A0B14]/95 border-rose-400/40 text-rose-100'
          }`}
        >
          <span className="leading-relaxed font-medium">{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="min-h-[28px] min-w-[28px] flex items-center justify-center rounded-lg text-white/70 hover:text-white shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 1. OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => {
                setSubFilter('pending');
                setActiveTab('submissions');
              }}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-purple-400/30 p-5"
            >
              <div className="flex items-center justify-between text-purple-300">
                <span className="text-xs text-sky-200/80">Pending Official Proofs</span>
                <FileCheck2 className="w-4 h-4 shrink-0" />
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-purple-300">
                {stats.pendingProofs}
              </p>
              <p className="mt-1 text-xs text-sky-200/60">
                Approve or reject official task submissions
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setCtFilter('pending');
                setActiveTab('custom_tasks');
              }}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-amber-400/30 p-5"
            >
              <div className="flex items-center justify-between text-amber-300">
                <span className="text-xs text-sky-200/80">Pending Custom Tasks</span>
                <FilePlus2 className="w-4 h-4 shrink-0" />
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-300">
                {stats.pendingCustomTasks}
              </p>
              <p className="mt-1 text-xs text-sky-200/60">
                {stats.uninspectedCustomTasks} awaiting Assistant inspection
              </p>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('completed')}
              className="text-left rounded-2xl bg-[#0D1730]/95 border border-emerald-400/30 p-5"
            >
              <div className="flex items-center justify-between text-emerald-300">
                <span className="text-xs text-sky-200/80">Approved Official Tasks</span>
                <Award className="w-4 h-4 shrink-0" />
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-teal-300">
                {stats.approvedProofs}
              </p>
              <p className="mt-1 text-xs text-sky-200/60">
                {stats.myReviewedCount} submissions reviewed by you
              </p>
            </button>

            <div className="rounded-2xl bg-[#0D1730]/95 border border-blue-400/30 p-5">
              <div className="flex items-center justify-between text-blue-300">
                <span className="text-xs text-sky-200/80">Active Official Tasks</span>
                <ClipboardCheck className="w-4 h-4 shrink-0" />
              </div>
              <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">
                {stats.activeTasks}
              </p>
              <p className="mt-1 text-xs text-sky-200/60">
                Published by Main Administrator
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 sm:p-6 space-y-3">
            <div className="flex items-center gap-2 text-teal-300">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <h2 className="text-sm sm:text-base font-semibold text-white">
                Assistant Admin Permissions & Wallet Safeguards
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-sky-200/80 leading-relaxed">
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-400/20 space-y-1.5">
                <p className="font-semibold text-emerald-300">Authorized Actions</p>
                <p>
                  • View all member official task submissions, task instructions, proof links, and
                  screenshots.
                </p>
                <p>
                  • Approve official task submissions (credits predefined task reward exactly once)
                  or Reject with a required reason.
                </p>
                <p>
                  • Inspect Custom Task submissions and mark them Reviewed or Recommend
                  Approval/Rejection for Main Admin.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5">
                <p className="font-semibold text-amber-300">Main Admin Exclusive Controls</p>
                <p>• Creating or managing Admin / Assistant Admin accounts.</p>
                <p>• Final payment approval/rejection on Custom Task requests.</p>
                <p>
                  • Approving member withdrawals, manual wallet adjustments, or modifying app
                  settings & official tasks.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. OFFICIAL TASK SUBMISSIONS REVIEW */}
      {activeTab === 'submissions' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 w-fit overflow-x-auto">
              {(['pending', 'approved', 'rejected'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setSubFilter(st)}
                  className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap ${
                    subFilter === st
                      ? 'bg-teal-500 text-slate-950'
                      : 'text-sky-200/75 hover:text-white'
                  }`}
                >
                  {st === 'pending' ? 'Pending Review' : st}
                </button>
              ))}
            </div>

            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                placeholder="Search member ID, name, task..."
                className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-[#0D1730] border border-white/12 text-xs sm:text-sm text-white"
              />
            </div>
          </div>

          {filteredSubmissions.length === 0 ? (
            <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center text-sm text-sky-200/70">
              No official task submissions match this filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredSubmissions.map((sub) => {
                const taskInfo = taskById.get(sub.taskId);
                const showDetails = Boolean(expandedTaskInstructions[sub.submissionId]);

                return (
                  <div
                    key={sub.submissionId}
                    className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <AvatarDisplay
                            fullName={sub.memberName}
                            sizeClass="w-10 h-10 text-xs"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums text-sky-200/70">
                              <span>{sub.taskCode}</span>
                              <span aria-hidden="true">·</span>
                              <span className="text-teal-300 font-semibold">
                                {sub.memberId} ({sub.memberName})
                              </span>
                            </div>
                            <h3 className="text-base font-bold text-white mt-0.5">
                              {sub.taskTitle}
                            </h3>
                            <p className="text-[11px] font-mono tabular-nums text-sky-200/55">
                              Submitted {formatDateTime(sub.createdAt)}
                            </p>
                          </div>
                        </div>
                        <span className="text-lg font-bold font-mono tabular-nums text-teal-300 shrink-0">
                          {formatBdt(sub.rewardAmount)}
                        </span>
                      </div>

                      {taskInfo && (
                        <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-sky-200/80">
                              Official Task Details
                            </span>
                            <div className="flex items-center gap-2">
                              {taskInfo.externalLink && (
                                <a
                                  href={taskInfo.externalLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-300 hover:underline"
                                >
                                  <span>Task Link</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedTaskInstructions((prev) => ({
                                    ...prev,
                                    [sub.submissionId]: !prev[sub.submissionId],
                                  }))
                                }
                                className="text-[11px] font-semibold text-sky-200 hover:text-white"
                              >
                                {showDetails ? 'Hide Instructions' : 'View Instructions'}
                              </button>
                            </div>
                          </div>
                          {showDetails && (
                            <p className="text-xs text-sky-100/80 whitespace-pre-line leading-relaxed pt-1 border-t border-white/8">
                              {taskInfo.instructions}
                            </p>
                          )}
                        </div>
                      )}

                      <ProofScreenshotViewer
                        assetId={sub.screenshotAssetId}
                        title={`${sub.memberName} (${sub.memberId}) · ${sub.taskTitle}`}
                      />

                      {sub.proofLink && (
                        <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-400/25 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] text-sky-200/70">Shared Proof Link</p>
                            <a
                              href={sub.proofLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-medium text-teal-300 hover:underline truncate block"
                            >
                              {sub.proofLink}
                            </a>
                          </div>
                          <a
                            href={sub.proofLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[36px] px-3 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
                          >
                            <span>Open Link</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}

                      {sub.submissionNote && (
                        <p className="text-xs text-sky-100 bg-white/[0.03] p-3 rounded-xl">
                          Member note: {sub.submissionNote}
                        </p>
                      )}

                      {sub.status !== 'pending' && (
                        <div className="p-3 rounded-xl bg-[#070E20] border border-white/10 space-y-1 text-xs">
                          <p
                            className={`font-semibold inline-flex items-center gap-1.5 ${
                              sub.status === 'approved' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {sub.status === 'approved' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span className="capitalize">
                              {sub.reviewAction || sub.status} ·{' '}
                              {sub.status === 'approved'
                                ? `Credited ${formatBdt(sub.rewardAmount)}`
                                : 'No Wallet Credit'}
                            </span>
                          </p>
                          <p className="text-[11px] font-mono tabular-nums text-sky-200/65">
                            Reviewer: {sub.reviewerId || sub.reviewedBy || 'Admin'}
                            {sub.reviewerName ? ` (${sub.reviewerName})` : ''}
                            {sub.reviewerRole
                              ? ` · ${sub.reviewerRole === 'admin' ? 'Main Admin' : 'Assistant Admin'}`
                              : ''}
                          </p>
                          {sub.reviewedAt && (
                            <p className="text-[11px] font-mono tabular-nums text-sky-200/55">
                              Reviewed At: {formatDateTime(sub.reviewedAt)}
                            </p>
                          )}
                          {sub.status === 'rejected' && sub.rejectionReason && (
                            <p className="text-xs text-rose-300 pt-1">
                              Reason: {sub.rejectionReason}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {sub.status === 'pending' && (
                      <div className="pt-3 border-t border-white/10 space-y-3">
                        {cardError?.id === sub.submissionId && (
                          <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-400/30 text-xs text-rose-200">
                            {cardError.text}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            disabled={busyId === sub.submissionId}
                            onClick={() =>
                              handleReviewOfficialSubmission(sub.submissionId, 'approved')
                            }
                            className="min-h-[46px] px-3 rounded-xl bg-teal-500 hover:bg-teal-400 active:scale-[0.99] disabled:opacity-50 text-slate-950 text-xs font-semibold transition-all cursor-pointer"
                          >
                            {busyId === sub.submissionId && busyAction === 'approved'
                              ? 'Approving...'
                              : `Approve & Credit ${formatBdt(sub.rewardAmount)}`}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === sub.submissionId}
                            onClick={() => {
                              setRejectingSubId(sub.submissionId);
                              setSubRejectReason('');
                              setCardError(null);
                            }}
                            className={`min-h-[46px] px-3 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer ${
                              rejectingSubId === sub.submissionId
                                ? 'bg-rose-500/30 border border-rose-400/40 text-rose-200'
                                : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300'
                            }`}
                          >
                            Reject Proof
                          </button>
                        </div>

                        {rejectingSubId === sub.submissionId && (
                          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/25 space-y-2.5">
                            <label className="block text-[11px] font-semibold text-rose-200">
                              Rejection Reason (Required)
                            </label>
                            <input
                              type="text"
                              required
                              maxLength={MAX_REASON_LENGTH}
                              value={subRejectReason}
                              onChange={(e) => setSubRejectReason(e.target.value)}
                              placeholder="Explain clearly why the submission was rejected..."
                              className="w-full min-h-[42px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-xs text-white"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={busyId === sub.submissionId}
                                onClick={() => {
                                  setRejectingSubId(null);
                                  setSubRejectReason('');
                                }}
                                className="min-h-[42px] px-3 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={busyId === sub.submissionId}
                                onClick={() =>
                                  handleReviewOfficialSubmission(sub.submissionId, 'rejected')
                                }
                                className="min-h-[42px] px-3.5 rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-slate-950 text-xs font-semibold whitespace-nowrap cursor-pointer"
                              >
                                {busyId === sub.submissionId && busyAction === 'rejected'
                                  ? 'Rejecting...'
                                  : 'Confirm Reject'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. CUSTOM TASK REVIEW & RECOMMENDATIONS */}
      {activeTab === 'custom_tasks' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-[#0D1730]/95 border border-teal-400/25 flex items-start gap-3 text-xs text-sky-100/85">
            <Clock className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Assistant Admins can inspect Custom Task details and proof screenshots and mark them
              as <span className="font-semibold text-white">Reviewed</span>,{' '}
              <span className="font-semibold text-emerald-300">Recommend Approval</span>, or{' '}
              <span className="font-semibold text-rose-300">Recommend Rejection</span>. Only the
              Main Admin can perform final payment approval or rejection.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#081022] border border-white/10 w-fit overflow-x-auto">
              {(['pending', 'approved', 'rejected'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setCtFilter(st)}
                  className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap ${
                    ctFilter === st
                      ? 'bg-teal-500 text-slate-950'
                      : 'text-sky-200/75 hover:text-white'
                  }`}
                >
                  {st === 'pending' ? 'Pending Main Admin' : st}
                </button>
              ))}
            </div>

            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={ctSearch}
                onChange={(e) => setCtSearch(e.target.value)}
                placeholder="Search member, ID, custom task..."
                className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-[#0D1730] border border-white/12 text-xs sm:text-sm text-white"
              />
            </div>
          </div>

          {filteredCustomTasks.length === 0 ? (
            <div className="rounded-2xl bg-[#0D1730]/90 border border-white/10 p-10 text-center text-sm text-sky-200/70">
              No custom task submissions in this status.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCustomTasks.map((ct) => {
                const badge = formatAssistantBadge(ct.assistantStatus);
                const noteValue =
                  ctNotes[ct.customTaskId] !== undefined
                    ? ctNotes[ct.customTaskId]
                    : ct.assistantNote || '';

                return (
                  <div
                    key={ct.customTaskId}
                    className="rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono tabular-nums text-sky-200/70">
                            <span className="text-teal-300 font-semibold">{ct.customTaskCode}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-white font-semibold">
                              {ct.memberId} ({ct.memberName})
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-white mt-1">{ct.taskName}</h3>
                          <p className="text-[11px] font-mono tabular-nums text-sky-200/55">
                            Submitted {formatDateTime(ct.createdAt)}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-[11px] text-sky-200/65">Requested</p>
                          <p className="text-lg font-bold font-mono tabular-nums text-amber-300">
                            {formatBdt(ct.requestedAmount)}
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/8 space-y-1">
                        <p className="text-[11px] font-semibold text-sky-200/70">Task Details</p>
                        <p className="text-xs sm:text-sm text-sky-100 whitespace-pre-line leading-relaxed">
                          {ct.taskDetails}
                        </p>
                      </div>

                      {ct.screenshotAssetId ? (
                        <ProofScreenshotViewer
                          assetId={ct.screenshotAssetId}
                          title={`${ct.memberName} (${ct.memberId}) · ${ct.taskName}`}
                        />
                      ) : (
                        <div className="p-3 rounded-xl bg-[#070E20] border border-white/10 text-xs text-sky-200/60 text-center">
                          No screenshot uploaded (Optional proof)
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        {ct.assistantReviewedAt && (
                          <span className="text-[11px] font-mono tabular-nums text-sky-200/60">
                            By {ct.assistantReviewerId || 'Assistant'} ·{' '}
                            {formatDateTime(ct.assistantReviewedAt)}
                          </span>
                        )}
                      </div>

                      {ct.assistantNote && ct.status !== 'pending' && (
                        <p className="text-xs text-sky-200/80 bg-white/[0.03] p-2.5 rounded-xl">
                          Inspection Note: {ct.assistantNote}
                        </p>
                      )}

                      {ct.status !== 'pending' && (
                        <div className="p-3 rounded-xl bg-[#070E20] border border-white/10 space-y-1 text-xs">
                          <p
                            className={`font-semibold ${
                              ct.status === 'approved' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {ct.status === 'approved'
                              ? `Main Admin Approved · Paid ${formatBdt(ct.approvedAmount)}`
                              : 'Main Admin Rejected'}
                          </p>
                          {ct.reviewedAt && (
                            <p className="text-[11px] font-mono tabular-nums text-sky-200/60">
                              Decided {formatDateTime(ct.reviewedAt)} by{' '}
                              {ct.reviewerName || ct.reviewerId}
                            </p>
                          )}
                          {ct.rejectionReason && (
                            <p className="text-rose-300">Reason: {ct.rejectionReason}</p>
                          )}
                        </div>
                      )}
                    </div>

                    {ct.status === 'pending' && (
                      <div className="pt-3 border-t border-white/10 space-y-3">
                        {cardError?.id === ct.customTaskId && (
                          <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-400/30 text-xs text-rose-200">
                            {cardError.text}
                          </div>
                        )}

                        <div>
                          <label className="block text-[11px] font-medium text-sky-200/75 mb-1">
                            Assistant Inspection / Recommendation Note (Required if recommending
                            reject)
                          </label>
                          <input
                            type="text"
                            maxLength={MAX_REASON_LENGTH}
                            value={noteValue}
                            onChange={(e) =>
                              setCtNotes((prev) => ({
                                ...prev,
                                [ct.customTaskId]: e.target.value,
                              }))
                            }
                            placeholder="Add verification note for Main Admin..."
                            className="w-full min-h-[40px] px-3 rounded-xl bg-[#070E20] border border-white/15 text-xs text-white"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <button
                            type="button"
                            disabled={busyId === ct.customTaskId}
                            onClick={() => handleInspectCustomTask(ct, 'reviewed')}
                            className="min-h-[40px] px-3 rounded-xl bg-white/8 hover:bg-white/14 border border-white/12 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {busyId === ct.customTaskId && busyAction === 'reviewed'
                              ? 'Saving...'
                              : 'Mark Reviewed'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === ct.customTaskId}
                            onClick={() => handleInspectCustomTask(ct, 'recommended_approve')}
                            className="min-h-[40px] px-3 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 border border-teal-400/35 text-xs font-semibold text-teal-200 disabled:opacity-50"
                          >
                            {busyId === ct.customTaskId && busyAction === 'recommended_approve'
                              ? 'Saving...'
                              : 'Recommend Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === ct.customTaskId}
                            onClick={() => handleInspectCustomTask(ct, 'recommended_reject')}
                            className="min-h-[40px] px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-xs font-semibold text-rose-300 disabled:opacity-50"
                          >
                            {busyId === ct.customTaskId && busyAction === 'recommended_reject'
                              ? 'Saving...'
                              : 'Recommend Reject'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. COMPLETED OFFICIAL TASKS */}
      {activeTab === 'completed' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-sky-200/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={completedSearch}
              onChange={(e) => setCompletedSearch(e.target.value)}
              placeholder="Search task code, title, member..."
              className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-[#0D1730] border border-white/12 text-xs sm:text-sm text-white"
            />
          </div>

          <div className="rounded-2xl bg-[#0D1730]/95 border border-white/10 divide-y divide-white/8 overflow-hidden">
            {completedOfficialTasks.length === 0 ? (
              <div className="p-10 text-center text-sm text-sky-200/70">
                No approved official task completions recorded yet.
              </div>
            ) : (
              completedOfficialTasks.map((rec) => (
                <div
                  key={rec.submissionId}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-white">
                      {rec.taskTitle}{' '}
                      <span className="font-mono tabular-nums text-xs text-sky-200/70">
                        ({rec.taskCode})
                      </span>
                    </p>
                    <p className="text-xs text-sky-200/65 font-mono tabular-nums">
                      <span className="text-teal-300 font-semibold">
                        {rec.memberId} · {rec.memberName}
                      </span>{' '}
                      · Approved {formatDateTime(rec.reviewedAt || rec.updatedAt)}
                      {rec.reviewerId ? ` · By ${rec.reviewerId}` : ''}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-teal-300 text-sm shrink-0">
                    +{formatBdt(rec.rewardAmount)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 5. ASSISTANT ADMIN PROFILE */}
      {activeTab === 'profile' && (
        <div className="max-w-xl rounded-2xl bg-[#0D1730]/95 border border-white/10 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-4 pb-4 border-b border-white/10">
            <AvatarDisplay
              photoAssetId={currentAssistant.photoAssetId}
              fullName={currentAssistant.fullName}
              sizeClass="w-16 h-16 text-base"
            />
            <div className="min-w-0">
              <p className="text-xs font-mono tabular-nums text-teal-300 font-semibold">
                {currentAssistant.memberId}
              </p>
              <h2 className="text-lg font-bold text-white truncate">{currentAssistant.fullName}</h2>
              <p className="text-xs text-sky-200/70 truncate">{currentAssistant.email}</p>
            </div>
          </div>

          <div className="divide-y divide-white/8 text-xs sm:text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Assigned Role</span>
              <span className="text-teal-300 font-semibold">Assistant Admin</span>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Reviewer ID</span>
              <span className="font-mono tabular-nums text-white">{currentAssistant.memberId}</span>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Account Status</span>
              <span className="text-emerald-400 font-semibold capitalize">
                {currentAssistant.status}
              </span>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Mobile Number</span>
              <span className="font-mono tabular-nums text-white">
                {currentAssistant.phone || 'Not provided'}
              </span>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <span className="text-sky-200/70">Joined On</span>
              <span className="font-mono tabular-nums text-sky-100">
                {formatShortDate(currentAssistant.createdAt)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void onLogout()}
            className="w-full min-h-[46px] px-4 rounded-xl bg-white/[0.06] hover:bg-rose-500/20 border border-white/12 text-xs sm:text-sm font-semibold text-white hover:text-rose-200 flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out of Assistant Admin</span>
          </button>
        </div>
      )}
    </div>
  );
}
