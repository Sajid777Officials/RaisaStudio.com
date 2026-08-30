# RAISA Studio CMS Admin Guide

This guide is for portfolio Owners, Publishers, Editors, and Viewers. It covers
the normal browser workflow and the recovery steps that are safe to perform
without weakening Supabase Auth, Row Level Security (RLS), or Storage policies.

The repository checks exercise the client and SQL contracts without contacting
a live project. Complete the staging checks in
[`FINAL_VERIFICATION_CHECKLIST.md`](FINAL_VERIFICATION_CHECKLIST.md) before a
production release.

## Sign in and session behavior

The admin overlay is the portfolio's branded login surface and reuses the
public site's typography, color, spacing, controls, and responsive shell. Its
appearance is not an authorization boundary; Supabase Auth plus the active
database role still decide access.

1. Open the deployed portfolio and add `/#admin` to the site URL.
2. Wait for **Checking session…** to finish.
3. Enter the email and password for an active Supabase Auth account.
4. Choose **Sign in securely**.

The login uses Supabase password authentication. The browser must have both a
valid Supabase session and an active row in `public.admin_users`; having only
one of those is not sufficient. Before loading a private draft, the CMS asks
Supabase to verify the current user and then verifies that the user ID matches
the active CMS role.

The CMS rechecks access when a user signs in, a token refreshes, or account data
changes. A missing, expired, mismatched, signed-out, or inactive session locks
the editor and replaces any in-memory draft preview with the public snapshot.
An authenticated Supabase user who has no active portfolio role is
unauthorized.

Never put a password, reset link, database password, secret key, or
`service_role` key in `.env`, source code, a support ticket, or a CMS content
field. The browser needs only the configured Supabase URL and publishable key.

## Roles and permissions

The interface hides or disables unavailable actions, but Postgres functions,
RLS, and Storage policies are the authority.

| Capability | Owner | Publisher | Editor | Viewer |
|---|---:|---:|---:|---:|
| Read draft, history, activity, and media | Yes | Yes | Yes | Yes |
| Open an authorized draft preview | Yes | Yes | Yes | Yes |
| Add, edit, duplicate, delete, and reorder draft content | Yes | Yes | Yes | No |
| Save a draft | Yes | Yes | Yes | No |
| Stage media, edit alt text, replace media, and remove unreferenced private media | Yes | Yes | Yes | No |
| Publish, whole-site unpublish, and restore a revision | Yes | Yes | No | No |
| Promote media and delete eligible canonical delivery media | Yes | Yes | No | No |
| List, assign, change, or deactivate staff roles | Yes | No | No | No |

At least one active Owner must remain. The database serializes role changes and
rejects an attempt to demote or deactivate the last active Owner. Keeping two
independently controlled Owner accounts is recommended for recovery.

## Create an account and assign a role

These are deliberately separate operations. The CMS never creates Auth
accounts or sets passwords.

1. In the trusted Supabase Dashboard, create or invite the person under
   **Authentication → Users**. Use Supabase's password setup or reset process.
2. Confirm the Auth user exists and that its email is correct.
3. Sign in to the portfolio CMS as an existing Owner.
4. Open **Staff**, enter that existing Auth email, select `owner`, `publisher`,
   `editor`, or `viewer`, and assign the role. The screen calls the owner-only
   `add_portfolio_admin_user` RPC; never call it from an anonymous client.
5. Have the new staff member sign in separately and verify only the expected
   actions are available.

The RPC normalizes the email and role, rejects unsupported roles, and fails if
no matching Supabase Auth account exists. Assigning a role records the acting
Owner, target user, role, and time in the activity log. If the email already
has a staff row, assigning it updates the role and reactivates that row; review
the existing account carefully before submitting.

To change access, an Owner updates the role or marks the staff record inactive.
Deactivation blocks protected CMS operations but does not delete the Supabase
Auth account. For urgent offboarding, also revoke that user's Auth sessions or
disable/delete the Auth account using trusted Supabase administration. Review
the activity entry and verify the account can no longer reload private data.

The SQL bootstrap in `README_DEPLOY.md` is only for the first Owner on a new
installation. After that, use the owner-only workflow above.

## Edit and save a draft

Use the structured sections rather than the raw **Data** view for normal work:

- **Site** manages brand details, contact information, navigation, social
  links, footer content, SEO, sharing metadata, and integrations.
- **Graphic**, **Software Dev**, and **Cases** manage page copy, services,
  projects, case studies, visibility, ordering, and their media.
- **Uploads** manages staged and published images.
- **History** shows revisions and activity.

Adding, editing, duplicating, deleting, hiding, or reordering an item changes
the browser working copy first. It does not change the public site.

1. Make the required edits and resolve every field-level validation message.
2. Use **Preview** to inspect the working copy with the real public components.
3. Choose **Save draft**. A successful save advances the draft revision.
4. Leave the item in draft, or ask an Owner/Publisher to publish it.

**Discard draft** removes only unsaved browser changes. **Reload** fetches the
latest server draft and revisions. Closing or reloading a dirty editor prompts
for confirmation, but operators should not rely on the prompt as a backup.

The server validates and sanitizes the full content document. It also compares
the expected draft revision so one session cannot silently overwrite another.

## Preview

Preview is authorized, browser-local, and non-publishing. It renders the
current working copy, including unsaved fields, with the public website
components. Private `media://<uuid>` references are resolved only for the
authorized session using short-lived signed URLs; those signed URLs are never
saved in content.

Check the target page, its navigation route, responsive layout, links, image
crop, alternative text, SEO fields, and hidden/unpublished records. A preview
is not proof that the public site changed.

## Publish

Only an Owner or Publisher can publish.

1. Resolve validation errors and choose **Save draft**.
2. Confirm the toolbar no longer says **Unsaved draft changes**.
3. Preview the saved revision.
4. Choose **Publish** and confirm the dialog.
5. Wait for media promotion and content publication to finish.
6. Open a signed-out/private browser window and reload the public route.

Publishing promotes referenced private assets to immutable delivery paths
before finalizing the public snapshot. The canonical delivery bucket is
private; visitors receive short-lived signed URLs only for verified objects
referenced by the enabled published snapshot. If promotion or publication
fails, do not upload over an existing delivery object. Keep the draft, resolve
the reported problem, and retry from the saved revision.

## Unpublish

There are two kinds of unpublishing:

- To remove one service, project, case, or section, set its published/active
  control off, save the draft, preview it, and publish the new snapshot.
- To take the whole portfolio snapshot out of public delivery, an Owner or
  Publisher uses the protected **Unpublish site** action and confirms the
  current published revision. The public loader receives the explicit
  unavailable state; the private draft and revision history remain intact.

Do not improvise a direct table update or invoke privileged operations from the
browser console. If the action is unavailable, stop and reconcile the deployed
frontend/migration versions before changing publication state.

After either action, verify the affected route in a signed-out/private browser
window. Unpublish does not delete media or revision history.

## Restore a revision

Only an Owner or Publisher can restore.

1. Open **History** and identify the intended draft or published revision.
2. Choose **Restore to draft** and confirm.
3. Review the restored draft; restoration does not publish automatically.
4. Preview, correct, and save as needed.
5. Publish only after the restored result has been approved.

The restore call uses the current expected draft revision. If another session
changed the draft, follow the conflict procedure below instead of forcing the
old revision.

## Media workflow

Managed uploads accept JPEG, PNG, WebP, and GIF files up to 3 MiB. New media
requires meaningful alt text. The browser performs an early signature, size,
dimension, and crop check before staging a private object with a generated
path. That browser check is usability feedback, not the trust boundary.

After the private upload, the authenticated CMS invokes the
`verify-portfolio-media` Edge Function. The function checks the exact allowed
origin and active Editor-or-higher session, derives the reserved Storage path
from protected metadata, downloads the object with its server-only credential,
fully decodes it, computes its SHA-256 digest, and records the immutable binding
through a service-role-only RPC. It accepts at most a 6,000-pixel edge,
12 megapixels per frame, 120 frames, and 24 megapixels across all frames. The
CMS must not offer the resulting `media://` token as usable unless that trusted
verification succeeds. Non-GIF images can be cropped; animated GIFs keep their
original frames.

Use **Replace** to create a new asset and update the working draft. A published
object is immutable and is never overwritten in place. Deletion uses a
prepare/finalize flow and is rejected while the asset is referenced by either
the draft, published content, or retained revision history.

Canonical visitor delivery uses signed URLs with a 300-second lifetime. The
public client refreshes them before expiry and fails closed after the short
cache envelope expires; a whole-site unpublish clears the public content and
signed-media caches. Treat every signed URL as a temporary bearer grant: never
paste one into content, support messages, activity metadata, or documentation.
Legacy `portfolio-uploads` URLs remain direct only for compatibility while
their references are deliberately migrated.

For detailed upload, crop, replacement, deletion, failed-publication, orphan
cleanup, and legacy-media procedures, follow
[`MEDIA_OPERATIONS.md`](MEDIA_OPERATIONS.md).

## Revision conflict recovery

The message _another session changed the draft_ means the server correctly
rejected a stale expected revision.

1. Stop editing in the stale tab. Do not repeatedly retry the same save.
2. Copy the unsaved text or values to a temporary, access-controlled note if
   they would be difficult to recreate. Do not copy passwords or signed media
   URLs.
3. Choose **Reload** to fetch the latest server draft.
4. Review the newer changes and manually reapply only the still-valid edits.
5. Validate, preview, and **Save draft** again.
6. Publish only the newly saved revision.

If publication reports a revision conflict, reload both draft and published
status before deciding whether another publish is still required.

If a staff action reports that Owner access changed while it was being
processed, treat the action as failed. Sign in again, reload Staff and Activity,
confirm the current Owner set, and then decide whether to retry. Never show or
record a success unless the protected RPC returned successfully.

## Errors and interrupted operations

- A validation error leaves the working copy on screen. Correct the named
  field and save again.
- A database or network error does not prove a save or publish failed. Keep the
  tab open, restore connectivity, reload authoritative state in a second
  authorized session if necessary, and check revisions/activity before retrying.
- An expired or revoked session locks the CMS. Sign in again only after
  confirming the account should still have access.
- A missing private preview URL can be retried after reauthentication. Never
  paste a signed URL into content.
- A verifier rejection means the staged object is not usable even if the
  browser preview looked valid. Keep the reported error, confirm the session
  and configured origin, and retry with a valid file; never call the trusted
  marker RPC from the browser or fabricate verification metadata.
- A failed media promotion or deletion must be reconciled using
  `MEDIA_OPERATIONS.md`; do not manually remove referenced Storage objects.

## Activity and audit review

The activity feed is available to active staff and is newest-first. Each record
includes the actor, action, resource type/target, and timestamp, with operation
metadata where applicable. Staff assignment, update, and deactivation events
identify both the acting Owner and target account. The server caps each page at
100 records.

Review activity after a role change, restore, unpublish, or unexpected content
change. An activity entry supports investigation but does not replace checking
the current draft, published revision, Auth user, and Storage state.

## Safe sign out

1. Save or deliberately discard unsaved work.
2. Choose **Sign out** in the CMS sidebar.
3. Wait until the locked login screen is visible and private preview content is
   gone.
4. On a shared device, close every portfolio tab and then close the browser.

The CMS requests normal Supabase sign-out, then attempts local session removal
if server revocation reports an error. It always clears the in-memory draft and
preview. If it warns that server session revocation could not be confirmed,
close the browser before leaving the device and use trusted Supabase
administration to revoke the session when appropriate.

Closing the panel with **Close** is not the same as signing out.

## Before a production release

- Use Node.js 22 or newer, install the lockfile with `npm ci`, and run
  `npm run seed:check`, `npm run check`, and `npm run verify:browser` from the
  final source tree. Record the actual output; there is no separate lint or
  type-check command in this repository.
- In staging, configure `PORTFOLIO_ALLOWED_ORIGINS` as a comma-separated list of
  exact HTTPS origins (loopback HTTP is permitted only for local testing) and
  deploy `supabase/functions/verify-portfolio-media` with gateway JWT
  verification enabled. `SUPABASE_SERVICE_ROLE_KEY` is available only inside
  the Edge runtime and must never be copied into the frontend environment.
- Before migration `202608040005`, inventory every existing canonical media
  row. Existing rows do not automatically acquire a trusted marker. Reverify
  an exact preserved staging source through the deployed verifier, or replace
  and republish the asset when that source is unavailable. Never manufacture a
  digest or mark historical public bytes trusted without decoding the reserved
  source. Unverified canonical media is intentionally excluded from delivery.
- Apply every migration in the order and rollout sequence listed in
  `README_DEPLOY.md`, then release the matching frontend in the same controlled
  window.
- Complete and record every staging/manual item in
  [`FINAL_VERIFICATION_CHECKLIST.md`](FINAL_VERIFICATION_CHECKLIST.md).
- Use test accounts for all four roles and a separate signed-out browser.
- Do not test destructive recovery procedures against production.
