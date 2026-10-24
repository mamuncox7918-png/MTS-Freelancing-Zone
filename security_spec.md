# Security Specification — MTS Freelancing Zone

## 1. Data Invariants & Master Sources of Truth

1. **Identity & Email Verification Gate**: Every read or write operation requires a signed-in user with `request.auth.token.email_verified == true` (`isVerified()`). Unverified email tokens (even if matching the bootstrapped admin email `mamuncox7918@gmail.com`) are strictly denied.
2. **RBAC Privilege Isolation**: Only `isAdmin()` (verified bootstrapped email `mamuncox7918@gmail.com` or existence in `/admins/{uid}`) can create/edit tasks, approve/reject members, review submissions, credit wallet rewards, process withdrawals, decide password-change requests, or write audit logs. Self-registration in `/users/{userId}` strictly enforces `role == 'member'` and `status == 'pending'`.
3. **Pending Member Containment**: Submitting proof (`/submissions`), requesting withdrawals (`/withdrawals`), and submitting password-change requests (`/passwordChangeRequests`) require `isApprovedMember()` (`get(/databases/$(database)/documents/users/$(request.auth.uid)).data.status == 'approved'`).
4. **PII & Private Financial Isolation**: `/users/{userId}`, `/wallets/{userId}`, `/submissions/{submissionId}`, `/transactions/{transactionId}`, `/withdrawals/{withdrawalId}`, `/passwordChangeRequests/{requestId}`, and `/mediaAssets/{assetId}` restrict document reads strictly to the owning member (`request.auth.uid`) or `isAdmin()`.
5. **Query Enforcer & Zero-Read List Blocks**: Every `allow list` rule evaluates `resource.data` directly (e.g., `resource.data.userId == request.auth.uid`) with zero `get()` or `exists()` calls inside `list` blocks.
6. **Atomic Wallet Conservation, Minimum ৳100 Withdrawal & Fixed ৳5 Fee**:
   - Members can initialize `/wallets/{uid}` only with `0` balances across all fields.
   - Members can NEVER increase `availableBalance` or `totalEarnings`.
   - A member wallet deduction requires `grossAmount >= 100`, `feeAmount == 5`, `netAmount == grossAmount - 5` (`netAmount >= 95`), `availableBalance >= grossAmount`, and atomic co-creation of `/withdrawals/{withdrawalId}` verified symmetrically via `getAfter()`.
7. **Terminal State Locking & Safe Proof Links**: Once a `/submissions/{id}` reaches `'approved'` or `'rejected'`, or a `/withdrawals/{id}` reaches `'paid'` or `'rejected'`, further status mutations are blocked (`existing().status == 'pending'`), preventing duplicate rewards, duplicate payouts, and duplicate refunds. Optional `proofLink` on `/submissions` must be empty or match `^https?://.+` (`<= 500` chars).
8. **Zero-Plaintext Password Policy**: `/passwordChangeRequests/{requestId}` strictly enforces `hasOnly` keys without any password field; passwords are never stored in Firestore.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Privilege Escalation on Registration (`users` create)**:
   Authenticated verified user attempts to create `/users/attacker_1` with `{ role: "admin", status: "approved" }`.
2. **Payload 2 — Shadow Field Injection (`users` update)**:
   Approved member updates `/users/member_1` with `{ fullName: "Valid Name", isVerifiedAdmin: true }`.
3. **Payload 3 — Unverified Admin Email Spoof (`tasks` create)**:
   Attacker authenticates with `{ email: "mamuncox7918@gmail.com", email_verified: false }` and attempts to create `/tasks/tsk_spoof`.
4. **Payload 4 — Cross-Member PII & Wallet Scraping (`wallets` get / `submissions` list)**:
   Approved member `member_1` attempts to read `/wallets/member_2` or list `/submissions` without `where("userId", "==", "member_1")`.
5. **Payload 5 — Self-Minting Wallet Balance (`wallets` update)**:
   Approved member `member_1` attempts to update `/wallets/member_1` setting `availableBalance: 50000`.
6. **Payload 6 — Fake Reward Ledger Entry (`transactions` create)**:
   Approved member `member_1` attempts to create `/transactions/tx_fake` with `type: "task_reward", amount: 500`.
7. **Payload 7 — Pending Member Task Submission (`submissions` create)**:
   Unapproved (`status: "pending"`) member attempts to create `/submissions/sub_1` for an active task.
8. **Payload 8 — Spoofed Task Reward Amount or Unsafe Proof Link (`submissions` create)**:
   Approved member submits proof for a ৳20 task (`tsk_1`) with tampered `rewardAmount: 5000` or `proofLink: "javascript:evil()"`.
9. **Payload 9 — Sub-Minimum Withdrawal Under ৳100 (`withdrawals` create)**:
   Approved member with ৳200 balance attempts a withdrawal with `grossAmount: 99, feeAmount: 5, netAmount: 94`.
10. **Payload 10 — Orphaned Withdrawal Without Atomic Wallet Deduction (`withdrawals` create)**:
    Approved member attempts to create `/withdrawals/wdr_orphan` (`grossAmount: 100, feeAmount: 5, netAmount: 95`) without deducting `wallets/member_1` in the same atomic batch.
11. **Payload 11 — Double Approval / Terminal State Bypass (`submissions` update & `withdrawals` update)**:
    Admin attempts to re-approve an already `'approved'` submission or mark a `'rejected'` withdrawal as `'paid'`.
12. **Payload 12 — Plaintext Password / Oversized ID Poisoning (`passwordChangeRequests` create)**:
    Member attempts to inject `{ newPassword: "secret123" }` or a 500-character poisoned document ID into `/passwordChangeRequests`.
