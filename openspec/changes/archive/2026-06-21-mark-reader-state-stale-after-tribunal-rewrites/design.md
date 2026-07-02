# Design: Tribunal Reader Staleness

## Current shape

Tribunal 像編輯部，會修文、重寫、補強。但 Reader Tracker 像只看檔名的書籤，文章被重寫後仍然說「你看過」。

## Proposed shape

Tribunal 只要改到讀者會看到的正文，文章的 read-relevant revision 就要變。讀者過去的 read record 仍保留，但會變成 stale read。

## What must not happen

評審分數、後台進度、模型名字、runtime 版本，這些不是讀者需要重讀文章的理由。它們可以更新，但不該把已讀狀態打成過期。

即使某些 score panel 會被讀者看見，這個 change 仍把它們視為 article chrome / quality metadata，而不是「需要重讀正文」的 revision source。正文、標題、摘要、ClawdNote 這種讀者閱讀內容才算 reader-visible content for reread.

## Version boundaries

`tribunalVersion` 是評審流程版本，不是文章版本。Judge score date/model 也不是文章版本。Reader Tracker 只能跟 reader-facing revision 比。

## Dependency

這個 change 的實作要等 version-aware reader state 可以保存 read revision 後才完整落地。
