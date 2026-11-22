# 研数 · 考研数学二智能练习助手

面向考研数学二的本地优先练习应用：真题组卷、AI 仿真题、错题本、错题变式练习、学习数据中心、我的试卷和 PDF 导出。

## 技术栈

- 前端：React 19 + Vite + TypeScript + KaTeX
- 本地后端：Node.js HTTP Server
- 数据库：PostgreSQL 16（本地 Docker）或 SQLite（无数据库配置时的回退）
- AI：OpenAI 兼容的 `/chat/completions` 接口
- PDF：浏览器端 html2canvas + jsPDF
- 数据管线：Python + PyMuPDF

## 环境要求

- Node.js 24+（推荐 24.22.x；前端要求 `^22.13.0 || >=24`）
- npm
- Docker Desktop（使用本地 PostgreSQL 时）
- Python 3.10+（仅重新运行数据管线时需要）
- Chrome 或 Edge（PDF 保存位置选择使用 File System Access API）

## 快速启动

### 1. 安装依赖

```bash
npm install --prefix web
npm install --prefix dev
```

`web` 是前端，`dev` 是本地持久化依赖（PostgreSQL 驱动）。

### 2. 准备本地 PostgreSQL

项目使用独立的 `kaoyan-postgres` 容器，端口 `5433`，不会影响本机已有的 PostgreSQL。

首次创建：

```bash
docker run -d --name kaoyan-postgres \
  -e POSTGRES_USER=kaoyan \
  -e POSTGRES_PASSWORD=kaoyan_dev_2026 \
  -e POSTGRES_DB=kaoyan \
  -p 127.0.0.1:5433:5432 \
  -v kaoyan_pgdata:/var/lib/postgresql/data \
  --health-cmd "pg_isready -U kaoyan -d kaoyan" \
  --health-interval 5s --health-timeout 3s --health-retries 10 \
  postgres:16-alpine
```

之后启动：

```bash
docker start kaoyan-postgres
```

确认状态：

```bash
docker ps --filter name=kaoyan-postgres
```

### 3. 配置环境变量

在项目根目录创建 `.env.local`（该文件已被 git 忽略）：

```dotenv
LOCAL_DATABASE_URL=postgres://kaoyan:kaoyan_dev_2026@127.0.0.1:5433/kaoyan

# 可选的服务端默认模型，数据管线也使用这三项
KAOYAN_LLM_BASE_URL=http://127.0.0.1:3425/v1
KAOYAN_LLM_API_KEY=your-key
KAOYAN_LLM_MODEL=your-model
```

说明：

- `LOCAL_DATABASE_URL` 存在时使用 PostgreSQL，不存在时回退到 `data/kaoyan.db`（SQLite）。
- 数据库表由后端启动时自动创建，无需手动执行 SQL。
- 同时设置三项 `KAOYAN_LLM_*` 后，未自配模型的访客可直接使用 AI 功能。右上角「模型设置」中保存的设备配置优先。线上部署时由后端服务注入这三项。

### 4. 启动后端

在第一个终端运行：

```bash
node dev/local.mjs
```

健康检查：

```text
http://127.0.0.1:8000/functions/v1/app/api/health
```

### 5. 启动前端

在第二个终端运行：

```bash
npm run dev --prefix web
```

打开：

```text
http://127.0.0.1:5173/
```

前端开发服务器会把 `/functions/v1/app` 代理到 `http://127.0.0.1:8000`。

### 6. 配置模型

服务端设置默认模型后，访客可直接使用。

自配模型时，在应用右上角「模型设置」填写：

- Base URL：OpenAI 兼容地址，例如 `https://api.openai.com/v1`
- API Key
- 模型名

点击「保存并测试」。只有服务端真实调用成功后才保存；Key 保存在服务端，浏览器只显示末四位掩码。

进入「学习助手」后先填写学习档案和偏好，再用自然语言提出目标。助手会读取当前设备的错题、试卷、知识树和复习状态；涉及生成练习卷、变式题或保存计划时，会先给出方案，用户确认后才执行。

学习档案分为两类：用户明确填写的档案是事实，Agent 自己总结的内容是推断，二者分开存储和注入。上下文窗口按当前模型动态计算，长期对话会压缩为可恢复的任务摘要。

## 主要功能

- 真题：2005–2026 年数学二共 501 题
- 每日一题：根据到期复习、薄弱知识点和近期作答稳定推送一道题，提交后可请求 AI 个性化讲解与追问
- 组卷：整卷模考 / 专项突破，按题型设置数量，最多 30 题
- AI 仿真：异步生成、格式校验、盲解自测、组装试卷
- 混合卷：真题与 AI 题各半，奇数时真题多 1 道
- 学习助手：独立 Agent 页面，读取用户档案/偏好/历史数据，通过工具查询错题、试卷和知识树，可生成计划、练习卷与错题仿真
- 错题本：完整选项、正确答案、解析、仿真练习掌握率
- 错题仿真：勾选错题，每题生成 3–10 道同考点变式题
- 我的试卷：待完成 / 已交卷记录、继续作答、查看解析
- 数据中心：组卷统计、近期组卷公开预览、作答趋势
- PDF：未交卷直接保存空白卷；已交卷可选带作答与解析或空白卷，保存窗口默认从桌面开始

## 测试与构建

后端契约测试：

```bash
node --test tests/p1-contract.test.mjs
```

数据管线测试：

```bash
python -m unittest discover -s pipeline/tests -v
```

前端构建：

```bash
npm run build --prefix web
```

构建输出在 `web/dist/`。

## 目录结构

```text
contracts/          API、题目、状态机和数据库契约
dev/                本地 Node 后端入口、PostgreSQL/SQLite 持久化
docs/               产品方案、开发计划和数据进度
functions/          路由、组卷、判卷、AI 生成、Agent、题目数据
pipeline/           真题 PDF 抽取、切分、LaTeX 重建、解析生成
tests/              应用契约测试
web/                React 前端
数学二/             真题 PDF 原始资料（因版权和体积不纳入 Git）
data/               本地数据库文件（不纳入 Git）
```

## 数据说明

- 应用运行所需的 501 道题和知识树已导出到 `functions/real-data.mjs`，克隆仓库后无需原始 PDF 即可启动。
- `数学二/` 中的真题 PDF 不随仓库分发。
- 数据管线产物在 `pipeline/output/`，同样不纳入 Git。

## 部署说明

当前推荐架构：

```text
Qoder Sites 静态前端
        ↓ HTTPS
自有 API 网关（Caddy/Nginx）
        ↓
Node 后端 + PostgreSQL
        ↓
用户配置的 OpenAI 兼容模型服务
```

Qoder Sites 免费版只支持静态部署；Sites 云数据库和 Functions 需要付费后端额度。当前本地版本使用独立 PostgreSQL 容器，公网部署时请更换数据库密码、配置 HTTPS/CORS，并不要把模型 Key 或 `.env.local` 提交到仓库。
