# Editable content inventory

This inventory maps public-facing portfolio content to the canonical
`schemaVersion: 1` document and the structured CMS surface. The database keeps
the complete draft private and exposes only the sanitized published projection.
Source defaults are recovery/first-run content; after the guarded seed, editors
work on the database document rather than changing source files.

## Public route map

| Public route | Managed content used |
|---|---|
| `/` | Global brand/loading/navigation plus both studio split-hero records |
| `/graphic` | Graphic page copy, services, category projects, selected work, About, site/footer, and Graphic route SEO |
| `/webdev` | Software Development page copy, technology rail, services, category projects, selected work, GitHub integration, About, site/footer, and Software Dev route SEO |
| `/about` and `/{graphic|webdev}/about` | The corresponding managed studio About section and route SEO |
| `/{graphic|webdev}/{work-id-or-slug}` | Published selected work plus its one linked, published case record and case SEO |

Service-category selection is page state rather than a separate public URL.
Legacy hash forms resolve to the same content; they are compatibility routes,
not a second content source.

## Global site content

| Public area | Editable fields | CMS location |
|---|---|---|
| Brand and loading screen | `site.brandName`, `site.logoMark`, `site.trademark` | Site |
| Contact actions | `site.contact.email`, `phone`, `location` (`contactEmail` is a legacy email alias) | Site → Contact details |
| Primary navigation | item `label`, internal `target` or external `url`, visibility, order | Site → Navigation |
| Social links | item `label`, `url`, visibility, order | Site → Social links |
| Footer | `eyebrow`, `tagline`, `contactLabel`, `copyright`, plus contact/social data above | Site → Footer |
| Global SEO | title, description, keywords, canonical URL, sharing image, no-index flag | Site → Search and sharing |
| Route SEO | title, description, keywords, canonical URL, sharing image, no-index for Home, Graphic, Software Dev, and About | Site → Page SEO |
| Technology strip | ordered `techStack` labels | Data → Technology stack (structured controls) |
| GitHub portfolio feed | enabled flag, username, eyebrow, title, link label, item limit | Site → GitHub integration |

## Graphic and Software Development pages

Both studio documents under `studios.graphic` and `studios.webdev` expose the
same structured families.

| Public section | Editable fields | CMS location |
|---|---|---|
| Split hero | eyebrow, title fragments, subtitle, CTA, hover label, ordered statistics | Graphic / Software Dev → Hero |
| Page navigation chrome | back-button label and page breadcrumb | Graphic / Software Dev → Page intro |
| Page introduction | eyebrow, title fragments/second line, lead paragraph, ordered statistics | Graphic / Software Dev → Page intro |
| Technology rail (Software Dev) | rail label, ordered technology labels, and section visibility | Software Dev → Page intro and Technology stack |
| Service heading and navigation | heading, subtitle, helper/meta copy, category breadcrumb, all-services label, project-details CTA, load-more CTA, and section visibility | Graphic / Software Dev → Services |
| Services | stable ID, slug, number, name/title, short description aliases, icon, active flag, order | Graphic / Software Dev → Services |
| Service-category projects | stable ID, category relationship, title, slug, short/full description, client, date, stack where applicable, tags, cover image/alt, gallery, featured/published flags, order and visual thumbnail settings | Graphic / Software Dev → Category projects |
| Selected-work heading | title, portfolio meta copy, work CTA label, and section visibility | Graphic / Software Dev → Hero and selected work |
| Selected work | stable ID, category relationship/label, title, slug, year, client, stack, short/full description, cover image/alt, gallery, featured/published flags, order/span and visual thumbnail settings | Graphic / Software Dev → Selected work |
| About | eyebrow, title, lead, body, ordered pillars, and section visibility | Graphic / Software Dev → About |

Services, category projects, and selected work can be added, edited,
duplicated, reordered, unpublished, and deleted in the draft. Search, status
filters, sorting, and pagination operate on the project/work lists. Publication
visibility is enforced again by the database public projection.

## Case studies

Each `cases[caseId]` record is linked through `project_id` to canonical selected
work. A public case without a published linked work is excluded rather than
served as an orphan.

Editable fields include:

- stable case ID and canonical `project_id` relationship;
- publication state;
- side, title, eyebrow, palette and thumbnail presentation;
- cover image and alternative text;
- challenge, pull quote, process, tools/deliverables;
- ordered side-information rows and result metrics;
- additional gallery images and their alternative text/captions where present;
- per-case SEO title, description, keywords, canonical URL, sharing image, and
  no-index flag.

Cases can be added, duplicated, searched, filtered, sorted, paginated, linked,
edited, unpublished, previewed, and deleted from the private draft in the Cases
editor. A case is publicly reachable only when both the case and its linked work
are published.

## Media

The Uploads library manages the content rather than embedding credentials or
temporary URLs in the document. Editable media properties are alternative text
and references placed in eligible image fields. Operators can:

- upload validated JPEG, PNG, WebP, or GIF files;
- preview private draft media with a short-lived signed URL;
- crop non-GIF images before staging;
- replace an asset by creating a new immutable asset/reference;
- inspect draft and published usage; and
- delete only after the protected prepare/finalize workflow confirms that no
  saved or current browser draft reference exists.

Persisted content stores `media://<uuid>` tokens. The public projection resolves
only verified, published manifest entries. Canonical delivery objects are in a
private bucket and are exposed to visitors through short-lived signed URLs;
legacy compatibility objects may retain their historical public URLs. Signed
draft-preview URLs are never saved into content.

## Workflow and operational records

These are editable or actionable in the CMS but are not public content:

- draft/published revision state and whole-site publication status;
- revision restoration into a new draft;
- activity records containing actor, action, target, and timestamp; and
- Owner-managed staff role/activation records for Owner, Publisher, Editor,
  and Viewer.

## Code-managed interface text and recovery fallbacks

Security, accessibility, and transient interface messages such as sign-in
errors, loading states, dialog controls, keyboard labels, empty states, and
publish confirmations remain version-controlled application UI. They are not
marketing/content records and must not be editable through untrusted content.

Public components retain conservative fallback labels for missing legacy
fields or a temporary backend failure. The fallback is recovery behavior, not
an alternate CMS: a successful published RPC response (including an explicit
whole-site-unpublished marker) is authoritative. New content work should be
performed in the structured editor and published through the protected
workflow.
