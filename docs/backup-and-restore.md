# 备份与恢复

## 格式

| 格式                   | 导出              | 导入 | 说明                                                |
| ---------------------- | ----------------- | ---- | --------------------------------------------------- |
| Siftmark JSON          | 是                | 是   | 不含缩略图，manifest 和 `data.json` 封装在单个 JSON |
| Siftmark ZIP           | 是                | 是   | `manifest.json`、`data.json`、可选 `thumbnails/`    |
| `.siftmark-backup`     | 是                | 是   | 包含 API Key 的加密完整配置和原生 ZIP               |
| Netscape Bookmark HTML | 代码支持导入/导出 | 是   | 与浏览器书签 HTML 兼容，不含 Siftmark 扩展元数据    |
| MarkAI JSON            | 否                | 是   | 用户选择文件后迁移并报告未知字段                    |
| CSV                    | 代码支持审阅导出  | 否   | 防公式注入的人工审阅格式                            |

设置页当前“备份与迁移”主流程提供 Siftmark JSON/ZIP 导出和 JSON/ZIP/HTML/MarkAI/加密归档导入。

## 普通备份

1. 打开设置的“备份与迁移”。
2. 选择要包含的原生根文件夹。
3. 需要缩略图时明确勾选；界面会显示估算体积。
4. 选择“导出 JSON”或“导出 ZIP”。
5. 等待“备份已通过校验并开始下载”。

普通备份包含选定书签/文件夹、关联元数据、范围内操作记录、设置、历史和屏蔽域名。任何键名匹配 API Key 的字段都会剔除。缩略图只在 ZIP 且用户选择时加入。

ZIP 结构：

```text
manifest.json
data.json
thumbnails/<bookmark-id>-<hash>.webp
```

Schema 版本当前为 1。manifest 记录应用版本、导出时间、数量、文件字节数和每个文件的 SHA-256。导入时会重新计算校验和；文件缺失、数量不符、内容篡改或未知版本都会在写入前拒绝。

## 加密完整配置

完整配置包含模型档案和 API Key，只能以 `.siftmark-backup` 导出：

1. 输入密码并再次确认。
2. 选择“导出加密归档”。
3. 将归档和密码分别保管；Siftmark 不保存或恢复密码。

容器使用 AES-256-GCM，密钥由 PBKDF2-SHA-256、随机 16 字节 Salt 和 600,000 次迭代派生；Nonce 为随机 12 字节，头部参与认证。密码错误、密文或头部任意篡改都会失败关闭。

该机制保护静态备份，不改变浏览器内 API Key 的存储边界：运行时 Key 仍是 `chrome.storage.local` 中的本地原值。

## 导入

1. 选择 `.json`、`.zip`、`.html/.htm` 或 `.siftmark-backup`；加密归档还需输入密码。
2. 选择“本地解析”。解析、Schema 与校验和验证都在本机完成。
3. 检查格式、版本、完整性、文件夹/书签/元数据数量、密钥状态、未知字段和缩略图体积。
4. 选择导入目标原生文件夹。
5. 对冲突逐项选择处理方式，再确认导入方案。

冲突检测基于 URL、标题和文件夹。默认不删除或覆盖现有数据。可用决策由预览界面给出，包括跳过、保留、创建副本及适用时合并标签/笔记。

执行写入前会保存恢复点。导入逐项提交；某项失败时已完成项保留，任务进入暂停并显示最后失败，修复原因后可“继续上次导入”。

## MarkAI 迁移

扩展名为 `.json` 且不是 Siftmark manifest 时按 MarkAI 兼容备份解析。迁移器只读取已知书签、元数据、设置和历史字段；未知字段在预览中列出，不静默执行。发现的 API Key 只显示“已发现但不会导入”，除非来源是经过认证的 Siftmark 加密归档。

## 卸载与重装恢复

卸载扩展可能删除 IndexedDB 和 `chrome.storage.local`，但原生 Chromium 书签通常保留。卸载前：

1. 导出 Siftmark ZIP；如需模型密钥，再单独导出加密完整配置。
2. 确认文件非零且能在当前扩展中完成本地解析预览。
3. 记录特殊文件夹和模型服务商信息。
4. 卸载、重装并完成引导。
5. 先导入普通 ZIP，再按需要导入加密配置，检查冲突预览后确认。

## 恢复失败

- `backup-password-required`：未输入加密归档密码。
- `invalid-encrypted-backup` / `unsupported-encrypted-backup`：密码、认证标签、头部或版本不匹配。
- `backup-checksum-mismatch`：文件损坏或被修改，不应继续。
- `unsupported-backup-version`：当前版本只能诊断，拒绝写入。
- `invalid-json-backup`：JSON 既不是有效 Siftmark，也不能作为 MarkAI 迁移源解析。
- 导入暂停：保留原文件和恢复点，按界面最后失败原因修复后续跑；不要通过重置强行清除，除非已另存备份。
