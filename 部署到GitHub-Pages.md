# 部署到 GitHub Pages（手机随时访问）

目标：手机浏览器打开一个网址就能记账，并且能"添加到主屏幕"当 App 用。

> 前提说明：托管只把**网页文件**放到网上，你的**账本数据仍然只存在手机浏览器里**，
> 不会上传。代价是手机和电脑各记一本账，需要时用「导出/恢复 JSON 备份」搬运。

---

## 一、先本地验证（2 分钟，强烈建议）

在 `记账` 文件夹里打开终端，执行：

```powershell
node server.js
```

然后浏览器打开 http://localhost:8765 ，确认能注册、能记一笔、能看统计图。
这一步能跑通，部署后 100% 能跑通。

> 为什么必须验证：`file://` 双击打开时 Service Worker 不生效，
> 有些问题只有走 http 才暴露出来。

---

## 二、创建 GitHub 仓库并推送

### 1. 确认 Git 可用

```powershell
git --version
```

没有的话去 https://git-scm.com/download/win 装一个，装完重开终端。

### 2. 在 `记账` 文件夹里初始化并提交

```powershell
cd "C:\Users\xiaofang\Downloads\记账"

# 忽略系统垃圾文件
@"
Thumbs.db
desktop.ini
.DS_Store
"@ | Out-File -Encoding utf8 .gitignore

git init
git add .
git commit -m "小账本：本地记账 PWA 首次发布"
git branch -M main
```

### 3. 在 GitHub 上建仓库

浏览器登录 https://github.com → 右上角 `+` → **New repository**

- **Repository name**：填 `xiaozhangben`（或任意英文名，这会影响网址）
- **Public** ← 必须选公开。免费账户的 Pages 只能用于公开仓库
- 下面的 `Add a README` / `.gitignore` / `license` **全部不要勾**
- 点 **Create repository**

建好后页面会显示仓库地址，形如：

```
https://github.com/你的用户名/xiaozhangben.git
```

### 4. 推送（把下面两行的「你的用户名」换掉）

```powershell
git remote add origin https://github.com/你的用户名/xiaozhangben.git
git push -u origin main
```

第一次推送会弹出登录窗口：

- 推荐选 **Sign in with your browser**（最省事）
- 若要填密码：**不能填 GitHub 登录密码**，必须用 Personal Access Token
  （GitHub → Settings → Developer settings → Personal access tokens → Tokens(classic)
  → Generate new token，勾选 `repo` 权限，生成后复制那串字符当密码用）

推送成功后刷新 GitHub 仓库页面，应该能看到 `index.html`、`css/`、`js/` 等文件。

---

## 三、开启 Pages

1. 仓库页面 → **Settings**（顶部齿轮）
2. 左侧栏 → **Pages**
3. **Source** 选 `Deploy from a branch`
4. **Branch** 选 `main`，文件夹选 `/ (root)`，点 **Save**
5. 等 1~2 分钟，刷新该页面，顶部会出现绿色提示和网址：

```
https://你的用户名.github.io/xiaozhangben/
```

**用电脑浏览器打开这个网址**，确认和 localhost 表现一致（能注册、能记账、图标正常）。

---

## 四、手机使用

### Android（Chrome）

打开网址 → 右上角 ⋮ → **添加到主屏幕** / **安装应用**。

### iPhone（必须用 Safari，Chrome 不行）

1. Safari 打开 `https://你的用户名.github.io/xiaozhangben/`
2. 点底部**分享**按钮 ⬆️
3. 下滑找到 **添加到主屏幕** → 添加
4. 桌面出现「小账本」图标，点开是全屏、无地址栏，和原生 App 一样

之后首次打开会联网加载一次，之后**离线也能用**（Service Worker 已缓存）。

---

## 五、以后改了代码怎么更新

```powershell
cd "C:\Users\xiaofang\Downloads\记账"
git add .
git commit -m "改了什么"
git push
```

等 1 分钟左右 GitHub Pages 自动重新发布。

> ⚠️ **重要**：如果你改了 `css/`、`js/` 或图标，**必须把 `sw.js` 里的
> `CACHE_VERSION = 'xzb-v1'` 改成 `'xzb-v2'`**（下次 v3，依次递增），否则手机上
> 会一直读到旧缓存，看不到更新。这是你的项目本来就设计好的机制。

---

## 六、必须知道的几件事

| 事项 | 说明 |
|---|---|
| 数据在哪 | 只在**当前手机浏览器的当前站点**里。换浏览器、换手机、电脑，都是各自独立的一本账 |
| 清缓存 = 丢数据 | 清除浏览器数据／网站数据会**清空账本**。请定期在「管理 → 导出完整备份（JSON）」留一份 |
| iOS 会清理 | iPhone 系统可能清理长期不用的网页数据，重要账本请定期导出备份 |
| 账号≠云账号 | 账号密码只存在这台手机的浏览器里，用于多人共用设备时隔离，**不能跨设备登录同一本账** |
| 换设备怎么迁 | 旧设备导出 JSON → 新设备登录后「从备份恢复」（注意：恢复会**覆盖**当前账本） |
| 手机流量能开吗 | 能。GitHub Pages 是公网地址，任何网络都能访问 |
| 别人能看到我的账吗 | 代码是公开的，但**你的账本数据在你自己手机里，任何人打开那个网址都只是一个空账本** |

---

## 七、这个网址的路径特性（已核对，无需改代码）

部署地址是 `用户名.github.io/仓库名/` 这种**子目录**，很多项目会在这里 404。
你的项目已确认安全：

- 所有 HTML 里的 `css/`、`js/`、`icons/` 都是相对路径 ✅
- `manifest.webmanifest` 里 `start_url: "./index.html"`、`scope: "./"` 都是相对的 ✅
- `sw.js` 用 `navigator.serviceWorker.register('sw.js')` 注册，scope 自动落在仓库子目录内 ✅
- `app.js` 里已判断"仅 https 或 localhost 才注册 SW"，GitHub Pages 是 https，走正常分支 ✅
- 全项目**没有任何 `/xxx` 形式的绝对路径**，不存在子目录 404 风险 ✅

---

## 八、下一步可选升级

- **跨设备同步（真云端）**：需要加后端（接口 + 数据库 + 服务端账号）。
  前端几乎不用动，只需在 `Store` 层加一层远端同步。想做时告诉我，我先出方案再动手。
- **自定义域名**：买个域名在 Pages 里绑定，网址更好记。
- **数据自动备份提醒**：比如超过 7 天没导出就在首页提醒一次（纯前端可做，成本很低）。
