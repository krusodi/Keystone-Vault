# Security Specification & Threat Model (Keystone Vault + Firebase)

## 1. Data Invariants
1. **Workspace Authentication & Membership Gate**: Every shared workspace (`/workspaces/{workspaceId}`) and its subcollections (`publicApps`, `vaultData`, `devices`, `publicState`, `members`, `invites`) strictly require `request.auth != null` (either Firebase Anonymous Auth or verified email account) and verified workspace membership (`members/{uid}`). Admin/legacy `/admins/{adminId}` and `/users/{userId}` paths remain restricted strictly to `request.auth.token.email_verified == true`.
2. **Invite-Gated Multi-Device Joining (Atomicity)**: A user can join an existing shared workspace only via an atomic batch that creates `/workspaces/{workspaceId}/members/{request.auth.uid}` validated against an active `/workspaces/{workspaceId}/invites/{inviteToken}` and atomically appends `request.auth.uid` to `workspaces/{workspaceId}.memberUids` enforced via `existsAfter`.
3. **Zero-Knowledge Vault Confidentiality**: Passwords and sensitive credentials are never stored in `publicApps`, `WorkspaceRoot`, or `WorkspaceMember`; they exist only inside `EncryptedVaultDocument.ciphertext` / `WorkspaceEncryptedVault.ciphertext` encrypted client-side via `AES-256-GCM` with `PBKDF2-SHA256` per-admin key slots.
4. **No PII Leakage**: `WorkspaceMember` and `WorkspaceDeviceSession` store non-PII labels only (no email, phone, or physical address).
5. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, `workspaceId`, `id`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.
6. **Strict Schema & Bounded Payloads**: No ghost fields allowed (`hasOnly(...)`); all strings, lists (`keySlots <= 20`, `memberUids <= 20`, `appIds <= 200`, `deviceIds <= 50`), and document IDs (`^[a-zA-Z0-9_\-]+$`, max 128 chars) are strictly size-checked.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Email Spoof**: Signed-in user with `email: "krusodi.ns@gmail.com"` and `email_verified: false` attempts to read/write `/admins/{uid}` or `/workspaces/main`.
2. **Cross-Tenant Vault Read**: Verified User B (not a member of `workspaces/main`) attempts `get` or `list` on `/workspaces/main/vaultData/primary`.
3. **Shadow Update Ghost Field Injection**: Member updates `/workspaces/main` adding `isAdmin: true` or `ownerId: userB`.
4. **Privilege Self-Escalation**: Non-admin user attempts `create` on `/admins/{uid}` with `role: "admin"`, or joins `/workspaces/main/members/{uid}` with `role: "owner"`.
5. **Unauthorized Invite Bypass**: Non-member attempts to add their UID directly to `/workspaces/main.memberUids` without a valid active invite token and atomic `members/{uid}` creation.
6. **ID Poisoning**: User attempts to create `/workspaces/main/publicApps/..%2Fadmin` or a 300-character invalid document ID.
7. **OwnerId Spoofing on Create**: User A sets `ownerId: userB` inside `/workspaces/main/publicApps/{appId}`.
8. **Immutable Field Tampering**: Member attempts to change `createdAt`, `workspaceId`, or `ownerId` during `update` on `/workspaces/main/publicApps/{appId}`.
9. **Client Timestamp Forgery**: Member sends a backdated JavaScript Date instead of `serverTimestamp()` (`request.time`) for `updatedAt`.
10. **Denial-of-Wallet Oversized String**: Member sends a 250KB string in `WorkspaceRoot.systemName` (limit 40) or 1MB+ in `ciphertext`.
11. **Unbounded Array / Invalid Element Type**: Member sends `memberUids: []` or 25 members, or `keySlots: ["not-a-map"]` on `WorkspaceEncryptedVault`.
12. **Blanket List Query Bypass**: User attempts an unconstrained `list` on `/workspaces`, `/workspaces/main/publicApps`, or `/workspaces/main/invites` without matching ownership/membership `where` filter.
