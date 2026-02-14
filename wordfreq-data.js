/**
 * B站评论搜索 - 数据加载与分词模块
 */
(function () {
    "use strict";

    // ========== 共享命名空间 ==========
    window._BcsWF = window._BcsWF || {};
    const S = window._BcsWF;

    // ========== 模块状态 ==========
    S.stopwords = new Set();
    S.positiveWords = new Set();
    S.negativeWords = new Set();
    S.dataLoaded = false;
    S.excludeWords = new Set();

    // ========== 数据加载 ==========

    async function loadJSON(filename) {
        const url = chrome.runtime.getURL("data/" + filename);
        const resp = await fetch(url);
        return resp.json();
    }

    async function loadStopwords() {
        try {
            const arr = await loadJSON("stopwords.json");
            S.stopwords = new Set(arr);
            console.log("[词频分析] 停用词加载完成:", S.stopwords.size);
        } catch (err) {
            console.warn("[词频分析] 停用词加载失败:", err);
        }
    }

    async function loadSentimentDicts() {
        try {
            const [pos, neg] = await Promise.all([
                loadJSON("positive.json"),
                loadJSON("negative.json"),
            ]);
            S.positiveWords = new Set(pos);
            S.negativeWords = new Set(neg);
            console.log("[词频分析] 情感词典加载完成: 正面", S.positiveWords.size, "负面", S.negativeWords.size);
        } catch (err) {
            console.warn("[词频分析] 情感词典加载失败:", err);
        }
    }

    async function loadCustomDict() {
        try {
            const url = chrome.runtime.getURL("data/custom_dict.txt");
            const resp = await fetch(url);
            const text = await resp.text();
            const lines = text.split("\n");
            let count = 0;
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const parts = trimmed.split(/\s+/);
                if (parts.length >= 1) {
                    const word = parts[0];
                    const freq = parts.length >= 2 ? parseInt(parts[1]) : undefined;
                    const tag = parts.length >= 3 ? parts[2] : undefined;
                    JiebaLoader.addWord(word, freq, tag);
                    count++;
                }
            }
            console.log("[词频分析] 自定义词典加载完成:", count, "词");
        } catch (err) {
            console.warn("[词频分析] 自定义词典加载失败:", err);
        }
    }

    async function initAll() {
        if (S.dataLoaded) return true;

        const jiebaOk = await JiebaLoader.init();
        if (!jiebaOk) {
            console.error("[词频分析] 分词引擎初始化失败");
            return false;
        }

        await Promise.all([loadStopwords(), loadSentimentDicts(), loadCustomDict()]);

        // 加载排除词
        try {
            const saved = localStorage.getItem("bcs-wf-exclude");
            if (saved) {
                const arr = JSON.parse(saved);
                S.excludeWords = new Set(arr);
            }
        } catch (e) { }

        S.dataLoaded = true;
        return true;
    }

    // ========== 分词模块 ==========

    const PUNCT_RE = /^[\s\p{P}\p{S}\p{Z}\p{C}]+$/u;
    const NUM_RE = /^\d+$/;

    function isValidWord(word) {
        if (!word || word.length < 2) return false;
        if (PUNCT_RE.test(word)) return false;
        if (NUM_RE.test(word)) return false;
        if (S.stopwords.has(word)) return false;
        return true;
    }

    function segmentText(text) {
        if (!text || typeof text !== "string") return [];
        const clean = text.replace(/[\n\r\t]/g, " ").trim();
        if (!clean) return [];
        try {
            const words = JiebaLoader.cut(clean, true);
            return words.filter(isValidWord);
        } catch (err) {
            console.warn("[词频分析] 分词失败:", err);
            return [];
        }
    }

    /**
     * 对所有评论进行分词，构建词频映射和词-评论索引映射
     * @param {Array} apiComments
     * @returns {{ wordFreqMap, wordCommentMap, allTexts, wordTextMap, textMetaMap }}
     */
    function segmentAllComments(apiComments) {
        const wordFreqMap = new Map();
        const wordCommentMap = new Map();
        const allTexts = [];
        const wordTextMap = new Map();
        const textMetaMap = [];

        for (let i = 0; i < apiComments.length; i++) {
            const comment = apiComments[i];
            const content = comment.content;
            const text = (content && typeof content === 'string') ? content : "";

            // 添加到 allTexts（flat 索引）
            const flatIdx = allTexts.length;
            allTexts.push(text);
            textMetaMap.push({ parentIdx: i, isReply: false, replyIdx: -1 });

            const words = segmentText(text);
            for (const word of words) {
                wordFreqMap.set(word, (wordFreqMap.get(word) || 0) + 1);

                if (!wordCommentMap.has(word)) wordCommentMap.set(word, new Set());
                wordCommentMap.get(word).add(i);

                if (!wordTextMap.has(word)) wordTextMap.set(word, new Set());
                wordTextMap.get(word).add(flatIdx);
            }

            // 处理回复
            if (comment.replies && comment.replies.length > 0) {
                for (let ri = 0; ri < comment.replies.length; ri++) {
                    const reply = comment.replies[ri];
                    const replyContent = reply.content;
                    const replyText = (replyContent && typeof replyContent === 'string') ? replyContent : "";

                    const replyFlatIdx = allTexts.length;
                    allTexts.push(replyText);
                    textMetaMap.push({ parentIdx: i, isReply: true, replyIdx: ri });

                    const replyWords = segmentText(replyText);
                    for (const word of replyWords) {
                        wordFreqMap.set(word, (wordFreqMap.get(word) || 0) + 1);

                        if (!wordCommentMap.has(word)) wordCommentMap.set(word, new Set());
                        wordCommentMap.get(word).add(i);

                        if (!wordTextMap.has(word)) wordTextMap.set(word, new Set());
                        wordTextMap.get(word).add(replyFlatIdx);
                    }
                }
            }
        }

        return { wordFreqMap, wordCommentMap, allTexts, wordTextMap, textMetaMap };
    }

    // ========== 暴露接口 ==========
    S.data = {
        initAll,
        segmentText,
        segmentAllComments,
        isValidWord,
    };

})();
