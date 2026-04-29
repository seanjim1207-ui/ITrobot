---
title: Blender (RDP遠端滑鼠偏移問題）
keywords: Edit, Grab, 實習生上, Input, 端機房主機, 公司教室電腦, 時遇到滑鼠狀, 都是小電腦遠, Blender, blender, Continuos, Preferences, Blender (RDP遠端滑鼠偏移問題）, 公司教室電腦都是小電腦遠端機房主機，實習生上blender時遇到滑鼠狀況。
---

**症狀:**  公司教室電腦都是小電腦遠端機房主機，實習生上blender時遇到滑鼠狀況。

**解決方法:**
1.原因:遠端時，Blender抓不到螢幕的邊界，導致滑鼠相對位置失靈，數值經過滑鼠左移右移都會增加的問題。
2.打開Edit→Preferences→跳出Blender Preferences→ Input→ 在滑鼠欄位找到 Continuos Grab 把打勾取消掉
