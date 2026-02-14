/**
 * jieba-wasm 加载器
 * 封装 WASM 加载逻辑，提供 Intl.Segmenter 回退方案
 */
(function () {
  "use strict";

  let _ready = false;
  let _useSegmenter = false;
  let _initPromise = null;
  let _segmenter = null;

  /**
   * 初始化 jieba-wasm
   * 通过 chrome.runtime.getURL 获取 WASM 文件路径
   * 失败时回退到 Intl.Segmenter
   */
  async function init() {
    if (_ready) return true;
    if (_initPromise) return _initPromise;

    _initPromise = _doInit();
    return _initPromise;
  }

  async function _doInit() {
    try {
      const wasmUrl = chrome.runtime.getURL("lib/jieba_rs_wasm_bg.wasm");
      console.log("[词频分析] 正在加载 jieba-wasm:", wasmUrl);

      if (!window.__jieba_wasm) {
        throw new Error("jieba_rs_wasm.js 未加载");
      }

      await window.__jieba_wasm.init(wasmUrl);
      _ready = true;
      _useSegmenter = false;
      console.log("[词频分析] jieba-wasm 加载成功");
      return true;
    } catch (err) {
      console.warn("[词频分析] jieba-wasm 加载失败，尝试 Intl.Segmenter 回退:", err);
      return _initSegmenterFallback();
    }
  }

  /**
   * Intl.Segmenter 回退方案
   */
  function _initSegmenterFallback() {
    try {
      if (typeof Intl !== "undefined" && Intl.Segmenter) {
        _segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
        _ready = true;
        _useSegmenter = true;
        console.log("[词频分析] 使用 Intl.Segmenter 回退方案");
        return true;
      } else {
        console.error("[词频分析] 浏览器不支持 Intl.Segmenter，分词功能不可用");
        return false;
      }
    } catch (err) {
      console.error("[词频分析] Intl.Segmenter 初始化失败:", err);
      return false;
    }
  }

  /**
   * 分词接口
   * @param {string} text - 待分词文本
   * @returns {string[]} 分词结果数组
   */
  function cut(text) {
    if (!_ready) return [text];

    if (_useSegmenter) {
      const segments = _segmenter.segment(text);
      const result = [];
      for (const seg of segments) {
        if (seg.isWordLike) {
          result.push(seg.segment);
        }
      }
      return result;
    }

    try {
      return window.__jieba_wasm.cut(text, true);
    } catch (err) {
      console.warn("[词频分析] jieba 分词出错，回退到 Segmenter:", err);
      if (_initSegmenterFallback()) {
        return cut(text);
      }
      return [text];
    }
  }

  /**
   * 添加自定义词
   * @param {string} word - 词
   * @param {number} [freq] - 词频
   * @param {string} [tag] - 词性
   */
  function addWord(word, freq, tag) {
    if (_useSegmenter || !_ready) return;
    try {
      window.__jieba_wasm.add_word(word, freq, tag);
    } catch (err) {
      console.warn("[词频分析] 添加自定义词失败:", word, err);
    }
  }

  // 暴露全局接口
  window.JiebaLoader = {
    init: init,
    isReady: function () { return _ready; },
    isUsingFallback: function () { return _useSegmenter; },
    cut: cut,
    addWord: addWord,
  };
})();
