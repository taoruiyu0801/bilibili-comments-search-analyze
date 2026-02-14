(function () {
  "use strict";

  // ========== B站 API 配置 ==========
  const BiliApi = {
    comments: 'https://api.bilibili.com/x/v2/reply',
    commentReplies: 'https://api.bilibili.com/x/v2/reply/reply',
  };

  const FetchDelay = {
    comment: 200,
    replies: 200,
  };

  // ========== 配置：B站评论区选择器 ==========
  const SELECTORS = {
    // 评论区根容器（尝试多种可能的选择器）
    commentRoot: [
      "#comment",
      "#commentapp",
      ".comment",
      "bili-comments",
    ],
    // Web Component（Shadow DOM）
    commentComponent: "bili-comments",
    // 一级评论项
    replyItem: [
      ".reply-item",
      ".list-item.reply-wrap",
      "bili-comment-thread-renderer", // 新版
    ],
    // 一级评论文本
    replyContent: [
      ".root-reply-container .reply-content-container .reply-content",
      ".reply-con .text-con",
      ".root-reply .reply-content",
      ".content-warp .text",
      ".bili-comment-text", // 新版
      "#body", // 新版可能的选择器
    ],
    // 二级评论（回复）项
    subReplyItem: [
      ".sub-reply-item",
      ".reply-item .reply-wrap",
      "bili-comment-renderer", // 新版
    ],
    // 二级评论文本
    subReplyContent: [
      ".sub-reply-content .reply-content-container .reply-content",
      ".sub-reply-content .reply-content",
      ".sub-con .text-con",
      ".bili-comment-text", // 新版
      "#body", // 新版
    ],
  };

  // ========== 状态 ==========
  let isRegexMode = false;
  let isHideMode = false;
  let isApiMode = true; // 默认使用 API 模式
  let currentKeyword = "";
  let searchBar = null;
  let observer = null;
  let shadowRoot = null; // 缓存 Shadow DOM
  let matchedComments = []; // 匹配的评论列表
  let apiComments = []; // API 获取的评论数据
  window.BcsGetApiComments = function () { return apiComments; };
  window.BcsSaveVideoData = function () { saveCurrentVideoData(); };
  let isFetchingApi = false; // 是否正在通过 API 获取评论
  let isApiSearchMode = false; // 当前是否为 API 搜索模式
  let isAutoLoading = false; // 是否正在自动滚动加载
  let autoLoadInterval = null; // 自动加载定时器
  let loadSpeed = 300; // 滚动间隔时间（毫秒）

  // ========== 视频数据缓存（sessionStorage 持久化） ==========
  const CACHE_STORAGE_KEY = "bcs-video-cache";
  const MAX_CACHE_SIZE = 5;

  function extractVideoId(url) {
    const videoMatch = url.match(/\/video\/(BV[\w]+|av\d+)/i);
    if (videoMatch) return videoMatch[1];
    const bvidMatch = url.match(/[?&]bvid=(BV[\w]+)/i);
    if (bvidMatch) return bvidMatch[1];
    const generalMatch = url.match(/BV[\w]+/i);
    return generalMatch ? generalMatch[0] : null;
  }

  function getCurrentVideoId() {
    return extractVideoId(location.href);
  }

  // ========== 序列化工具（Map/Set ↔ JSON） ==========

  function serializeMap(map) {
    if (!map) return null;
    return Array.from(map.entries());
  }

  function deserializeMap(arr) {
    if (!arr) return new Map();
    return new Map(arr);
  }

  function serializeMapOfSets(map) {
    if (!map) return null;
    return Array.from(map.entries(), ([k, v]) => [k, [...v]]);
  }

  function deserializeMapOfSets(arr) {
    if (!arr) return new Map();
    return new Map(arr.map(([k, v]) => [k, new Set(v)]));
  }

  function serializeAnalysisCache(cache) {
    if (!cache) return null;
    return {
      commentCount: cache.commentCount,
      wordFreqMap: serializeMap(cache.wordFreqMap),
      wordCommentMap: serializeMapOfSets(cache.wordCommentMap),
      allTexts: cache.allTexts,
      wordTextMap: serializeMapOfSets(cache.wordTextMap),
      textMetaMap: cache.textMetaMap,
      wordSentiments: cache.wordSentiments ? serializeMap(cache.wordSentiments) : null,
    };
  }

  function deserializeAnalysisCache(obj) {
    if (!obj) return null;
    return {
      commentCount: obj.commentCount,
      wordFreqMap: deserializeMap(obj.wordFreqMap),
      wordCommentMap: deserializeMapOfSets(obj.wordCommentMap),
      allTexts: obj.allTexts || [],
      wordTextMap: deserializeMapOfSets(obj.wordTextMap),
      textMetaMap: obj.textMetaMap || [],
      wordSentiments: obj.wordSentiments ? new Map(obj.wordSentiments.map(([k, v]) => [k, { ...v }])) : null,
    };
  }

  // ========== 缓存读写（sessionStorage 持久化） ==========

  function loadCacheIndex() {
    try {
      const raw = sessionStorage.getItem(CACHE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("[B站评论搜索] 读取缓存索引失败:", e);
      return {};
    }
  }

  function saveCacheIndex(index) {
    try {
      sessionStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(index));
    } catch (e) {
      console.warn("[B站评论搜索] 保存缓存索引失败:", e);
    }
  }

  function saveCurrentVideoData(videoId) {
    if (!videoId) videoId = getCurrentVideoId();
    if (!videoId || apiComments.length === 0) return;

    const S = window._BcsWF;

    const data = {
      apiComments: apiComments,
      analysisCache: S ? serializeAnalysisCache(S.analysisCache) : null,
      aiSentimentCache: S ? serializeMap(S.aiSentimentCache) : null,
      useAiSentiment: S ? S.useAiSentiment : false,
      savedAt: Date.now(),
    };

    try {
      // LRU：读取索引，管理容量
      const index = loadCacheIndex();
      const keys = Object.keys(index);

      // 如果已存在，先删除旧条目
      if (index[videoId]) {
        sessionStorage.removeItem("bcs-vc-" + videoId);
        delete index[videoId];
      }

      // 如果缓存已满，删除最旧的
      while (Object.keys(index).length >= MAX_CACHE_SIZE) {
        let oldestKey = null, oldestTime = Infinity;
        for (const [k, v] of Object.entries(index)) {
          if (v.savedAt < oldestTime) { oldestTime = v.savedAt; oldestKey = k; }
        }
        if (oldestKey) {
          sessionStorage.removeItem("bcs-vc-" + oldestKey);
          delete index[oldestKey];
          console.log(`[B站评论搜索] 缓存已满，移除最旧视频: ${oldestKey}`);
        } else break;
      }

      // 写入数据
      sessionStorage.setItem("bcs-vc-" + videoId, JSON.stringify(data));
      index[videoId] = { savedAt: data.savedAt, commentCount: apiComments.length };
      saveCacheIndex(index);

      console.log(`[B站评论搜索] 已缓存视频 ${videoId}（${apiComments.length} 条评论）`);
    } catch (e) {
      console.warn("[B站评论搜索] 保存缓存失败:", e);
      // sessionStorage 可能满了，尝试清理一个旧条目后重试
      try {
        const index = loadCacheIndex();
        let oldestKey = null, oldestTime = Infinity;
        for (const [k, v] of Object.entries(index)) {
          if (v.savedAt < oldestTime) { oldestTime = v.savedAt; oldestKey = k; }
        }
        if (oldestKey) {
          sessionStorage.removeItem("bcs-vc-" + oldestKey);
          delete index[oldestKey];
          sessionStorage.setItem("bcs-vc-" + videoId, JSON.stringify(data));
          index[videoId] = { savedAt: data.savedAt, commentCount: apiComments.length };
          saveCacheIndex(index);
        }
      } catch (e2) {
        console.error("[B站评论搜索] 保存缓存彻底失败:", e2);
      }
    }
  }

  function restoreVideoData(videoId) {
    if (!videoId) return false;

    const index = loadCacheIndex();
    if (!index[videoId]) return false;

    try {
      const raw = sessionStorage.getItem("bcs-vc-" + videoId);
      if (!raw) return false;

      const cached = JSON.parse(raw);
      apiComments = cached.apiComments || [];

      // 恢复词频分析缓存
      const S = window._BcsWF;
      if (S) {
        S.analysisCache = deserializeAnalysisCache(cached.analysisCache);
        S.aiSentimentCache = cached.aiSentimentCache
          ? new Map(cached.aiSentimentCache.map(([k, v]) => [Number(k), v]))
          : new Map();
        S.useAiSentiment = cached.useAiSentiment || false;
      }

      // 更新状态栏
      const statsEl = document.getElementById('bcs-stats');
      if (statsEl) {
        const replyCount = apiComments.reduce((sum, c) => sum + (c.replies ? c.replies.length : 0), 0);
        const aiLabel = (S && S.useAiSentiment) ? " [含AI分析]" : "";
        statsEl.textContent = `已恢复缓存: ${apiComments.length} 条评论, ${replyCount} 条回复${aiLabel}`;
      }

      // 如果有分析缓存，自动重建词频面板
      if (S && S.analysisCache && window.BcsWordFreq) {
        // 搜索栏可能尚未插入 DOM（评论区组件延迟加载），延迟重试
        const tryCreatePanel = (retries) => {
          if (document.getElementById('bcs-search-bar')) {
            window.BcsWordFreq.createPanel();
          } else if (retries > 0) {
            setTimeout(() => tryCreatePanel(retries - 1), 500);
          } else {
            console.warn('[B站评论搜索] 缓存恢复：搜索栏未就绪，放弃重建词频面板');
          }
        };
        tryCreatePanel(10);
      }

      console.log(`[B站评论搜索] 已恢复视频 ${videoId} 的缓存数据（${apiComments.length} 条评论）`);
      return true;
    } catch (e) {
      console.warn("[B站评论搜索] 恢复缓存失败:", e);
      return false;
    }
  }

  // ========== API 获取评论功能 ==========

  /** 获取视频 BV 号 */
  function getBV() {
    const url = window.location.href;
    const match = url.match(/BV[a-zA-Z0-9]+/);
    if (!match) {
      console.error('[B站评论搜索] 未找到 BV 号');
      return null;
    }
    return match[0];
  }

  /** 获取番剧的 ep_id 或 season_id */
  function getBangumiId() {
    const url = window.location.href;
    // 匹配 /ep123456 或 /ss123456
    const epMatch = url.match(/\/ep(\d+)/);
    const ssMatch = url.match(/\/ss(\d+)/);
    if (epMatch) {
      return { type: 'ep', id: epMatch[1] };
    }
    if (ssMatch) {
      return { type: 'ss', id: ssMatch[1] };
    }
    return null;
  }

  /** 获取评论区 oid (视频为 aid，番剧为 ep_id) */
  async function getOid() {
    // 先尝试普通视频
    const bv = getBV();
    if (bv) {
      // 需要将 BV 号转换为 aid
      try {
        const resp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, {
          method: 'GET',
          credentials: 'include'
        });
        const data = await resp.json();
        if (data.code === 0 && data.data && data.data.aid) {
          return { oid: data.data.aid.toString(), type: '1' };
        }
      } catch (e) {
        console.error('[B站评论搜索] 获取 aid 失败:', e);
      }
      // 如果转换失败，直接使用 BV 号
      return { oid: bv, type: '1' };
    }

    // 尝试番剧
    const bangumi = getBangumiId();
    if (bangumi) {
      // 番剧评论区 type 为 1
      return { oid: bangumi.id, type: '1' };
    }

    return null;
  }

  /** 通过 API 获取单页评论 */
  async function fetchComments(params) {
    try {
      const resp = await fetch(
        `${BiliApi.comments}?${new URLSearchParams(params).toString()}`,
        { method: 'GET', credentials: 'include' }
      );
      const body = await resp.json();

      if (body.code !== 0) {
        console.error(`[B站评论搜索] 获取评论失败: ${body.message}`);
        return null;
      }

      if (!body.data || !body.data.replies || body.data.replies.length === 0) {
        return null;
      }

      // 第一页时合并置顶评论
      if (body.data.top_replies && params.pn === '1') {
        body.data.replies.unshift(...body.data.top_replies);
      }

      // 解析评论数据
      const result = body.data.replies.map(reply => ({
        rpid_str: reply.rpid_str,
        mid: reply.mid,
        isUp: body.data.upper && body.data.upper.mid === reply.mid,
        uname: reply.member.uname,
        avatar: reply.member.avatar,
        content: reply.content.message,
        like: reply.like,
        time: new Date(reply.ctime * 1000).toLocaleString('zh-CN'),
        replyCount: reply.rcount || 0,
        replies: reply.replies || [],
        total: body.data.page ? body.data.page.acount : 0,
      }));

      return result;
    } catch (e) {
      console.error('[B站评论搜索] 获取评论出错:', e);
      return null;
    }
  }

  /** 通过 API 获取评论的回复（折叠评论） */
  async function fetchCommentReplies(params) {
    try {
      const resp = await fetch(
        `${BiliApi.commentReplies}?${new URLSearchParams(params).toString()}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Referer': window.location.href,
          }
        }
      );
      const body = await resp.json();

      if (body.code !== 0) {
        console.error(`[B站评论搜索] 获取回复失败: ${body.message}`);
        return null;
      }

      if (!body.data || !body.data.replies || body.data.replies.length === 0) {
        return null;
      }

      const result = body.data.replies.map(reply => ({
        rpid_str: reply.rpid_str,
        mid: reply.mid,
        isUp: body.data.upper && body.data.upper.mid === reply.mid,
        uname: reply.member.uname,
        avatar: reply.member.avatar,
        content: reply.content.message,
        like: reply.like,
        time: new Date(reply.ctime * 1000).toLocaleString('zh-CN'),
      }));

      return result;
    } catch (e) {
      console.error('[B站评论搜索] 获取回复出错:', e);
      return null;
    }
  }

  /** 通过 API 获取所有评论（包括折叠回复） */
  async function fetchAllCommentsViaApi(options = {}) {
    const oidInfo = await getOid();
    if (!oidInfo) {
      showError('无法获取视频信息，请确认页面是否为B站视频页');
      return [];
    }

    const { oid, type } = oidInfo;
    const params = {
      oid: oid,
      type: type,
      sort: '2', // 按时间排序
      ps: '20',  // 每页20条
      pn: '1',
    };

    const allComments = [];
    let pageNum = 1;
    let totalLoaded = 0;
    const statsEl = document.getElementById('bcs-stats');

    console.log(`[B站评论搜索] 开始通过 API 获取评论, oid=${oid}, type=${type}`);

    // 循环获取所有页的评论
    while (true) {
      if (!isFetchingApi) {
        console.log('[B站评论搜索] 用户取消了 API 获取');
        break;
      }

      params.pn = pageNum.toString();
      const comments = await fetchComments(params);

      if (!comments || comments.length === 0) {
        break;
      }

      // 如果需要获取折叠的回复
      if (options.fetchReplies) {
        for (const comment of comments) {
          if (comment.replyCount > (comment.replies ? comment.replies.length : 0)) {
            // 有更多回复需要获取
            const replyParams = {
              oid: oid,
              type: type,
              root: comment.rpid_str,
              ps: '10',
              pn: '1',
            };

            let replyPage = 1;
            const allReplies = [];

            while (true) {
              if (!isFetchingApi) break;

              replyParams.pn = replyPage.toString();
              const replies = await fetchCommentReplies(replyParams);

              if (!replies || replies.length === 0) {
                break;
              }

              allReplies.push(...replies);
              replyPage++;

              await new Promise(resolve => setTimeout(resolve, FetchDelay.replies));
            }

            comment.replies = allReplies;
          }
        }
      }

      allComments.push(...comments);
      totalLoaded += comments.length;

      // 更新进度
      const total = comments[0] ? comments[0].total : '?';
      if (statsEl) {
        statsEl.textContent = `正在加载... ${totalLoaded}/${total} 条评论`;
      }

      console.log(`[B站评论搜索] 已加载 ${totalLoaded} 条评论`);

      pageNum++;
      await new Promise(resolve => setTimeout(resolve, FetchDelay.comment));
    }

    console.log(`[B站评论搜索] API 加载完成，共 ${allComments.length} 条评论`);
    return allComments;
  }

  /** 开始通过 API 加载评论 */
  async function startApiLoad(options = {}) {
    if (isFetchingApi) {
      stopApiLoad();
      return;
    }

    isFetchingApi = true;
    const btn = document.getElementById('bcs-btn-apiload');
    if (btn) {
      btn.classList.add('loading');
      btn.textContent = '停止加载';
    }

    const statsEl = document.getElementById('bcs-stats');
    if (statsEl) {
      statsEl.textContent = '正在通过 API 加载评论...';
    }

    try {
      apiComments = await fetchAllCommentsViaApi(options);

      if (statsEl) {
        const replyCount = apiComments.reduce((sum, c) => sum + (c.replies ? c.replies.length : 0), 0);
        statsEl.textContent = `API 加载完成: ${apiComments.length} 条评论, ${replyCount} 条回复`;
      }

      // 缓存当前视频数据
      saveCurrentVideoData();

      // 如果有搜索关键词，自动搜索
      if (currentKeyword.trim()) {
        performApiSearch();
      }
    } catch (e) {
      console.error('[B站评论搜索] API 加载失败:', e);
      showError('API 加载失败: ' + e.message);
    } finally {
      stopApiLoad();
    }
  }

  /** 停止 API 加载 */
  function stopApiLoad() {
    isFetchingApi = false;
    const btn = document.getElementById('bcs-btn-apiload');
    if (btn) {
      btn.classList.remove('loading');
      btn.textContent = 'API加载';
    }
  }

  /** 在 API 获取的评论中搜索 */
  function performApiSearch() {
    const keyword = currentKeyword.trim();
    matchedComments = [];
    isApiSearchMode = true; // 标记为 API 搜索模式

    if (!keyword) {
      updateStats(0, 0);
      renderApiResults();
      return;
    }

    if (apiComments.length === 0) {
      showError('请先点击"API加载"获取评论数据');
      return;
    }

    const matcher = buildMatcher(keyword, isRegexMode);
    if (!matcher) {
      updateStats(0, 0);
      renderApiResults();
      return;
    }

    let matchCount = 0;
    const totalCount = apiComments.length;

    console.log(`[B站评论搜索] 在 ${totalCount} 条 API 评论中搜索: "${keyword}"`);

    apiComments.forEach(comment => {
      let matched = false;

      // 搜索主评论
      if (matcher(comment.content) || matcher(comment.uname)) {
        matched = true;
      }

      // 搜索回复
      const matchedReplies = [];
      if (comment.replies && comment.replies.length > 0) {
        comment.replies.forEach(reply => {
          if (matcher(reply.content) || matcher(reply.uname)) {
            matched = true;
            matchedReplies.push(reply);
          }
        });
      }

      if (matched) {
        matchCount++;
        matchedComments.push({
          ...comment,
          matchedReplies: matchedReplies,
        });
      }
    });

    console.log(`[B站评论搜索] API 搜索完成: ${matchCount}/${totalCount}`);
    updateStats(matchCount, totalCount);
    renderApiResults();
  }

  /** 渲染 API 搜索结果 */
  function renderApiResults() {
    const resultsEl = document.getElementById('bcs-results');
    if (!resultsEl) return;

    if (matchedComments.length === 0 || !currentKeyword.trim()) {
      resultsEl.classList.remove('show');
      resultsEl.innerHTML = '';
      return;
    }

    resultsEl.classList.add('show');

    const highlighter = buildHighlighter(currentKeyword, isRegexMode);

    const html = matchedComments.map((comment, index) => {
      let displayText = comment.content.substring(0, 150);
      if (comment.content.length > 150) displayText += '...';

      // 高亮关键词
      if (highlighter) {
        highlighter.lastIndex = 0;
        displayText = displayText.replace(
          highlighter,
          '<span class="bcs-highlight">$1</span>'
        );
      }

      // 显示匹配的回复数量
      const replyInfo = comment.matchedReplies && comment.matchedReplies.length > 0
        ? ` <span class="bcs-reply-count">(+${comment.matchedReplies.length}条回复)</span>`
        : '';

      // 显示评论在列表中的序号，帮助用户判断是否在页面上
      const orderNum = apiComments.findIndex(c => c.rpid_str === comment.rpid_str) + 1;
      const orderTag = orderNum <= 40 ? '' : ` <span class="bcs-order-tag" title="第${orderNum}条，可能需要滚动加载">#${orderNum}</span>`;

      return `
        <div class="bcs-result-item" data-index="${index}">
          <div class="bcs-result-user">${comment.uname}${comment.isUp ? ' <span class="bcs-up-tag">UP</span>' : ''}${orderTag}${replyInfo}</div>
          <div class="bcs-result-text">${displayText}</div>
        </div>
      `;
    }).join('');

    resultsEl.innerHTML = html;

    // 绑定点击事件 - 跳转到评论位置
    resultsEl.querySelectorAll('.bcs-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        const comment = matchedComments[index];
        if (comment && comment.rpid_str) {
          // 尝试在页面中查找对应的评论元素（通过内容匹配）
          const targetEl = findCommentElementByRpid(comment.rpid_str, comment.content, comment.uname);
          if (targetEl) {
            // 滚动到评论位置
            targetEl.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
            // 临时高亮动画
            targetEl.style.transition = 'background 0.3s';
            targetEl.style.background = '#fff3a8';
            setTimeout(() => {
              targetEl.style.background = '';
            }, 2000);
          } else {
            // 如果找不到，复制评论内容
            const fullText = `${comment.uname}: ${comment.content}`;
            navigator.clipboard.writeText(fullText).then(() => {
              item.style.background = '#d4edda';
              item.title = '已复制（该评论未在页面中加载）';
              setTimeout(() => {
                item.style.background = '';
              }, 1000);
            });
          }
        }
      });
    });
  }

  /** 通过 URL 跳转到评论（利用 B站自带功能） */
  function jumpToCommentByUrl(rpid) {
    // B站支持通过 URL hash 跳转到评论
    // 格式: #reply{rpid}
    const currentUrl = window.location.href.split('#')[0];
    const newUrl = `${currentUrl}#reply${rpid}`;

    // 修改 URL 并刷新页面的评论区
    window.location.hash = `reply${rpid}`;

    // 延迟后检查是否跳转成功，如果没有则尝试滚动到评论区
    setTimeout(() => {
      const targetEl = findCommentElementByRpid(rpid);
      if (targetEl) {
        targetEl.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
        targetEl.style.transition = 'background 0.3s';
        targetEl.style.background = '#fff3a8';
        setTimeout(() => {
          targetEl.style.background = '';
        }, 2000);
      }
    }, 1000);
  }

  /** 通过评论ID在页面中查找评论元素 */
  function findCommentElementByRpid(rpid, commentContent, commentUser) {
    const shadow = getShadowRoot();
    if (!shadow) {
      console.log('[B站评论搜索] findCommentElementByRpid: 未找到 Shadow Root');
      return null;
    }

    // 在 Shadow DOM 中查找所有评论
    const threads = shadow.querySelectorAll('bili-comment-thread-renderer');

    // 清理内容：移除表情符号 [xxx] 和特殊字符
    const cleanContent = (text) => {
      if (!text) return '';
      return text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    };

    const cleanedApiContent = cleanContent(commentContent);
    const contentPrefix = cleanedApiContent.substring(0, 15); // 用前15个字符匹配

    console.log(`[B站评论搜索] 尝试查找评论, 用户=${commentUser}, 清理后内容前15字="${contentPrefix}"`);

    // 第一轮：精确匹配用户名 + 内容
    for (const thread of threads) {
      const threadText = cleanContent(getTextFromShadowElement(thread));
      const threadUser = getUserName(thread);

      if (commentUser && threadUser === commentUser) {
        if (contentPrefix && threadText.includes(contentPrefix)) {
          console.log(`[B站评论搜索] 精确匹配找到评论: ${threadUser}`);
          return thread;
        }
      }
    }

    // 第二轮：只匹配用户名（如果用户名唯一）
    const matchedByUser = [];
    for (const thread of threads) {
      const threadUser = getUserName(thread);
      if (commentUser && threadUser === commentUser) {
        matchedByUser.push(thread);
      }
    }

    if (matchedByUser.length === 1) {
      console.log(`[B站评论搜索] 通过唯一用户名找到评论: ${commentUser}`);
      return matchedByUser[0];
    } else if (matchedByUser.length > 1) {
      // 多个同名用户，尝试用更短的内容匹配
      const shortPrefix = cleanedApiContent.substring(0, 8);
      for (const thread of matchedByUser) {
        const threadText = cleanContent(getTextFromShadowElement(thread));
        if (shortPrefix && threadText.includes(shortPrefix)) {
          console.log(`[B站评论搜索] 通过短内容匹配找到评论: ${commentUser}`);
          return thread;
        }
      }
      // 如果还是找不到，返回第一个同名用户
      console.log(`[B站评论搜索] 找到${matchedByUser.length}个同名用户，返回第一个: ${commentUser}`);
      return matchedByUser[0];
    }

    // 备用方法：遍历所有评论
    const allItems = getAllReplyItems();
    for (const item of allItems) {
      const itemUser = getUserName(item);
      if (commentUser && itemUser === commentUser) {
        console.log(`[B站评论搜索] 通过 allItems 用户名匹配找到评论: ${itemUser}`);
        return item;
      }
    }

    console.log(`[B站评论搜索] 未找到匹配的评论元素`);
    return null;
  }

  // ========== 展开所有折叠评论功能 ==========

  let isExpanding = false; // 是否正在展开

  /** 在回复渲染器中查找展开按钮 */
  function findExpandButtonsInRepliesRenderer(repliesRenderer) {
    const buttons = [];
    if (!repliesRenderer?.shadowRoot) return buttons;

    const shadow = repliesRenderer.shadowRoot;

    // 方法1: 查找包含 "查看" + "回复" 的元素（如 "查看5条回复"）
    const allElements = shadow.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent?.trim() || '';

      // 精确匹配展开按钮的文本格式
      // "查看X条回复" 或 "点击查看" 或 "展开X条回复"
      const isExpandText = (
        /^查看\s*\d+\s*条回复$/.test(text) ||
        /^展开\s*\d+\s*条回复$/.test(text) ||
        /^共\s*\d+\s*条回复[，,]\s*点击查看$/.test(text) ||
        /^点击查看$/.test(text) ||
        /^查看更多回复$/.test(text) ||
        /^展开更多$/.test(text)
      );

      if (isExpandText && el.offsetParent !== null) {
        buttons.push(el);
        console.log(`[B站评论搜索] 找到展开按钮: "${text}"`);
      }
    }

    // 方法2: 查找特定的按钮组件
    const actionButtons = shadow.querySelectorAll('bili-comment-action-buttons-renderer');
    for (const btn of actionButtons) {
      if (btn.shadowRoot) {
        const innerBtns = btn.shadowRoot.querySelectorAll('button, [role="button"]');
        for (const innerBtn of innerBtns) {
          const text = innerBtn.textContent?.trim() || '';
          if ((text.includes('查看') && text.includes('回复')) || text.includes('展开')) {
            if (innerBtn.offsetParent !== null) {
              buttons.push(innerBtn);
            }
          }
        }
      }
    }

    return buttons;
  }

  /** 查找评论线程中的所有展开按钮 */
  function findAllExpandButtons(shadow) {
    const buttons = [];
    if (!shadow) return buttons;

    const threads = shadow.querySelectorAll('bili-comment-thread-renderer');

    for (const thread of threads) {
      if (!thread.shadowRoot) continue;

      // 只在回复渲染器中查找展开按钮（避免匹配评论内容）
      const repliesRenderer = thread.shadowRoot.querySelector('bili-comment-replies-renderer');
      if (repliesRenderer) {
        const foundButtons = findExpandButtonsInRepliesRenderer(repliesRenderer);
        buttons.push(...foundButtons);
      }
    }

    return buttons;
  }

  /** 一键展开所有折叠的回复评论 */
  async function expandAllReplies() {
    if (isExpanding) {
      stopExpanding();
      return;
    }

    isExpanding = true;
    const btn = document.getElementById("bcs-btn-expand");
    if (btn) {
      btn.classList.add("loading");
      btn.textContent = "停止展开";
    }

    const statsEl = document.getElementById("bcs-stats");
    const shadow = getShadowRoot();

    if (!shadow) {
      showError("未找到评论区，请确保页面已加载完成");
      stopExpanding();
      return;
    }

    console.log("[B站评论搜索] 开始展开所有折叠评论...");

    let expandedCount = 0;
    let round = 0;
    const maxRounds = 100; // 防止无限循环
    const clickedElements = new Set(); // 记录已点击的元素，避免重复

    while (isExpanding && round < maxRounds) {
      round++;
      let clickedThisRound = 0;

      // 查找所有展开按钮（只在回复渲染器中查找，避免匹配评论内容）
      const expandButtons = findAllExpandButtons(shadow);

      for (const expandBtn of expandButtons) {
        if (!isExpanding) break;

        // 用元素的文本内容和位置作为唯一标识，避免重复点击
        const btnKey = expandBtn.textContent?.trim() + '_' + expandBtn.getBoundingClientRect().top;

        if (!clickedElements.has(btnKey) && expandBtn.offsetParent !== null) {
          console.log(`[B站评论搜索] 点击展开按钮: "${expandBtn.textContent?.trim()}"`);
          expandBtn.click();
          clickedElements.add(btnKey);
          clickedThisRound++;
          expandedCount++;

          if (statsEl) {
            statsEl.textContent = `正在展开... 已点击 ${expandedCount} 次`;
          }

          // 等待内容加载
          await new Promise(resolve => setTimeout(resolve, 350));
        }
      }

      console.log(`[B站评论搜索] 第 ${round} 轮点击了 ${clickedThisRound} 个按钮`);

      // 如果这一轮没有点击任何按钮，再检查一轮确认
      if (clickedThisRound === 0) {
        // 等待一下再检查，可能有延迟加载的按钮
        await new Promise(resolve => setTimeout(resolve, 500));

        // 再查找一次
        const remainingButtons = findAllExpandButtons(shadow);
        let hasMore = false;
        for (const b of remainingButtons) {
          const bKey = b.textContent?.trim() + '_' + b.getBoundingClientRect().top;
          if (!clickedElements.has(bKey) && b.offsetParent !== null) {
            hasMore = true;
            break;
          }
        }

        if (!hasMore) {
          console.log(`[B站评论搜索] 未找到更多展开按钮，展开完成`);
          break;
        }
      }

      // 短暂等待后继续下一轮
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (statsEl) {
      statsEl.textContent = `展开完成，共点击 ${expandedCount} 次`;
    }

    console.log(`[B站评论搜索] 展开完成，共点击 ${expandedCount} 次`);
    stopExpanding();

    // 如果有搜索关键词，重新执行搜索以包含新展开的回复
    if (currentKeyword.trim()) {
      console.log(`[B站评论搜索] 展开完成后重新搜索: "${currentKeyword}"`);
      setTimeout(() => {
        performSearch();
      }, 500); // 延迟500ms确保DOM已更新
    }
  }

  /** 停止展开 */
  function stopExpanding() {
    isExpanding = false;
    const btn = document.getElementById("bcs-btn-expand");
    if (btn) {
      btn.classList.remove("loading");
      btn.textContent = "展开全部";
    }
  }

  // ========== 滚动加载功能 ==========

  /** 开始自动滚动加载 */
  function startAutoLoad() {
    if (isAutoLoading) {
      stopAutoLoad();
      return;
    }

    isAutoLoading = true;
    const btn = document.getElementById("bcs-btn-scroll");
    if (btn) {
      btn.classList.add("loading");
      btn.textContent = "停止滚动";
    }

    console.log("[B站评论搜索] 开始自动滚动加载...");

    let lastCount = 0;
    let noChangeCount = 0;

    autoLoadInterval = setInterval(() => {
      const currentCount = getAllReplyItems().length;

      // 更新统计
      const statsEl = document.getElementById("bcs-stats");
      if (statsEl) {
        statsEl.textContent = `正在滚动加载... 已加载 ${currentCount} 条评论`;
      }

      // 快速滚动到底部
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "instant",
      });

      // 检查是否有新评论加载
      if (currentCount === lastCount) {
        noChangeCount++;
        console.log(`[B站评论搜索] 评论数量未变化 (${noChangeCount}/5): ${currentCount}`);

        // 如果连续5次没有新评论，认为已加载完成
        if (noChangeCount >= 5) {
          stopAutoLoad();
          console.log(`[B站评论搜索] 滚动加载完成，共 ${currentCount} 条评论`);

          // 自动返回顶部
          setTimeout(() => {
            window.scrollTo({
              top: 0,
              behavior: "smooth",
            });
          }, 500);

          if (statsEl) {
            statsEl.textContent = `滚动加载完成，共 ${currentCount} 条评论`;
          }

          // 如果有搜索关键词，重新执行搜索
          if (currentKeyword.trim()) {
            console.log(`[B站评论搜索] 滚动加载完成后重新搜索: "${currentKeyword}"`);
            setTimeout(() => {
              performSearch();
            }, 1000); // 延迟1秒确保返回顶部动画完成
          }
        }
      } else {
        noChangeCount = 0;
        console.log(`[B站评论搜索] 加载中: ${lastCount} -> ${currentCount}`);
      }

      lastCount = currentCount;
    }, loadSpeed);
  }

  /** 停止自动滚动加载 */
  function stopAutoLoad() {
    isAutoLoading = false;
    if (autoLoadInterval) {
      clearInterval(autoLoadInterval);
      autoLoadInterval = null;
    }

    const btn = document.getElementById("bcs-btn-scroll");
    if (btn) {
      btn.classList.remove("loading");
      btn.textContent = "滚动加载";
    }

    console.log("[B站评论搜索] 停止滚动加载");
  }

  // ========== 工具函数 ==========

  /** 用多个选择器查找第一个匹配的元素 */
  function queryFirst(parent, selectorList) {
    for (const sel of selectorList) {
      const el = parent.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /** 用多个选择器查找所有匹配的元素 */
  function queryAll(parent, selectorList) {
    for (const sel of selectorList) {
      const els = parent.querySelectorAll(sel);
      if (els.length > 0) return Array.from(els);
    }
    return [];
  }

  /** 获取 Shadow DOM 根元素 */
  function getShadowRoot() {
    if (shadowRoot) return shadowRoot;

    const component = document.querySelector(SELECTORS.commentComponent);
    if (component && component.shadowRoot) {
      shadowRoot = component.shadowRoot;
      console.log("[B站评论搜索] 找到 Shadow DOM:", component);
      return shadowRoot;
    }
    return null;
  }

  /** 获取评论区根元素 */
  function getCommentRoot() {
    // 先尝试 Shadow DOM
    const shadow = getShadowRoot();
    if (shadow) {
      console.log("[B站评论搜索] 使用 Shadow DOM 作为根元素");
      return shadow;
    }

    // 回退到普通 DOM
    for (const sel of SELECTORS.commentRoot) {
      const el = document.querySelector(sel);
      if (el) {
        console.log("[B站评论搜索] 使用评论区根选择器:", sel);
        return el;
      }
    }
    return null;
  }

  /** 调试：分析评论区结构 */
  function debugCommentStructure() {
    const root = getCommentRoot();
    if (!root) {
      console.error("[B站评论搜索] 未找到评论区根元素");
      return;
    }

    console.log("[B站评论搜索] === 评论区结构分析 ===");
    console.log("[B站评论搜索] 评论区根元素:", root);
    console.log("[B站评论搜索] 是否为 Shadow Root:", root instanceof ShadowRoot);

    // 查找所有可能的评论元素
    const possibleSelectors = [
      ".reply-item",
      ".list-item",
      ".comment-item",
      "[class*='reply']",
      "[class*='comment']",
      "bili-comment-thread-renderer",
      "bili-comment-renderer",
      "bili-comment",
      "#contents",
      "#body",
    ];

    possibleSelectors.forEach((sel) => {
      const items = root.querySelectorAll(sel);
      if (items.length > 0) {
        console.log(`[B站评论搜索] 找到 ${items.length} 个元素匹配 "${sel}"`);
        console.log(`[B站评论搜索] 第一个元素:`, items[0]);
        if (items[0].className) {
          console.log(`[B站评论搜索] 第一个元素的class:`, items[0].className);
        }
        // 尝试获取文本内容
        const text = items[0].textContent?.trim().substring(0, 100);
        if (text) {
          console.log(`[B站评论搜索] 第一个元素的文本:`, text);
        }
      }
    });

    // 输出前5层子元素的标签和class
    console.log("[B站评论搜索] 评论区子元素结构:");
    const children = root.children || root.childNodes;
    Array.from(children).slice(0, 10).forEach((child, i) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      if (child.id === "bcs-search-bar") return;
      const tag = child.tagName?.toLowerCase() || child.nodeName?.toLowerCase();
      const cls = child.className || "";
      console.log(`  [${i}] <${tag}> class="${cls}" id="${child.id || ""}"`);

      if (child.children && child.children.length > 0) {
        Array.from(child.children).slice(0, 5).forEach((grandChild, j) => {
          const gtag = grandChild.tagName?.toLowerCase();
          const gcls = grandChild.className || "";
          console.log(`    [${j}] <${gtag}> class="${gcls}" id="${grandChild.id || ""}"`);
        });
      }
    });
  }

  /** 获取所有一级评论 */
  function getAllReplyItems() {
    const root = getCommentRoot();
    if (!root) {
      console.log("[B站评论搜索] 获取评论失败：未找到评论区根元素");
      return [];
    }
    const items = queryAll(root, SELECTORS.replyItem);
    if (items.length === 0) {
      console.log("[B站评论搜索] 警告：评论区根元素存在，但未找到评论项");
      console.log("[B站评论搜索] 尝试的选择器:", SELECTORS.replyItem);
      debugCommentStructure(); // 调用调试函数
    }
    return items;
  }

  /** 递归获取 Shadow DOM 中的文本 */
  function getTextFromShadowElement(el) {
    if (!el) return "";

    // 如果元素有 shadowRoot，递归查找
    if (el.shadowRoot) {
      // 尝试查找 bili-rich-text
      const richText = el.shadowRoot.querySelector("bili-rich-text");
      if (richText && richText.shadowRoot) {
        const contents = richText.shadowRoot.querySelector("#contents");
        if (contents) {
          return contents.textContent || "";
        }
      }

      // 尝试查找其他可能的文本容器
      const contents = el.shadowRoot.querySelector("#contents");
      if (contents) return contents.textContent || "";

      const body = el.shadowRoot.querySelector("#body");
      if (body) return body.textContent || "";

      // 递归查找子元素
      const children = el.shadowRoot.querySelectorAll("*");
      for (const child of children) {
        if (child.shadowRoot) {
          const text = getTextFromShadowElement(child);
          if (text) return text;
        }
      }

      // 兜底：用深度遍历（自动跳过 style/script）
      return deepGetAllText(el);
    }

    return el.textContent || "";
  }

  /** 获取评论项中的文本内容 */
  function getTextFromReply(replyEl, contentSelectors) {
    // 先尝试递归 Shadow DOM
    const shadowText = getTextFromShadowElement(replyEl);
    if (shadowText.trim()) return shadowText;

    // 回退到普通选择器
    const contentEl = queryFirst(replyEl, contentSelectors);
    return contentEl ? contentEl.textContent || "" : "";
  }

  /** 获取评论作者名称 */
  function getUserName(replyEl) {
    if (!replyEl) return "匿名用户";

    // 尝试从 Shadow DOM 中获取
    if (replyEl.shadowRoot) {
      const renderer = replyEl.shadowRoot.querySelector("bili-comment-renderer");
      if (renderer && renderer.shadowRoot) {
        const userInfo = renderer.shadowRoot.querySelector("bili-comment-user-info");
        if (userInfo && userInfo.shadowRoot) {
          const nameEl = userInfo.shadowRoot.querySelector("#user-name");
          if (nameEl) return nameEl.textContent?.trim() || "匿名用户";
        }
      }
    }

    // 回退到普通选择器
    const nameSelectors = [
      ".user-name",
      ".name",
      ".reply-name",
      "[class*='user-name']",
    ];
    const nameEl = queryFirst(replyEl, nameSelectors);
    return nameEl ? nameEl.textContent?.trim() || "匿名用户" : "匿名用户";
  }

  /** 从 bili-comment-renderer 元素直接获取用户名 */
  function getRendererUserName(rendererEl) {
    if (rendererEl && rendererEl.shadowRoot) {
      const userInfo = rendererEl.shadowRoot.querySelector("bili-comment-user-info");
      if (userInfo && userInfo.shadowRoot) {
        const nameEl = userInfo.shadowRoot.querySelector("#user-name");
        if (nameEl) return nameEl.textContent?.trim() || "";
      }
    }
    return "";
  }

  /** 获取评论项中每条回复的详细信息 [{text, userName, element}] */
  function getSubRepliesInfo(replyEl) {
    const results = [];

    if (replyEl.shadowRoot) {
      const repliesRenderer = replyEl.shadowRoot.querySelector(
        "bili-comment-replies-renderer"
      );
      if (repliesRenderer) {
        // 方法1: 通过 shadowRoot 逐条获取
        if (repliesRenderer.shadowRoot) {
          const subRenderers = Array.from(
            repliesRenderer.shadowRoot.querySelectorAll("bili-comment-renderer")
          );
          if (subRenderers.length > 0) {
            for (const renderer of subRenderers) {
              const text = getTextFromShadowElement(renderer);
              const userName = getRendererUserName(renderer);
              results.push({ text, userName, element: renderer });
            }
            return results;
          }
        }

        // 方法2: 深度遍历获取整体文本（无法分离单条回复）
        const fallbackText = deepGetAllText(repliesRenderer);
        if (fallbackText.trim()) {
          results.push({ text: fallbackText, userName: "", element: repliesRenderer });
        }
      }
    }

    // 回退到普通选择器
    if (results.length === 0) {
      const subItems = queryAll(replyEl, SELECTORS.subReplyItem);
      for (const item of subItems) {
        const text = getTextFromReply(item, SELECTORS.subReplyContent);
        const userName = getUserName(item);
        results.push({ text, userName, element: item });
      }
    }

    return results;
  }

  /** 深度递归获取元素及其所有嵌套 Shadow DOM 中的全部文本 */
  function deepGetAllText(el) {
    if (!el) return "";

    // 优先策略：只提取 bili-rich-text 中的评论正文（跨越所有 Shadow DOM 层级）
    const richTextParts = [];
    function findRichTexts(node) {
      if (!node) return;
      // 找到 bili-rich-text 就提取内容，不再往下
      if (node.tagName && node.tagName.toLowerCase() === 'bili-rich-text') {
        if (node.shadowRoot) {
          const contents = node.shadowRoot.querySelector("#contents");
          if (contents) richTextParts.push(contents.textContent?.trim() || "");
        }
        return;
      }
      // 穿透 Shadow DOM
      if (node.shadowRoot) findRichTexts(node.shadowRoot);
      // 遍历子元素
      if (node.children) {
        for (const child of node.children) findRichTexts(child);
      }
    }
    findRichTexts(el);

    if (richTextParts.length > 0) return richTextParts.join(" ");

    // 兜底策略：收集所有文本但跳过 UI 元素
    const parts = [];
    function walk(node) {
      if (!node) return;
      if (node.shadowRoot) walk(node.shadowRoot);
      const children = node.childNodes;
      if (children) {
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child.nodeType === 3) { // TEXT_NODE
            const t = child.textContent;
            if (t && t.trim()) parts.push(t.trim());
          } else if (child.nodeType === 1) { // ELEMENT_NODE
            const tag = child.tagName;
            if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'BUTTON') continue;
            walk(child);
          }
        }
      }
    }
    walk(el);
    return parts.join(" ");
  }

  /** 获取评论项中的所有二级评论文本 */
  function getSubReplyTexts(replyEl) {
    // 先尝试在 Shadow DOM 中查找回复
    if (replyEl.shadowRoot) {
      const repliesRenderer = replyEl.shadowRoot.querySelector(
        "bili-comment-replies-renderer"
      );
      if (repliesRenderer) {
        // 方法1: 通过 shadowRoot 查找 bili-comment-renderer
        if (repliesRenderer.shadowRoot) {
          const subItems =
            repliesRenderer.shadowRoot.querySelectorAll("bili-comment-renderer");
          if (subItems.length > 0) {
            return Array.from(subItems).map((item) => getTextFromShadowElement(item));
          }
        }

        // 方法2: 如果方法1失败，用深度遍历获取回复容器的所有文本
        const fallbackText = deepGetAllText(repliesRenderer);
        if (fallbackText.trim()) {
          return [fallbackText];
        }
      }
    }

    // 回退到普通选择器
    const subItems = queryAll(replyEl, SELECTORS.subReplyItem);
    return subItems.map((item) =>
      getTextFromReply(item, SELECTORS.subReplyContent)
    );
  }

  /** 构造搜索匹配函数 */
  function buildMatcher(keyword, useRegex) {
    if (!keyword) return null;

    if (useRegex) {
      try {
        const regex = new RegExp(keyword, "gi");
        hideError();
        return (text) => regex.test(text);
      } catch (e) {
        showError("正则表达式语法错误: " + e.message);
        return null;
      }
    } else {
      const lowerKeyword = keyword.toLowerCase();
      hideError();
      return (text) => (text || '').toString().toLowerCase().includes(lowerKeyword);
    }
  }

  /** 构造高亮替换函数 */
  function buildHighlighter(keyword, useRegex) {
    if (!keyword) return null;

    if (useRegex) {
      try {
        return new RegExp(`(${keyword})`, "gi");
      } catch {
        return null;
      }
    } else {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(${escaped})`, "gi");
    }
  }

  /** 高亮元素中的文本 */
  function highlightElement(el, regex) {
    if (!el || !regex) return;

    // 如果元素有 shadowRoot，在 Shadow DOM 中查找文本元素
    if (el.shadowRoot) {
      const richText = el.shadowRoot.querySelector("bili-rich-text");
      if (richText && richText.shadowRoot) {
        const contents = richText.shadowRoot.querySelector("#contents");
        if (contents) {
          highlightInElement(contents, regex);
          return;
        }
      }

      // 尝试其他容器
      const contents = el.shadowRoot.querySelector("#contents");
      if (contents) {
        highlightInElement(contents, regex);
        return;
      }

      // 递归处理子元素
      const children = el.shadowRoot.querySelectorAll("*");
      for (const child of children) {
        if (child.shadowRoot) {
          highlightElement(child, regex);
        }
      }
      return;
    }

    // 普通元素
    highlightInElement(el, regex);
  }

  /** 在普通元素中高亮文本 */
  function highlightInElement(el, regex) {
    if (!el || !regex) return;

    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      const text = node.textContent;
      // 重置 regex lastIndex
      regex.lastIndex = 0;
      if (!regex.test(text)) return;

      const span = document.createElement("span");
      regex.lastIndex = 0;
      span.innerHTML = text.replace(
        regex,
        '<mark class="bcs-highlight">$1</mark>'
      );
      node.parentNode.replaceChild(span, node);
    });
  }

  /** 深度递归高亮：穿透所有 Shadow DOM 层级 */
  function deepHighlight(el, regex) {
    if (!el) return;

    if (el.shadowRoot) {
      // 在 shadowRoot 中查找文本容器并高亮
      const richTexts = el.shadowRoot.querySelectorAll("bili-rich-text");
      if (richTexts.length > 0) {
        richTexts.forEach(rt => {
          if (rt.shadowRoot) {
            const contents = rt.shadowRoot.querySelector("#contents");
            if (contents) {
              highlightInElement(contents, regex);
            }
          }
        });
      }

      // 递归处理所有带 shadowRoot 的子元素
      const children = el.shadowRoot.querySelectorAll("*");
      for (const child of children) {
        if (child.shadowRoot) {
          deepHighlight(child, regex);
        }
      }
    }
  }

  /** 清除所有高亮 */
  function clearHighlights() {
    // 清除普通 DOM 中的高亮
    document.querySelectorAll(".bcs-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });

    // 清除 Shadow DOM 中的高亮
    const shadow = getShadowRoot();
    if (shadow) {
      const threads = shadow.querySelectorAll("bili-comment-thread-renderer");
      threads.forEach((thread) => {
        clearHighlightsInShadow(thread);
      });
    }
  }

  /** 递归清除 Shadow DOM 中的高亮 */
  function clearHighlightsInShadow(el) {
    if (!el || !el.shadowRoot) return;

    el.shadowRoot.querySelectorAll(".bcs-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    });

    // 递归处理子元素
    const children = el.shadowRoot.querySelectorAll("*");
    children.forEach((child) => {
      if (child.shadowRoot) {
        clearHighlightsInShadow(child);
      }
    });
  }

  /** 清除评论的匹配/隐藏状态 */
  function clearCommentStates() {
    document
      .querySelectorAll(".bcs-comment-hidden")
      .forEach((el) => el.classList.remove("bcs-comment-hidden"));
    document
      .querySelectorAll(".bcs-comment-matched")
      .forEach((el) => el.classList.remove("bcs-comment-matched"));
  }

  // ========== 错误提示 ==========
  function showError(msg) {
    const errorEl = document.getElementById("bcs-error");
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = "block";
    }
  }

  function hideError() {
    const errorEl = document.getElementById("bcs-error");
    if (errorEl) {
      errorEl.style.display = "none";
    }
  }

  // ========== 核心搜索逻辑 ==========
  function performSearch() {
    const keyword = currentKeyword.trim();

    // 清除之前的状态
    clearHighlights();
    clearCommentStates();
    matchedComments = [];
    isApiSearchMode = false; // 标记为 DOM 搜索模式

    if (!keyword) {
      updateStats(0, 0);
      renderResults();
      return;
    }

    const matcher = buildMatcher(keyword, isRegexMode);
    if (!matcher) {
      updateStats(0, 0);
      renderResults();
      return;
    }

    const highlighter = buildHighlighter(keyword, isRegexMode);
    const replyItems = getAllReplyItems();
    let matchCount = 0;
    let totalReplyCount = 0; // 回复总数

    console.log(`[B站评论搜索] 开始搜索: "${keyword}", 正则模式: ${isRegexMode}, 隐藏模式: ${isHideMode}`);
    console.log(`[B站评论搜索] 找到 ${replyItems.length} 条一级评论`);

    replyItems.forEach((item, index) => {
      const mainText = getTextFromReply(item, SELECTORS.replyContent);
      const userName = getUserName(item);
      const subReplies = getSubRepliesInfo(item);
      totalReplyCount += subReplies.length;

      let threadMatched = false;

      // 1. 检查主评论
      if (matcher(mainText)) {
        matchCount++;
        threadMatched = true;
        matchedComments.push({
          element: item,
          text: mainText,
          userName: userName,
          isReply: false,
        });
      }

      // 2. 逐条检查回复
      for (const reply of subReplies) {
        if (matcher(reply.text)) {
          matchCount++;
          threadMatched = true;
          matchedComments.push({
            element: item, // 跳转到所属 thread
            text: reply.text,
            userName: reply.userName || "回复",
            isReply: true,
            parentUser: userName,
          });
        }
      }

      // 3. 保底：上面都没匹配时，用深度遍历整个 thread
      if (!threadMatched) {
        const deepText = deepGetAllText(item);
        if (matcher(deepText)) {
          matchCount++;
          threadMatched = true;
          matchedComments.push({
            element: item,
            text: deepText.substring(0, 300),
            userName: userName,
            isReply: false,
          });
        }
      }

      if (threadMatched) {
        item.classList.add("bcs-comment-matched");

        // 高亮
        if (highlighter) {
          highlightElement(item, new RegExp(highlighter.source, "gi"));
          if (item.shadowRoot) {
            const repliesRenderer = item.shadowRoot.querySelector(
              "bili-comment-replies-renderer"
            );
            if (repliesRenderer) {
              deepHighlight(repliesRenderer, new RegExp(highlighter.source, "gi"));
            }
          }
        }
      } else if (isHideMode) {
        item.classList.add("bcs-comment-hidden");
      }
    });

    const totalCount = replyItems.length + totalReplyCount;
    console.log(`[B站评论搜索] 匹配结果: ${matchCount}/${totalCount} (${replyItems.length}条评论 + ${totalReplyCount}条回复)`);
    updateStats(matchCount, totalCount);
    renderResults();
  }

  /** 更新统计信息 */
  function updateStats(matched, total) {
    const statsEl = document.getElementById("bcs-stats");
    if (statsEl) {
      if (!currentKeyword.trim()) {
        statsEl.textContent = "";
      } else {
        statsEl.textContent = `找到 ${matched} 条匹配 (共 ${total} 条评论+回复)`;
      }
    }
  }

  /** 渲染搜索结果列表 */
  function renderResults() {
    const resultsEl = document.getElementById("bcs-results");
    if (!resultsEl) return;

    // 如果是 API 搜索模式，使用 API 渲染函数
    if (isApiSearchMode) {
      renderApiResults();
      return;
    }

    if (matchedComments.length === 0 || !currentKeyword.trim()) {
      resultsEl.classList.remove("show");
      resultsEl.innerHTML = "";
      return;
    }

    resultsEl.classList.add("show");

    const highlighter = buildHighlighter(currentKeyword, isRegexMode);

    const html = matchedComments
      .map((comment, index) => {
        let displayText = (comment.text || '').substring(0, 150);
        if ((comment.text || '').length > 150) displayText += "...";

        // 高亮关键词
        if (highlighter) {
          highlighter.lastIndex = 0;
          displayText = displayText.replace(
            highlighter,
            '<span class="bcs-highlight">$1</span>'
          );
        }

        // 回复标记：显示 "回复者 → 主评论者"
        const replyTag = comment.isReply
          ? ` <span class="bcs-reply-tag">回复 ${comment.parentUser || ''}</span>`
          : '';

        return `
        <div class="bcs-result-item" data-index="${index}">
          <div class="bcs-result-user">${comment.userName || '匿名用户'}${replyTag}</div>
          <div class="bcs-result-text">${displayText}</div>
        </div>
      `;
      })
      .join("");

    resultsEl.innerHTML = html;

    // 绑定点击事件
    resultsEl.querySelectorAll(".bcs-result-item").forEach((item) => {
      item.addEventListener("click", () => {
        const index = parseInt(item.dataset.index);
        const comment = matchedComments[index];
        if (comment && comment.element) {
          // 滚动到评论位置
          comment.element.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          // 临时高亮动画
          comment.element.style.transition = "background 0.3s";
          comment.element.style.background = "#e6f7ff";
          setTimeout(() => {
            comment.element.style.background = "";
          }, 1000);
        }
      });
    });
  }

  // ========== UI 创建 ==========
  function createSearchBar() {
    if (document.getElementById("bcs-search-bar")) return;

    const bar = document.createElement("div");
    bar.id = "bcs-search-bar";

    bar.innerHTML = `
      <div id="bcs-controls">
        <input
          id="bcs-search-input"
          type="text"
          placeholder="搜索评论关键词..."
          autocomplete="off"
        />
        <button class="bcs-btn bcs-btn-primary" id="bcs-btn-apiload" title="通过API快速获取所有评论（推荐，速度快）">
          API加载
        </button>
        <button class="bcs-btn" id="bcs-btn-apiload-replies" title="通过API获取所有评论和折叠回复（较慢但更完整）">
          含回复
        </button>
        <button class="bcs-btn" id="bcs-btn-scroll" title="自动滚动加载页面评论">
          滚动加载
        </button>
        <button class="bcs-btn" id="bcs-btn-expand" title="一键展开所有折叠的回复评论">
          展开全部
        </button>
        <div class="bcs-speed-control" title="调节滚动间隔时间">
          <span class="bcs-speed-label">速度:</span>
          <input type="range" id="bcs-speed-slider" min="100" max="800" step="50" value="300" />
          <span id="bcs-speed-value">300ms</span>
        </div>
        <button class="bcs-btn" id="bcs-btn-regex" title="正则表达式模式：支持高级搜索语法">
          正则
        </button>
        <button class="bcs-btn" id="bcs-btn-hide" title="隐藏不匹配的评论">
          仅匹配
        </button>
        <button class="bcs-btn" id="bcs-btn-clear" title="清除搜索">
          清除
        </button>
        <button class="bcs-btn bcs-btn-primary" id="bcs-btn-wordfreq" title="对已加载的评论进行词频分析、情感分析和可视化">
          词频分析
        </button>
        <span id="bcs-stats"></span>
      </div>
      <div id="bcs-error"></div>
      <div id="bcs-results"></div>
    `;

    searchBar = bar;
    return bar;
  }

  /** 将搜索栏插入到评论区上方 */
  function insertSearchBar() {
    if (document.getElementById("bcs-search-bar")) {
      console.log("[B站评论搜索] 搜索栏已存在");
      return;
    }

    // 如果使用 Shadow DOM，插入到外层容器
    const component = document.querySelector(SELECTORS.commentComponent);
    if (component) {
      console.log("[B站评论搜索] 找到评论组件，插入搜索栏到其上方");
      const bar = createSearchBar();
      component.parentElement.insertBefore(bar, component);
      bindSearchBarEvents();
      return;
    }

    // 回退：插入到普通 DOM
    const commentRoot = getCommentRoot();
    if (!commentRoot) {
      console.log("[B站评论搜索] 未找到评论区根元素");
      return;
    }

    console.log("[B站评论搜索] 找到评论区，插入搜索栏", commentRoot);
    const bar = createSearchBar();
    commentRoot.insertBefore(bar, commentRoot.firstChild);
    bindSearchBarEvents();
  }

  /** 绑定搜索栏事件 */
  function bindSearchBarEvents() {

    // 绑定事件
    const input = document.getElementById("bcs-search-input");
    const btnApiLoad = document.getElementById("bcs-btn-apiload");
    const btnApiLoadReplies = document.getElementById("bcs-btn-apiload-replies");
    const btnScroll = document.getElementById("bcs-btn-scroll");
    const btnExpand = document.getElementById("bcs-btn-expand");
    const speedSlider = document.getElementById("bcs-speed-slider");
    const speedValue = document.getElementById("bcs-speed-value");
    const btnRegex = document.getElementById("bcs-btn-regex");
    const btnHide = document.getElementById("bcs-btn-hide");
    const btnClear = document.getElementById("bcs-btn-clear");

    // 输入搜索（防抖）
    let debounceTimer = null;
    input.addEventListener("input", () => {
      currentKeyword = input.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // 如果已有 API 数据，在 API 数据中搜索
        if (apiComments.length > 0) {
          performApiSearch();
        } else {
          performSearch();
        }
      }, 300);
    });

    // Enter 键立即搜索
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        currentKeyword = input.value;
        clearTimeout(debounceTimer);
        if (apiComments.length > 0) {
          performApiSearch();
        } else {
          performSearch();
        }
      }
    });

    // API 加载按钮（不含回复）
    btnApiLoad.addEventListener("click", () => {
      startApiLoad({ fetchReplies: false });
    });

    // API 加载按钮（含回复）
    btnApiLoadReplies.addEventListener("click", () => {
      startApiLoad({ fetchReplies: true });
    });

    // 滚动加载按钮
    btnScroll.addEventListener("click", () => {
      startAutoLoad();
    });

    // 展开全部按钮
    btnExpand.addEventListener("click", () => {
      expandAllReplies();
    });

    // 速度滑块
    speedSlider.addEventListener("input", () => {
      loadSpeed = parseInt(speedSlider.value);
      speedValue.textContent = loadSpeed + "ms";
    });

    // 正则模式切换
    btnRegex.addEventListener("click", () => {
      isRegexMode = !isRegexMode;
      btnRegex.classList.toggle("active", isRegexMode);
      performSearch();
    });

    // 隐藏模式切换
    btnHide.addEventListener("click", () => {
      isHideMode = !isHideMode;
      btnHide.classList.toggle("active", isHideMode);
      performSearch();
    });

    // 清除
    btnClear.addEventListener("click", () => {
      input.value = "";
      currentKeyword = "";
      matchedComments = [];
      clearHighlights();
      clearCommentStates();
      updateStats(0, 0);
      renderResults();
      hideError();
    });

    // 词频分析
    const btnWordFreq = document.getElementById("bcs-btn-wordfreq");
    btnWordFreq.addEventListener("click", () => {
      if (apiComments.length === 0) {
        const errEl = document.getElementById("bcs-error");
        if (errEl) {
          errEl.textContent = "请先通过 API 加载评论后再进行词频分析";
          errEl.style.display = "block";
          setTimeout(() => { errEl.style.display = "none"; }, 3000);
        }
        return;
      }
      if (window.BcsWordFreq) {
        window.BcsWordFreq.createPanel();
      }
    });
  }

  // ========== MutationObserver 监听动态加载 ==========
  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      let hasNewComments = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            // 检查是否是评论区出现了
            if (!document.getElementById("bcs-search-bar")) {
              const commentRoot = getCommentRoot();
              if (commentRoot) {
                insertSearchBar();
              }
            }

            // 检查是否有新评论加载
            for (const sel of SELECTORS.replyItem) {
              if (node.matches?.(sel) || node.querySelector?.(sel)) {
                hasNewComments = true;
                break;
              }
            }
          }
        }
      }

      // 如果有新评论且当前有搜索词，重新搜索
      if (hasNewComments && currentKeyword.trim()) {
        performSearch();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ========== 返回顶部按钮 ==========
  function createBackTopButton() {
    if (document.getElementById("bcs-btn-backtop")) return;

    const btn = document.createElement("button");
    btn.id = "bcs-btn-backtop";
    btn.innerHTML = "↑";
    btn.title = "返回顶部";
    document.body.appendChild(btn);

    // 点击返回顶部
    btn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });

    // 监听滚动显示/隐藏按钮
    let scrollTimeout;
    window.addEventListener("scroll", () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        if (window.scrollY > 500) {
          btn.classList.add("show");
        } else {
          btn.classList.remove("show");
        }
      }, 100);
    });
  }

  // ========== 视频切换检测（SPA 导航） ==========
  let lastVideoUrl = location.href;

  function getVideoId() {
    // 复用 getCurrentVideoId 的逻辑
    return getCurrentVideoId() || location.pathname;
  }

  function resetForNewVideo(oldVideoId) {
    console.log("[B站评论搜索] 检测到视频切换，重置所有状态");

    // 先保存旧视频的数据到缓存
    saveCurrentVideoData(oldVideoId);

    // 重置搜索状态
    apiComments = [];
    matchedComments = [];
    currentKeyword = "";
    isApiSearchMode = false;
    isFetchingApi = false;

    // 清除搜索UI
    const input = document.getElementById("bcs-search-input");
    if (input) input.value = "";
    const statsEl = document.getElementById("bcs-stats");
    if (statsEl) statsEl.textContent = "";
    const resultsEl = document.getElementById("bcs-results");
    if (resultsEl) { resultsEl.innerHTML = ""; resultsEl.classList.remove("show"); }
    const errEl = document.getElementById("bcs-error");
    if (errEl) errEl.style.display = "none";

    clearHighlights();
    clearCommentStates();

    // 轻量重置词频状态（不删除面板 DOM，由 restoreVideoData 决定是否重建）
    const S = window._BcsWF;
    if (S) {
      S.analysisCache = null;
      S.aiSentimentCache = new Map();
      S.isAiAnalyzing = false;
      S.useAiSentiment = false;
      S.currentSelectedWord = null;
      S.currentChartType = "bar";
      if (S.barChart) { S.barChart.dispose(); S.barChart = null; }
      if (S.cloudChart) { S.cloudChart.dispose(); S.cloudChart = null; }
    }
    // 移除面板（restoreVideoData 会按需重建）
    const panel = document.getElementById("bcs-wordfreq-panel");
    if (panel) panel.remove();

    lastVideoUrl = location.href;

    // 尝试恢复新视频的缓存数据
    const newVideoId = getCurrentVideoId();
    if (newVideoId) {
      restoreVideoData(newVideoId);
    }
  }

  function checkUrlChange() {
    if (location.href !== lastVideoUrl) {
      // 从旧 URL 提取视频 ID（用于保存缓存）
      const oldVideoId = extractVideoId(lastVideoUrl);
      lastVideoUrl = location.href; // 先更新，避免重复触发
      // 延迟检测，等新页面 DOM 稳定
      setTimeout(() => {
        resetForNewVideo(oldVideoId);
      }, 300);
    }
  }

  // 拦截 pushState / replaceState
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    checkUrlChange();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    checkUrlChange();
  };
  window.addEventListener("popstate", checkUrlChange);

  // 兜底：定时检测（某些情况 pushState 可能未被拦截）
  setInterval(checkUrlChange, 1500);

  // 页面离开前保存当前数据
  window.addEventListener("beforeunload", () => {
    saveCurrentVideoData();
  });

  // ========== 初始化 ==========
  function init() {
    // 尝试插入搜索栏
    insertSearchBar();

    // 创建返回顶部按钮
    createBackTopButton();

    // 启动 MutationObserver 监听评论区动态加载
    startObserver();

    // 记录初始 URL
    lastVideoUrl = location.href;

    // 尝试从缓存恢复当前视频数据
    const currentVid = getCurrentVideoId();
    if (currentVid) {
      const restored = restoreVideoData(currentVid);
      if (restored) {
        console.log("[B站评论搜索] 初始化时从缓存恢复了数据");
      }
    }
  }

  // 页面加载完成后初始化
  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
