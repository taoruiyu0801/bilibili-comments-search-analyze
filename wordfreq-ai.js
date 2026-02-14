/**
 * B站评论搜索 - DeepSeek AI 情感分析模块
 */
(function () {
    "use strict";

    const S = window._BcsWF;

    // ========== AI 分析状态 ==========
    S.aiSentimentCache = new Map();
    S.isAiAnalyzing = false;
    S.useAiSentiment = false;

    // ========== DeepSeek API 调用 ==========

    /**
     * 调用 DeepSeek API 对一批评论进行情感分析
     * @param {Array<string>} texts 评论文本数组
     * @param {string} apiKey DeepSeek API Key
     * @returns {Promise<Array<{i: number, s: string}>>}
     */
    async function callDeepSeekBatch(texts, apiKey) {
        const numbered = texts.map((t, i) => `${i}:${t.slice(0, 100)}`).join("\n");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        { role: "system", content: '情感分析器。输出JSON数组[{"i":序号,"s":"positive"/"neutral"/"negative"}]，不要其他内容。' },
                        { role: "user", content: numbered }
                    ],
                    temperature: 0,
                    max_tokens: 2000,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!resp.ok) {
                const errBody = await resp.text();
                throw new Error(`API 错误 ${resp.status}: ${errBody}`);
            }

            const data = await resp.json();
            const content = data.choices[0].message.content.trim();

            const jsonMatch = content.match(/\[.*\]/s);
            if (!jsonMatch) {
                throw new Error("API 返回格式无法解析");
            }

            return JSON.parse(jsonMatch[0]);
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    // ========== AI 分析主流程 ==========

    /**
     * AI 情感分析主入口：分批并发调用 DeepSeek API
     */
    async function runAiSentimentAnalysis() {
        const apiKey = localStorage.getItem("bcs-deepseek-key");
        if (!apiKey) {
            showApiKeyDialog();
            return;
        }

        if (!S.analysisCache || !S.analysisCache.allTexts) {
            S.utils.setStatus("请先进行词频分析");
            return;
        }

        const allTexts = S.analysisCache.allTexts;
        if (allTexts.length === 0) {
            S.utils.setStatus("没有可分析的文本");
            return;
        }

        if (S.isAiAnalyzing) {
            S.utils.setStatus("AI 分析正在进行中...");
            return;
        }

        S.isAiAnalyzing = true;
        S.aiSentimentCache = new Map();
        S.useAiSentiment = false;
        const progressEl = document.getElementById("bcs-ai-progress");
        const btnAi = document.getElementById("bcs-wf-btn-ai");
        if (btnAi) btnAi.disabled = true;

        const batchSize = 80;
        const concurrency = 5;
        const total = allTexts.length;
        let processed = 0;
        let failCount = 0;

        // 构建所有批次
        const batches = [];
        for (let start = 0; start < total; start += batchSize) {
            const end = Math.min(start + batchSize, total);
            const batchTexts = [];
            const batchIndices = [];
            for (let i = start; i < end; i++) {
                batchTexts.push(allTexts[i] || "");
                batchIndices.push(i);
            }
            batches.push({ start, end, batchTexts, batchIndices });
        }

        try {
            for (let bi = 0; bi < batches.length; bi += concurrency) {
                const chunk = batches.slice(bi, bi + concurrency);

                if (progressEl) {
                    progressEl.textContent = `AI分析中... ${processed}/${total}（含回复）`;
                    progressEl.style.display = "inline";
                }
                S.utils.setStatus(`AI分析中 ${processed}/${total}（含回复, ${concurrency}路并发）`);

                const promises = chunk.map(async (batch) => {
                    let results = null;
                    let retries = 0;
                    const maxRetries = 1;

                    while (retries <= maxRetries) {
                        try {
                            results = await callDeepSeekBatch(batch.batchTexts, apiKey);
                            break;
                        } catch (err) {
                            retries++;
                            if (retries > maxRetries) {
                                console.warn(`[AI分析] 批次 ${batch.start}-${batch.end} 失败:`, err.message);
                                failCount += (batch.end - batch.start);
                                break;
                            }
                            await new Promise(r => setTimeout(r, 500));
                        }
                    }

                    if (results) {
                        for (const item of results) {
                            const globalIdx = batch.batchIndices[item.i];
                            if (globalIdx !== undefined) {
                                const label = ["positive", "neutral", "negative"].includes(item.s) ? item.s : "neutral";
                                S.aiSentimentCache.set(globalIdx, { label, score: label === "positive" ? 1 : label === "negative" ? -1 : 0 });
                            }
                        }
                    }
                    return batch.end - batch.start;
                });

                const counts = await Promise.all(promises);
                processed += counts.reduce((a, b) => a + b, 0);

                if (bi + concurrency < batches.length) {
                    await new Promise(r => setTimeout(r, 50));
                }
            }

            // 完成
            S.useAiSentiment = true;
            const successCount = S.aiSentimentCache.size;
            const commentCount = S.analysisCache.textMetaMap.filter(m => !m.isReply).length;
            const replyCount = S.analysisCache.textMetaMap.filter(m => m.isReply).length;
            S.utils.setStatus(`AI分析完成: ${successCount}/${total}条（${commentCount}评论+${replyCount}回复）`);
            if (progressEl) {
                progressEl.textContent = `✓ AI完成 (${successCount}/${total})`;
            }

            // 用 AI 结果刷新图表
            S.charts.refreshCharts();

            // 保存 AI 分析结果到缓存
            if (typeof window.BcsSaveVideoData === "function") {
                window.BcsSaveVideoData();
            }

        } catch (err) {
            console.error("[AI分析] 错误:", err);
            S.utils.setStatus("AI分析出错: " + err.message);
            if (progressEl) {
                progressEl.textContent = "AI分析失败";
            }
        } finally {
            S.isAiAnalyzing = false;
            if (btnAi) btnAi.disabled = false;
        }
    }

    /**
     * 使用 AI 缓存计算词情感分布
     */
    function computeWordSentimentsAi(topWords, wordTextMap) {
        const result = new Map();
        for (const { word } of topWords) {
            const flatIndices = wordTextMap.get(word);
            const dist = { positive: 0, neutral: 0, negative: 0 };
            if (flatIndices) {
                for (const flatIdx of flatIndices) {
                    const cached = S.aiSentimentCache.get(flatIdx);
                    if (cached) {
                        dist[cached.label]++;
                    } else {
                        dist["neutral"]++;
                    }
                }
            }
            result.set(word, dist);
        }
        return result;
    }

    // ========== API Key 设置弹窗 ==========

    function showApiKeyDialog() {
        const existing = document.getElementById("bcs-apikey-dialog");
        if (existing) existing.remove();

        const currentKey = localStorage.getItem("bcs-deepseek-key") || "";
        const masked = currentKey ? currentKey.slice(0, 6) + "..." + currentKey.slice(-4) : "";

        const dialog = document.createElement("div");
        dialog.id = "bcs-apikey-dialog";
        dialog.innerHTML = `
      <div class="bcs-apikey-overlay"></div>
      <div class="bcs-apikey-content">
        <div class="bcs-apikey-title">设置 DeepSeek API Key</div>
        <p class="bcs-apikey-desc">请输入您的 DeepSeek API Key 以启用 AI 情感分析。\n获取方式: <a href="https://platform.deepseek.com/api_keys" target="_blank">platform.deepseek.com</a></p>
        ${masked ? `<p class="bcs-apikey-current">当前: ${masked}</p>` : ""}
        <input type="password" id="bcs-apikey-input" class="bcs-apikey-input" placeholder="sk-..." value="${currentKey}">
        <div class="bcs-apikey-actions">
          <button class="bcs-wf-btn" id="bcs-apikey-cancel">取消</button>
          <button class="bcs-wf-btn bcs-ai-btn" id="bcs-apikey-save">保存</button>
        </div>
      </div>
    `;

        document.body.appendChild(dialog);

        document.getElementById("bcs-apikey-cancel").addEventListener("click", () => dialog.remove());
        document.getElementById("bcs-apikey-save").addEventListener("click", () => {
            const key = document.getElementById("bcs-apikey-input").value.trim();
            if (key) {
                localStorage.setItem("bcs-deepseek-key", key);
                S.utils.setStatus("API Key 已保存");
            } else {
                localStorage.removeItem("bcs-deepseek-key");
                S.utils.setStatus("API Key 已清除");
            }
            dialog.remove();
        });
        dialog.querySelector(".bcs-apikey-overlay").addEventListener("click", () => dialog.remove());
    }

    // ========== 评论情感摘要 ==========

    /**
     * 调用 DeepSeek 生成评论区情感总结
     */
    async function generateSentimentSummary() {
        const apiKey = localStorage.getItem("bcs-deepseek-key");
        if (!apiKey) {
            showApiKeyDialog();
            return;
        }

        if (!S.analysisCache || !S.analysisCache.allTexts) {
            S.utils.setStatus("请先进行词频分析");
            return;
        }

        const allTexts = S.analysisCache.allTexts;
        if (allTexts.length === 0) {
            S.utils.setStatus("没有可分析的文本");
            return;
        }

        const summaryBox = document.getElementById("bcs-wf-summary-box");
        const summaryContent = document.getElementById("bcs-wf-summary-content");
        const btnSummary = document.getElementById("bcs-wf-btn-summary");
        if (btnSummary) btnSummary.disabled = true;

        if (summaryBox) summaryBox.classList.add("show");
        if (summaryContent) summaryContent.innerHTML = '<span class="bcs-wf-spinner" style="vertical-align:middle;margin-right:6px;"></span>正在生成情感总结...';

        // 采样评论：优先取高赞评论，最多取120条
        const apiComments = S.utils.getApiComments();
        const sampled = sampleComments(apiComments, allTexts, 120);
        const numbered = sampled.map((t, i) => `${i + 1}. ${t}`).join("\n");

        // 统计基础情感分布
        let posCount = 0, negCount = 0, neuCount = 0;
        for (let i = 0; i < allTexts.length; i++) {
            if (S.useAiSentiment && S.aiSentimentCache.size > 0) {
                const cached = S.aiSentimentCache.get(i);
                const label = cached ? cached.label : "neutral";
                if (label === "positive") posCount++;
                else if (label === "negative") negCount++;
                else neuCount++;
            } else {
                const result = S.sentiment.analyzeSentiment(allTexts[i]);
                if (result.label === "positive") posCount++;
                else if (result.label === "negative") negCount++;
                else neuCount++;
            }
        }

        const total = allTexts.length;
        const statsLine = `评论总数${total}条，正面${posCount}条(${(posCount / total * 100).toFixed(1)}%)，中性${neuCount}条(${(neuCount / total * 100).toFixed(1)}%)，负面${negCount}条(${(negCount / total * 100).toFixed(1)}%)。`;

        // 获取高频词作为参考
        let topWordsLine = "";
        if (S.analysisCache.wordFreqMap) {
            const sorted = [...S.analysisCache.wordFreqMap.entries()]
                .filter(([w]) => !S.excludeWords.has(w))
                .sort((a, b) => b[1] - a[1])
                .slice(0, 15);
            topWordsLine = "高频词: " + sorted.map(([w, c]) => `${w}(${c})`).join("、");
        }

        const systemPrompt = `你是B站评论区情感分析专家。请根据提供的评论样本、情感统计数据和高频词，用中文生成一段精炼的评论区情感总结（150字以内）。
要求：
1. 先用一句话概括整体情感倾向和氛围
2. 提炼2-3个核心观点或话题
3. 如有显著的正面/负面倾向，简要说明原因
4. 语言简洁有力，不要使用"首先/其次/最后"等模板化表述
不要输出其他无关内容。`;

        const userContent = `${statsLine}\n${topWordsLine}\n\n评论样本:\n${numbered}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        try {
            const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent }
                    ],
                    temperature: 0.3,
                    max_tokens: 500,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!resp.ok) {
                const errBody = await resp.text();
                throw new Error(`API 错误 ${resp.status}: ${errBody}`);
            }

            const data = await resp.json();
            const summary = data.choices[0].message.content.trim();

            if (summaryContent) {
                // 渲染情感分布条 + 总结文本
                const posPercent = (posCount / total * 100).toFixed(1);
                const neuPercent = (neuCount / total * 100).toFixed(1);
                const negPercent = (negCount / total * 100).toFixed(1);

                summaryContent.innerHTML = `
                    <div class="bcs-wf-summary-bar-wrap">
                        <div class="bcs-wf-summary-bar">
                            <div class="bcs-wf-summary-bar-pos" style="width:${posPercent}%"></div>
                            <div class="bcs-wf-summary-bar-neu" style="width:${neuPercent}%"></div>
                            <div class="bcs-wf-summary-bar-neg" style="width:${negPercent}%"></div>
                        </div>
                        <div class="bcs-wf-summary-bar-labels">
                            <span class="bcs-wf-summary-label-pos">正面 ${posPercent}%</span>
                            <span class="bcs-wf-summary-label-neu">中性 ${neuPercent}%</span>
                            <span class="bcs-wf-summary-label-neg">负面 ${negPercent}%</span>
                        </div>
                    </div>
                    <div class="bcs-wf-summary-text">${S.charts.escapeHtml(summary)}</div>
                    <div class="bcs-wf-summary-meta">基于 ${total} 条评论 · ${S.useAiSentiment ? 'AI情感分析' : '词典情感分析'}</div>
                `;
            }

            S.utils.setStatus("情感总结生成完成");

        } catch (err) {
            clearTimeout(timeoutId);
            console.error("[情感总结] 错误:", err);
            if (summaryContent) {
                summaryContent.textContent = "生成失败: " + err.message;
            }
            S.utils.setStatus("情感总结生成失败");
        } finally {
            if (btnSummary) btnSummary.disabled = false;
        }
    }

    /**
     * 采样评论：混合高赞评论和随机评论
     */
    function sampleComments(apiComments, allTexts, maxCount) {
        if (allTexts.length <= maxCount) {
            return allTexts.map(t => t.slice(0, 120));
        }

        const result = [];
        const usedIndices = new Set();

        // 取高赞评论（前40%配额）
        const highLikeQuota = Math.floor(maxCount * 0.4);
        const commentsByLike = apiComments
            .map((c, i) => ({ idx: i, like: c.like || 0, content: c.content || "" }))
            .filter(c => c.content.length > 2)
            .sort((a, b) => b.like - a.like);

        for (let i = 0; i < Math.min(highLikeQuota, commentsByLike.length); i++) {
            const idx = commentsByLike[i].idx;
            if (!usedIndices.has(idx)) {
                usedIndices.add(idx);
                result.push(commentsByLike[i].content.slice(0, 120));
            }
        }

        // 随机取剩余配额
        const remaining = maxCount - result.length;
        const availableIndices = [];
        for (let i = 0; i < allTexts.length; i++) {
            if (!usedIndices.has(i) && allTexts[i].length > 2) {
                availableIndices.push(i);
            }
        }

        // Fisher-Yates 洗牌取前 N 个
        for (let i = availableIndices.length - 1; i > 0 && result.length < maxCount; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [availableIndices[i], availableIndices[j]] = [availableIndices[j], availableIndices[i]];
        }
        for (let i = 0; i < Math.min(remaining, availableIndices.length); i++) {
            result.push(allTexts[availableIndices[i]].slice(0, 120));
        }

        return result;
    }

    // ========== 暴露接口 ==========
    S.ai = {
        runAiSentimentAnalysis,
        computeWordSentimentsAi,
        showApiKeyDialog,
        generateSentimentSummary,
    };

})();
