# zoomable-post-images Specification

## Purpose

定義文章說明圖片的 inline rendering、可存取 zoom view、iPhone pinch zoom 與 performance 邊界，並限制裝飾圖不成為預設內容目標。

## Requirements

### Requirement: Posts can include zoomable explanatory images

The site SHALL provide a supported way for MDX posts to include explanatory images that render inline and can be opened into a larger view.

#### Scenario: Author embeds an explanatory figure

- **GIVEN** an author has an image that helps readers understand a post
- **WHEN** the author embeds it using the supported post image mechanism
- **THEN** the image SHALL render inline within the article body
- **AND** the image SHALL support opening a larger view from the article
- **AND** the image SHALL preserve alt text and optional caption

### Requirement: Expanded image view supports iPhone pinch zoom

The expanded image view SHALL allow mobile readers to use native two-finger zoom and panning gestures, and SHALL NOT block those gestures with overlay CSS or custom touch handlers.

#### Scenario: Reader opens a figure on iPhone

- **GIVEN** a reader is viewing a post on iPhone
- **WHEN** the reader opens a zoomable post image
- **THEN** the expanded view SHALL allow two-finger zoom
- **AND** the reader SHALL be able to pan around the enlarged image
- **AND** closing the expanded view SHALL return the reader to the post
- **AND** dragging or pinching the image SHALL NOT accidentally close the expanded view

#### Scenario: Overlay is implemented for iOS Safari

- **GIVEN** a zoomable image is open on iOS Safari
- **WHEN** the reader uses native pinch or pan gestures
- **THEN** the overlay SHALL NOT use `touch-action: none`
- **AND** it SHALL NOT intercept two-finger gestures with custom handlers that prevent native zoom

### Requirement: Zoomable images remain accessible

Zoomable post images SHALL remain accessible to readers using assistive technology and keyboard navigation.

#### Scenario: Image has accessibility metadata

- **GIVEN** a post includes a zoomable image
- **WHEN** the page is rendered
- **THEN** the image SHALL expose meaningful alt text
- **AND** any close control SHALL have an accessible label
- **AND** the caption SHALL be associated visually and semantically with the image or expanded dialog

#### Scenario: Keyboard user opens and closes an image

- **GIVEN** a zoomable image is rendered inline
- **WHEN** a keyboard user focuses the image open control and activates it
- **THEN** the expanded view SHALL open with dialog semantics
- **AND** focus SHALL move into the expanded view
- **AND** Escape or an equivalent keyboard action SHALL close the expanded view
- **AND** focus SHALL return to the original open control

### Requirement: Inline images protect article performance

Zoomable post images SHALL avoid forcing the initial article view to load unnecessarily large image assets.

#### Scenario: Article contains a high-resolution figure

- **GIVEN** a post includes a high-resolution figure
- **WHEN** the article first loads
- **THEN** the inline image SHALL use an optimized size appropriate for the article layout
- **AND** the inline image SHALL expose intrinsic dimensions or equivalent layout stability
- **AND** the high-resolution view SHALL be loaded only when needed or through an equivalent performance-safe strategy
- **AND** pages without zoomable images SHALL NOT pay the expanded-view interaction cost

### Requirement: Decorative images are not the default goal

The authoring guidance SHALL frame zoomable images as reader-helpful explanatory content, not mandatory decoration.

#### Scenario: Agent considers adding an image to a post

- **GIVEN** an agent is editing a gu-log post
- **WHEN** it considers adding a zoomable image
- **THEN** it SHALL add the image only when it helps explain structure, flow, evidence, UI, or a visual concept
- **AND** it SHALL preserve source / attribution context when the image is not original
