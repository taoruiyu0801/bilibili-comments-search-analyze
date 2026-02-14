/**
 * B站评论搜索 - 图表渲染与交互模块
 */
(function () {
    "use strict";

    const S = window._BcsWF;

    // ========== 模块状态 ==========
    S.currentChartType = "bar";
    S.currentSelectedWord = null;
    S.barChart = null;
    S.cloudChart = null;

    // ========== 辅助函数 ==========

    function getTopWords(wordFreqMap, topN, minFreq) {
        const arr = [];
        for (const [word, count] of wordFreqMap) {
            if (count >= minFreq && !S.excludeWords.has(word)) {
                arr.push({ word, count });
            }
        }
        arr.sort((a, b) => b.count - a.count);
        return arr.slice(0, topN);
    }

    function highlightWord(htmlText, word) {
        if (!word) return htmlText;
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(escaped, "gi");
        return htmlText.replace(re, '<span class="bcs-wf-word-hl">$&</span>');
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // ========== 面板创建 ==========

    function createAnalyticsPanel() {
        let panel = document.getElementById("bcs-wordfreq-panel");
        if (panel) return panel;

        panel = document.createElement("div");
        panel.id = "bcs-wordfreq-panel";
        panel.innerHTML = `
      <div id="bcs-wf-controls">
        <span style="font-weight:600;font-size:14px;color:#1a1a1a;">词频分析</span>
        <label>Top-N: <input type="number" id="bcs-wf-topn" value="20" min="5" max="100" step="5"></label>
        <label>最低频次: <input type="number" id="bcs-wf-minfreq" value="2" min="1" max="50"></label>
        <button class="bcs-wf-btn active" id="bcs-wf-btn-bar">柱状图</button>
        <button class="bcs-wf-btn" id="bcs-wf-btn-cloud">词云</button>
        <button class="bcs-wf-btn" id="bcs-wf-btn-refresh">刷新</button>
        <button class="bcs-wf-btn bcs-ai-btn" id="bcs-wf-btn-ai" title="使用 DeepSeek AI 进行更精准的情感分析">🤖 AI分析</button>
        <button class="bcs-wf-btn bcs-summary-btn" id="bcs-wf-btn-summary" title="调用 DeepSeek 生成评论区情感总结">📊 情感总结</button>
        <button class="bcs-wf-btn bcs-ai-settings-btn" id="bcs-wf-btn-apikey" title="设置 DeepSeek API Key">⚙️</button>
        <span id="bcs-ai-progress"></span>
        <span id="bcs-wf-status"></span>
        <span id="bcs-wf-toggle">[收起]</span>
      </div>
      <div id="bcs-wf-body">
        <div id="bcs-wf-chart-wrap">
          <div id="bcs-wf-chart"></div>
          <div id="bcs-wf-wordcloud"></div>
        </div>
        <div id="bcs-wf-summary-box">
          <div id="bcs-wf-summary-header">
            <span class="bcs-wf-summary-title-text">评论情感总结</span>
            <span id="bcs-wf-summary-close" title="关闭">&times;</span>
          </div>
          <div id="bcs-wf-summary-content"></div>
        </div>
        <div id="bcs-wf-comments">
          <div id="bcs-wf-comments-title"></div>
          <div id="bcs-wf-comments-list"></div>
        </div>
        <div id="bcs-wf-exclude">
          <span id="bcs-wf-exclude-label">排除词:</span>
          <div id="bcs-wf-exclude-tags"></div>
          <input id="bcs-wf-exclude-input" type="text" placeholder="输入词...">
          <button class="bcs-wf-btn" id="bcs-wf-btn-add-exclude">添加</button>
        </div>
      </div>
    `;

        return panel;
    }

    function insertPanel() {
        const searchBar = document.getElementById("bcs-search-bar");
        if (!searchBar) return null;
        let panel = document.getElementById("bcs-wordfreq-panel");
        if (panel) return panel;

        panel = createAnalyticsPanel();
        searchBar.parentElement.insertBefore(panel, searchBar.nextSibling);
        bindPanelEvents();
        return panel;
    }

    // ========== 面板事件绑定 ==========

    function bindPanelEvents() {
        const btnBar = document.getElementById("bcs-wf-btn-bar");
        const btnCloud = document.getElementById("bcs-wf-btn-cloud");
        const btnRefresh = document.getElementById("bcs-wf-btn-refresh");
        const btnAi = document.getElementById("bcs-wf-btn-ai");
        const btnApiKey = document.getElementById("bcs-wf-btn-apikey");
        const topNInput = document.getElementById("bcs-wf-topn");
        const minFreqInput = document.getElementById("bcs-wf-minfreq");
        const toggle = document.getElementById("bcs-wf-toggle");
        const excludeInput = document.getElementById("bcs-wf-exclude-input");
        const btnAddExclude = document.getElementById("bcs-wf-btn-add-exclude");

        btnBar.addEventListener("click", () => {
            S.currentChartType = "bar";
            btnBar.classList.add("active");
            btnCloud.classList.remove("active");
            const chartEl = document.getElementById("bcs-wf-chart");
            const cloudEl = document.getElementById("bcs-wf-wordcloud");
            if (chartEl) chartEl.classList.remove("hidden");
            if (cloudEl) cloudEl.classList.remove("visible");
            refreshCharts();
        });

        btnCloud.addEventListener("click", () => {
            S.currentChartType = "wordcloud";
            btnCloud.classList.add("active");
            btnBar.classList.remove("active");
            const chartEl = document.getElementById("bcs-wf-chart");
            const cloudEl = document.getElementById("bcs-wf-wordcloud");
            if (chartEl) chartEl.classList.add("hidden");
            if (cloudEl) {
                cloudEl.classList.add("visible");
                setTimeout(() => {
                    if (S.cloudChart) S.cloudChart.resize();
                }, 50);
            }
            refreshCharts();
        });

        btnRefresh.addEventListener("click", () => {
            S.analysisCache = null;
            S.runAnalysis();
        });

        btnAi.addEventListener("click", () => {
            if (!S.analysisCache) {
                S.utils.setStatus("请先进行词频分析");
                return;
            }
            S.ai.runAiSentimentAnalysis();
        });

        btnApiKey.addEventListener("click", () => {
            S.ai.showApiKeyDialog();
        });

        const btnSummary = document.getElementById("bcs-wf-btn-summary");
        btnSummary.addEventListener("click", () => {
            if (!S.analysisCache) {
                S.utils.setStatus("请先进行词频分析");
                return;
            }
            S.ai.generateSentimentSummary();
        });

        const summaryClose = document.getElementById("bcs-wf-summary-close");
        summaryClose.addEventListener("click", () => {
            const box = document.getElementById("bcs-wf-summary-box");
            if (box) box.classList.remove("show");
        });

        topNInput.addEventListener("change", refreshCharts);
        minFreqInput.addEventListener("change", refreshCharts);

        toggle.addEventListener("click", () => {
            const body = document.getElementById("bcs-wf-body");
            if (body.style.display === "none") {
                body.style.display = "";
                toggle.textContent = "[收起]";
            } else {
                body.style.display = "none";
                toggle.textContent = "[展开]";
            }
        });

        btnAddExclude.addEventListener("click", addExcludeWord);
        excludeInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") addExcludeWord();
        });
    }

    // ========== 排除词管理 ==========

    function addExcludeWord() {
        const input = document.getElementById("bcs-wf-exclude-input");
        const word = input.value.trim();
        if (!word || S.excludeWords.has(word)) return;
        S.excludeWords.add(word);
        input.value = "";
        saveExcludeWords();
        renderExcludeTags();
        refreshCharts();
    }

    function removeExcludeWord(word) {
        S.excludeWords.delete(word);
        saveExcludeWords();
        renderExcludeTags();
        refreshCharts();
    }

    function saveExcludeWords() {
        try {
            localStorage.setItem("bcs-wf-exclude", JSON.stringify([...S.excludeWords]));
        } catch (e) { }
    }

    function renderExcludeTags() {
        const container = document.getElementById("bcs-wf-exclude-tags");
        if (!container) return;
        container.innerHTML = "";
        for (const word of S.excludeWords) {
            const tag = document.createElement("span");
            tag.className = "bcs-wf-exclude-tag";
            tag.innerHTML = `${escapeHtml(word)} <span class="bcs-wf-tag-remove">&times;</span>`;
            tag.querySelector(".bcs-wf-tag-remove").addEventListener("click", () => removeExcludeWord(word));
            container.appendChild(tag);
        }
    }

    // ========== 图表刷新 ==========

    function refreshCharts() {
        if (!S.analysisCache) return;

        const topN = parseInt(document.getElementById("bcs-wf-topn").value) || 20;
        const minFreq = parseInt(document.getElementById("bcs-wf-minfreq").value) || 2;

        const topWords = getTopWords(S.analysisCache.wordFreqMap, topN, minFreq);
        if (topWords.length === 0) {
            S.utils.setStatus("无满足条件的词汇");
            return;
        }

        let wordSentiments;
        if (S.useAiSentiment && S.aiSentimentCache.size > 0) {
            wordSentiments = S.ai.computeWordSentimentsAi(topWords, S.analysisCache.wordTextMap);
        } else {
            const apiComments = S.utils.getApiComments();
            wordSentiments = S.sentiment.computeWordSentiments(topWords, apiComments, S.analysisCache.wordCommentMap);
        }
        S.analysisCache.wordSentiments = wordSentiments;

        if (S.currentChartType === "bar") {
            renderBarChart(topWords, wordSentiments);
        } else {
            renderWordCloud(topWords, wordSentiments);
        }

        const modeLabel = (S.useAiSentiment && S.aiSentimentCache.size > 0) ? " [AI模式]" : " [词典模式]";
        S.utils.setStatus(`共 ${S.analysisCache.wordFreqMap.size} 个不同词，显示 Top ${topWords.length}${modeLabel}`);
    }

    // ========== 柱状图渲染 ==========

    function renderBarChart(topWords, wordSentiments) {
        const chartDom = document.getElementById("bcs-wf-chart");
        if (!chartDom) return;

        if (S.barChart) S.barChart.dispose();
        S.barChart = echarts.init(chartDom, null, { renderer: 'canvas' });

        const categories = topWords.map(w => w.word);
        const posData = [], neuData = [], negData = [];

        for (const { word } of topWords) {
            const s = wordSentiments.get(word) || { positive: 0, neutral: 0, negative: 0 };
            posData.push(s.positive);
            neuData.push(s.neutral);
            negData.push(s.negative);
        }

        const option = {
            backgroundColor: '#ffffff',
            tooltip: {
                trigger: "axis",
                axisPointer: { type: "shadow" },
                formatter: function (params) {
                    const word = params[0].name;
                    let total = 0;
                    let html = `<strong>${word}</strong><br/>`;
                    for (const p of params) {
                        html += `${p.marker} ${p.seriesName}: ${p.value}<br/>`;
                        total += p.value;
                    }
                    html += `合计: ${total}`;
                    return html;
                },
            },
            legend: {
                data: ["正面", "中性", "负面"],
                top: 5,
                textStyle: { color: '#333' },
            },
            grid: { left: 60, right: 20, top: 40, bottom: 60 },
            xAxis: {
                type: "category",
                data: categories,
                axisLabel: { rotate: 40, fontSize: 11, interval: 0, color: '#333' },
                axisLine: { lineStyle: { color: '#ccc' } },
            },
            yAxis: {
                type: "value",
                name: "评论数",
                nameTextStyle: { color: '#333' },
                axisLabel: { color: '#333' },
                axisLine: { lineStyle: { color: '#ccc' } },
                splitLine: { lineStyle: { color: '#eee' } },
            },
            series: [
                { name: "正面", type: "bar", stack: "total", data: posData, itemStyle: { color: "#f5615c" }, emphasis: { focus: "series" } },
                { name: "中性", type: "bar", stack: "total", data: neuData, itemStyle: { color: "#bfbfbf" }, emphasis: { focus: "series" } },
                { name: "负面", type: "bar", stack: "total", data: negData, itemStyle: { color: "#5b8ff9" }, emphasis: { focus: "series" } },
            ],
        };

        S.barChart.setOption(option);
        S.barChart.off("click");
        S.barChart.on("click", function (params) {
            if (params.componentType === "series") {
                const word = params.name;
                const seriesName = params.seriesName;
                let sentimentFilter = null;
                if (seriesName === "正面") sentimentFilter = "positive";
                else if (seriesName === "中性") sentimentFilter = "neutral";
                else if (seriesName === "负面") sentimentFilter = "negative";
                showWordComments(word, sentimentFilter);
            }
        });

        window.addEventListener("resize", () => S.barChart && S.barChart.resize());
    }

    // ========== 词云渲染 ==========

    function renderWordCloud(topWords, wordSentiments) {
        const chartDom = document.getElementById("bcs-wf-wordcloud");
        if (!chartDom) {
            console.error("[词频分析] 词云容器未找到");
            return;
        }

        if (chartDom.offsetWidth === 0 || chartDom.offsetHeight === 0) {
            console.error("[词频分析] 词云容器尺寸为0");
            return;
        }

        if (S.cloudChart) {
            S.cloudChart.dispose();
            S.cloudChart = null;
        }

        cloudZoomState = { scale: 1, tx: 0, ty: 0 };
        const oldCanvas = chartDom.querySelector("canvas");
        if (oldCanvas) oldCanvas.style.transform = "";

        try {
            S.cloudChart = echarts.init(chartDom);
        } catch (err) {
            console.error("[词频分析] 创建 ECharts 实例失败:", err);
            return;
        }

        const positiveColors = ['#ff6b6b', '#ee5a6f', '#f06292', '#ff4757', '#fc5c65'];
        const neutralColors = ['#95afc0', '#778ca3', '#a29bfe', '#74b9ff', '#81ecec'];
        const negativeColors = ['#4834df', '#5f27cd', '#686de0', '#3867d6', '#0984e3'];

        const data = topWords.map(({ word, count }, index) => {
            const s = wordSentiments.get(word) || { positive: 0, neutral: 0, negative: 0 };
            const total = s.positive + s.neutral + s.negative;
            let color = neutralColors[index % neutralColors.length];

            if (total > 0) {
                const posRatio = s.positive / total;
                const negRatio = s.negative / total;
                if (posRatio > negRatio && posRatio > 0.3) {
                    color = positiveColors[index % positiveColors.length];
                } else if (negRatio > posRatio && negRatio > 0.3) {
                    color = negativeColors[index % negativeColors.length];
                }
            }

            return { name: word, value: count, textStyle: { color } };
        });

        const option = {
            backgroundColor: '#ffffff',
            tooltip: {
                show: true,
                formatter: function (params) { return `${params.name}: ${params.value}次`; },
            },
            series: [{
                type: "wordCloud",
                shape: "circle",
                left: "center",
                top: "center",
                width: "95%",
                height: "95%",
                sizeRange: [20, 80],
                rotationRange: [-45, 45],
                rotationStep: 15,
                gridSize: 6,
                drawOutOfBound: false,
                layoutAnimation: true,
                textStyle: { fontFamily: "sans-serif", fontWeight: "bold" },
                emphasis: { textStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.3)" } },
                data: data,
            }],
        };

        try {
            S.cloudChart.setOption(option);
            setTimeout(() => { if (S.cloudChart) S.cloudChart.resize(); }, 100);
        } catch (err) {
            console.error("[词频分析] 词云渲染失败:", err);
            return;
        }

        S.cloudChart.off("click");
        S.cloudChart.on("click", function (params) {
            showWordComments(params.name);
        });

        window.addEventListener("resize", () => S.cloudChart && S.cloudChart.resize());
        setupCloudZoomPan(chartDom);
    }

    // ========== 词云缩放拖动 ==========

    let cloudZoomState = { scale: 1, tx: 0, ty: 0 };

    function setupCloudZoomPan(container) {
        if (container._zoomBound) return;
        container._zoomBound = true;

        let isDragging = false;
        let startX = 0, startY = 0;
        let startTx = 0, startTy = 0;

        function applyTransform() {
            const canvas = container.querySelector("canvas");
            if (canvas) {
                canvas.style.transformOrigin = "center center";
                canvas.style.transform = `translate(${cloudZoomState.tx}px, ${cloudZoomState.ty}px) scale(${cloudZoomState.scale})`;
            }
        }

        container.addEventListener("wheel", function (e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            cloudZoomState.scale = Math.max(0.5, Math.min(5, cloudZoomState.scale + delta));
            applyTransform();
        }, { passive: false });

        container.addEventListener("mousedown", function (e) {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startTx = cloudZoomState.tx;
            startTy = cloudZoomState.ty;
            container.style.cursor = "grabbing";
            e.preventDefault();
        });

        document.addEventListener("mousemove", function (e) {
            if (!isDragging) return;
            cloudZoomState.tx = startTx + (e.clientX - startX);
            cloudZoomState.ty = startTy + (e.clientY - startY);
            applyTransform();
        });

        document.addEventListener("mouseup", function () {
            if (!isDragging) return;
            isDragging = false;
            container.style.cursor = "grab";
        });

        container.addEventListener("dblclick", function () {
            cloudZoomState = { scale: 1, tx: 0, ty: 0 };
            applyTransform();
        });

        container.style.cursor = "grab";
        container.style.overflow = "hidden";
    }

    // ========== 评论展示交互 ==========

    function showWordComments(word, sentimentFilter = null) {
        S.currentSelectedWord = word;
        const container = document.getElementById("bcs-wf-comments");
        const titleEl = document.getElementById("bcs-wf-comments-title");
        const listEl = document.getElementById("bcs-wf-comments-list");
        if (!container || !titleEl || !listEl) return;

        const apiComments = S.utils.getApiComments();

        // ========== AI 模式 + 情感过滤：使用 wordTextMap（flat 索引）==========
        if (sentimentFilter && S.useAiSentiment && S.analysisCache && S.analysisCache.wordTextMap) {
            const flatIndices = S.analysisCache.wordTextMap.get(word);
            if (!flatIndices || flatIndices.size === 0) {
                container.classList.remove("show");
                return;
            }

            const matchedFlatIndices = [];
            for (const fi of flatIndices) {
                const cached = S.aiSentimentCache.get(fi);
                const label = cached ? cached.label : "neutral";
                if (label === sentimentFilter) matchedFlatIndices.push(fi);
            }

            const sentimentText =
                sentimentFilter === 'positive' ? ' [正面]' :
                    sentimentFilter === 'negative' ? ' [负面]' :
                        sentimentFilter === 'neutral' ? ' [中性]' : '';
            titleEl.textContent = `包含「${word}」的文本${sentimentText} (${matchedFlatIndices.length}条)`;
            listEl.innerHTML = "";

            const groupedByParent = new Map();
            for (const fi of matchedFlatIndices) {
                const meta = S.analysisCache.textMetaMap[fi];
                if (!meta) continue;
                if (!groupedByParent.has(meta.parentIdx)) groupedByParent.set(meta.parentIdx, []);
                groupedByParent.get(meta.parentIdx).push({ fi, meta });
            }

            const maxShow = 80;
            let shown = 0;

            for (const [parentIdx, items] of groupedByParent) {
                if (shown >= maxShow) break;
                if (parentIdx >= apiComments.length) continue;
                const comment = apiComments[parentIdx];
                const commentText = (comment.content && typeof comment.content === 'string') ? comment.content : "";

                for (const { fi, meta } of items) {
                    if (shown >= maxShow) break;

                    if (!meta.isReply) {
                        const item = document.createElement("div");
                        item.className = "bcs-wf-comment-item";
                        const userName = escapeHtml(comment.uname || "匿名");
                        const highlighted = highlightWord(escapeHtml(commentText), word);
                        item.innerHTML = `
              <div class="bcs-wf-comment-user">${userName}</div>
              <div class="bcs-wf-comment-text">${highlighted}</div>
            `;
                        listEl.appendChild(item);
                    } else {
                        const reply = comment.replies && comment.replies[meta.replyIdx];
                        if (!reply) continue;
                        const replyText = (reply.content && typeof reply.content === 'string') ? reply.content : "";

                        const ctxItem = document.createElement("div");
                        ctxItem.className = "bcs-wf-comment-item bcs-wf-comment-context";
                        const ctxUser = escapeHtml(comment.uname || "匿名");
                        const ctxText = commentText.length > 60 ? escapeHtml(commentText.slice(0, 60)) + "..." : escapeHtml(commentText);
                        ctxItem.innerHTML = `
              <div class="bcs-wf-comment-user" style="color:#999;">${ctxUser} (原评论)</div>
              <div class="bcs-wf-comment-text" style="color:#999;font-size:12px;">${ctxText}</div>
            `;
                        listEl.appendChild(ctxItem);

                        const replyItem = document.createElement("div");
                        replyItem.className = "bcs-wf-comment-item";
                        replyItem.style.marginLeft = "20px";
                        replyItem.style.borderLeft = "2px solid #00aeec";
                        const replyUser = escapeHtml(reply.uname || "匿名");
                        const replyHL = highlightWord(escapeHtml(replyText), word);
                        replyItem.innerHTML = `
              <div class="bcs-wf-comment-user">${replyUser} (回复)</div>
              <div class="bcs-wf-comment-text">${replyHL}</div>
            `;
                        listEl.appendChild(replyItem);
                    }
                    shown++;
                }
            }

            if (matchedFlatIndices.length > maxShow) {
                const more = document.createElement("div");
                more.style.cssText = "text-align:center;padding:8px;color:#999;font-size:12px;";
                more.textContent = `还有 ${matchedFlatIndices.length - maxShow} 条未显示`;
                listEl.appendChild(more);
            }

            container.classList.add("show");
            container.scrollIntoView({ behavior: "smooth", block: "nearest" });
            return;
        }

        // ========== 词典模式 / 无情感过滤：使用 wordCommentMap ==========
        const indices = S.analysisCache && S.analysisCache.wordCommentMap.get(word);
        if (!indices || indices.size === 0) {
            container.classList.remove("show");
            return;
        }

        let filteredIndices = [...indices];
        if (sentimentFilter) {
            filteredIndices = filteredIndices.filter(idx => {
                if (idx >= apiComments.length) return false;
                const comment = apiComments[idx];
                const content = comment.content;
                const text = (content && typeof content === 'string') ? content : "";
                const sentiment = S.sentiment.analyzeSentiment(text);
                return sentiment.label === sentimentFilter;
            });
        }

        const sentimentText = sentimentFilter ?
            (sentimentFilter === 'positive' ? ' [正面]' :
                sentimentFilter === 'negative' ? ' [负面]' :
                    sentimentFilter === 'neutral' ? ' [中性]' : '') : '';
        titleEl.textContent = `包含「${word}」的评论${sentimentText} (${filteredIndices.length}条)`;
        listEl.innerHTML = "";

        const sortedIndices = filteredIndices.sort((a, b) => a - b);
        const maxShow = 50;
        const showIndices = sortedIndices.slice(0, maxShow);

        for (const idx of showIndices) {
            if (idx >= apiComments.length) continue;
            const comment = apiComments[idx];
            const content = comment.content;
            const text = (content && typeof content === 'string') ? content : "";
            const parentContainsWord = text.includes(word);

            if (parentContainsWord) {
                const item = document.createElement("div");
                item.className = "bcs-wf-comment-item";
                const userName = escapeHtml(comment.uname || "匿名");
                const highlighted = highlightWord(escapeHtml(text), word);
                item.innerHTML = `
          <div class="bcs-wf-comment-user">${userName}</div>
          <div class="bcs-wf-comment-text">${highlighted}</div>
        `;
                listEl.appendChild(item);
            }

            if (comment.replies) {
                let hasMatchingReply = false;
                for (const reply of comment.replies) {
                    const replyContent = reply.content;
                    const replyText = (replyContent && typeof replyContent === 'string') ? replyContent : "";
                    if (replyText.includes(word)) {
                        if (sentimentFilter) {
                            const replyLabel = S.sentiment.analyzeSentiment(replyText).label;
                            if (replyLabel !== sentimentFilter) continue;
                        }

                        if (!parentContainsWord && !hasMatchingReply) {
                            const ctxItem = document.createElement("div");
                            ctxItem.className = "bcs-wf-comment-item bcs-wf-comment-context";
                            const ctxUser = escapeHtml(comment.uname || "匿名");
                            const ctxText = text.length > 60 ? escapeHtml(text.slice(0, 60)) + "..." : escapeHtml(text);
                            ctxItem.innerHTML = `
                <div class="bcs-wf-comment-user" style="color:#999;">${ctxUser} (原评论)</div>
                <div class="bcs-wf-comment-text" style="color:#999;font-size:12px;">${ctxText}</div>
              `;
                            listEl.appendChild(ctxItem);
                        }
                        hasMatchingReply = true;

                        const replyItem = document.createElement("div");
                        replyItem.className = "bcs-wf-comment-item";
                        replyItem.style.marginLeft = "20px";
                        replyItem.style.borderLeft = "2px solid #00aeec";
                        const replyUser = escapeHtml(reply.uname || "匿名");
                        const replyHL = highlightWord(escapeHtml(replyText), word);
                        replyItem.innerHTML = `
              <div class="bcs-wf-comment-user">${replyUser} (回复)</div>
              <div class="bcs-wf-comment-text">${replyHL}</div>
            `;
                        listEl.appendChild(replyItem);
                    }
                }
            }
        }

        if (sortedIndices.length > maxShow) {
            const more = document.createElement("div");
            more.style.cssText = "text-align:center;padding:8px;color:#999;font-size:12px;";
            more.textContent = `还有 ${sortedIndices.length - maxShow} 条评论未显示`;
            listEl.appendChild(more);
        }

        container.classList.add("show");
        container.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // ========== 暴露接口 ==========
    S.charts = {
        insertPanel,
        refreshCharts,
        renderExcludeTags,
        escapeHtml,
        highlightWord,
    };

})();
