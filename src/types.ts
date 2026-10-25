export type UserRole = 'member' | 'assistant_admin' | 'admin';
export type AccountStatus = 'pending' | 'approved' | 'rejected';
export type AuthProviderType = 'password' | 'google.com';

export interface AssistantAdminRecord {
  uid: string;
  memberId: string;
  fullName: string;
  email: string;
  createdBy: string;
  createdAt: unknown;
}

export interface UserProfile {
  uid: string;
  memberId: string;
  fullName: string;
  email: string;
  phone: string;
  authProvider: AuthProviderType;
  photoAssetId: string;
  role: UserRole;
  status: AccountStatus;
  rejectionReason: string;
  completedTasksCount: number;
  pendingSubmissionsCount: number;
  totalEarnings: number;
  lastPasswordChangedAt: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface MemberWallet {
  userId: string;
  memberId: string;
  availableBalance: number;
  totalEarnings: number;
  totalWithdrawals: number;
  totalWithdrawalFees: number;
  reservedWithdrawals: number;
  lastWithdrawalId: string;
  lastCreditedSubmissionId?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface TaskItem {
  taskId: string;
  taskCode: string;
  title: string;
  instructions: string;
  externalLink: string;
  rewardAmount: number;
  isActive: boolean;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface TaskSubmission {
  submissionId: string;
  taskId: string;
  taskCode: string;
  taskTitle: string;
  rewardAmount: number;
  userId: string;
  memberId: string;
  memberName: string;
  screenshotAssetId: string;
  proofLink?: string;
  submissionNote: string;
  status: SubmissionStatus;
  rejectionReason: string;
  reviewedBy: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewerRole?: '' | 'admin' | 'assistant_admin';
  reviewAction?: '' | 'approved' | 'rejected';
  reviewedAt: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type CustomTaskAssistantStatus =
  | 'unreviewed'
  | 'reviewed'
  | 'recommended_approve'
  | 'recommended_reject';

export interface CustomTaskSubmission {
  customTaskId: string;
  customTaskCode: string;
  userId: string;
  memberId: string;
  memberName: string;
  taskName: string;
  taskDetails: string;
  requestedAmount: number;
  approvedAmount: number;
  screenshotAssetId: string;
  status: SubmissionStatus;
  assistantStatus: CustomTaskAssistantStatus;
  assistantNote: string;
  assistantReviewedBy: string;
  assistantReviewerId: string;
  assistantReviewerName: string;
  assistantReviewedAt: string;
  rejectionReason: string;
  reviewedBy: string;
  reviewerId: string;
  reviewerName: string;
  reviewedAt: string;
  transactionId: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type NotificationType =
  | 'custom_task_approved'
  | 'custom_task_rejected'
  | 'task_approved'
  | 'task_rejected';

export interface MemberNotification {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  referenceId: string;
  isRead: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export type TransactionType =
  | 'task_reward'
  | 'custom_task_reward'
  | 'withdrawal_request'
  | 'withdrawal_paid'
  | 'withdrawal_refund';

export interface WalletTransaction {
  transactionId: string;
  userId: string;
  memberId: string;
  type: TransactionType;
  amount: number;
  feeAmount: number;
  netAmount: number;
  direction: 'credit' | 'debit' | 'settlement';
  description: string;
  referenceId: string;
  taskName?: string;
  submissionId?: string;
  approvedAt?: string;
  createdAt: unknown;
}

export type PayoutMethod = 'bKash' | 'Nagad';
export type WithdrawalStatus = 'pending' | 'paid' | 'rejected';

export interface WithdrawalRequest {
  withdrawalId: string;
  transactionCode: string;
  userId: string;
  memberId: string;
  memberName: string;
  payoutMethod: PayoutMethod;
  accountNumber: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: WithdrawalStatus;
  adminNote: string;
  paymentReference: string;
  processedBy: string;
  processedAt: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type PasswordRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export interface PasswordChangeRequest {
  requestId: string;
  userId: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  authProvider: AuthProviderType;
  reason: string;
  status: PasswordRequestStatus;
  decisionNote: string;
  reviewedBy: string;
  reviewedAt: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AdminAuditLog {
  logId: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: unknown;
}

export interface MediaAsset {
  assetId: string;
  ownerId: string;
  purpose: 'avatar' | 'proof';
  mimeType: 'image/webp' | 'image/jpeg' | 'image/png';
  dataUrl: string;
  sizeBytes: number;
  createdAt: unknown;
}

// Validation constants synchronized with firebase-blueprint.json & firestore.rules
export const FIXED_WITHDRAWAL_FEE = 5;
export const MIN_WITHDRAWAL_GROSS = 100;
export const BD_MOBILE_PATTERN = /^(\+88)?01[3-9][0-9]{8}$/;
export const MAX_NAME_LENGTH = 100;
export const MAX_TASK_TITLE_LENGTH = 140;
export const MAX_TASK_INSTRUCTIONS_LENGTH = 2000;
export const MAX_PROOF_LINK_LENGTH = 500;
export const MAX_SUBMISSION_NOTE_LENGTH = 500;
export const MAX_REASON_LENGTH = 300;

export type MemberPageTab =
  | 'home'
  | 'tasks'
  | 'custom_task'
  | 'completed'
  | 'proof'
  | 'wallet'
  | 'withdraw'
  | 'profile'
  | 'admin';
