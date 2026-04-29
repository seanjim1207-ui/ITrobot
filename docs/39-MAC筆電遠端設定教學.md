---
title: MAC筆電遠端設定教學
keywords: 作業, 搖晃, 端回, APP, Add, Joe, MAC, VPN, app, cfg, ios, mac, pin, vpn, 同事帶
---

**症狀:**  同事帶MAC筆電要設定遠端，方便連線回來作業，管理職也可遠端回tiger

**解決方法:**
步驟一
1.下載手機APP imOTP(ios)或是DroidOTP(android)
2.點選Initialize Secret後"搖晃"手機，會產生一組金鑰，記得按右上角的done → Save存檔
3.請想一組4位數的pin碼(ex:1324)，將剛剛的金鑰跟四位數一起給Joe哥設定
4.登入後輸入4位數pin碼，會得到一組動態密碼(30秒更新一次) ，為登入vpn使用

步驟二
1.安裝VPN連線軟體SmartVPN
2.請到[https://ppt.cc/fWsgwx](https://ppt.cc/fWsgwx) 下載(密碼為:moonshine)
3.到雲端硬碟裡 下載"SmartVPN & moonshinem_通用.cfg"
4.安裝完後開啟SmartVPN→ 選取系統設定
5.點瀏覽→ 匯入剛剛下載好的設定檔"SmartVPN & moonshinem_通用.cfg"
6.點選連線,輸入使用者名稱:公司員工帳號，密碼:(手機生成的動態密碼)
7.連上後 狀態會寫:已連接，即完成

步驟三
1.使用mac的同仁需要先安裝  【 WIndows APP】
https://apps.apple.com/tw/app/microsoft-remote-desktop/id1295203466?mt=12
2.在上方按 【 +】號，PCname輸入:自己的電腦.moonshine.ad
3.gateway欄位→點選" Add Gateway..."→ Gateway name 輸入: "rdsgateway.moonshine.ad"→ user account 新增一組
4.Add a User Account → Usernamr:moonshine\帳號 (帳號前記得加moonshine\)
5.勾選bypass for local addresses →  按下save即可連線

6.完整圖文教學:https://knowhow.moonshine.tw/books/%E5%B1%85%E5%AE%B6%E5%B7%A5%E4%BD%9C/page/macosmicrosoft-remote-desktop
