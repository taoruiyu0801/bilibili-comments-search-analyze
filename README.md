# Bilibili 评论搜索 🔍

> 一款强大的 B 站评论区搜索与分析 Chrome 扩展，支持关键词搜索、正则表达式、词频分析、情感分析和 AI 分析。

<p align="center">
  <img src="screenshots/demo.png" alt="功能演示" width="700">
</p>

## ✨ 功能特性

### 🔍 评论搜索
- **API 批量加载**：通过 B 站 API 一键加载视频全部评论（含回复）
- **关键词搜索**：在已加载的评论中实时搜索，支持高亮显示
- **正则表达式**：支持正则模式，满足复杂搜索需求
- **评论定位**：点击搜索结果自动滚动到对应评论

### 📊 词频分析
- **中文分词**：基于 Jieba (WASM) 的高性能中文分词
- **自定义词典**：支持自定义词典扩展分词能力
- **柱状图**：Top-N 高频词可视化，支持情感分布堆叠
- **词云**：交互式词云，支持缩放和拖动
- **排除词管理**：灵活添加/移除排除词

### 🎭 情感分析
- **词典模式**：内置正面/负面情感词典 + B 站网络用语 + Emoji 映射
- **否定词/程度词**：支持否定词反转和程度副词加权
- **AI 模式**：集成 DeepSeek API，80条/批 × 5路并发的高速 AI 情感分析
- **情感总结**：AI 生成评论区整体情感摘要

### 💾 智能缓存
- **跨导航缓存**：切换视频后再返回，评论和分析结果自动恢复
- **刷新保留**：页面刷新后数据不丢失（sessionStorage 持久化）
- **LRU 淘汰**：最多缓存 5 个视频，自动淘汰最旧数据

## 📦 安装

### 从源码安装（开发者模式）

1. **下载项目**
   ```bash
   git clone https://github.com/YOUR_USERNAME/bilibili-comment-search.git
   ```

2. **打开 Chrome 扩展管理页**
   - 地址栏输入 `chrome://extensions/`
   - 打开右上角「开发者模式」

3. **加载扩展**
   - 点击「加载已解压的扩展程序」
   - 选择项目文件夹

4. **开始使用**
   - 打开任意 B 站视频页面
   - 评论区会出现搜索栏和工具按钮

## 🚀 使用指南

### 基本搜索
1. 打开 B 站视频页面，搜索栏会自动出现在评论区上方
2. 点击 **「API 加载评论」** 批量获取所有评论
3. 在搜索框输入关键词，实时筛选匹配评论
4. 点击搜索结果可跳转到对应评论位置

### 词频分析
1. API 加载评论后，点击 **「词频分析」** 按钮
2. 查看高频词柱状图，切换词云视图
3. 点击柱状图中的词条查看包含该词的评论
4. 调整 Top-N 和最低频次参数，添加排除词

### AI 情感分析
1. 点击 **⚙️** 按钮设置 DeepSeek API Key
   - 获取方式：[platform.deepseek.com](https://platform.deepseek.com/api_keys)
2. 完成词频分析后，点击 **🤖 AI分析** 按钮
3. 等待分析完成，图表自动切换为 AI 情感模式
4. 可点击 **📝 情感总结** 获取 AI 生成的评论区总结

## 📁 项目结构

```
bilibili-comment-search/
├── manifest.json          # 扩展配置文件 (Manifest V3)
├── content.js             # 主内容脚本：搜索、API加载、缓存
├── content.css            # 搜索栏样式
├── wordfreq-data.js       # 数据加载与分词模块
├── wordfreq-sentiment.js  # 情感词典与词典分析模块
├── wordfreq-ai.js         # DeepSeek AI 情感分析模块
├── wordfreq-charts.js     # 图表渲染与交互模块
├── wordfreq.js            # 词频分析主入口
├── wordfreq.css           # 词频分析面板样式
├── icon48.png             # 扩展图标 48x48
├── icon128.png            # 扩展图标 128x128
├── data/
│   ├── stopwords.json     # 停用词表
│   ├── positive.json      # 正面情感词典
│   ├── negative.json      # 负面情感词典
│   └── custom_dict.txt    # Jieba 自定义词典
└── lib/
    ├── echarts.min.js     # ECharts 可视化库
    ├── echarts-wordcloud.min.js  # ECharts 词云插件
    ├── jieba_rs_wasm.js   # Jieba 分词 (WASM)
    ├── jieba-loader.js    # Jieba 加载器
    └── jieba_rs_wasm_bg.wasm  # Jieba WASM 二进制
```

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| **Chrome Extension Manifest V3** | 扩展框架 |
| **Jieba (jieba_rs_wasm)** | 中文分词 |
| **ECharts** | 柱状图、词云可视化 |
| **DeepSeek API** | AI 情感分析 |
| **sessionStorage** | 跨导航数据缓存 |

## ⚙️ 自定义配置

### 自定义停用词
编辑 `data/stopwords.json`，添加需要过滤的词汇。

### 自定义情感词典
- `data/positive.json`：正面情感词数组
- `data/negative.json`：负面情感词数组

### 自定义分词词典
编辑 `data/custom_dict.txt`，格式为每行一个词条：
```
词语 词频 词性
```

## 📝 更新日志

### v1.1.0
- ✅ 模块化重构：拆分为 5 个独立模块
- ✅ 集成 DeepSeek AI 情感分析（批量并发）
- ✅ AI 情感总结功能
- ✅ sessionStorage 缓存持久化
- ✅ 视频切换自动检测与数据缓存/恢复
- ✅ B 站网络用语和 Emoji 情感识别

### v1.0.0
- 🎉 初始版本
- 评论区关键词搜索与高亮
- API 批量加载评论
- 词频分析与词云

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request
