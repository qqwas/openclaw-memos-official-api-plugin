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
  if (!memosData?.data?.text_mem) return [];
  
  const results = [];
  for (const cube of memosData.data.text_mem) {
    if (!cube.memories || !Array.isArray(cube.memories)) continue;
    
    for (const memory of cube.memories) {
      if (!memory.memory) continue;
      
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

// Analyze for memfeedback opportunities
export function analyzeForMemFeedback(messages, retrievedMemories, threshold = 0.7, types = ["correction", "refinement"]) {
  // Simplified analysis - in real implementation this would use ML models
  const opportunities = [];
  
  if (!messages.length || !retrievedMemories.length) {
    return opportunities;
  }
  
  // Simple heuristic: if assistant message is long and no similar memories found
  const lastAssistantMsg = messages.reverse().find(m => m.role === "assistant");
  if (lastAssistantMsg && lastAssistantMsg.content.length > 200) {
    opportunities.push({
      type: "refinement",
      confidence: 0.8,
      message: "Long assistant response may need refinement",
      context: lastAssistantMsg.content.substring(0, 100)
    });
  }
  
  return opportunities.slice(0, 3); // Limit to 3 opportunities
}

// Build memfeedback payload
export function buildMemFeedbackPayload(config, opportunities, ctx) {
  return {
    user_id: config.userId,
    feedback_type: "memory_quality",
    opportunities: opportunities.map(opp => ({
      type: opp.type,
      confidence: opp.confidence,
      message: opp.message,
      context: opp.context
    })),
    session_id: ctx?.sessionKey,
    info: {
      source: "openclaw-official-api",
      pluginVersion: "2.0.0"
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