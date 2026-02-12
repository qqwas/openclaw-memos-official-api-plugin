添加用户记忆 http://localhost:8000/product/add (POST)
# 请求参数
{
  "user_id": "8736b16e-1d20-4163-980b-a5063c3facdc",
  "mem_cube_id": "b32d0977-435d-4828-a86f-4f47f8b55bca",
  "async_mode": "async",
  "messages": [
    {
      "role": "user",
      "content": "我喜欢草莓"
    }
  ]
}
# 响应
{
    "code": 200,
    "message": "Memory created successfully",
    "data": null
}
查询用户记忆 http://localhost:8000/product/search (POST)
# 请求参数
{
  "query": "我喜欢什么",
  "user_id": "8736b16e-1d20-4163-980b-a5063c3facdc",
  "mem_cube_id": "b32d0977-435d-4828-a86f-4f47f8b55bca"
}
# 响应
{
    "code": 200,
    "message": "Search completed successfully",
    "data": {
        "text_mem": [
          {
            "cube_id": "7231eda8-6c57-4f6e-97ce-98b699eebb98",
            "memories": [
              {
                  "id": "2f40be8f-736c-4a5f-aada-9489037769e0",
                  "memory": "[user观点]用户喜欢草莓。",
                  "metadata": {
                      "user_id": "de8215e3-3beb-4afc-9b64-ae594d62f1ea",
                      "session_id": "root_session",
                      "status": "activated",
                      "type": "fact",
                      "key": "用户对草莓的喜好",
                      "confidence": 0.99,
                      "source": null,
                      "tags": [
                          "喜好",
                          "草莓"
                      ],
                      "visibility": null,
                      "updated_at": "2025-09-18T08:23:44.625479000+00:00",
                      "memory_type": "UserMemory",
                      "sources": [],
                      "embedding": [],
                      "created_at": "2025-09-18T08:23:44.625511000+00:00",
                      "usage": [
                          "{
                            "time": "2025-09-18T08:24:17.759748", 
                            "info": {
                              "user_id": "de8215e3-3beb-4afc-9b64-ae594d62f1ea",
                              "session_id": "root_session"
                            }
                          }"
                      ],
                      "background": "用户表达了对草莓的喜好，显示出他们在饮食偏好上的倾向。",
                      "relativity": 0.6349761312470591,
                      "vector_sync": "success",
                      "ref_id": "[2f40be8f]",
                      "id": "2f40be8f-736c-4a5f-aada-9489037769e0",
                      "memory": "[user观点]用户喜欢草莓。"
                  },
                  "ref_id": "[2f40be8f]"
              },
              ...
            }
          }
        ],
        "act_mem": [],
        "para_mem": []
    }
}



# 响应失败，原因排查
# src/memos/api/config.py
# 检查get_neo4j_community_config方法中配置的"neo4j_vec_db"和"EMBEDDING_DIMENSION"

修正用户记忆 http://localhost:8000/product/feedback (POST)
# 请求参数
{
  "user_id": "string",
  "session_id": "default_session",
  "task_id": "string",
  "history": [
    {
      "content": "string",
      "role": "system",
      "name": "string",
      "chat_time": "string",
      "message_id": "string"
    },
    {
      "content": "string",
      "role": "user",
      "name": "string",
      "chat_time": "string",
      "message_id": "string"
    },
    {
      "role": "assistant",
      "audio": {
        "id": "string"
      },
      "content": "string",
      "refusal": "string",
      "tool_calls": [
        {
          "id": "string",
          "function": {
            "arguments": "string",
            "name": "string"
          },
          "type": "function"
        },
        {
          "id": "string",
          "custom": {
            "input": "string",
            "name": "string"
          },
          "type": "custom"
        }
      ],
      "chat_time": "string",
      "message_id": "string"
    },
    {
      "content": "string",
      "role": "tool",
      "tool_call_id": "string",
      "chat_time": "string",
      "message_id": "string"
    }
  ],
  "retrieved_memory_ids": [
    "string"
  ],
  "feedback_content": "string",
  "feedback_time": "string",
  "writable_cube_ids": [
    "string"
  ],
  "async_mode": "async",
  "corrected_answer": false,
  "info": {
    "additionalProp1": {}
  },
  "mem_cube_id": "string"
}
# 响应
{
  "code": 200,
  "message": "string",
  "data": [
    "string"
  ]
}
MemFeedback 是 MemOS 的“后悔药”。

在长时记忆系统中，最头疼的往往不是“记不住”，而是“记错了改不掉”。当用户说“不，我的生日是明天”或者“把这个项目的代号改成 X”时，简单的 RAG 系统通常无能为力。

MemFeedback 能够听懂这些自然语言指令，自动去数据库里精准定位冲突的记忆，并执行原子级的修正操作（比如把旧记忆归档、写入新记忆）。通过它，你的 Agent 能够像人一样在交流中不断纠错和学习。

2. 核心能力
它能处理四种常见的反馈场景：

纠错 (Correction)
用户指出事实错误。系统不会粗暴地删除旧数据，而是将其归档 (Archive)，并写入新数据。这样既修正了错误，又保留了版本历史（Traceability）。如果是正在进行的对话（WorkingMemory），则直接原地更新，保证上下文连贯。

补充 (Addition)
如果用户只是补充了新信息，且与旧记忆不冲突，那就很简单——直接作为新节点存入记忆库。

全局替换 (Keyword Replacement)
类似于 IDE 里的“全局重构”。比如用户说“把所有文档里的‘张三’都改成‘李四’”，系统会结合 Reranker 自动圈定受影响的文档范围，批量更新所有相关记忆。

偏好进化 (Preference Evolution)
专门处理“我不吃香菜”、“我喜欢 Python”这类偏好。系统会记录下这个偏好产生的场景，不断丰富用户画像，让 Agent 越用越顺手。

