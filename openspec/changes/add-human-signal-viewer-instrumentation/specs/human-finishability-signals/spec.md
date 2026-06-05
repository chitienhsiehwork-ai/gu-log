## MODIFIED Requirements

### Requirement: Share intent SHALL be treated as strong positive feedback

Gu-log SHALL record share intent as a strong human reaction signal. Share events SHALL include article identity, version snapshot, share target, result confidence, reaction strength, and polarity.

Share intent SHALL NOT be interpreted as positive by default unless `polarity` is explicitly classified as `positive` or equivalent. The default viewer label for `polarity="unknown"` SHALL be strong reaction with unknown polarity.

#### Scenario: Native share attempted

- **WHEN** a reader uses the Web Share API from a gu-log article
- **THEN** the system SHALL record a `share_intent` event with `target="native"`
- **AND** the event SHALL include the article `postVersion`
- **AND** the event SHOULD record whether the native share promise completed or was cancelled when the platform exposes that distinction
- **AND** the event SHALL NOT be displayed or consumed as positive feedback unless polarity was explicitly classified

#### Scenario: External share link clicked

- **WHEN** a reader clicks X, Facebook, LINE, or copy-link share UI
- **THEN** the system SHALL record a `share_intent` event with the selected target
- **AND** the event SHALL mark result confidence as attempted unless completion can be verified
- **AND** the event SHALL default to `polarity="unknown"` unless a classifier or human explicitly assigns polarity
