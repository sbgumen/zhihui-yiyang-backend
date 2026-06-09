# 智绘颐养 (Zhihui Yiyang) — 后端 API 服务

<div align="center">

> 智绘颐养智慧养老服务平台后端 REST API

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.18-green?logo=express)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql)](https://www.mysql.com/)
[![JWT](https://img.shields.io/badge/JWT-9.0-blue)](https://jwt.io/)

</div>

---

## 目录

- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [数据库设计](#数据库设计)
- [API 接口文档](#api-接口文档)
- [认证机制](#认证机制)
- [安全设计](#安全设计)
- [部署指南](#部署指南)
- [环境变量](#环境变量)

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 18+ | 运行时 |
| Express.js | 4.18 | HTTP 框架 |
| mysql2 | 3.9 | MySQL 连接池（promise 模式） |
| jsonwebtoken | 9.0 | JWT 签发与验证（30 天有效期） |
| bcrypt | 5.1 | 密码哈希 |
| cors | 2.8 | 跨域资源共享 |
| dotenv | 17.4 | 环境变量管理 |
| NeteaseCloudMusicApi | 4.32 | 网易云音乐 API 封装 |
| qrcode | 1.5 | 二维码生成 |
| spug.cc | — | 短信验证码推送（外部 API） |

---

## 项目结构

```
zhihui-yiyang-后端/
├── server.js                    # 应用入口：Express 配置、DB 初始化、路由挂载
├── config/
│   └── db.js                    # MySQL 连接池配置
├── middleware/
│   └── auth.js                  # JWT 认证中间件 + HMAC 签名工具函数
├── routes/
│   ├── auth.js                  # 认证路由：短信、登录、注册、设置密码
│   ├── user.js                  # 用户路由：资料、充值、改密
│   ├── order.js                 # 订单路由：创建、列表、取消、确认
│   └── music.js                 # 音乐路由：网易云音乐代理
├── package.json
└── .env                         # 网易云音乐 Cookie（可选）
```

---

## 快速开始

### 前置条件

- Node.js >= 18
- MySQL >= 8.0
- npm >= 9

### 安装与启动

```bash
# 1. 安装依赖
npm install

# 2. 创建数据库（MySQL）
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS zhjy DEFAULT CHARACTER SET utf8mb4;"

# 3. 检查数据库配置
# 编辑 config/db.js，确保以下配置与你的 MySQL 一致：
#   host: 'localhost'
#   user: 'zhjy'
#   password: 'your-password'
#   database: 'zhjy'

# 4. 启动服务（首次启动自动建表）
node server.js
# 服务运行在 http://0.0.0.0:4001
```

### 验证

```bash
curl http://localhost:4001/api/health
# 响应: { "code": 200, "message": "服务运行正常" }
```

---

## 数据库设计

### 数据库: `zhjy`

服务首次启动时自动创建以下三张表，并执行向后兼容的列迁移。

### 1. users — 用户表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INT | AUTO_INCREMENT, PRIMARY KEY | 内部主键 |
| `user_id` | VARCHAR(10) | UNIQUE, NOT NULL | 展示用用户ID（5位数字，从 10000+ 递增） |
| `account` | VARCHAR(50) | UNIQUE, NULL | 登录账号名 |
| `phone` | VARCHAR(20) | UNIQUE, NULL | 手机号 |
| `password` | VARCHAR(255) | DEFAULT NULL | bcrypt 哈希密码（NULL = 仅手机号登录） |
| `nickname` | VARCHAR(50) | DEFAULT '' | 昵称 |
| `gender` | ENUM('male','female','unknown') | DEFAULT 'unknown' | 性别 |
| `avatar` | VARCHAR(500) | DEFAULT '' | 头像 URL |
| `balance` | DECIMAL(10,2) | DEFAULT 0.00 | 钱包余额 |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | 注册时间 |

**索引**: `user_id` (UNIQUE), `account` (UNIQUE), `phone` (UNIQUE)

### 2. sms_codes — 短信验证码表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INT | AUTO_INCREMENT, PRIMARY KEY | 主键 |
| `phone` | VARCHAR(20) | NOT NULL, INDEX | 目标手机号 |
| `code` | VARCHAR(10) | NOT NULL | 6 位数字验证码 |
| `expires_at` | BIGINT | NOT NULL | 过期时间（Unix 毫秒时间戳） |
| `used` | TINYINT | DEFAULT 0 | 0 = 未使用，1 = 已使用 |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | 创建时间 |

### 3. orders — 订单表

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INT | AUTO_INCREMENT, PRIMARY KEY | 主键 |
| `order_no` | VARCHAR(50) | UNIQUE, NOT NULL | 订单号（格式: `ORD` + 时间戳 + 4位随机码） |
| `user_id` | INT | NOT NULL | 用户 ID（外键 → users.id） |
| `items` | TEXT | NOT NULL | 订单商品列表（JSON 字符串） |
| `total_price` | DECIMAL(10,2) | NOT NULL | 订单总金额 |
| `status` | ENUM('pending','confirmed','cancelled') | DEFAULT 'pending' | 订单状态 |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | 创建时间 |

**订单状态流转**:
```
pending ──→ confirmed (确认)
pending ──→ cancelled (取消，自动退款)
```

---

## API 接口文档

### 基础信息

- **Base URL**: `http://<host>:4001/api`
- **Content-Type**: `application/json`
- **统一响应格式**:
  ```json
  { "code": 200, "data": { ... }, "message": "success" }
  // 或
  { "code": 400, "message": "错误描述" }
  ```

---

### 1. 健康检查

#### `GET /api/health`

服务状态检查。

**响应**:
```json
{
  "code": 200,
  "message": "服务运行正常"
}
```

---

### 2. 认证接口 `/api/auth`

#### `POST /api/auth/send-sms` — 发送短信验证码

> **需要 HMAC-SHA256 签名验证 + IP 限流**

**请求体**:
```json
{
  "phone": "13800138000",
  "_t": 1700000000000,
  "_sign": "a1b2c3d4e5f6a7b8"
}
```

**签名算法**: `_sign = HMAC-SHA256(key, _t).substring(0, 16)`，key 为 `zhihui-yiyang-2024-api-sign`

**限流**: 每 IP 每分钟最多 5 次，同一手机号 60 秒冷却

**响应**:
```json
{
  "code": 200,
  "message": "验证码已发送"
}
```

#### `POST /api/auth/phone-login` — 手机号 + 验证码登录

**请求体**:
```json
{
  "phone": "13800138000",
  "code": "123456"
}
```

**说明**: 若手机号未注册，自动创建新用户并登录。

**响应**:
```json
{
  "code": 200,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": 1,
      "user_id": "10001",
      "phone": "138****8000",
      "nickname": "",
      "gender": "unknown",
      "avatar": "",
      "balance": 0.00,
      "hasPassword": false
    }
  }
}
```

#### `POST /api/auth/login` — 账号/密码登录

**请求体**:
```json
{
  "account": "zhangsan",
  "password": "123456"
}
```

**说明**: `account` 字段支持匹配 `account`、`phone` 或 `user_id` 列。

#### `POST /api/auth/register` — 账号/密码注册

**请求体**:
```json
{
  "account": "zhangsan",
  "password": "123456",
  "nickname": "张三"
}
```

**校验**: 密码长度 ≥ 6 字符。

#### `POST /api/auth/set-password` — 设置/修改密码

> **需要 JWT 认证**

**请求体**:
```json
{
  "oldPassword": "old123456",
  "newPassword": "new123456"
}
```

**说明**: 若用户当前无密码（仅手机号登录），则 `oldPassword` 无需提供。

---

### 3. 用户接口 `/api/user`

> 以下接口均需 JWT 认证（`Authorization: Bearer <token>`）

#### `GET /api/user/profile` — 获取用户资料

**响应**:
```json
{
  "code": 200,
  "data": {
    "id": 1,
    "user_id": "10001",
    "account": "zhangsan",
    "phone": "13800138000",
    "nickname": "张三",
    "gender": "male",
    "avatar": "https://example.com/avatar.jpg",
    "balance": 50.00,
    "hasPassword": true,
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### `PUT /api/user/profile` — 更新用户资料

**请求体**:
```json
{
  "nickname": "张三",
  "gender": "male",
  "avatar": "https://example.com/avatar.jpg"
}
```

**可更新字段**: `nickname`, `gender`, `avatar`

#### `POST /api/user/recharge` — 余额充值

**请求体**:
```json
{
  "amount": 100.00
}
```

**校验**: `amount` 必须 > 0

**响应**:
```json
{
  "code": 200,
  "data": { "balance": 150.00 },
  "message": "充值成功"
}
```

#### `POST /api/user/change-password` — 修改密码

**请求体**:
```json
{
  "oldPassword": "old123456",
  "newPassword": "new123456"
}
```

**校验**: 若用户已有密码，必须验证 `oldPassword`。`newPassword` 长度 ≥ 6。

---

### 4. 订单接口 `/api/order`

> 以下接口均需 JWT 认证（`Authorization: Bearer <token>`）

#### `POST /api/order/create` — 创建订单

**请求体**:
```json
{
  "items": [
    { "id": 1, "name": "红烧肉", "price": 25.00, "quantity": 2 }
  ],
  "totalPrice": 50.00
}
```

**说明**: 创建订单时**即时扣款**：检查余额 → 扣除金额 → 创建订单（状态：pending）。

**响应**:
```json
{
  "code": 200,
  "data": {
    "orderNo": "ORD1700000000AB12",
    "balance": 100.00
  },
  "message": "下单成功"
}
```

#### `GET /api/order/list` — 获取订单列表

**响应**:
```json
{
  "code": 200,
  "data": [
    {
      "id": 1,
      "order_no": "ORD1700000000AB12",
      "items": [
        { "id": 1, "name": "红烧肉", "price": 25.00, "quantity": 2 }
      ],
      "total_price": 50.00,
      "status": "pending",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

#### `POST /api/order/cancel` — 取消订单

**请求体**:
```json
{
  "orderNo": "ORD1700000000AB12"
}
```

**说明**: 仅可取消 `pending` 状态订单。取消后**全额退款**到用户余额，状态变为 `cancelled`。

#### `POST /api/order/confirm` — 确认订单

**请求体**:
```json
{
  "orderNo": "ORD1700000000AB12"
}
```

**说明**: 仅可确认 `pending` 状态订单，确认后状态变为 `confirmed`。

---

### 5. 音乐接口 `/api/music`

> 网易云音乐代理接口，首次使用需扫码登录。

#### `GET /api/music/login/qr/create` — 生成登录二维码

**响应**:
```json
{
  "code": 200,
  "data": {
    "qrimg": "data:image/png;base64,...",
    "key": "abc123..."
  }
}
```

#### `GET /api/music/login/qr/check?key=abc123...` — 查询扫码状态

**响应** (已扫码登录):
```json
{
  "code": 200,
  "data": { "code": 803, "message": "授权登录成功" }
}
```

成功登录后 Cookie 自动持久化到 `.env` 文件。

#### `GET /api/music/login/status` — 获取登录状态

**响应**:
```json
{
  "code": 200,
  "data": {
    "loggedIn": true,
    "user": { "nickname": "用户昵称", "avatarUrl": "https://..." }
  }
}
```

#### `POST /api/music/login/logout` — 退出登录

清除网易云音乐 Cookie（内存 + `.env` 文件）。

#### `GET /api/music/search?keywords=方大同&limit=30` — 搜索歌曲

**说明**: 自动用 `song/detail` 补充搜索结果中的专辑封面 `picUrl`。

#### `GET /api/music/song/url?id=xxx&level=standard` — 获取歌曲播放 URL

#### `GET /api/music/lyric?id=xxx` — 获取歌词

#### `GET /api/music/audio/:id?level=standard` — 音频流

直接代理音频文件流，设置正确的 Content-Type、Content-Length、Range 和 Cache-Control 头。

#### `GET /api/music/image?url=xxx` — 图片代理

代理获取图片（24 小时缓存）。

#### `GET /api/music/playlist?id=xxx` — 获取歌单详情

#### `GET /api/music/playlist/hot` — 热门歌单（Top 10）

#### `GET /api/music/song/detail?ids=xxx,yyy` — 歌曲详情

#### `GET /api/music/likelist` — 收藏歌单

获取已登录用户的收藏歌曲列表（最多 50 首）。

---

## 认证机制

### JWT 认证

- **密钥**: 硬编码于 `middleware/auth.js`
- **Token 有效期**: 30 天
- **Token 载荷**: `{ id: number, user_id: string }`
- **Token 格式**: `Authorization: Bearer <token>`

### API 签名（SMS 专用）

- **密钥**: `zhihui-yiyang-2024-api-sign`
- **主算法**: HMAC-SHA256(timestamp).substring(0, 16)
- **备选算法**: 简化版迭代哈希（HTTP 环境降级）
- **时间窗口**: 时间戳误差 ±5 分钟

### 短信限流

- **实现**: 内存 Map（IP → 请求记录数组）
- **限制**: 每 IP 每 60 秒窗口最多 5 次请求
- **清理**: 每 5 分钟清理过期记录

---

## 安全设计

| 安全点 | 实现方式 |
|--------|---------|
| 密码存储 | bcrypt 哈希（salt 自动生成） |
| 接口认证 | JWT Token（30 天过期） |
| SMS 防刷 | HMAC-SHA256 签名 + IP 限流 + 60s 冷却 |
| CORS | 全局启用，允许所有来源 |
| SQL 注入 | 参数化查询（mysql2 prepared statements） |
| 订单安全 | 用户隔离（只能操作自己的订单） |
| Cookie 持久化 | 网易云 Cookie 写入 .env，重启不丢失 |

---

## 部署指南

### 直接部署

```bash
# 1. 安装依赖
npm install --production

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env（如需）

# 3. 启动服务
node server.js
```

### PM2 部署（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start server.js --name zhihui-yiyang-api

# 保存进程列表（开机自启）
pm2 save
pm2 startup

# 查看状态
pm2 status

# 查看日志
pm2 logs zhihui-yiyang-api
```

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Docker 部署

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 4001
CMD ["node", "server.js"]
```

---

## 环境变量

所有敏感配置已通过 `.env` 文件管理。复制 `.env.example` 为 `.env` 并修改对应值。

### `.env` 完整配置

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DB_HOST` | 否 | `localhost` | MySQL 主机地址 |
| `DB_USER` | 否 | `zhjy` | 数据库用户名 |
| `DB_PASSWORD` | 否 | `123456lzx` | 数据库密码 |
| `DB_NAME` | 否 | `zhjy` | 数据库名 |
| `DB_CONNECTION_LIMIT` | 否 | `10` | 连接池大小 |
| `JWT_SECRET` | 否 | `zhihui-yiyang-2024-secret-key` | JWT 签名密钥（**生产环境务必修改**） |
| `API_SIGN_KEY` | 否 | `zhihui-yiyang-2024-api-sign` | SMS 接口 HMAC 签名密钥（**生产环境务必修改**） |
| `MUSIC_U_COOKIE` | 否 | — | 网易云音乐登录 Cookie（QR 登录后自动写入） |

> 开发时无需配置 `.env` 也可运行，所有变量均有默认值。生产环境请务必修改 `JWT_SECRET` 和 `API_SIGN_KEY`。

---

## 启动流程

`server.js` 启动时会依次执行：

1. 加载 `.env` 环境变量
2. 初始化 MySQL 连接池
3. 自动创建 `users`、`sms_codes`、`orders` 三张表（如不存在）
4. 执行列迁移（向后兼容旧表结构）
5. 挂载所有路由（auth / user / order / music）
6. 监听 4001 端口（绑定 `0.0.0.0`）

---

## 前端项目

前端项目请查看 [智绘颐养前端](../zhihui-yiyang/README.md)。

---

<div align="center">

**智绘颐养后端服务** — 为智慧养老提供稳定可靠的 API 支撑

</div>
