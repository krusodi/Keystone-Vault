# Security Specification & Threat Model (Keystone Vault + Firebase)

## 1. Data Invariants
1. **Owner & Verified Identity**: Every user workspace (`/users/{userId}`), public launcher entry (`/users/{userId}/publicApps/{appId}`), and encrypted vault (`/users/{userId}/vaultData/{vaultId}`) belongs strictly to the authenticated, email-verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. **Master Gate Relational Sync**: Subcollections (`publicApps`, `vaultData`) require an existing parent workspace document `/users/{userId}` whose `uid` matches `userId`.
3. **Zero-Knowledge Vault Confidentiality**: Passwords and sensitive credentials are never stored in `publicApps` or `UserWorkspace`; they exist only inside `EncryptedVaultDocument.ciphertext` encrypted client-side via `AES-256-GCM` with `PBKDF2-SHA256` per-admin key slots.
4. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, `id`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.
5. **Strict Schema & Bounded Payloads**: No ghost fields allowed (`hasOnly(...)`); all strings, lists (`keySlots <= 20`), and document IDs (`^[a-zA-Z0-9_\-]+$`, max 128 chars) are strictly size-checked.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Email Spoof**: Signed-in user with `email: "krusodi.ns@gmail.com"` and `email_verified: false` attempts to read/write `/admins/{uid}` or `/users/{uid}`.
2. **Cross-Tenant Vault Read**: Verified User B attempts `get` or `list` on `/users/{userA}/vaultData/primary`.
3. **Ghost Field Injection (Shadow Update)**: Owner updates `/users/{uid}` adding `isAdmin: true` or `role: "super_admin"`.
4. **Privilege Self-Escalation**: Non-admin user attempts `create` on `/admins/{uid}` with `role: "admin"`.
5. **Orphaned Subcollection Write**: User attempts to create `/users/{uid}/vaultData/primary` before `/users/{uid}` workspace document exists.
6. **ID Poisoning**: User attempts to create `/users/{uid}/publicApps/..%2Fadmin` or a 300-character invalid document ID.
7. **OwnerId Spoofing on Create**: User A sets `ownerId: userB` inside `/users/{userA}/publicApps/{appId}`.
8. **Immutable Field Tampering**: Owner attempts to change `createdAt` or `ownerId` during `update` on `/users/{uid}/publicApps/{appId}`.
9. **Client Timestamp Forgery**: Owner sends a backdated JavaScript Date instead of `serverTimestamp()` (`request.time`) for `updatedAt`.
10. **Denial-of-Wallet Oversized String**: Owner sends a 250KB string in `UserWorkspace.systemName` (limit 40) or 1MB+ in `ciphertext`.
11. **Unbounded KeySlot Array / Invalid Slot Type**: Owner sends `keySlots: []` (empty) or `keySlots: ["not-a-map"]` or 25 slots on `EncryptedVaultDocument`.
12. **Blanket List Query Bypass**: User attempts an unconstrained `list` on `/users` or `/admins` or `/users/{userA}/publicApps`.
