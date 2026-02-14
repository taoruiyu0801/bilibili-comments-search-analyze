/**
 * B站评论搜索 - 词频分析主入口与状态管理
 *
 * 模块加载顺序：
 *   wordfreq-data.js      → 数据加载、分词
 *   wordfreq-sentiment.js → 情感词典、词典分析
 *   wordfreq-ai.js        → DeepSeek API、AI分析
 *   wordfreq-charts.js    → 图表渲染、交互
 *   wordfreq.js           → 主入口（本文件）
 */
(function () {
  "use strict";

  const S = window._BcsWF;

  // ========== 共享状态 ==========
  S.analysisCache = null;

  // ========== 工具函数 ==========

  function getApiComments() {
    if (typeof window.BcsGetApiComments === "function") {
      return window.BcsGetApiComments();
    }
    return [];
  }

  function setStatus(text) {
    const el = document.getElementById("bcs-wf-status");
    if (el) el.textContent = text;
  }

  function showLoading(msg) {
    const chartWrap = document.getElementById("bcs-wf-chart-wrap");
    if (chartWrap) {
      chartWrap.innerHTML = `<div id="bcs-wf-loading"><span class="bcs-wf-spinner"></span>${S.charts.escapeHtml(msg)}</div>`;
    }
  }

  function restoreChartContainers() {
    const chartWrap = document.getElementById("bcs-wf-chart-wrap");
    if (!chartWrap) return;
    chartWrap.innerHTML = `
      <div id="bcs-wf-chart" class="${S.currentChartType === 'bar' ? '' : 'hidden'}"></div>
      <div id="bcs-wf-wordcloud" class="${S.currentChartType === 'wordcloud' ? 'visible' : ''}"></div>
    `;
  }

  // 暴露工具函数供其他模块使用
  S.utils = {
    getApiComments,
    setStatus,
    showLoading,
    restoreChartContainers,
  };

  // ========== 主分析入口 ==========

  async function runAnalysis() {
    const apiComments = getApiComments();
    if (!apiComments || apiComments.length === 0) {
      setStatus("请先通过 API 加载评论");
      return;
    }

    // 如果缓存有效则直接使用
    if (S.analysisCache && S.analysisCache.commentCount === apiComments.length) {
      S.charts.refreshCharts();
      S.charts.renderExcludeTags();
      return;
    }

    showLoading("正在初始化分词引擎...");

    const ok = await S.data.initAll();
    if (!ok) {
      setStatus("分词引擎初始化失败");
      restoreChartContainers();
      return;
    }

    showLoading("正在分析评论...");

    // 让 UI 更新
    await new Promise(resolve => setTimeout(resolve, 50));

    const { wordFreqMap, wordCommentMap, allTexts, wordTextMap, textMetaMap } = S.data.segmentAllComments(apiComments);

    S.analysisCache = {
      commentCount: apiComments.length,
      wordFreqMap,
      wordCommentMap,
      allTexts,
      wordTextMap,
      textMetaMap,
      wordSentiments: null,
    };

    restoreChartContainers();
    S.charts.refreshCharts();
    S.charts.renderExcludeTags();

    // 通知 content.js 更新视频缓存（保存分析结果）
    if (typeof window.BcsSaveVideoData === "function") {
      window.BcsSaveVideoData();
    }
  }

  // 暴露 runAnalysis 供 charts 模块调用（刷新按钮）
  S.runAnalysis = runAnalysis;

  // ========== 重置 ==========

  function resetAll() {
    S.analysisCache = null;
    S.aiSentimentCache = new Map();
    S.isAiAnalyzing = false;
    S.useAiSentiment = false;
    S.currentSelectedWord = null;
    S.currentChartType = "bar";

    if (S.barChart) { S.barChart.dispose(); S.barChart = null; }
    if (S.cloudChart) { S.cloudChart.dispose(); S.cloudChart = null; }

    const panel = document.getElementById("bcs-wordfreq-panel");
    if (panel) panel.remove();

    console.log("[词频分析] 已重置所有状态");
  }

  // ========== 创建面板 ==========

  function createPanel() {
    const panel = S.charts.insertPanel();
    if (panel) {
      runAnalysis();
    }
  }

  // ========== 对外接口 ==========
  window.BcsWordFreq = {
    createPanel,
    runAnalysis,
    initAll: S.data.initAll,
    reset: resetAll,
    isReady: function () { return S.dataLoaded; },
  };

  // ========== 检查依赖 ==========
  if (typeof echarts === 'undefined') {
    console.error("[词频分析] ECharts 未加载");
  } else {
    console.log("[词频分析] ECharts 版本:", echarts.version);
  }

})();
