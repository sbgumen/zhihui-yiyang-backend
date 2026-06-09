# 智绘颐养 后端架构文档

> 面向开发者：项目概述、目录结构、每个文件的作用详解

---

## 项目简介

**智绘颐养后端** 是智慧养老服务平台的 API 服务层，基于 Node.js + Express 4 构建，提供 RESTful API。服务运行在 **4001 端口**，使用 MySQL 8 数据库，JWT 认证，bcrypt 密码加密。

### 核心功能

- **用户认证系统**：手机验证码登录/注册、账号密码登录、JWT Token 管理
- **用户管理**：资料查询与修改、密码修改
- **钱包系统**：余额充值、消费扣款、退款
- **订单系统**：创建订单（即时扣款）、订单查询、确认收货、取消退款
- **网易云音乐代理**：歌曲搜索、音频流代理、歌词获取、二维码登录、歌单同步
- **安全机制**：HMAC-SHA256 签名验证、IP 限流、JWT 鉴权

---

## 目录结构总览

```
zhihui-yiyang-后端/
├── server.js                    # 应用入口
├── package.json                 # 依赖与脚本
├── .gitignore                   # Git 忽略规则
├── .env                         # 环境变量（不提交 Git）
├── .env.example                 # 环境变量模板
├── README.md                    # 项目说明
│
├── config/
│   └── db.js                    # MySQL 连接池配置
│
├── middleware/
│   └── auth.js                  # JWT 认证中间件
│
└── routes/
    ├── auth.js                  # 认证路由
    ├── user.js                  # 用户路由
    ├── order.js                 # 订单路由
    └── music.js                 # 网易云音乐代理路由
```

---

## 文件详解

### 根目录

#### `server.js`
**应用入口文件**，负责整个服务的启动流程：

1. **加载环境变量**：`require('dotenv').config()` 读取 `.env` 文件
2. **创建 Express 应用**：初始化 HTTP 服务器
3. **注册中间件**：
   - `cors()` — 全局跨域资源共享
   - `express.json()` — JSON 请求体解析
4. **挂载路由**：
   - `/api/auth` → `routes/auth.js`
   - `/api/user` → `routes/user.js`
   - `/api/order` → `routes/order.js`
   - `/api/music` → `routes/music.js`
5. **健康检查**：`GET /api/health` 返回服务运行状态
6. **数据库初始化**（`initDatabase` 函数）：
   - 自动创建 `users` 表（如不存在）
   - 执行向后兼容列迁移（为旧表添加 `user_id`、`phone` 等新列）
   - 为旧用户补充 `user_id`（5 位随机数字）
   - 自动创建 `sms_codes` 表
   - 自动创建 `orders` 表
   - 初始化失败则退出进程（`process.exit(1)`）
7. **启动监听**：数据库初始化成功后，监听 `0.0.0.0:4001`

#### `package.json`
项目配置：
- **scripts**: `start` 和 `dev` 均执行 `node server.js`
- **dependencies**:
  - `express` — HTTP 框架
  - `mysql2` — MySQL 连接池（promise 模式）
  - `jsonwebtoken` — JWT 签发与验证（30 天有效期）
  - `bcrypt` — 密码哈希
  - `cors` — 跨域资源共享
  - `dotenv` — 环境变量加载
  - `NeteaseCloudMusicApi` — 网易云音乐 API 封装库
  - `qrcode` — 二维码图片生成

---

### `config/` — 配置

#### `config/db.js`
MySQL 连接池配置：

```js
const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  user:     process.env.DB_USER || 'zhjy',
  password: process.env.DB_PASSWORD || '123456lzx',
  database: process.env.DB_NAME || 'zhjy',
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
})
```

- 使用 `mysql2/promise` 模式，所有查询返回 Promise
- 连接池最大连接数 10，支持排队等待
- 配置项均支持环境变量覆盖，无环境变量时使用默认值
- 导出 `pool` 供所有路由文件共享使用

---

### `middleware/` — 中间件

#### `middleware/auth.js`
JWT 认证中间件，导出两个值：

**`JWT_SECRET`**：
- JWT 签名密钥
- 从 `process.env.JWT_SECRET` 读取，默认值用于开发
- 同时被 `routes/auth.js` 引入用于签发 Token

**`authMiddleware(req, res, next)`**：
- 从 `Authorization` Header 提取 Bearer Token
- 使用 `jwt.verify()` 验证 Token 有效性
- 验证成功：将 `{ id, user_id }` 挂载到 `req.user`，调用 `next()`
- 验证失败：返回 401 `{ code: 401, message: '登录已过期，请重新登录' }`
- 无 Token：返回 401 `{ code: 401, message: '未登录' }`

---

### `routes/` — 路由

#### `routes/auth.js`
**认证路由** (`/api/auth`)，处理所有登录注册相关请求：

**依赖**：`bcrypt`、`jsonwebtoken`、`crypto`、数据库连接池、JWT 中间件

**`API_SIGN_KEY`**：
- SMS 接口 HMAC-SHA256 签名密钥
- 从 `process.env.API_SIGN_KEY` 读取，默认值用于开发

**IP 限流机制**：
- 实现：内存 `Map<IP, [{ timestamp }]>` 滑动窗口
- 限制：每 IP 每 60 秒最多 5 次请求
- 清理：每 5 分钟清理过期记录（定时器）

**接口列表**：

| 端点 | 鉴权 | 功能 |
|------|------|------|
| `POST /send-sms` | HMAC 签名 + IP 限流 | 发送 6 位短信验证码到手机 |
| `POST /phone-login` | 无 | 手机号 + 验证码登录（自动注册） |
| `POST /login` | 无 | 账号/手机号/用户ID + 密码登录 |
| `POST /register` | 无 | 传统账号密码注册 |
| `POST /set-password` | JWT | 设置/修改密码 |

**SMS 发送流程**：
1. 验证 HMAC 签名（`_t` 时间戳 + `_sign` 签名）
2. 检查 IP 限流（60 秒窗口内 ≤ 5 次）
3. 检查手机号冷却（同一号码 60 秒内不可重发）
4. 生成 6 位随机数字验证码
5. 存入 `sms_codes` 表（5 分钟有效期）
6. 调用 spug.cc 推送 API 发送短信

**phone-login 流程**：
1. 验证手机号和验证码（查 `sms_codes`，验证未使用 + 未过期）
2. 标记验证码已使用
3. 查询用户是否存在 → 不存在则自动注册（生成 5 位 `user_id`）
4. 签发 JWT Token（30 天有效期）
5. 返回 `{ token, user }`

**login 流程**：
1. 接收 `account` 和 `password`
2. `account` 同时匹配 `account`、`phone`、`user_id` 三个字段
3. bcrypt 验证密码
4. 签发 JWT Token，返回用户信息（含 `hasPassword` 布尔值）

**set-password 流程**：
1. JWT 验证用户身份
2. 若用户已有密码 → 需传入并验证 `oldPassword`
3. bcrypt 加密新密码 → 更新 `users` 表

---

#### `routes/user.js`
**用户路由** (`/api/user`)，处理用户资料和钱包操作：

**依赖**：`bcrypt`、数据库连接池、JWT 中间件

| 接口 | 鉴权 | 功能 |
|------|------|------|
| `GET /profile` | JWT | 获取当前用户完整资料 |
| `PUT /profile` | JWT | 更新昵称、性别、头像 |
| `POST /recharge` | JWT | 余额充值 |
| `POST /change-password` | JWT | 修改密码（需验证旧密码） |

**profile（GET）**：
- 查询 `users` 表中当前用户的所有字段
- 额外计算 `hasPassword` 布尔值（密码是否为 null）
- 手机号脱敏处理（`138****8000` 格式）

**profile（PUT）**：
- 仅允许更新 `nickname`、`gender`、`avatar` 三个字段
- 白名单过滤请求体中的字段

**recharge**：
- 校验 `amount > 0`
- `UPDATE users SET balance = balance + ?`
- 返回更新后的余额

**change-password**：
- 若用户已有密码 → 校验 `oldPassword`
- bcrypt 加密 `newPassword` → 更新数据库

---

#### `routes/order.js`
**订单路由** (`/api/order`)，处理订单生命周期：

**依赖**：数据库连接池、JWT 中间件

| 接口 | 鉴权 | 功能 |
|------|------|------|
| `POST /create` | JWT | 创建订单（即时扣款） |
| `GET /list` | JWT | 获取当前用户所有订单列表 |
| `POST /cancel` | JWT | 取消待确认订单（全额退款） |
| `POST /confirm` | JWT | 确认待确认订单 |

**create 流程**：
1. 接收 `items`（商品数组 JSON）和 `totalPrice`（总金额）
2. 查询用户余额 → 检查余额是否 ≥ totalPrice
3. 扣除余额：`UPDATE users SET balance = balance - totalPrice`
4. 生成订单号：`ORD` + 时间戳 + 4 位随机大写字母数字
5. 插入 `orders` 表（状态为 `pending`）
6. 返回 `{ orderNo, balance }`

**list 流程**：
- 查询当前用户所有订单（`WHERE user_id = ?`）
- 按 `created_at DESC` 排序
- 对每条订单的 `items` JSON 字符串进行 `JSON.parse()`

**cancel 流程**：
1. 检查订单状态为 `pending`
2. 更新状态为 `cancelled`
3. 全额退款：`UPDATE users SET balance = balance + totalPrice`

**confirm 流程**：
1. 检查订单状态为 `pending`
2. 更新状态为 `confirmed`

**订单状态流转**：
```
pending ──→ confirmed (确认收货)
pending ──→ cancelled (取消，自动退款)
```

---

#### `routes/music.js`
**网易云音乐代理路由** (`/api/music`)，将网易云音乐 API 封装为本地接口：

**依赖**：`NeteaseCloudMusicApi`（网易云音乐非官方 API 封装）、`qrcode`、`dotenv`

**核心机制**：
- **共享 Cookie**：整个服务实例共享一个网易云音乐会话
- **Cookie 持久化**：QR 登录成功后，自动将 Cookie 写入 `.env` 文件，重启不丢失
- **初始化**：启动时从 `.env` 的 `MUSIC_U_COOKIE` 读取 Cookie，设置到 `NeteaseCloudMusicApi` 的全局 cookie

| 接口 | 鉴权 | 功能 |
|------|------|------|
| `GET /login/qr/create` | 无 | 生成二维码 Key + Base64 图片 |
| `GET /login/qr/check?key=` | 无 | 轮询扫码状态 |
| `GET /login/status` | 无 | 获取当前登录状态 |
| `POST /login/logout` | 无 | 退出登录，清除 Cookie |
| `GET /search?keywords=&limit=30` | 无 | 搜索歌曲 |
| `GET /song/url?id=&level=standard` | 无 | 获取歌曲播放 URL |
| `GET /lyric?id=` | 无 | 获取歌词 |
| `GET /audio/:id` | 无 | 音频流代理 |
| `GET /image?url=` | 无 | 图片代理 |
| `GET /playlist?id=` | 无 | 获取歌单详情 |
| `GET /playlist/hot` | 无 | 热门歌单 Top 10 |
| `GET /song/detail?ids=` | 无 | 歌曲详情 |
| `GET /likelist` | 无 | 收藏歌单 |

**关键实现细节**：

**QR 登录流程**：
1. `GET /login/qr/create` → 调用 `neteaseCloudMusicApi.login_qr_key()` + `login_qr_create()` → 返回 QR Key 和 Base64 二维码
2. 用户扫描二维码
3. `GET /login/qr/check?key=xxx` → 轮询扫码状态（code 803 = 成功）
4. 成功后自动获取 Cookie → 写入内存 + 持久化到 `.env`

**音频流代理 (`/audio/:id`)**：
- 先调用 `song_url_v1()` 获取歌曲真实 URL
- 使用 `http.get()` 将音频流管道转发（pipe）到客户端
- 设置正确的 Content-Type、Content-Length、Accept-Ranges、Cache-Control 头
- 解决网易云音频文件直接访问受限的问题

**图片代理 (`/image`)**：
- 接收 `url` 查询参数（URL 编码）
- 获取并转发图片
- 设置 24 小时缓存

**搜索增强**：
- `GET /search` 执行后，自动用 `song/detail` 补充搜索结果中缺失的专辑封面 `picUrl`
- 确保每个搜索结果都有可显示的封面图

**歌词 (`/lyric`)**：
- 直接透传网易云歌词数据（含 LRC 格式）
- 前端负责解析和展示

---

## 数据库设计

### `users` 表

```sql
CREATE TABLE users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(10) UNIQUE,         -- 展示 ID（5 位数字）
  account    VARCHAR(50) UNIQUE,         -- 登录账号名
  phone      VARCHAR(20) UNIQUE,         -- 手机号
  password   VARCHAR(255) DEFAULT NULL,   -- bcrypt 哈希（NULL = 仅手机号登录）
  nickname   VARCHAR(50) DEFAULT '',      -- 昵称
  gender     ENUM('male','female','unknown') DEFAULT 'unknown',
  avatar     VARCHAR(500) DEFAULT '',     -- 头像 URL
  balance    DECIMAL(10,2) DEFAULT 0.00,  -- 钱包余额
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### `sms_codes` 表

```sql
CREATE TABLE sms_codes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  phone      VARCHAR(20) NOT NULL,
  code       VARCHAR(10) NOT NULL,       -- 6 位验证码
  expires_at BIGINT NOT NULL,            -- 过期时间（Unix 毫秒）
  used       TINYINT DEFAULT 0,          -- 0=未使用, 1=已使用
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### `orders` 表

```sql
CREATE TABLE orders (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  order_no    VARCHAR(50) UNIQUE NOT NULL,  -- 订单号
  user_id     INT NOT NULL,                  -- FK → users.id
  items       TEXT NOT NULL,                 -- JSON 商品列表
  total_price DECIMAL(10,2) NOT NULL,        -- 总金额
  status      ENUM('pending','confirmed','cancelled') DEFAULT 'pending',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 认证与安全

### JWT 认证

```
客户端                         服务端
  │                              │
  │  POST /api/auth/phone-login  │
  │──────────────────────────────>│ 验证手机号+验证码
  │                              │ 签发 JWT (payload: {id, user_id}, 30天)
  │  { token, user }             │
  │<──────────────────────────────│
  │                              │
  │  GET /api/user/profile       │
  │  Authorization: Bearer xxx   │
  │──────────────────────────────>│ authMiddleware 验证 Token
  │                              │ 解码 → req.user = {id, user_id}
  │  { user data }               │ 查询数据库 → 返回用户信息
  │<──────────────────────────────│
```

### SMS 签名

```
前端                              后端
 │                                │
 │  生成 _t = Date.now()          │
 │  _sign = HMAC-SHA256(          │
 │    API_SIGN_KEY, _t            │
 │  ).slice(0, 16)                │
 │                                │
 │  POST /send-sms                │
 │  { phone, _t, _sign }          │
 │───────────────────────────────>│
 │                                │ 1. 验证 |_t - now| < 5分钟
 │                                │ 2. 重新计算 _sign 并比对
 │                                │ 3. 检查 IP 限流 (5次/分钟)
 │                                │ 4. 检查手机号冷却 (60秒)
 │                                │ 5. 发送短信
 │  { code: 200 }                 │
 │<───────────────────────────────│
```

### 安全要点

| 安全措施 | 实现 |
|---------|------|
| 密码存储 | bcrypt 哈希，自动生成 salt |
| 接口认证 | JWT Bearer Token，30 天过期 |
| SMS 防刷 | HMAC-SHA256 签名 + IP 限流（5次/分钟）+ 手机号冷却（60秒） |
| SQL 注入 | 参数化查询（mysql2 prepared statements） |
| 订单安全 | 用户隔离：只能查询和操作自己的订单 |
| 余额安全 | 创建订单即时扣款 + 取消全额退款，事务性操作 |
| 配置安全 | 全部敏感配置通过环境变量，`.env` 不提交 Git |

---

## 环境变量

复制 `.env.example` 为 `.env`，按需修改：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_HOST` | `localhost` | MySQL 主机地址 |
| `DB_USER` | `zhjy` | 数据库用户名 |
| `DB_PASSWORD` | `123456lzx` | 数据库密码 |
| `DB_NAME` | `zhjy` | 数据库名 |
| `DB_CONNECTION_LIMIT` | `10` | 连接池最大连接数 |
| `JWT_SECRET` | `zhihui-yiyang-2024-secret-key` | JWT 签名密钥 |
| `API_SIGN_KEY` | `zhihui-yiyang-2024-api-sign` | SMS 签名密钥 |
| `MUSIC_U_COOKIE` | — | 网易云音乐 Cookie（QR 登录后自动写入） |

---

## 启动流程

```
node server.js
  │
  ├─ 1. dotenv 加载 .env
  ├─ 2. 创建 Express 应用 + 注册中间件
  ├─ 3. 挂载 4 组路由
  ├─ 4. 注册健康检查端点
  ├─ 5. initDatabase()
  │     ├─ CREATE TABLE IF NOT EXISTS users
  │     ├─ 向后兼容列迁移 (ALTER TABLE)
  │     ├─ 补全旧用户 user_id
  │     ├─ CREATE TABLE IF NOT EXISTS sms_codes
  │     └─ CREATE TABLE IF NOT EXISTS orders
  └─ 6. 监听 0.0.0.0:4001
```

---

## 开发与部署

```bash
# 开发
npm install
node server.js              # http://localhost:4001

# 生产（PM2）
pm2 start server.js --name zhihui-yiyang-api
pm2 save

# 健康检查
curl http://localhost:4001/api/health
```
