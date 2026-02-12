# memos-official-api-plugin（本地memos插件）

感谢MemTensor开发的memos和memos-cloud-openclaw-plugin。

这是一个最小可用的 OpenClaw  插件，功能是：
- **召回记忆**：在每轮对话前从 MemOS  检索记忆并注入上下文
- **添加记忆**：在每轮对话结束后把消息写回 MemOS 


## 安装

### GitHub
```bash
openclaw plugins install github:qqwas/memos-official-api-plugin
openclaw gateway restart
```
确认 `~/.openclaw/openclaw.json` 中已启用：
```json
{
  "plugins": {
    "entries": {
      "memos-official-api-plugin": { "enabled": true }
    }
  }
}
```


## 插件配置
在 `plugins.entries.memos-official-api-plugin` 中设置：
```json
{
  "enabled": true,
  "config": {
  "baseUrl": "http://host:port",
  "apiKey": "123456",
  "userId": "openclaw-user",
  "recallEnabled": true,
  "addEnabled": true,
  "memFeedbackEnabled": true,
  "searchMode": "fine",
  "topK": 10,
  "prefTopK": 6,
  "includePreference": true,
  "searchToolMemory": true,
  "toolMemTopK": 6,
  "captureStrategy": "full_session",
  "includeAssistant": true,
  "preserveFullContent": true,
  "showRetrievedMemories": false
  "customTags": [
    "openclaw",
    "openclaw-official-api"
   ]
 }
},
```

## 致谢
- 感谢MemTensor开发的memos和memos-cloud-openclaw-plugin。