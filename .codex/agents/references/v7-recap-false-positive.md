# Tribunal v7 校準參考：讀得懂、但太長又在重講的 false positive

Tribunal v7 的起點是一篇被打太高分的文章。那篇已經下架，這裡只留描述與教訓，不指向它的內容。

## 發生什麼事

- 一篇講 agent 編排工作流的文章，被評成 `vibe: 8`、`narrative: 9`、`freshEyes.readability: 8`、`freshEyes.firstImpression: 8`、`librarian.crossRef: 7`。
- ShroomDog 人工判定這是 false positive：文章太長、廢話多，而且重講了 MP-179 已經用更短、更有趣的方式講過的工作流程（從管理 agent 變成管理 work、issue 狀態觸發、demo 的邊界），只在後段輕輕提了一下 MP-179。
- 表面特徵都在（MoguNote、比喻、kaomoji、完整的 section），骨架卻是線性報告。

## 各評審該抓什麼

- **Librarian**：抓跟既有文章的重疊。指出重疊的是哪一篇、哪幾段，要求具體動作：提早引用、壓成一句 recap 加內鏈、對照新角度、合併或退件。不能只留一句「可以加個 cross-ref」。
- **FreshEyes**：抓讀者疲勞。一直重講基本概念、好幾段都在 recap、長度超過資訊量，firstImpression 最多 7；節奏一直是「解釋 → 引用 → 解釋」、讀者猜得到下一段，readability 或 firstImpression 最多 6。
- **Vibe**：不要因為裝飾特徵給 `vibe 8 / narrative 9`。拿掉 MoguNote 與比喻之後讀起來像報告，narrative 就不及格。

這份參考只用來校準責任邊界，不是改寫指示。
