#!/usr/bin/env node

// MemOS Official API Plugin - Strictly follows official API specifications
// Based on: https://memos-docs.openmem.net/cn/api-reference/

import {
  buildConfig,
  extractText,
  formatPromptBlock,
  searchMemory,
  addMemory,
  memFeedback,
  updateMemory,
  deleteMemory,
  transformSearchResults,
  buildMemFeedbackPayload,
  detectCorrectionIntent,
  USER_QUERY_MARKER
} from "./lib/memos-api-official.js";

let lastCaptureTime = 0;
let lastAnalysisTime = 0;
const conversationCounters = new Map();
const sentMessageIds = new Map();
const MEMOS_SOURCE = "openclaw-official-api";
const MEM_FEEDBACK_THROTTLE_MS = 30000;
const MEMORY_BLOCK_START = "[[user.memory]]";
const MEMORY_BLOCK_END = "[[/user.memory]]";
const OPENCLAW_COMMAND_PATTERNS = [
  /^\/new\b/i,
  /^\/reset\b/i,
  /^\/load\b/i,
  /^\/save\b/i,
  /^\/undo\b/i,
  /^\/redo\b/i,
  /^\/fork\b/i,
  /^\/merge\b/i,
  /^\/diff\b/i,
  /^\/plan\b/i,
  /^\/commit\b/i,
  /^\/agent\b/i,
  /^A new session was started via \/new or \/reset\./i
];

// Helper functions
function warnMissingApiKey(log, context) {
  const heading = "[memos-official] Missing MEMOS_API_KEY (Token auth)";
  const header = `${heading}${context ? `; ${context} skipped` : ""}. Configure it with:`;
  log.warn?.(
    [
      header,
      "echo 'export MEMOS_API_KEY=\"your-token-here\"' >> ~/.zshrc",
      "source ~/.zshrc",
      `or add to plugin config\nGet API key from memOS dashboard`,
    ].join("\n"),
  );
}

function stripPrependedPrompt(content) {
  if (!content) return content;
  const idx = content.lastIndexOf(USER_QUERY_MARKER);
  if (idx === -1) return content;
  return content.slice(idx + USER_QUERY_MARKER.length).trimStart();
}

function getCounterSuffix(sessionKey) {
  if (!sessionKey) return "";
  const current = conversationCounters.get(sessionKey) ?? 0;
  return current > 0 ? `#${current}` : "";
}

function bumpConversationCounter(sessionKey) {
  const current = conversationCounters.get(sessionKey) ?? 0;
  conversationCounters.set(sessionKey, current + 1);
}

function containsEchoedMemory(content) {
  if (!content || typeof content !== "string") return false;
  return content.includes(MEMORY_BLOCK_START) && content.includes(MEMORY_BLOCK_END);
}

function isOpenClawCommandMessage(content) {
  if (!content || typeof content !== "string") return false;
  return OPENCLAW_COMMAND_PATTERNS.some(pattern => pattern.test(content.trim()));
}

const VALID_MEMOS_ROLES = ["system", "user", "assistant", "tool"];
const ROLE_MAPPING = {
  "toolResult": "tool"
};

function sanitizeContent(content) {
  if (!content || typeof content !== "string") return content;
  
  return content
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/[\uFFFE\uFFFF]/g, "");
}

function prepareMessageForAPI(msg, cfg) {
  if (!msg || !msg.role) return null;

  const rawContent = extractText(msg.content);
  if (!rawContent) return null;

  if (containsEchoedMemory(rawContent)) {
    return null;
  }

  if (isOpenClawCommandMessage(rawContent)) {
    return null;
  }

  let role = msg.role;
  if (ROLE_MAPPING[role]) {
    role = ROLE_MAPPING[role];
  }

  if (!VALID_MEMOS_ROLES.includes(role)) {
    return null;
  }

  const sanitizedContent = sanitizeContent(rawContent);

  return {
    role: role,
    content: cfg.preserveFullContent !== false ? sanitizedContent :
      sanitizedContent.length > 10000 ? `${sanitizedContent.slice(0, 10000)}...` : sanitizedContent
  };
}

// Capture messages based on strategy
function captureMessages(messages, cfg, sessionKey) {
  const results = [];
  const sessionSentIds = sessionKey ? (sentMessageIds.get(sessionKey) || new Set()) : new Set();
  
  console.log(`[memos-official] Capturing ${messages.length} messages with strategy: ${cfg.captureStrategy}`);
  console.log(`[memos-official] Already sent ${sessionSentIds.size} messages in this session`);
  
  if (cfg.captureStrategy === "full_session") {
    for (const msg of messages) {
      const messageId = msg.id || `${msg.role}_${msg.content?.slice(0, 50)}`;
      
      if (sessionSentIds.has(messageId)) {
        continue;
      }
      
      const prepared = prepareMessageForAPI(msg, cfg);
      if (prepared) {
        results.push({ ...prepared, _originalId: messageId });
        console.log(`[memos-official] Captured ${msg.role} message: ${prepared.content.length} chars`);
      }
    }
  } else {
    const lastUserIndex = messages
      .map((m, idx) => ({ m, idx }))
      .filter(({ m }) => m?.role === "user")
      .map(({ idx }) => idx)
      .pop();

    if (lastUserIndex !== undefined) {
      const slice = messages.slice(lastUserIndex);
      for (const msg of slice) {
        const messageId = msg.id || `${msg.role}_${msg.content?.slice(0, 50)}`;
        
        if (sessionSentIds.has(messageId)) {
          continue;
        }
        
        if (!cfg.includeAssistant && msg.role === "assistant") continue;
        const prepared = prepareMessageForAPI(msg, cfg);
        if (prepared) {
          results.push({ ...prepared, _originalId: messageId });
        }
      }
    }
  }
  
  console.log(`[memos-official] Total captured messages: ${results.length} (new only)`);
  return results;
}

function markMessagesAsSent(sessionKey, messages) {
  if (!sessionKey || !messages || messages.length === 0) return;
  
  const sessionSentIds = sentMessageIds.get(sessionKey) || new Set();
  
  for (const msg of messages) {
    if (msg._originalId) {
      sessionSentIds.add(msg._originalId);
    }
  }
  
  sentMessageIds.set(sessionKey, sessionSentIds);
  console.log(`[memos-official] Marked ${messages.length} messages as sent for session ${sessionKey}`);
}

// Build search payload according to official /product/search API
function buildSearchPayload(cfg, query, ctx) {
  const payload = {
    user_id: cfg.userId,
    query: query,
    mode: cfg.searchMode || "fast",
    top_k: cfg.topK || 10,
    pref_top_k: cfg.prefTopK || 6,
    include_preference: cfg.includePreference !== false,
    search_tool_memory: cfg.searchToolMemory !== false,
    tool_mem_top_k: cfg.toolMemTopK || 6
  };

  // Add session_id if configured
  if (cfg.sessionId) {
    payload.session_id = cfg.sessionId;
  }

  console.log(`[memos-official] Built search payload: ${JSON.stringify(payload)}`);
  return payload;
}

// Build add payload according to official /product/add API
function buildAddPayload(cfg, messages, ctx) {
  const messagesArray = messages.map((msg, index) => {
    const baseMsg = {
      role: msg.role,
      content: sanitizeContent(msg.content),
      chat_time: new Date().toISOString(),
      message_id: msg.id || crypto.randomUUID()
    };

    if (msg.role === "system") {
      baseMsg.name = "system";
    }

    if (msg.role === "tool") {
      baseMsg.tool_call_id = msg.toolCallId || `call_${index}`;
    }

    return baseMsg;
  }).filter(msg => msg.content && msg.content.length > 0);

  const payload = {
    user_id: cfg.userId,
    messages: JSON.stringify(messagesArray),
    async_mode: cfg.asyncMode || "async",
    info: {
      source: "openclaw-official-api",
      sessionKey: ctx?.sessionKey,
      agentId: ctx?.agentId,
      pluginVersion: "2.0.0-official",
      timestamp: new Date().toISOString()
    }
  };

  // Add session_id if configured (official field name)
  if (cfg.sessionId) {
    payload.session_id = cfg.sessionId;
  } else if (ctx?.sessionKey) {
    payload.session_id = ctx.sessionKey;
  }

  // Add custom_tags if configured (official field name)
  if (cfg.customTags && cfg.customTags.length > 0) {
    payload.custom_tags = cfg.customTags;
  }

  // Add additional info from config
  if (cfg.info && typeof cfg.info === 'object') {
    payload.info = { ...payload.info, ...cfg.info };
  }

  // Debug log
  const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
  console.log(`[memos-official] Built add payload with ${messages.length} messages, ${totalChars} total chars`);
  
  return payload;
}

// Main plugin
export default {
  id: "memos-official-api-plugin",
  name: "MemOS Official API Plugin",
  description: "MemOS plugin that strictly follows official API specifications",
  kind: "lifecycle",

  register(api) {
    const cfg = buildConfig(api.pluginConfig);
    const log = api.logger ?? console;

    // Log configuration
    log.info?.("[memos-official] Plugin registered with official API compliance");
    log.info?.(`[memos-official] Base URL: ${cfg.baseUrl}, User: ${cfg.userId}`);

    api.on("before_agent_start", async (event, ctx) => {
      if (!cfg.recallEnabled) {
        log.debug?.("[memos-official] Memory recall disabled");
        return;
      }
      
      if (!event?.prompt || event.prompt.length < 3) {
        log.debug?.("[memos-official] Prompt too short for recall");
        return;
      }

      if (isOpenClawCommandMessage(event.prompt)) {
        log.debug?.("[memos-official] Skipping recall - prompt is an OpenClaw command");
        return;
      }
      
      if (!cfg.apiKey) {
        warnMissingApiKey(log, "recall");
        return;
      }

      try {
        log.debug?.("[memos-official] Searching memories for:", event.prompt.substring(0, 50) + "...");
        
        const payload = buildSearchPayload(cfg, event.prompt, ctx);
        const result = await searchMemory(cfg, payload);
        
        if (result?.code !== 200) {
          log.warn?.(`[memos-official] Search failed: ${result?.message || "Unknown error"}`);
          return;
        }

        // Store retrieved memories
        ctx.retrievedMemories = transformSearchResults(result);
        
        if (!ctx.retrievedMemories || ctx.retrievedMemories.length === 0) {
          log.debug?.("[memos-official] No relevant memories found");
          return;
        }

      log.debug?.(`[memos-official] Found ${ctx.retrievedMemories.length} relevant memories`);

      if (cfg.showRetrievedMemories) {
        const promptBlock = formatPromptBlock(ctx.retrievedMemories, {
          wrapTagBlocks: true,
          includeHeaders: true,
        });

        if (promptBlock) {
          return {
            prependContext: promptBlock,
          };
        }
      }
      } catch (err) {
        log.warn?.(`[memos-official] Recall failed: ${String(err)}`);
      }
    });

    // 2. ADD: After agent ends - add conversation to memory
    api.on("agent_end", async (event, ctx) => {
      if (!cfg.addEnabled || !event?.success || !event?.messages?.length) {
        return;
      }

      if (!cfg.apiKey) {
        warnMissingApiKey(log, "add");
        return;
      }

      const now = Date.now();
      if (cfg.throttleMs && now - lastCaptureTime < cfg.throttleMs) {
        log.debug?.("[memos-official] Throttled memory addition");
        return;
      }
      lastCaptureTime = now;

      try {
        const sessionKey = ctx?.sessionKey;
        const messages = captureMessages(event.messages, cfg, sessionKey);

        if (!messages.length) {
          log.debug?.("[memos-official] No messages to capture");
          return;
        }

        log.debug?.(`[memos-official] Adding ${messages.length} messages to memory`);

        const payload = buildAddPayload(cfg, messages, ctx);
        const result = await addMemory(cfg, payload);

        if (result?.code === 200) {
          log.debug?.("[memos-official] Successfully added to memory");

          if (sessionKey) {
            markMessagesAsSent(sessionKey, messages);
          }

          if (result.data && result.data.length > 0) {
            const memory = result.data[0];
            const sentChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
            const receivedChars = memory.memory?.length || 0;

            if (receivedChars < sentChars * 0.8) {
              log.warn?.(`[memos-official] Possible content loss: sent ${sentChars} chars, received ${receivedChars} chars`);
            } else {
              log.debug?.(`[memos-official] Content preserved: ${receivedChars}/${sentChars} chars`);
            }
          }
        } else {
          log.warn?.(`[memos-official] Add failed: ${result?.message || "Unknown error"}`);
        }
      } catch (err) {
        log.warn?.(`[memos-official] Add failed: ${String(err)}`);
      }
    });

    // 3. MEMFEEDBACK: Analyze for memory feedback
    api.on("agent_end", async (event, ctx) => {
      if (!cfg.memFeedbackEnabled || !event?.success || !event?.messages?.length) {
        return;
      }

      if (!cfg.apiKey) {
        warnMissingApiKey(log, "memfeedback");
        return;
      }

      const now = Date.now();
      const sinceLastAnalysis = now - lastAnalysisTime;
      if (sinceLastAnalysis < MEM_FEEDBACK_THROTTLE_MS) {
        log.debug?.(`[memos-official] MemFeedback throttled (${sinceLastAnalysis}ms ago)`);
        return;
      }
      lastAnalysisTime = now;

      try {
        const messages = captureMessages(event.messages, cfg, ctx?.sessionKey);
        if (!messages.length) {
          log.debug?.("[memos-official] No messages for memfeedback");
          return;
        }

        const lastUserMsg = messages.reverse().find(m => m.role === "user");
        if (!lastUserMsg) {
          log.debug?.("[memos-official] No user message to analyze for feedback");
          return;
        }

        const lastUserContent = extractText(lastUserMsg.content);
        if (containsEchoedMemory(lastUserContent)) {
          log.debug?.("[memos-official] Skipping feedback - message contains echoed memory content");
          return;
        }

        if (isOpenClawCommandMessage(lastUserContent)) {
          log.debug?.("[memos-official] Skipping feedback - message is an OpenClaw command");
          return;
        }

        const correctionInfo = detectCorrectionIntent(lastUserContent, cfg.requireExplicitMemoryReference);
        if (!correctionInfo) {
          log.debug?.("[memos-official] No correction intent detected, skipping feedback");
          return;
        }

        log.info?.(`[memos-official] Correction detected: "${correctionInfo.keywords.join(", ")}"`);

        if (!ctx.retrievedMemories || ctx.retrievedMemories.length === 0) {
          log.debug?.("[memos-official] No retrieved memories for feedback");
          return;
        }

        // Find most relevant memory to correct (simplified: use first retrieved)
        const relatedMemory = ctx.retrievedMemories[0]?.text || null;

        const payload = buildMemFeedbackPayload(
          cfg,
          messages,
          ctx.retrievedMemories,
          ctx,
          {
            ...correctionInfo,
            correctionMessage: lastUserMsg.content,
            relatedMemory: relatedMemory
          }
        );
        const result = await memFeedback(cfg, payload);

        if (result?.code === 200) {
          log.info?.("[memos-official] MemFeedback submitted for correction");
        } else {
          log.warn?.(`[memos-official] MemFeedback failed: ${result?.message || "Unknown error"}`);
        }
      } catch (err) {
        log.warn?.(`[memos-official] MemFeedback failed: ${String(err)}`);
      }
    });

    log.info?.("[memos-official] Plugin fully registered with official API compliance");
  },
};