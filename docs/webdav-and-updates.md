# WebDAV 同步与 Windows 自动更新

## WebDAV

在扩展设置的「WebDAV 全量同步」填写目录地址、用户名、应用密码和独立加密口令，点击「验证并连接」，再点击「重新对比同步」。远端改动进入预览；确认后先下载完整 Netscape HTML 书签备份，再创建、修改或移动原生书签。删除移入已绑定的本机回收站。备份失败不执行改动。

同步内容包括原生书签、目录、笔记与元数据、模型档案及 API Key、业务配置、学习偏好、会话历史、整理审核、访问聚合、用量和通知。跨设备引用通过稳定标识映射到目标设备的原生书签 ID，不建立替代书签库。外来会话和操作只作历史，另一设备不会接管正在执行的任务，也不能执行外来操作的撤销。

不传输 WebDAV 凭据、独立加密口令、设备授权开关、运行检查点、浏览器权限、缩略图和可重建搜索缓存。学习和其他主动功能仍需在每台设备独立授权。

- 传输：HTTPS，仅 loopback 地址允许 HTTP。服务器目录须事先存在，支持 GET、PUT、DELETE、强 ETag、`If-Match` 和 `If-None-Match`。连接验证会创建并清理一个随机临时文件，并验证两个条件写约束。
- 密文：`siftmark-sync.v1.encrypted`，复用 AES-256-GCM、PBKDF2-SHA-256（600,000 次）；各设备使用同一独立口令。口令不匹配或文件损坏时停止。
- 合并：共同快照、当前本机、当前云端三方对比；独立新增与单边编辑可合并，同项双改必须逐项选版本。没有共同快照时合并两个集合，不推断删除。
- 确认：所有本机变更都先预览。预览后云端版本或本机数据发生变化时，拒绝旧方案并重新对比。云端提交再次使用 ETag，其他设备抢先提交会阻止覆盖。
- 恢复：保存本机执行意图和操作日志；重启或断网后点「重新对比同步」，先核对原生书签和日志，避免重复创建。可撤销最近一次同步的本机变更；后来的手动编辑优先保留。撤销不直接覆盖云端。

勾选自动检查后每 15 分钟对比；出现预览或失败时等待处理，不自动覆盖或删除本机数据。凭据和加密口令只保存在 `chrome.storage.session`，关闭整个浏览器后需要重新连接；服务工作线程休眠不清除会话凭据。

单个同步文件上限 64 MB。第一版传输完整密文快照；不支持多人实时协作、分片上传或不具备条件写入的 WebDAV 服务。请保留加密口令；遗失口令无法解密云端文件。

## Windows 更新器

解压加载的扩展由 GitHub 稳定版分发；每台电脑安装一次原生消息宿主。设置页可下载 `siftmark-windows-updater.zip`，解压后在 PowerShell 执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionPath "F:\browser_plugin\siftmark-0.1.8-chromium" -ExtensionId "当前扩展ID"
```

扩展 ID 可直接从设置页命令复制。安装只写当前用户的 `%LOCALAPPDATA%\Siftmark\Updater`，并注册 Chrome、Edge 和 Chromium 的 `NativeMessagingHosts\com.siftmark.updater`；不需要管理员、不启动常驻网络端口。

安装后点击「检查更新」，再启用「自动检查并在空闲时更新」。更新器只访问 `zxbdzh/Siftmark` 的 GitHub 稳定版，要求唯一的 `siftmark-x.y.z-chromium.zip` 和同名 `.sha256` 文件。缺少校验文件时拒绝更新。

下载、SHA-256、版本与扩展清单校验通过后，更新器拒绝链接、越界路径、重复文件及超限压缩内容；在安装时绑定的目录旁暂存，保留旧目录，再替换。扩展维护锁与任务状态检查阻止在书签任务执行期间替换；进入空闲后继续。重载后的扩展向宿主确认新版本。

替换失败恢复旧目录；目录换名时中断，下一次宿主调用优先恢复原位置。「恢复上一个版本」关闭自动更新、恢复文件并重载。安装目录移动后须重新运行安装脚本绑定新目录；原生宿主当前不支持 macOS/Linux。

如果新版扩展完全无法启动，可在 PowerShell 执行下面的本机恢复命令，再到浏览器扩展管理页点「重新加载」：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Siftmark\Updater\updater.ps1" -Action rollback
```

发布工作流使用 Node 22，生成安装包与 SHA-256 伴随文件。不要把未发布到 GitHub 的本机开发版本视作已供所有设备升级。

## 验证入口

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\updater\self-test.ps1
```

双设备服务测试覆盖加密、映射、备份失败、并发变化、中断创建、回收与手动恢复、撤销保护和外来历史隔离。Windows 自检在临时目录实际执行替换与回退，并验证坏哈希和路径越界被拒绝。`tests/e2e/fixtures/webdav-server.mjs` 提供仅绑定本机、只保存内存密文的实机验收服务；不是生产 WebDAV 服务器。
