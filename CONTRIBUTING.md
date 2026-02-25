# 开发贡献指南

## 🌳 分支策略

### 分支说明
- **main**: 生产分支，始终保持稳定可发布状态
- **develop**: 开发主分支，日常开发在此进行
- **feature/***: 功能分支，开发新功能时使用
- **hotfix/***: 紧急修复分支，修复生产环境问题

### 分支命名规范
```
feature/功能名称-简短描述
hotfix/bug名称-简短描述

示例:
feature/github-mirror-support
feature/smart-link-component
hotfix/npm-registry-timeout
```

## 🔄 开发流程

### 1. 开发新功能

```bash
# 1. 确保 develop 分支是最新的
git checkout develop
git pull origin develop

# 2. 创建功能分支
git checkout -b feature/your-feature-name

# 3. 开发并提交代码
git add .
git commit -m "feat: add your feature"

# 4. 推送到远程
git push -u origin feature/your-feature-name

# 5. 在 GitHub 上创建 Pull Request
# 目标分支: develop
# 标题: feat: your feature description
# 描述: 详细说明功能、测试情况等

# 6. 合并后删除分支
git checkout develop
git pull origin develop
git branch -d feature/your-feature-name
```

### 2. 修复 Bug

```bash
# 紧急修复从 main 分支创建
git checkout main
git checkout -b hotfix/bug-description

# 普通 bug 从 develop 创建
git checkout develop
git checkout -b feature/fix-bug-description

# 修复、提交、推送流程同上
```

### 3. 发布版本

```bash
# 1. 从 develop 创建 release 分支
git checkout develop
git checkout -b release/v0.1.0

# 2. 更新版本号和 CHANGELOG
# 修改 build.txt, CHANGELOG.md

# 3. 提交版本更新
git commit -m "chore: bump version to v0.1.0"

# 4. 合并到 main 并打 tag
git checkout main
git merge --no-ff release/v0.1.0
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin main --tags

# 5. 合并回 develop
git checkout develop
git merge --no-ff release/v0.1.0
git push origin develop

# 6. 删除 release 分支
git branch -d release/v0.1.0
```

## 📝 Commit 规范

### 格式
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型
- **feat**: 新功能
- **fix**: Bug 修复
- **docs**: 文档更新
- **style**: 代码格式（不影响功能）
- **refactor**: 重构
- **perf**: 性能优化
- **test**: 测试相关
- **chore**: 构建/工具链
- **ci**: CI/CD 配置

### 示例
```bash
# 好的提交
git commit -m "feat(netutil): add GitHub mirror selection"
git commit -m "fix(updater): handle API rate limit"
git commit -m "docs: update development guide"

# 不好的提交 ❌
git commit -m "update"
git commit -m "fix bug"
git commit -m "changes"
```

## 🏷️ 版本号规范

遵循语义化版本 (Semantic Versioning): `v主版本.次版本.修订号`

```
v1.2.3
│ │ │
│ │ └─ PATCH: Bug 修复
│ └─── MINOR: 新功能（向后兼容）
└───── MAJOR: 破坏性变更
```

### 版本升级规则
- 破坏性变更: `v1.0.0` → `v2.0.0`
- 新功能: `v1.0.0` → `v1.1.0`
- Bug 修复: `v1.0.0` → `v1.0.1`
- 开发阶段: `v0.x.y`

## ✅ 提交前检查清单

### 每次提交前
- [ ] 代码已格式化 (`go fmt ./...`)
- [ ] 通过编译 (`go build ./...`)
- [ ] 前端构建成功 (`cd web && npm run build`)
- [ ] Commit 消息符合规范
- [ ] 无调试代码/console.log

### 每次发布前
- [ ] 更新版本号
- [ ] 更新 CHANGELOG.md
- [ ] 完整构建成功
- [ ] 创建 Git tag
- [ ] 创建 GitHub Release
- [ ] 上传构建产物

## 🛠️ 开发工具

### 推荐 Git 客户端
- **命令行**: Git Bash / PowerShell
- **GUI**: GitHub Desktop, GitKraken

### 代码质量
```bash
# Go 代码格式化
go fmt ./...

# Go 代码检查
go vet ./...

# 前端构建
cd web
npm run build
```

## 📚 参考资源

- [Git Flow 工作流](https://nvie.com/posts/a-successful-git-branching-model/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
