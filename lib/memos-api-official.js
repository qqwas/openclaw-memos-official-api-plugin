// Official MemOS API client - Strictly follows official API specifications

const DEFAULT_BASE_URL = "http://192.168.1.1:8000";
export const USER_QUERY_MARKER = "user\u200b原\u200b始\u200bquery\u200b：\u200b\u200b\u200b\u200b";

// Extract text from message content
export function extractText(content) {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && typeof block === "object" && block.type === "text")
      .map((block) => block.text)
      .join(" ");
  }
  return "";
}

// Search memories - Official /product/search API
export async function searchMemory(config, payload) {
  const { baseUrl, apiKey, timeoutMs = 10000, retries = 2 } = config;
  
  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const url = `${baseUrl}/product/search`;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries + 1) {
        console.error(`[memos-official] Search failed after ${retries} retries:`, error.message);
        return {
          code: 500,
          message: `Search failed: ${error.message}`,
          data: null
        };
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
}

// Add memories - Official /product/add API
export async function addMemory(config, payload) {
  const { baseUrl, apiKey, timeoutMs = 10000, retries = 2 } = config;
  
  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const url = `${baseUrl}/product/add`;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      // Ensure payload follows official API format
      // Try without async_mode first as it might cause 422
      const officialPayload = {
        user_id: payload.user_id || config.userId,
        messages: payload.messages || [],
        ...(payload.session_id && { session_id: payload.session_id }),
        ...(payload.custom_tags && { custom_tags: payload.custom_tags }),
        ...(payload.info && { info: payload.info })
      };
      
      // Debug log the payload to see what's being sent
      console.log(`[memos-official] Add payload: ${JSON.stringify(officialPayload)}`);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(officialPayload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[memos-official] Add failed: HTTP ${response.status} - ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries + 1) {
        console.error(`[memos-official] Add failed after ${retries} retries:`, error.message);
        return {
          code: 500,
          message: `Add failed: ${error.message}`,
          data: null
        };
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
}

// MemFeedback - Official /product/feedback API
export async function memFeedback(config, payload) {
  const { baseUrl, apiKey, timeoutMs = 10000, retries = 2 } = config;
  
  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const url = `${baseUrl}/product/feedback`;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries + 1) {
        console.error(`[memos-official] MemFeedback failed after ${retries} retries:`, error.message);
        return {
          code: 500,
          message: `MemFeedback failed: ${error.message}`,
          data: null
        };
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
}

// Build config from plugin config
export function buildConfig(pluginConfig = {}) {
  return {
    baseUrl: pluginConfig.baseUrl || DEFAULT_BASE_URL,
    apiKey: pluginConfig.apiKey || "",
    userId: pluginConfig.userId || "openclaw-user",
    ...pluginConfig
  };
}

// Format prompt block for retrieved memories
export function formatPromptBlock(memories, options = {}) {
  if (!memories || !memories.length) return null;
  
  const { wrapTagBlocks = true, includeHeaders = true } = options;
  
  let result = "";
  
  if (includeHeaders) {
    result += "[[user.memory]]\n\n";
    result += "# 相关记忆 Retrieved user memories\n\n";
  }
  
  memories.forEach((memory, index) => {
    const { text, confidence = 0.99, tags = [] } = memory;
    
    if (wrapTagBlocks) {
      result += `**${text}**\n`;
      result += `*置信度: ${confidence.toFixed(2)}* `;
      if (tags.length > 0) {
        result += `*标签: ${tags.join(", ")}*\n`;
      } else {
        result += `*\n`;
      }
    } else {
      result += `${text}\n`;
    }
    
    result += "\n";
  });
  
  if (includeHeaders) {
    result += "[[/user.memory]]\n";
  }
  
  return result;
}

// Transform search results
export function transformSearchResults(memosData) {
  if (!memosData || !memosData.data || !memosData.data.text_mem) {
    return [];
  }

  const results = [];
  for (const cube of memosData.data.text_mem) {
    if (!cube || !cube.memories || !Array.isArray(cube.memories)) continue;

    for (const memory of cube.memories) {
      if (!memory || !memory.memory) continue;

      results.push({
        text: memory.memory,
        confidence: memory.metadata?.confidence || 0.99,
        tags: memory.metadata?.tags || ["未分类"],
        id: memory.id,
        cube_id: cube.cube_id
      });
    }
  }

  return results;
}

// Correction keywords for detecting user feedback intent
const CORRECTION_KEYWORDS = [
  "不对", "错了", "错误", "更正", "修改", "改正", "纠正",
  "不是", "应该是", "其实是", "确切", "更正一下",
  "不对哦", "错了哦", "不对哈", "错了哈",
  "wrong", "incorrect", "correction", "fix", "update",
  "not right", "mistake", "should be", "actually"
];

// Check if user message contains correction intent
export function detectCorrectionIntent(message) {
  if (!message || typeof message !== "string") return null;

  const lowerMsg = message.toLowerCase();
  const matchedKeywords = CORRECTION_KEYWORDS.filter(kw =>
    lowerMsg.includes(kw.toLowerCase())
  );

  if (matchedKeywords.length === 0) return null;

  return {
    hasCorrection: true,
    keywords: matchedKeywords,
    confidence: Math.min(matchedKeywords.length * 0.3 + 0.4, 0.95)
  };
}

// Build memfeedback payload according to official /product/feedback API
export function buildMemFeedbackPayload(config, messages, retrievedMemories, ctx, correctionInfo) {
  // Convert messages to API format (history field)
  const history = messages.map(msg => ({
    role: msg.role,
    content: msg.content,
    chat_time: new Date().toISOString(),
    message_id: msg.id || crypto.randomUUID()
  }));

  // Extract retrieved memory IDs for feedback context
  const retrieved_memory_ids = retrievedMemories
    .filter(m => m.id)
    .map(m => m.id);

  // Build meaningful feedback content based on user's correction
  let feedback_content = "";
  if (correctionInfo && correctionInfo.correctionMessage) {
    feedback_content = `User correction: "${correctionInfo.correctionMessage}". `;
    if (correctionInfo.relatedMemory) {
      feedback_content += `Related memory to correct: "${correctionInfo.relatedMemory}"`;
    }
  }

  return {
    user_id: config.userId,
    session_id: ctx?.sessionKey || "default_session",
    history: history,
    retrieved_memory_ids: retrieved_memory_ids.length > 0 ? retrieved_memory_ids : null,
    feedback_content: feedback_content || "User provided feedback on previous memories",
    async_mode: "async",
    corrected_answer: correctionInfo ? true : false,
    info: {
      source: "openclaw-official-api",
      pluginVersion: "2.0.0",
      correction_keywords: correctionInfo?.keywords || [],
      confidence: correctionInfo?.confidence || 0.5,
      timestamp: new Date().toISOString()
    }
  };
}

// Update memory
export async function updateMemory(config, payload) {
  // Implementation for update memory API
  return { code: 200, message: "Update not implemented in this version" };
}

// Delete memory
export async function deleteMemory(config, payload) {
  // Implementation for delete memory API
  return { code: 200, message: "Delete not implemented in this version" };
}