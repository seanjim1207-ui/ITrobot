---
title: windows筆電遠端設定教學
keywords: 作業, 搖晃, 瀏覽, APP, CER, DER, Joe, VPN, cer, cfg, ios, pin, vpn, LOGO, Save
---

**症狀:**  同事會帶筆電要設定遠端，方便連線回來作業

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
1.請同事先查看自己的 電腦名稱，右鍵左下角微軟LOGO→ 系統→ 就可以看到裝置名稱
2左下角搜尋列找【遠端桌面連線】→點開後，在中間電腦輸入: 電腦名稱.moonshine.ad
3.點選下方的顯示選項→進階→設定→勾選使用這些RD閘道伺服器設定
→輸入:rdsgateway.moonshine.ad→確定→按下連線
4.會跳出RD閘道伺服器認證，請輸入帳號:moonshine\員工帳號 密碼:員工密碼
5.第一次設定或登入會跳出無法識別，這時請按下檢視憑證
6.視窗跳出後→詳細資料→複製到檔案→下一步→匯出檔案格式→DER編碼二位元X.509(.CER)
7.任選一個電腦資料夾位置，命名檔案後存檔
8.找到剛剛匯出的資料夾位置，執行剛剛的.cer檔→在一般中選擇安裝憑證
9.選擇"本機電腦"→下一步→選擇"將所有憑證放入以下存放區"→按"瀏覽"→選擇"受信任的根憑證授權單位→按下完成。
10.回到遠端桌面連線→按下連線→輸入帳號:moonshine\自己公司帳號 密碼:自己公司密碼→共會需要輸入兩次→完成。

11.需要圖文詳細教學:https://knowhow.moonshine.tw/books/%E5%B1%85%E5%AE%B6%E5%B7%A5%E4%BD%9C
