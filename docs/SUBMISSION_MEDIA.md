# Apertale — submission media manifest

Use only the source-true captures below for repository, Devpost, and video materials. They show the current implementation rather than an aspirational mockup. Do not substitute the historical LivingBook reference images or generated interface concepts.

## Primary project image

- **File:** [`app/qa/apertale-atlas-day-current.png`](../app/qa/apertale-atlas-day-current.png)
- **Size:** 1092 × 889
- **Use:** GitHub README hero, Devpost project image, opening video frame.
- **Caption:** Apertale turns a page into a continuous illustrated world: here, Rome crosses both pages in the Day presentation.
- **Alt text:** Apertale Day presentation showing a panoramic paper-collage Rome spread inside an open book.

## Supporting gallery

| File | Size | Use | Caption / alt text |
|---|---:|---|---|
| [`apertale-library-current.png`](../app/qa/apertale-library-current.png) | 1092 × 889 | Independent-book proof | Apertale's editorial cover gallery puts the Field Guide first, followed by four independent curated Sample Books. |
| [`apertale-atlas-night-current.png`](../app/qa/apertale-atlas-night-current.png) | 1092 × 889 | Day/Night proof | Apertale's cool moonlit Night presentation over a continuous generated landmark illustration. |
| [`apertale-science-day-current.png`](../app/qa/apertale-science-day-current.png) | 1092 × 889 | Knowledge-book proof | A generated cut-paper volcano cross-section turns an explanation into a full-spread science scene. |
| [`apertale-atlas-preview-cover.png`](../app/qa/apertale-atlas-preview-cover.png) | 1280 × 720 | Clean Atlas frame | Atlas of Living Wonders in Preview, without editor chrome. |
| [`apertale-science-preview-cover.png`](../app/qa/apertale-science-preview-cover.png) | 1280 × 720 | Clean science frame | How the World Works in Preview, showing the illustrated volcano spread. |

## Video evidence sequence

The final public video must remain under three minutes and include audio. Use these source-true visual beats:

1. Library — `apertale-library-current.png` establishes the Field Guide plus four independent Sample Books and the explicit Create Your Own path.
2. Pencil storyboard — record the blank 3D book in the workshop while `sketch_storyboard` reveals labelled boxes, ellipses, arrows, and text stroke by stroke, with the Site tools activity indicator and the "Codex sketched N spreads" receipt in frame; a static screenshot cannot replace this evidence.
3. Red pencil — record the reader circling one labelled mark and striking through another, then Codex reading the marks (`get_project_context`), redrawing only that spread (`sketch_storyboard` update), the red marks vanishing, and the "Codex applied your marks on spread N" receipt.
4. Live Site Tools — record the ChatGPT desktop built-in browser's eight-tool list and the `request_image_handoff` → `manage_book` create sequence that turns the pencil plan into the finished book.
5. Human correction and exact undo — record a manual drag after an Agent `apply_scene_patch`, then `undo_project_change` removing the motion while the manual transform remains.
6. Night/Preview — finish with Night through `set_presentation`, a physical page turn, a click-driven knowledge reveal, and the read-only share link.

Follow the prompts and evidence requirements in [`SITE_TOOLS_ACCEPTANCE.md`](SITE_TOOLS_ACCEPTANCE.md). Do not show Chrome, development flags, localhost, private URLs, API keys, personal notifications, or unrelated browser tabs in the final recording.

## Provenance

These images are direct captures of the repository implementation. Runtime art and generated-asset provenance is documented in [`ASSET_PROVENANCE.md`](ASSET_PROVENANCE.md). The screenshots contain no third-party music and are intended only to demonstrate the submitted product.
