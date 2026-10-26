# Security Specification — MTS Freelancing Zone

## 1. Data Invariants & Master Sources of Truth

1. **Tiered Administrative RBAC (`Main Admin` vs `Assistant Admin` vs `Member`)**:
   - **Main Admin (`isAdmin()`)**: Requires `request.auth.token.email_verified == true` AND either bootstrapped owner email (`mamuncox7918@gmail.com`) or existence in `/admins/{uid}`. Retains exclusive control over creating/managing Assistant Admins (`/assistantAdmins/{uid}`), approving/rejecting members, creating/modifying official tasks, making final Custom Task payment approvals/rejections, processing withdrawals, and approving password change requests.
   - **Assistant Admin (`isAssistantAdmin()`)**: Requires `isSignedIn()` and active existence in `/assistantAdmins/{uid}` (provisioned exclusively by Main Admin). Can view and review official `/submissions` (crediting the exact predefined task reward once on approval, or requiring a rejection reason `>= 3` chars on rejection) and can inspect `/customTasks` to mark them as reviewed or recommend approval/rejection (`status` remains `'pending'`; zero wallet access for custom tasks).
   - **Assistant Admin Restrictions**: Assistant Admins CANNOT create admins/assistants, CANNOT manually alter `/wallets`, CANNOT credit `/customTasks`, CANNOT read/approve `/withdrawals`, and CANNOT create/edit `/tasks` or `/passwordChangeRequests`.
2. **Custom Task Payment & Wallet Conservation**:
   - Submitting an official task (`/submissions`) or custom task (`/customTasks`) NEVER credits any wallet while `status == 'pending'`.
   - Assistant Admin approval of `/submissions/{submissionId}` can update `/wallets/{userId}` ONLY when atomically coupled via `get()` (`status == 'pending'`) + `getAfter()` (`status == 'approved'`) on that exact `submissionId`, adding the exact predefined `rewardAmount` once and creating deterministic `/transactions/tx_reward_${submissionId}`.
   - Custom task payments (`/customTasks/{customTaskId}`) can ONLY transition to `'approved'` or `'rejected'` via Main Admin (`isAdmin()`), crediting `approvedAmount` once with deterministic `/transactions/tx_custom_${customTaskId}` and notifying the member via `/notifications/{notificationId}`.
3. **Rejection Reason Enforcement**: Rejecting either an official `/submissions/{id}` or a `/customTasks/{id}` strictly enforces `rejectionReason.size() >= 3`.
4. **PII & Private Financial Isolation**: `/users`, `/wallets`, `/submissions`, `/customTasks`, `/notifications`, `/transactions`, `/withdrawals`, `/passwordChangeRequests`, and `/leaderboardAdminNotes` forbid cross-member reads and enforce `resource.data.userId == request.auth.uid` on member list queries. `/mediaAssets` keeps `allow list: if false` and restricts `purpose == 'proof'` strictly to owner + Admin/Assistant Admin, while permitting authenticated `get` on `purpose == 'avatar'` so leaderboard display avatars load without exposing proof screenshots.
5. **Best 10 Monthly Leaderboard Integrity (`Asia/Dhaka`, UTC+6)**:
   - `/monthlyMemberEarnings/{monthKey}_{userId}`, `/leaderboardPeriods/{monthKey}`, and `/leaderboardWinners/{winnerId}` store zero PII (no email, phone, account numbers, or private ledger details).
   - Members can never self-create or alter `eligibleEarnings`, `approvedTaskCount`, or `reachedAtMs`; a member can only sync their own `displayName` and `photoAssetId` on an existing `/monthlyMemberEarnings` record.
   - Assistant Admins can only increment `/monthlyMemberEarnings` when atomically coupled via `get()` (`status == 'pending'`) + `getAfter()` (`status == 'approved'`) to a newly approved official `/submissions/{submissionId}` by that exact `rewardAmount`.
   - Only Main Admin (`isAdmin()`) can configure/publish `/leaderboardPeriods`, finalize `/leaderboardWinners`, record `/leaderboardAdminNotes`, or reverse/recalculate earnings.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Privilege Escalation on Registration (`users` create)**:
   Authenticated user attempts to self-register `/users/attacker_1` with `{ role: "admin" }` or `{ role: "assistant_admin" }`.
2. **Payload 2 — Assistant Admin Attempting Admin Creation (`assistantAdmins` create)**:
   Authenticated Assistant Admin attempts to create `/assistantAdmins/rogue_ast`.
3. **Payload 3 — Unverified Main Admin Email Spoof (`tasks` create)**:
   Attacker authenticates with `{ email: "mamuncox7918@gmail.com", email_verified: false }` and attempts to create `/tasks/tsk_spoof`.
4. **Payload 4 — Assistant Admin Attempting Manual Wallet Balance Edit (`wallets` update)**:
   Assistant Admin attempts to manually increase `/wallets/member_1.availableBalance` without an atomic pending-to-approved official `TaskSubmission`.
5. **Payload 5 — Assistant Admin Attempting Final Custom Task Approval (`customTasks` update)**:
   Assistant Admin attempts to set `/customTasks/ctk_1.status = "approved"` and `approvedAmount = 500`.
6. **Payload 6 — Assistant Admin Attempting Withdrawal Approval (`withdrawals` update)**:
   Assistant Admin attempts to mark `/withdrawals/wdr_1` as `"paid"`.
7. **Payload 7 — Rejection Without Reason (`submissions` update & `customTasks` update)**:
   Assistant Admin or Main Admin attempts to reject a submission with `rejectionReason: ""`.
8. **Payload 8 — Duplicate Wallet Credit / Replay Attack (`submissions` update & `transactions` create)**:
   Reviewer attempts to re-approve an already `"approved"` submission or create a duplicate `tx_reward_${submissionId}` ledger record.
9. **Payload 9 — Pending Member Custom Task Submission (`customTasks` create)**:
   Unapproved (`status: "pending"`) member attempts to submit a custom task request, or an approved member attempts to submit a custom task with `status: "approved"`.
10. **Payload 10 — Sub-Minimum Withdrawal Under ৳100 (`withdrawals` create)**:
    Approved member attempts a withdrawal with `grossAmount: 99`.
11. **Payload 11 — Cross-Member Custom Task Scraping (`customTasks` list)**:
    Approved member `member_1` attempts an unfiltered `getDocs(collection(db, "customTasks"))`.
12. **Payload 12 — Member Leaderboard Score Spoofing & Reward Tampering (`monthlyMemberEarnings` / `leaderboardPeriods`)**:
    Member or Assistant Admin attempts to forge `/monthlyMemberEarnings/2026-10_member_1` with inflated `eligibleEarnings` or modify `/leaderboardPeriods/2026-10`.

