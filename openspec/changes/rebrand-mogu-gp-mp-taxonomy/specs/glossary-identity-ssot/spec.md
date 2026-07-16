## ADDED Requirements

### Requirement: Mogu SHALL have one canonical glossary identity

The gu-log commentary persona SHALL have exactly one enabled canonical glossary entry named `Mogu`, with stable anchors `/glossary#mogu` and `/en/glossary#mogu`. Active posts and UI SHALL NOT link the persona name to a Clawd anchor or use Clawd as an alias.

#### Scenario: Mogu appears in a post note

- **WHEN** a MoguNote renders a linked persona prefix
- **THEN** the zh-tw prefix SHALL link to `/glossary#mogu`
- **AND** the English prefix SHALL link to `/en/glossary#mogu`

#### Scenario: Retired persona anchor is introduced

- **WHEN** active content links persona prose to `/glossary#clawd` or `/en/glossary#clawd`
- **THEN** glossary validation SHALL fail
- **AND** SHALL suggest the language-appropriate Mogu anchor

#### Scenario: Duplicate persona identity or retired alias is introduced

- **WHEN** glossary data adds a second enabled Mogu persona entry or adds Clawd as an alias for the Mogu persona
- **THEN** glossary identity validation SHALL fail
- **AND** SHALL preserve exactly one canonical Mogu entry and anchor
