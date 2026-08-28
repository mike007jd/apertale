# Domain Context

## Page-turn session

A page-turn session is the runtime lifecycle of one physical leaf turn, from
arrow or drag intent through animation to one settled spread commit. It owns
direction, progress, navigation locking, reduced-motion resolution, stale-frame
suppression, and disposal. The editor and shared reader adapt their navigation
and renderer-readiness policy to this shared module; page content and Three.js
geometry remain separate concerns.

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
