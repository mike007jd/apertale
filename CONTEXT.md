# Domain Context

## Page-turn session

A page-turn session is the runtime lifecycle of one physical leaf turn, from
arrow or drag intent through animation to one settled spread commit. It owns
direction, progress, navigation locking, reduced-motion resolution, stale-frame
suppression, and disposal (`app/src/pageTurnSession.ts`). The page shapes that
turn animates — resting depth, vertex deformation, case and spine poses, and
which spread is painted on the moving leaf — are separate pure geometry
(`app/src/pageDeformation.ts`).

## Reader shell

The reader shell is the page-turn half of a reader surface: it owns the
Page-turn session, renderer readiness per turn direction, scene failure, the
WebGL/fallback choice, and the rule that a spread commit re-arms the wait state
and drops readiness before the index moves (`app/src/readerShell.ts`). The
editor and the shared reader differ only in where the spread index lives — the
book engine or local state — and express that difference as the shell's
`commit` adapter.

## WebMCP tool catalog

The WebMCP tool catalog is the authoritative ordered set of Agent-discoverable
Site Tools shipped by Apertale. Runtime registration, the authoring guide, the
public manifest, and deployment verification consume this same catalog.

## Asset registry

The Asset registry admits supported browser-local images, optimizes and stores
them, assigns stable asset IDs, exposes metadata and Blob resolution, and owns
the browser-side distinction between persisted and non-local asset references.

## Creation workshop session

A Creation workshop session holds the authoring mode, spread count, visual
direction, and ordered source-image membership for one creation brief. It owns
session restoration and brief materialization while the App Adapter owns UI,
clipboard, file-picker, focus, and feedback behavior.

## Creation brief readiness

Creation brief readiness is the versioned pre-mutation decision contract for
illustrated stories, photo-led keepsakes, and preserved-photo albums. The
contract owns blocking fields, concise user questions, recommendations, asset
needs, and photo/identity boundaries. Both context inspection and the create
command consume the same assessment; source-asset existence and identity risk
are derived from the actual source list rather than trusted book-type labels.

## Authoring quality lifecycle

The Authoring quality lifecycle is browser-local workflow state beside a
personal Project artifact. It records the exact creation brief, current-revision
render evidence, no more than two explicit critique rounds, and the structured
quality report. The shared rubric separates deterministic document/render
checks from Agent visual judgment over actual browser frames. Publishing
revalidates the attestation on both the client and Worker; existing public
revisions remain readable and recoverable.

Image-led spread provenance keeps two meanings separate: `sourceAssetId` is
the original full-spread composite used to derive a clean plate, while
`personalSourceAssetId` records a declared user photo governed by identity and
source-use policy. A legacy personal Project without lifecycle metadata may
adopt one readiness-passed brief at its inspected revision; curated samples and
books that already own a brief cannot be reclassified.

## Project artifact

A Project artifact is the revisioned book document consumed by the editor,
renderer, persistence, publishing, and shared-reader Adapters. Its Module owns
location-aware traversal of cover, spread, artwork, element, and frame asset
references; each Adapter retains its own authorization and trust policy.

## Publishing schema

The immutable, numbered D1 migrations under `app/drizzle` are the deployment
record for durable book and asset storage. The unbundled Worker keeps the
equivalent migration-0001 statements at its runtime boundary so a fresh binding
can serve safely; later schema changes add migrations instead of rewriting that
baseline. Sites contract tests keep the initial representations aligned and
prove the migrations are packaged.
