/**
 * B站评论搜索 - 情感词典与词典分析模块
 */
(function () {
    "use strict";

    const S = window._BcsWF;

    // ========== 否定词和程度副词 ==========
    const NEGATION_WORDS = new Set([
        "不", "没", "非", "无", "未", "别", "莫", "勿", "否",
        "不是", "没有", "不会", "不能", "不要", "不可", "不太",
        "不了", "不到", "不让", "不敢", "不想", "不该", "不必",
        "并非", "毫无", "从未", "绝非", "休想",
    ]);
    const DEGREE_AMPLIFY = new Set([
        "很", "非常", "极", "极其", "太", "特别", "超", "超级",
        "十分", "格外", "尤其", "万分", "无比", "最",
        "真", "真的", "确实", "实在", "相当",
        "巨", "贼", "老", "死", "暴", "狠", "过于",
        "极度", "异常", "无敌", "绝对", "简直",
    ]);
    const DEGREE_WEAKEN = new Set([
        "有点", "有些", "稍", "稍微", "略", "略微", "一点",
        "一些", "几分", "多少", "不太", "不怎么", "还行",
    ]);

    // ========== B站/网络增强情感词 ==========
    const BILIBILI_POSITIVE = new Set([
        "awsl", "yyds", "绝绝子", "泪目", "破防", "上头",
        "好家伙", "666", "nb", "牛批", "牛逼", "tql", "太强了",
        "爱了", "dddd", "冲冲冲", "催更", "笑死", "好活",
        "哈哈", "嗯嗯", "可以", "不错", "厉害", "给力",
        "高级", "良心", "感谢up", "三连", "火钳刘明",
        "答案", "干货", "学到了", "涨知识", "宝藏",
        "神作", "封神", "名场面", "经典", "传奇",
        "好看", "好听", "好玩", "有趣", "搞笑", "快乐",
        "温暖", "治愈", "舒服", "过瘾", "解压",
        "前排", "打卡", "来了", "蹲一个",
        "大佬", "dalao", "膜拜", "orz", "跪了",
        "xswl", "哈哈哈", "233", "2333", "23333",
    ]);
    const BILIBILI_NEGATIVE = new Set([
        "下头", "寒心", "摆烂", "炒冷饭", "烂尾",
        "智商税", "割韭菜", "收割", "营销号", "标题党",
        "拉胯", "翻车", "踩雷", "避雷", "跑路",
        "跟风", "蹭热度", "水视频", "混剪",
        "差评", "低能", "脑残", "弱智", "傻逼",
        "骗子", "骗人", "忽悠", "坑", "坑爹",
        "难看", "难听", "无聊", "尴尬", "硬凹",
        "劝退", "弃了", "没救了", "不行", "算了",
        "mmp", "wqnmlgb", "草", "淦", "尬",
        "举报", "抄袭", "盗用", "洗稿",
    ]);

    // ========== 表情符号情感映射 ==========
    const EMOJI_POSITIVE = new Set([
        "😀", "😁", "😂", "🤣", "😃", "😄", "😆", "😍", "🥰", "😘",
        "😊", "🥳", "🎉", "👍", "👏", "❤️", "💕", "💯", "🔥", "✨",
        "💪", "🙌", "😎", "🤩", "⭐", "🌟", "💖", "💗", "😻", "🫶",
        "👌", "🤝", "🥇", "🏆", "🎊", "🎁", "💐", "🌹",
    ]);
    const EMOJI_NEGATIVE = new Set([
        "😢", "😭", "😠", "😡", "🤮", "🤢", "💩", "👎", "😤", "😩",
        "😫", "😰", "😱", "🙄", "😒", "🥲", "💔", "⚠️", "❌", "🚫",
        "😞", "😔", "😟", "😿", "🤡", "👻",
    ]);

    // ========== 词典情感分析 ==========

    /**
     * 对单条文本进行情感分析
     * @param {string} text
     * @returns {{ score: number, label: "positive"|"neutral"|"negative" }}
     */
    function analyzeSentiment(text) {
        if (!text) return { score: 0, label: "neutral" };

        const words = JiebaLoader.cut(text);
        let score = 0;
        let negation = false;
        let degree = 1;

        // 1. 分词级别评分
        for (let i = 0; i < words.length; i++) {
            const w = words[i];

            if (NEGATION_WORDS.has(w)) {
                negation = true;
                continue;
            }

            if (DEGREE_AMPLIFY.has(w)) {
                degree = 2;
                continue;
            }

            if (DEGREE_WEAKEN.has(w)) {
                degree = 0.5;
                continue;
            }

            let wordScore = 0;
            if (S.positiveWords.has(w)) {
                wordScore = 1;
            } else if (S.negativeWords.has(w)) {
                wordScore = -1;
            }
            // B站/网络用语增强
            if (wordScore === 0) {
                const wLower = w.toLowerCase();
                if (BILIBILI_POSITIVE.has(w) || BILIBILI_POSITIVE.has(wLower)) {
                    wordScore = 1.5;
                } else if (BILIBILI_NEGATIVE.has(w) || BILIBILI_NEGATIVE.has(wLower)) {
                    wordScore = -1.5;
                }
            }

            if (wordScore !== 0) {
                if (negation) {
                    wordScore = -wordScore;
                    negation = false;
                }
                wordScore *= degree;
                degree = 1;
                score += wordScore;
            } else {
                negation = false;
                degree = 1;
            }
        }

        // 2. 表情符号评分
        for (const char of text) {
            if (EMOJI_POSITIVE.has(char)) score += 0.8;
            else if (EMOJI_NEGATIVE.has(char)) score -= 0.8;
        }

        // 3. 标点符号启发规则
        const exclamCount = (text.match(/！|!/g) || []).length;
        if (exclamCount >= 2 && score !== 0) {
            score *= (1 + Math.min(exclamCount, 4) * 0.15);
        }
        const questionCount = (text.match(/？|\?/g) || []).length;
        if (questionCount >= 2 && Math.abs(score) < 0.3) {
            score -= 0.3;
        }

        // 4. 笑声模式检测
        if (/[哈]{3,}|2{1,}3{2,}|xswl|笑死/i.test(text)) {
            score += 1.0;
        }

        // 5. 判定阈值
        let label = "neutral";
        if (score > 0.3) label = "positive";
        else if (score < -0.3) label = "negative";

        return { score, label };
    }

    /**
     * 对 Top-N 高频词，统计情感分布（词典模式）
     */
    function computeWordSentiments(topWords, apiComments, wordCommentMap) {
        const sentimentCache = [];
        for (let i = 0; i < apiComments.length; i++) {
            const content = apiComments[i].content;
            const text = (content && typeof content === 'string') ? content : "";
            sentimentCache.push(analyzeSentiment(text));
        }

        const result = new Map();
        for (const { word } of topWords) {
            const indices = wordCommentMap.get(word);
            const dist = { positive: 0, neutral: 0, negative: 0 };
            if (indices) {
                for (const idx of indices) {
                    if (idx < sentimentCache.length) {
                        dist[sentimentCache[idx].label]++;
                    }
                }
            }
            result.set(word, dist);
        }

        return result;
    }

    // ========== 暴露接口 ==========
    S.sentiment = {
        analyzeSentiment,
        computeWordSentiments,
    };

})();
