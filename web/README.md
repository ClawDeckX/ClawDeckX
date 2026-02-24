# ClawDeckX Web UI

ClawDeckX 的 Web 前端界面，基于 React + TypeScript + TailwindCSS 构建。

## 技术栈

- **框架**: React 18 + TypeScript
- **构建工具**: Vite
- **样式**: TailwindCSS v4
- **图标**: Google Material Symbols Outlined

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 项目结构

```
web/
├── components/     # 共享组件
├── windows/        # 页面组件 (React.lazy 按需加载)
├── services/       # API 封装
├── hooks/          # 自定义 Hooks
├── locales/        # 多语言翻译 (zh/en)
├── data/           # 静态数据
├── App.tsx         # 应用入口
└── index.tsx       # 渲染入口
```

## 构建输出

构建产物输出到 `../internal/web/dist/`，由 Go 后端通过 `go:embed` 嵌入二进制文件。

## 注意事项

- 所有 UI 文本必须通过 `locales/` 配置，禁止硬编码中文/英文
- 使用 `dark:` 前缀支持暗色主题
- 使用响应式类 (sm/md/lg/xl) 适配不同屏幕
